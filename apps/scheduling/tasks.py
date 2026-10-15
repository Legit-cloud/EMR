"""Celery tasks."""

import logging

from celery import shared_task

from apps.core import events

logger = logging.getLogger(__name__)


@shared_task
def cancel_appointments_for_deceased_patient(envelope):
    """Cancel the patient's active and recurring appointments.

    Stub until appointments exist (CLAUDE.md Prompt 6). It already runs under the
    publisher's tenant so the real handler only needs the query.
    """
    with events.event_context(envelope) as payload:
        logger.info(
            "patient.deceased: appointment cancellation pending for patient %s (event %s)",
            payload["patient_id"],
            envelope["event_id"],
        )
        return {"cancelled": 0}
