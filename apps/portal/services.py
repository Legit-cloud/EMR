"""Portal accounts: inviting a patient, switching access off, and what a patient may change."""

from django.db import transaction
from django.utils import timezone

from apps.accounts import services as accounts
from apps.core.errors import DomainError
from apps.patients import selectors as patients
from apps.patients import services as patient_services

from .models import PortalAccount


class PortalAccountError(DomainError):
    code = "portal_account_refused"
    status_code = 409


@transaction.atomic
def invite(patient_id) -> PortalAccount:
    """Give a patient a portal sign-in, and email them a link to set a password.

    The patient needs an email address on file. A deceased patient is never invited, and a
    patient has at most one account.
    """
    profile = patients.portal_profile(patient_id)
    if profile is None or not patients.patient_exists(patient_id):
        raise PortalAccountError("That patient does not exist.")
    if patients.is_deceased(patient_id):
        raise PortalAccountError("A deceased patient cannot be given portal access.")
    if PortalAccount.objects.filter(patient_id=patient_id).exists():
        raise PortalAccountError("This patient already has portal access.")
    if not profile["email"]:
        raise PortalAccountError(
            "Add the patient's email address first; the invitation goes there."
        )
    try:
        user = accounts.create_patient_user(
            username=f"patient-{profile['mrn']}".lower(),
            email=profile["email"],
            first_name=profile["first_name"],
            last_name=profile["last_name"],
        )
    except DomainError as error:
        raise PortalAccountError(error.message) from None
    return PortalAccount.objects.create(user=user, patient_id=patient_id)


@transaction.atomic
def revoke(account: PortalAccount, reason: str = "staff") -> PortalAccount:
    """Switch the patient's portal access off now: the sign-in is disabled and tokens revoked."""
    account = PortalAccount.objects.select_for_update().get(pk=account.pk)
    if not account.active:
        return account
    accounts.deactivate_user(account.user)
    account.active = False
    account.revoked_at = timezone.now()
    account.revoked_reason = reason
    account.save(
        update_fields=["active", "revoked_at", "revoked_reason", "updated_at", "updated_by"]
    )
    return account


def revoke_for_deceased_patient(patient_id) -> int:
    """patient.deceased: revoke the patient's portal access (CLAUDE.md Section 5)."""
    account = PortalAccount.objects.filter(patient_id=patient_id, active=True).first()
    if account is None:
        return 0
    revoke(account, reason="deceased")
    return 1


@transaction.atomic
def set_consents(account: PortalAccount, changes: dict) -> dict:
    """Record the patient's choices. Returns what actually changed, for the audit entry."""
    changed = {}
    for key, value in changes.items():
        if key not in PortalAccount.CONSENT_FIELDS:
            raise PortalAccountError(f"Unknown choice: {key}.")
        if getattr(account, key) != bool(value):
            setattr(account, key, bool(value))
            changed[key] = bool(value)
    if changed:
        account.consents_updated_at = timezone.now()
        account.save(update_fields=[*changed, "consents_updated_at", "updated_at", "updated_by"])
    return changed


def update_contact(account: PortalAccount, *, phone=None, email=None) -> None:
    patient_services.update_contact(account.patient_id, phone=phone, email=email)
