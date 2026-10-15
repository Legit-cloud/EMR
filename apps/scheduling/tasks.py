"""Celery tasks."""

import logging

from celery import shared_task

from apps.core import events
from apps.core.tenancy import tenant_context
from apps.tenants.selectors import active_tenant_ids

from . import services

logger = logging.getLogger(__name__)


@shared_task
def cancel_appointments_for_deceased_patient(envelope):
    """Handler for ``patient.deceased``: cancel active and recurring appointments."""
    with events.event_context(envelope) as payload:
        cancelled = services.cancel_for_deceased_patient(payload["patient_id"])
        logger.info(
            "patient.deceased: cancelled %d appointment(s) for patient %s (event %s)",
            cancelled,
            payload["patient_id"],
            envelope["event_id"],
        )
        return {"cancelled": cancelled}


@shared_task
def send_appointment_reminders():
    """Every few minutes (Celery beat): send reminders that have come due, in every tenant."""
    sent = 0
    for tenant_id in active_tenant_ids():
        with tenant_context(tenant_id):
            sent += services.send_due_reminders()
    return sent
