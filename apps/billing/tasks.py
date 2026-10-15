"""Celery tasks."""

import logging

from celery import shared_task

from apps.core import events

logger = logging.getLogger(__name__)


@shared_task
def flag_invoices_for_estate_review(envelope):
    """Flag the patient's outstanding invoices for estate-settlement review.

    Stub until invoices exist (CLAUDE.md Prompt 8).
    """
    with events.event_context(envelope) as payload:
        logger.info(
            "patient.deceased: estate review flagging pending for patient %s (event %s)",
            payload["patient_id"],
            envelope["event_id"],
        )
        return {"flagged": 0}
