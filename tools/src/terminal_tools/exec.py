"""``terminal_exec`` — foreground exec with auto-promotion to background.

The flagship tool. Most agent terminal interactions go through here:
fast commands (<30s) return inline with the standard envelope; longer
commands silently transition into the JobManager and surface a
``job_id`` so the agent can poll. The "should I background this?"
decision is removed — the answer is always yes-if-needed.

Implementation notes:
  - We spawn the process the same way JobManager does, then wait with
    ``proc.wait(timeout=auto_background_after_sec)``. Inline path
    drains pipes via ``proc.communicate()`` to avoid pipe-fill
    deadlocks.
  - Auto-promotion: when the timeout fires while the process is still
    running, we already have its stdin/stdout/stderr file objects.
    We hand them to JobManager which spawns pump threads to fill ring
    buffers from that point on. The agent sees an envelope with
    ``auto_backgrounded=True, exit_code=None, job_id=<…>`` and
    transitions to ``terminal_job_logs``. **There's no early-output loss**
    because the pumps start before we return from the tool call.
  - For pure-foreground use (``auto_background_after_sec=0``), we
    fall back to ``proc.communicate(timeout=timeout_sec)`` which has
    the simpler "kill on overall timeout" semantics.
"""

from __future__ import annotations

import os
import shlex
import subprocess
import threading
import time
from typing import TYPE_CHECKING

from terminal_tools.common.command_guard import check_command
from terminal_tools.common.limits import (
    ZshRefused,
    coerce_limits,
    make_preexec_fn,
    resolve_shell_spec,
    sanitized_env,
)
from terminal_tools.common.ring_buffer import RingBuffer
from terminal_tools.common.truncation import build_exec_envelope
from terminal_tools.jobs.manager import JobLimitExceeded, get_manager

if TYPE_CHECKING:
    from fastmcp import FastMCP


# Tokens that indicate the user passed a shell-syntax command (pipes,
# redirects, conditional chains) rather than an argv list. When any of
# these appear as standalone tokens in shlex.split(command), we silently
# route the command through /bin/bash -c instead of trying to exec it
# directly — the alternative is spawning the first program with the rest
# of the line as junk argv, which either errors or returns fake success
# (e.g. `echo "..." && ps ...` → echo prints the literal command).
_SHELL_METACHARS: frozenset[str] = frozenset({"|", "&&", "||", ";", ">", "<", ">>", "<<", "&", "2>", "2>&1", "|&"})


def register_exec_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def terminal_exec(
        command: str,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout_sec: int = 60,
        auto_background_after_sec: int = 30,
        shell: bool = False,
        stdin: str | None = None,
        limits: dict[str, int] | None = None,
        max_output_kb: int = 256,
        session_cwd: str | None = None,
        crm_principal: str | None = None,
    ) -> dict:
        """Run a shell command and capture its output.

        Past auto_background_after_sec, the call auto-promotes to a background
        job and returns immediately with `auto_backgrounded=True, job_id=...`
        — poll with terminal_job_logs(job_id, since_offset=...) to read the rest.
        Set auto_background_after_sec=0 to force pure foreground (kill on
        timeout_sec).

        Bash-only on POSIX. Passing shell="/bin/zsh" raises an error — this is
        a deliberate security stance.

        Args:
            command: The command. With shell=False we naively split on
                whitespace; for pipes / quoting / globs use shell=True.
            cwd: Working directory. Defaults to the session workdir when
                omitted; pass an absolute path to override (loose default,
                not a sandbox — you can point anywhere).
            env: Environment override (merged into a sanitized base — zsh
                dotfile vars are stripped).
            timeout_sec: Hard kill deadline. Past this, the process is
                terminated and `timed_out=True` is returned. Should be ≥
                auto_background_after_sec for the auto-promote path to work.
            auto_background_after_sec: Inline budget. Past this, promote to
                a background job and return. 0 disables auto-promotion.
            shell: True for `/bin/bash -c <command>`. zsh refused.
            stdin: Optional stdin payload (string).
            limits: Optional setrlimit caps. Keys: cpu_sec, rss_mb,
                fsize_mb, nofile.
            max_output_kb: Inline output cap. Overflow stashes to an
                output_handle for retrieval via terminal_output_get.

        Returns the standard envelope: see `terminal-tools-foundations` skill.
        """
        # Hard guard: browser/runtime kill+launch commands never spawn.
        # (destructive_warning stays advisory; this one blocks.)
        blocked = check_command(command)
        if blocked is not None:
            envelope = _err_envelope(command, blocked)
            envelope["blocked"] = True
            return envelope

        # Auto-detect shell-syntax commands. If the agent passes
        # ``shell=False`` (the default) but the command contains a pipe,
        # redirect, ``&&``, etc., naive argv splitting silently mangles
        # it — exec the first token with the rest as junk arguments.
        # Detect that case and transparently route through bash -c, then
        # surface an ``auto_shell=True`` flag in the envelope so the
        # foundational skill / agent feedback loop can learn from it.
        auto_shell = False
        try:
            if shell:
                # User opted in; trust them.
                pass
            else:
                try:
                    tokens = shlex.split(command, posix=True)
                except ValueError:
                    # Unbalanced quotes — almost certainly meant for the shell.
                    auto_shell = True
                    tokens = []
                if not auto_shell:
                    if not tokens:
                        return _err_envelope(command, "command was empty")
                    if any(t in _SHELL_METACHARS for t in tokens) or any(
                        # globs that shlex left unexpanded (`*`, `?`, `[`)
                        any(c in t for c in "*?[") and t != "["
                        for t in tokens
                    ):
                        auto_shell = True

            # Framework-injected, never agent-supplied (a CONTEXT_PARAM, so it
            # is stripped from the LLM-facing schema). `hive-crm` reads it as its
            # acting identity; without it the CRM backend falls back to the human
            # and every agent gets the user's own permissions.
            if crm_principal:
                env = {**(env or {}), "HIVE_CRM_PRINCIPAL": crm_principal}
            full_env = sanitized_env(env) if env is not None else None
            preexec = make_preexec_fn(coerce_limits(limits))
        except ZshRefused as e:
            return _err_envelope(command, str(e))

        effective_shell: bool | str = True if auto_shell else shell

        # Resolve shell here so the same logic the JobManager uses applies
        # in both the inline + promoted paths.
        try:
            spec = resolve_shell_spec(effective_shell)
            # Windows has no useful direct-exec path: POSIX coreutils (cat,
            # grep, sed, find) aren't native binaries and shlex tokenization
            # is POSIX-shaped, so a bare `cat foo` would FileNotFound. Route
            # every command through the resolved platform shell (Git Bash →
            # PowerShell → cmd). POSIX keeps the fast direct-exec path.
            if spec.executable is None and os.name == "nt":
                spec = resolve_shell_spec(True)
        except ZshRefused as e:
            return _err_envelope(command, str(e))

        shell_kind = spec.kind
        if spec.executable is not None:
            spawn_argv: list[str] = spec.build_argv(command)
        else:
            # shell=False AND no metacharacters → safe to direct-exec.
            spawn_argv = tokens

        # Loose, optimistic default: when the agent omits cwd, fall back to the
        # framework-injected session workdir. Not a sandbox — an explicit cwd
        # always wins and the agent may point anywhere. The promoted background
        # job inherits this because it adopts the already-spawned proc.
        effective_cwd = cwd if cwd is not None else session_cwd
        start = time.monotonic()
        try:
            proc = subprocess.Popen(
                spawn_argv,
                cwd=effective_cwd,
                env=full_env,
                # No stdin payload → DEVNULL, never inherit. This tool runs
                # inside a stdio MCP server whose own stdin IS the JSON-RPC
                # pipe; inheriting it makes the shell share the server's
                # protocol stream, which deadlocks on Windows (every command
                # hangs with zero output). DEVNULL also means a command that
                # reads stdin (cmd `date`, `read`, ssh) gets EOF and fails
                # fast instead of blocking forever.
                stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                preexec_fn=preexec,
                close_fds=True,
                bufsize=0,
                # Headless: don't pop or attach a console for the child shell.
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except FileNotFoundError as e:
            return _err_envelope(command, f"command not found: {e}")
        except OSError as e:
            return _err_envelope(command, f"spawn failed: {e}")

        # Push stdin without blocking on the process draining it. For
        # large stdin payloads this would deadlock; for typical agent
        # use (small payloads or None) it's fine.
        if stdin is not None and proc.stdin is not None:
            try:
                proc.stdin.write(stdin.encode("utf-8"))
                proc.stdin.close()
            except (BrokenPipeError, OSError):
                pass

        # Pump stdout/stderr into ring buffers so we don't deadlock on
        # full pipes during the wait. These same buffers become the
        # job's buffers if we auto-promote.
        stdout_buf = RingBuffer()
        stderr_buf = RingBuffer()
        pumps: list[threading.Thread] = []

        def _pump(stream, ring: RingBuffer) -> None:
            try:
                while True:
                    chunk = stream.read(4096)
                    if not chunk:
                        break
                    ring.write(chunk)
            except (OSError, ValueError):
                pass
            finally:
                try:
                    stream.close()
                except Exception:
                    pass
                ring.close()

        if proc.stdout is not None:
            t = threading.Thread(target=_pump, args=(proc.stdout, stdout_buf), daemon=True)
            t.start()
            pumps.append(t)
        if proc.stderr is not None:
            t = threading.Thread(target=_pump, args=(proc.stderr, stderr_buf), daemon=True)
            t.start()
            pumps.append(t)

        # Wait for either: auto-bg budget, hard timeout, or natural exit.
        promoted = False
        timed_out = False
        budget = auto_background_after_sec if auto_background_after_sec > 0 else timeout_sec
        budget = min(budget, timeout_sec) if timeout_sec > 0 else budget

        try:
            proc.wait(timeout=budget if budget > 0 else None)
        except subprocess.TimeoutExpired:
            if auto_background_after_sec > 0:
                # Promote: the process keeps running, we hand its
                # already-pumping buffers to the JobManager.
                try:
                    record = get_manager().adopt_running(
                        proc,
                        spawn_argv if spec.executable is None else command,
                        merged=False,
                        existing_stdout_buf=stdout_buf,
                        existing_stderr_buf=stderr_buf,
                        existing_pumps=pumps,
                    )
                    promoted = True
                    return build_exec_envelope(
                        command=command,
                        exit_code=None,
                        stdout_bytes=stdout_buf.tail(64 * 1024).data,
                        stderr_bytes=stderr_buf.tail(64 * 1024).data,
                        runtime_ms=int((time.monotonic() - start) * 1000),
                        pid=proc.pid,
                        timed_out=False,
                        max_output_kb=max_output_kb,
                        auto_backgrounded=True,
                        job_id=record.job_id,
                        auto_shell=auto_shell,
                        shell_kind=shell_kind,
                    )
                except JobLimitExceeded:
                    # Cap reached; treat as a hard timeout rather than spin.
                    pass
            # Fall through to hard-kill path.
            try:
                proc.terminate()
                proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            timed_out = True

        # Inline path: drain pump threads.
        for t in pumps:
            t.join(timeout=2.0)

        runtime_ms = int((time.monotonic() - start) * 1000)
        exit_code = proc.returncode if not promoted else None

        # The whole stream is in the ring; read from offset 0 to grab everything.
        stdout_full = stdout_buf.read(0, stdout_buf.total_written).data
        stderr_full = stderr_buf.read(0, stderr_buf.total_written).data

        return build_exec_envelope(
            command=command,
            exit_code=exit_code,
            stdout_bytes=stdout_full,
            stderr_bytes=stderr_full,
            runtime_ms=runtime_ms,
            pid=proc.pid,
            timed_out=timed_out,
            signaled=(exit_code is not None and exit_code < 0),
            max_output_kb=max_output_kb,
            auto_shell=auto_shell,
            shell_kind=shell_kind,
        )


def _err_envelope(command: str, message: str) -> dict:
    """Construct an envelope-shaped error reply for pre-spawn failures."""
    return {
        "exit_code": None,
        "stdout": "",
        "stderr": message,
        "stdout_truncated_bytes": 0,
        "stderr_truncated_bytes": 0,
        "runtime_ms": 0,
        "pid": None,
        "output_handle": None,
        "timed_out": False,
        "semantic_status": "error",
        "semantic_message": message,
        "warning": None,
        "auto_backgrounded": False,
        "job_id": None,
        "auto_shell": False,
        "shell_kind": None,
        "error": message,
    }


__all__ = ["register_exec_tools"]
