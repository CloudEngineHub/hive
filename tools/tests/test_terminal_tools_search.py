"""terminal_rg + terminal_glob — basic functionality, structured output."""

from __future__ import annotations

import shutil

import pytest


@pytest.fixture
def search_tools(mcp):
    from terminal_tools.search.tools import register_search_tools

    register_search_tools(mcp)
    return {
        "rg": mcp._tool_manager._tools["terminal_rg"].fn,
        "glob": mcp._tool_manager._tools["terminal_glob"].fn,
    }


@pytest.mark.skipif(not shutil.which("rg"), reason="ripgrep not installed")
def test_rg_finds_pattern(search_tools, tmp_path):
    (tmp_path / "a.txt").write_text("hello\nworld\nfoo\n")
    (tmp_path / "b.txt").write_text("bar\nworld\n")

    result = search_tools["rg"](pattern="world", path=str(tmp_path))
    assert result["total"] >= 2
    paths = {m["path"] for m in result["matches"]}
    assert any("a.txt" in p for p in paths)


@pytest.mark.skipif(not shutil.which("rg"), reason="ripgrep not installed")
def test_rg_no_matches(search_tools, tmp_path):
    (tmp_path / "a.txt").write_text("hello\n")
    result = search_tools["rg"](pattern="zzz_no_match_zzz", path=str(tmp_path))
    assert result["total"] == 0
    assert result["matches"] == []


@pytest.mark.skipif(not shutil.which("rg"), reason="ripgrep not installed")
def test_glob_by_name(search_tools, tmp_path):
    (tmp_path / "alpha.log").write_text("a")
    (tmp_path / "beta.log").write_text("b")
    (tmp_path / "ignore.txt").write_text("c")

    result = search_tools["glob"](pattern="*.log", path=str(tmp_path))
    assert result["count"] == 2
    assert all(p.endswith(".log") for p in result["paths"])


@pytest.mark.skipif(not shutil.which("rg"), reason="ripgrep not installed")
def test_glob_bare_stem_matches_file_with_extension(search_tools, tmp_path):
    """Regression: a bare filename stem (no wildcard, no extension) must find
    the file. The old find -name semantics returned a silent zero here — the
    exact trap that motivated the rewrite. WHY it matters: models routinely
    pass the stem they remember, not a glob, and a silent zero reads as
    "file doesn't exist."
    """
    nested = tmp_path / "scripts"
    nested.mkdir()
    (nested / "lk_scan_post_reactors.py").write_text("x")

    result = search_tools["glob"](pattern="lk_scan_post_reactors", path=str(tmp_path))
    assert result["expanded_pattern"] == "**/*lk_scan_post_reactors*"
    assert any(p.endswith("lk_scan_post_reactors.py") for p in result["paths"]), result


@pytest.mark.skipif(not shutil.which("rg"), reason="ripgrep not installed")
def test_glob_recurses_by_default(search_tools, tmp_path):
    """A glob with a metachar but no '/' should recurse (gets a '**/' prefix)."""
    deep = tmp_path / "a" / "b"
    deep.mkdir(parents=True)
    (deep / "config.py").write_text("x")

    result = search_tools["glob"](pattern="*.py", path=str(tmp_path))
    assert any(p.endswith("config.py") for p in result["paths"]), result


@pytest.mark.skipif(not shutil.which("rg"), reason="ripgrep not installed")
def test_glob_no_matches(search_tools, tmp_path):
    (tmp_path / "a.txt").write_text("x")
    result = search_tools["glob"](pattern="zzz_no_such_file_zzz", path=str(tmp_path))
    assert result["count"] == 0
    assert result["paths"] == []


def test_expand_glob_pattern_rules():
    from terminal_tools.search.tools import _expand_glob_pattern

    # bare stem -> recursive substring
    assert _expand_glob_pattern("lk_scan") == "**/*lk_scan*"
    # has metachar, no slash -> recursive
    assert _expand_glob_pattern("*.py") == "**/*.py"
    # explicit path -> verbatim
    assert _expand_glob_pattern("src/**/*.py") == "src/**/*.py"


def test_walk_fallback_finds_bare_stem(tmp_path):
    """The os.walk fallback (no ripgrep) honors the same expanded pattern."""
    from terminal_tools.search.tools import _expand_glob_pattern, _walk_paths

    nested = tmp_path / "scripts"
    nested.mkdir()
    (nested / "lk_scan_post_reactors.py").write_text("x")

    expanded = _expand_glob_pattern("lk_scan_post_reactors")
    paths, truncated = _walk_paths(expanded, str(tmp_path), 1000, include_ignored=False)
    assert any(p.endswith("lk_scan_post_reactors.py") for p in paths)
    assert truncated is False


def test_rg_falls_back_to_python_walk(search_tools, tmp_path, monkeypatch):
    """terminal_rg must DEGRADE to a Python content walk when ripgrep is
    absent — not hard-fail with 'ripgrep is not installed' (mirrors
    terminal_glob's fallback). Patches which() so this runs on any host."""
    import terminal_tools.search.tools as st

    monkeypatch.setattr(st, "_resolve_rg", lambda: None)

    (tmp_path / "a.txt").write_text("hello\nworld\nfoo\n")
    (tmp_path / "b.py").write_text("bar\nworld\n")

    result = search_tools["rg"](pattern="world", path=str(tmp_path))
    assert "error" not in result, result
    assert result["fallback"] == "python-walk"
    assert result["total"] >= 2
    paths = {m["path"] for m in result["matches"]}
    assert any(p.endswith("a.txt") for p in paths)
    assert any(p.endswith("b.py") for p in paths)


def test_rg_fallback_respects_glob_and_case(search_tools, tmp_path, monkeypatch):
    """The fallback honors the glob filter and ignore_case flag."""
    import terminal_tools.search.tools as st

    monkeypatch.setattr(st, "_resolve_rg", lambda: None)

    (tmp_path / "a.txt").write_text("NEEDLE\n")
    (tmp_path / "b.py").write_text("needle\n")

    result = search_tools["rg"](
        pattern="needle", path=str(tmp_path), glob="*.py", ignore_case=True
    )
    assert result["total"] == 1
    assert result["matches"][0]["path"].endswith("b.py")
    assert result["matches"][0]["line"] == 1


def test_resolve_rg_probes_absolute_paths(tmp_path, monkeypatch):
    """When rg isn't on PATH (stripped GUI/Electron PATH), _resolve_rg probes
    common absolute install locations before giving up."""
    import terminal_tools.search.tools as st

    fake_rg = tmp_path / "rg"
    fake_rg.write_text("#!/bin/sh\n")
    fake_rg.chmod(0o755)

    monkeypatch.setattr(st.shutil, "which", lambda _name: None)
    monkeypatch.setattr(st, "_RG_FALLBACK_PATHS", (str(fake_rg),))
    assert st._resolve_rg() == str(fake_rg)

    # Nothing on PATH and no known location -> None (drives the walk fallback).
    monkeypatch.setattr(st, "_RG_FALLBACK_PATHS", ("/nonexistent/rg",))
    assert st._resolve_rg() is None


def test_walk_grep_max_count_per_file(tmp_path):
    """max_count caps matches per file, like rg -m."""
    from terminal_tools.search.tools import _walk_grep

    (tmp_path / "f.txt").write_text("x\nx\nx\nx\n")
    res = _walk_grep(
        "x",
        str(tmp_path),
        glob=None,
        type_filter=None,
        ignore_case=False,
        max_count=2,
        max_depth=None,
        hidden=False,
        no_ignore=False,
    )
    assert res["total"] == 2
