"""Repository rules from CLAUDE.md: no CI service, and the pre-push hook runs the checks."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _target(name):
    """The recipe line of a one-line Makefile target."""
    lines = (ROOT / "Makefile").read_text(encoding="utf-8").splitlines()
    index = next(i for i, line in enumerate(lines) if line.startswith(f"{name}:"))
    return lines[index], lines[index + 1].strip()


def test_no_github_workflows_or_dependabot():
    assert not (ROOT / ".github" / "workflows").exists()
    assert not (ROOT / ".github" / "dependabot.yml").exists()


def test_pre_push_hook_runs_the_checks():
    hook = (ROOT / ".githooks" / "pre-push").read_text(encoding="utf-8")
    assert "make check" in hook
    # The container fallback runs the same checks.
    assert "make lint test" in hook
    assert "frontend-tools" in hook


def test_make_check_runs_backend_then_frontend_checks():
    check_line, _ = _target("check")
    assert check_line.split(":", 1)[1].split() == ["lint", "test", "frontend-check"]
    _, recipe = _target("frontend-check")
    assert recipe == "$(PNPM) --dir frontend check"


def test_frontend_check_is_lint_then_vitest():
    package = (ROOT / "frontend" / "package.json").read_text(encoding="utf-8")
    scripts = json.loads(package)["scripts"]
    assert scripts["check"] == "pnpm lint && pnpm test"
    assert scripts["lint"] == "eslint . && prettier --check ."
    assert scripts["test"] == "vitest run"
    # Playwright stays on demand, outside the checks.
    assert "playwright" not in scripts["check"]
