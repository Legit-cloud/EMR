"""Read-only portal queries."""

from apps.diagnostics import selectors as diagnostics

from .models import PortalAccount


def active_account(user_id) -> PortalAccount | None:
    """The portal account of a signed-in user, if it is still switched on."""
    return PortalAccount.objects.filter(user_id=user_id, active=True).first()


def account_for_patient(patient_id) -> PortalAccount | None:
    return PortalAccount.objects.filter(patient_id=patient_id).first()


def released_results(patient_id) -> list[dict]:
    """Lab and imaging results released to the patient.

    Only results a clinician has reviewed are ever returned (ADR 0025).
    """
    return diagnostics.released_results(patient_id)
