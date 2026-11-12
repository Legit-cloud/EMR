"""Module boundary rules from CLAUDE.md Section 3, enforced with the standard ast module.

A module may import another module only through its ``services``, ``events`` or
``selectors``. ``apps.core`` is the shared kernel and may be imported anywhere.
Tests and migrations are not checked: tests may build fixtures across modules and
migrations reference other apps by label, not by import.
"""

import ast
from pathlib import Path

APPS_DIR = Path(__file__).resolve().parent.parent / "apps"
ALLOWED_SUBMODULES = {"services", "events", "selectors"}
SHARED_MODULES = {"core"}
SKIPPED_DIRS = {"tests", "migrations"}


def _imported_targets(source: str, package: str) -> list[tuple[int, str]]:
    """Return (line, dotted target) for every import, resolving relative imports."""
    targets = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            targets.extend((node.lineno, alias.name) for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                parts = package.split(".")
                base = parts[: len(parts) - node.level + 1]
                module = ".".join(base + ([node.module] if node.module else []))
            else:
                module = node.module or ""
            targets.extend((node.lineno, f"{module}.{alias.name}") for alias in node.names)
    return targets


def boundary_violations(source: str, package: str) -> list[str]:
    """List the imports in ``source`` (living in ``package``) that break the boundary rules."""
    own = package.split(".")[1]
    violations = []
    for line, target in _imported_targets(source, package):
        parts = target.split(".")
        if len(parts) < 2 or parts[0] != "apps":
            continue
        other = parts[1]
        if other == own or other in SHARED_MODULES:
            continue
        if len(parts) < 3 or parts[2] not in ALLOWED_SUBMODULES:
            violations.append(f"line {line}: imports {target}")
    return violations


def _package_for(path: Path) -> str:
    """Dotted package containing the file, e.g. apps/billing/api/views.py -> apps.billing.api."""
    relative = path.relative_to(APPS_DIR.parent).with_suffix("")
    return ".".join(relative.parts[:-1])


def test_modules_import_each_other_only_through_services_events_or_selectors():
    problems = []
    for path in sorted(APPS_DIR.rglob("*.py")):
        if SKIPPED_DIRS.intersection(path.relative_to(APPS_DIR).parts):
            continue
        package = _package_for(path)
        if package == "apps":
            continue
        for violation in boundary_violations(path.read_text(encoding="utf-8"), package):
            problems.append(f"{path.relative_to(APPS_DIR.parent)} {violation}")
    assert not problems, "Module boundary violations:\n" + "\n".join(problems)


def test_checker_flags_direct_model_import():
    source = "from apps.billing.models import Invoice\n"
    assert boundary_violations(source, "apps.pharmacy") == [
        "line 1: imports apps.billing.models.Invoice"
    ]


def test_checker_flags_relative_and_bare_imports():
    source = "from ..billing import models\nimport apps.billing.tasks\nimport apps.billing\n"
    assert len(boundary_violations(source, "apps.pharmacy")) == 3


def test_checker_resolves_relative_imports_from_subpackages():
    source = "from ...billing.models import Invoice\nfrom ..models import Prescription\n"
    assert boundary_violations(source, "apps.pharmacy.api") == [
        "line 1: imports apps.billing.models.Invoice"
    ]


def test_checker_allows_services_events_selectors_core_and_own_module():
    source = (
        "from apps.billing import services\n"
        "from apps.billing.events import invoice_paid\n"
        "import apps.patients.selectors\n"
        "from apps.core.models import TenantModel\n"
        "from apps.pharmacy.models import Prescription\n"
        "from .models import Stock\n"
    )
    assert boundary_violations(source, "apps.pharmacy") == []
