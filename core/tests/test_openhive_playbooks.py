"""Smoke tests for the linkedin-connection-outbound playbook recipes.

The skill no longer bundles playbook files — it DESCRIBES the four playbooks the
queen authors, embedding each as a copy-verbatim ```python recipe in SKILL.md.
These tests extract those embedded recipes and run each through the REAL playbook
runner with a fake in-memory tracker + worker, so the code the queen copies stays
verified: it compiles, its `pending()` returns rows (not a COUNT), its `dispatch`
lambda builds its task string without KeyError, and the hardened invariants (20/day
cap, no-note invites, hooks capture, bulk poll, li_dm approval + no-fabrication)
hold. They do NOT exercise the live browser — the worker task is just an
inspectable string.
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

from framework.host.playbook.runner import PlaybookRun, run_playbook_script

_SKILL_MD = (
    Path(__file__).resolve().parents[1]
    / "framework/skills/_default_skills/linkedin-connection-outbound/SKILL.md"
)


def _unused(*_a, **_k):  # PlaybookRun.load() never calls these; only satisfies the ctor
    raise AssertionError("dispatch_one/query_rows must not be called during load()")


def _playbook_blocks() -> dict[str, str]:
    """Extract the embedded ```python playbook recipes from SKILL.md, keyed by
    each script's meta name. A fenced block counts as a playbook only if it loads
    (compiles + defines meta+run) — prose/example fences are skipped."""
    text = _SKILL_MD.read_text(encoding="utf-8")
    blocks: dict[str, str] = {}
    for body in re.findall(r"```python\n(.*?)```", text, re.DOTALL):
        probe = PlaybookRun(dispatch_one=_unused, query_rows=_unused, run_id="probe")
        try:
            probe.load(body)
        except Exception:
            continue  # not a playbook (an example snippet) — ignore
        name = (probe._meta or {}).get("name")
        if name:
            blocks[name] = body
    return blocks


def _script(name: str) -> str:
    return _playbook_blocks()[name]


class FakePlaybookColony:
    """One canned row for every SELECT; a worker that just succeeds.

    The fake never advances the row (the real advance is a tracker_upsert inside
    the worker, which we don't run), so with max_rounds=1 each playbook dispatches
    exactly its pending set once and then dead-letters the still-pending row —
    which is fine: we assert on dispatch count + the task strings, not convergence.
    """

    ROW = {
        "profile_url": "https://www.linkedin.com/in/jane-doe/",
        "name": "Jane Doe",
        "headline": "Head of GTM",
        "degree": "2nd",
        "hooks": '{"angle": "loved your GTM post"}',
        "message_link_url": None,
        "recheck_count": 0,
    }

    def __init__(self):
        self.dispatched = 0
        self.tasks_seen: list[str] = []

    def query_rows(self, sql):
        return [dict(self.ROW)]

    async def dispatch_one(self, task, *, data=None, profile=None, timeout=None, schema=None):
        self.dispatched += 1
        self.tasks_seen.append(task)
        return {"status": "success", "summary": "ok", "data": {"profile_url": self.ROW["profile_url"], "status": "ok"}}


def _run(name: str, args=None):
    colony = FakePlaybookColony()
    out = asyncio.run(
        run_playbook_script(
            _script(name),
            args=args,
            dispatch_one=colony.dispatch_one,
            query_rows=colony.query_rows,
            run_id=f"test-{name}",
        )
    )
    return colony, out


def test_all_playbooks_load_and_declare_meta():
    # Pure load/compile check via the runner's loader (meta + async run present).
    from framework.host.playbook.runner import PlaybookRun

    for name in ("li_scan", "li_invite", "li_poll", "li_dm"):
        colony = FakePlaybookColony()
        r = PlaybookRun(dispatch_one=colony.dispatch_one, query_rows=colony.query_rows, run_id="t")
        r.load(_script(name))
        assert (r._meta or {}).get("name") == name


def test_li_scan_dispatches_one_scan_worker():
    colony, out = _run("li_scan", args={"keywords": "go-to-market teaching"})
    assert colony.dispatched == 1
    assert "lk_scan_post_reactors" in colony.tasks_seen[0]
    assert "lk_search_content" in colony.tasks_seen[0]


def test_li_scan_author_mode():
    colony, _ = _run("li_scan", args={"author_profile": "simonrohrbach"})
    assert "lk_scan_user_posts" in colony.tasks_seen[0]


def test_li_scan_requires_an_arg():
    colony, out = _run("li_scan", args={})
    assert colony.dispatched == 0
    assert "error" in out["result"]


def test_li_invite_dispatches_no_note_invite():
    colony, _ = _run("li_invite", args={"daily_cap": 1})
    assert colony.dispatched == 1
    task = colony.tasks_seen[0]
    assert "lk_send_invite" in task
    assert "note=None" in task
    assert "https://www.linkedin.com/in/jane-doe/" in task


def test_li_poll_bulk_scans_connections():
    # One bulk connection-list scan, NOT one profile check per invited row.
    colony, _ = _run("li_poll")
    assert colony.dispatched == 1
    task = colony.tasks_seen[0]
    assert "lk_scan_connections" in task
    assert "lk_check_connection_status" not in task  # no per-profile loop
    assert "message_link_url" in task  # harvests the compose URL for li_dm


def test_li_dm_refuses_without_approval():
    # The reply-text policy enforced in code: no approved_message => no dispatch.
    colony, out = _run("li_dm", args={"daily_cap": 1})
    assert colony.dispatched == 0
    assert "approved_message" in out["result"]["error"]


def test_li_dm_sends_with_approval():
    approved = "Hi {first_name}, loved your GTM post — would value comparing notes on teaching go-to-market."
    colony, _ = _run("li_dm", args={"daily_cap": 1, "approved_message": approved})
    assert colony.dispatched == 1
    task = colony.tasks_seen[0]
    assert "lk_send_to_message_url" in task
    assert approved in task  # the exact approved wording rides into the worker task


def test_li_scan_captures_hooks():
    # Personalization seed must be captured at scan time (was NULL for all rows
    # in the prior run, so DMs were fabricated/generic).
    colony, _ = _run("li_scan", args={"keywords": "go-to-market teaching"})
    task = colony.tasks_seen[0]
    assert "hooks=" in task
    assert "source_post_topic" in task


def test_li_dm_personalizes_from_hooks_without_fabrication():
    approved = "Hi {first_name}, would value comparing notes on go-to-market."
    colony, _ = _run("li_dm", args={"daily_cap": 1, "approved_message": approved})
    task = colony.tasks_seen[0]
    assert "hooks" in task  # draws the personal opener ONLY from the row's hooks
    assert "NEUTRAL opener" in task or "do NOT claim" in task  # no fabricated "you reacted to X"
    assert "not_messageable" in task  # fail-loud on an unresolved compose URL, not a guess


def test_li_invite_hard_caps_at_20_and_skips_companies():
    # The prior run bursted to 80/day; the cap is now clamped in code, and bulk
    # non-person rows are filtered out of pending().
    src = _script("li_invite")
    assert "min(20" in src
    assert "is_company" in src
