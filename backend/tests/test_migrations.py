from io import StringIO

import pytest
from django.core.management import call_command


@pytest.mark.django_db
def test_models_and_migrations_are_in_sync():
    """Migration drift check: makemigrations --check --dry-run must report no changes."""
    output = StringIO()
    try:
        call_command("makemigrations", "--check", "--dry-run", stdout=output)
    except SystemExit:
        pytest.fail("Models have changes without migrations:\n" + output.getvalue())
