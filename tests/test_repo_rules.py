"""Repository rules from CLAUDE.md: no CI service, and the pre-push hook runs make check."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_no_github_workflows_or_dependabot():
    assert not (ROOT / ".github" / "workflows").exists()
    assert not (ROOT / ".github" / "dependabot.yml").exists()


def test_pre_push_hook_runs_make_check():
    hook = (ROOT / ".githooks" / "pre-push").read_text(encoding="utf-8")
    assert "make check" in hook


def test_make_check_runs_exactly_lint_then_test():
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    check_line = next(line for line in makefile.splitlines() if line.startswith("check:"))
    assert check_line.split(":", 1)[1].split() == ["lint", "test"]
