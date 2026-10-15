"""Celery tasks."""

import logging

from celery import shared_task

from apps.core import events

logger = logging.getLogger(__name__)


@shared_task
def revoke_portal_access_for_deceased_patient(envelope):
    """Revoke the patient's portal access.

    Stub until portal accounts are linked to patient records (patient portal, Release 2).
    """
    with events.event_context(envelope) as payload:
        logger.info(
            "patient.deceased: portal access revocation pending for patient %s (event %s)",
            payload["patient_id"],
            envelope["event_id"],
        )
        return {"revoked": 0}
