"""Clinical records are never hard-deleted; Entered-in-Error hides them from the active chart."""

import pytest

from apps.core.errors import HardDeleteNotAllowed
from apps.core.models import RecordState
from tests.tenancy_app.models import Record

pytestmark = pytest.mark.django_db


@pytest.fixture
def record(tenant_a, as_tenant):
    with as_tenant(tenant_a):
        return Record.objects.create(title="BP reading")


def test_hard_delete_is_refused(record, tenant_a, as_tenant):
    with as_tenant(tenant_a):
        with pytest.raises(HardDeleteNotAllowed):
            record.delete()
        with pytest.raises(HardDeleteNotAllowed):
            Record.objects.all().delete()
        assert Record.objects.filter(pk=record.pk).exists()


def test_entered_in_error_hides_from_active_chart_but_keeps_history(
    record, tenant_a, user_a, as_tenant
):
    with as_tenant(tenant_a, user_a):
        record.mark_entered_in_error("Recorded against the wrong patient")
        assert not Record.objects.active_chart().filter(pk=record.pk).exists()
        kept = Record.objects.get(pk=record.pk)
    assert kept.record_state == RecordState.ENTERED_IN_ERROR
    assert kept.entered_in_error_reason == "Recorded against the wrong patient"
    assert kept.entered_in_error_at is not None
    assert kept.updated_by_id == user_a.pk


def test_entered_in_error_requires_a_reason(record, tenant_a, as_tenant):
    with as_tenant(tenant_a), pytest.raises(ValueError):
        record.mark_entered_in_error("  ")
