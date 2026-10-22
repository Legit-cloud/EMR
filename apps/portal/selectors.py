"""Read-only portal queries."""

from .models import PortalAccount


def active_account(user_id) -> PortalAccount | None:
    """The portal account of a signed-in user, if it is still switched on."""
    return PortalAccount.objects.filter(user_id=user_id, active=True).first()


def account_for_patient(patient_id) -> PortalAccount | None:
    return PortalAccount.objects.filter(patient_id=patient_id).first()


def released_results(patient_id) -> list[dict]:
    """Lab and imaging results released to the patient.

    The diagnostics module does not exist yet (Release 2), so there is nothing to release.
    When it does, this is the one place that reads its selectors and only ever returns results a
    clinician has marked as released.
    """
    return []
