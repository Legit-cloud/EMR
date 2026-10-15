"""Celery tasks."""

import logging

from celery import shared_task

from apps.core import events

from .models import Invoice, PaymentStatus

logger = logging.getLogger(__name__)


@shared_task
def flag_invoices_for_estate_review(envelope):
    """patient.deceased -> flag the patient's outstanding invoices for estate settlement."""
    with events.event_context(envelope) as payload:
        flagged = (
            Invoice.objects.filter(patient_id=payload["patient_id"], net_due_minor__gt=0)
            .exclude(payment_status=PaymentStatus.PAID)
            .update(estate_review=True)
        )
        logger.info(
            "patient.deceased: flagged %d invoice(s) for estate review, patient %s (event %s)",
            flagged,
            payload["patient_id"],
            envelope["event_id"],
        )
        return {"flagged": flagged}
