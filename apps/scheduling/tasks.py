"""Celery tasks."""

import logging

from celery import shared_task

from apps.billing import services as billing
from apps.core import events
from apps.core.tenancy import tenant_context
from apps.staff import selectors as staff
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


@shared_task
def charge_consultation_fee(envelope):
    """appointment.completed -> bill the physician's consultation fee (idempotent)."""
    from .models import Appointment

    with events.event_context(envelope) as payload:
        appointment = Appointment.objects.filter(pk=payload["appointment_id"]).first()
        physician = staff.physician(appointment.physician_id) if appointment else None
        if physician is None or physician["consultation_fee"].is_zero():
            return {"charged": False}
        billing.charge_delivered(
            patient_id=appointment.patient_id,
            source="scheduling.appointment",
            source_id=appointment.pk,
            description=f"Consultation with {physician['display_name']}",
            quantity=1,
            unit_price=physician["consultation_fee"],
            idempotency_key=f"scheduling.appointment:{appointment.pk}",
            revenue_category="consultation",
        )
        return {"charged": True}
