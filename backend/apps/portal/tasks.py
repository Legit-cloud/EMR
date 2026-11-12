"""Celery tasks."""

import logging

from celery import shared_task

from apps.core import events

from . import services

logger = logging.getLogger(__name__)


@shared_task
def revoke_portal_access_for_deceased_patient(envelope):
    """Handler for ``patient.deceased``: switch off the patient's portal sign-in."""
    with events.event_context(envelope) as payload:
        revoked = services.revoke_for_deceased_patient(payload["patient_id"])
        logger.info(
            "patient.deceased: revoked %d portal account(s) for patient %s (event %s)",
            revoked,
            payload["patient_id"],
            envelope["event_id"],
        )
        return {"revoked": revoked}
