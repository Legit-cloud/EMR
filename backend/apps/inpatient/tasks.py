"""Celery tasks."""

import logging

from celery import shared_task

from apps.core import events
from apps.core.tenancy import tenant_context
from apps.tenants.selectors import active_tenant_ids

from . import services

logger = logging.getLogger(__name__)


@shared_task
def run_daily_ward_charges():
    """00:00 (Celery beat): add the new day's ward charge for every open admission."""
    billed = 0
    for tenant_id in active_tenant_ids():
        with tenant_context(tenant_id):
            billed += services.charge_open_admissions()
    logger.info("Daily ward charges: %d bed-day(s) billed", billed)
    return billed


@shared_task
def charge_first_day(envelope):
    """inpatient.admitted -> bill the day of admission (idempotent)."""
    from .models import Admission

    with events.event_context(envelope) as payload:
        admission = (
            Admission.objects.select_related("bed__ward").filter(pk=payload["admission_id"]).first()
        )
        if admission is None:
            return {"charged": False}
        return {"charged": services.charge_day(admission, services.today())}


@shared_task
def finalise_stay(envelope):
    """inpatient.discharged -> the stay's pending bed-days become final (idempotent)."""
    from .models import Admission

    with events.event_context(envelope) as payload:
        admission = Admission.objects.filter(pk=payload["admission_id"]).first()
        if admission is None:
            return {"finalised": 0}
        return {"finalised": services.finalise_charges(admission)}
