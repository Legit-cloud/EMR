"""Portal accounts: inviting a patient, switching access off, what a patient may change, and the
patient's data-protection requests."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts import selectors as accounts_selectors
from apps.accounts import services as accounts
from apps.core.errors import DomainError
from apps.core.roles import Role
from apps.core.tenancy import get_current_user_id
from apps.notifications import services as notifications
from apps.patients import selectors as patients
from apps.patients import services as patient_services

from .models import DataSubjectRequest, PortalAccount, RequestKind, RequestStatus


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


def update_contact(account: PortalAccount, *, phone=None, email=None, email_reminders=None) -> None:
    patient_services.update_contact(
        account.patient_id, phone=phone, email=email, email_reminders=email_reminders
    )


# -- data-protection requests (NDPA 2023, DG-03) ------------------------------------------


def today() -> date:
    return datetime.now(ZoneInfo(settings.MRN_TIME_ZONE)).date()


@transaction.atomic
def submit_request(patient_id, *, kind: str, details: str = "") -> DataSubjectRequest:
    """The patient asks to exercise a right. Compliance is told; the patient gets an
    acknowledgement with the date by which they will have an answer."""
    if kind not in RequestKind.values:
        raise PortalAccountError("Choose what you are asking for.")
    if kind in (RequestKind.CORRECTION, RequestKind.RESTRICTION, RequestKind.OBJECTION) and (
        len(details.strip()) < 5
    ):
        raise PortalAccountError("Tell us what you would like changed or why.")
    if DataSubjectRequest.objects.filter(
        patient_id=patient_id, kind=kind, status=RequestStatus.OPEN
    ).exists():
        raise PortalAccountError("You already have an open request of this kind.")
    request = DataSubjectRequest.objects.create(
        patient_id=patient_id,
        kind=kind,
        details=details.strip()[:1000],
        due_on=today() + timedelta(days=settings.DSR_RESPONSE_DAYS),
    )
    contact = patients.contact_details(patient_id)
    if contact and contact["email"]:
        notifications.queue_email(
            to=contact["email"],
            subject="We have received your request",
            body=(
                f"Dear {contact['first_name']},\n\nWe have received your request "
                f"({request.get_kind_display().lower()}). We will answer by "
                f"{request.due_on:%d %B %Y}. You can follow it under Your rights in the patient "
                "portal.\n"
            ),
            purpose="data_request_received",
            related_object=f"portal.datasubjectrequest:{request.pk}",
        )
    for to in accounts_selectors.emails_of_role_holders(
        [Role.COMPLIANCE_OFFICER, Role.TENANT_ADMIN]
    ):
        notifications.queue_email(
            to=to,
            subject="A patient has made a data-protection request",
            body=(
                f"A {request.get_kind_display().lower()} request was made and is due by "
                f"{request.due_on:%d %B %Y}. Open the Data requests screen to answer it."
            ),
            purpose="data_request_staff",
            related_object=f"portal.datasubjectrequest:{request.pk}",
        )
    return request


@transaction.atomic
def respond_to_request(
    request: DataSubjectRequest, *, status: str, note: str
) -> DataSubjectRequest:
    """Answer a request: completed, or refused with the reason. The patient is told to read the
    answer in the portal; the answer itself is not emailed because it may mention their records."""
    request = DataSubjectRequest.objects.select_for_update().get(pk=request.pk)
    if request.status != RequestStatus.OPEN:
        raise PortalAccountError("This request has already been answered.")
    if status not in (RequestStatus.COMPLETED, RequestStatus.REFUSED):
        raise PortalAccountError("Answer it as completed or refused.")
    note = note.strip()
    if len(note) < 10:
        raise PortalAccountError("Say what was done, or why it was refused.")
    request.status = status
    request.response_note = note[:1000]
    request.handled_by_id = get_current_user_id()
    request.handled_at = timezone.now()
    request.save(
        update_fields=[
            "status",
            "response_note",
            "handled_by",
            "handled_at",
            "updated_at",
            "updated_by",
        ]
    )
    contact = patients.contact_details(request.patient_id)
    if contact and contact["email"]:
        notifications.queue_email(
            to=contact["email"],
            subject="Your request has been answered",
            body=(
                f"Dear {contact['first_name']},\n\n"
                f"Your request ({request.get_kind_display().lower()}) has been answered. "
                "Please sign in to the patient portal and open Your rights to read the answer.\n"
            ),
            purpose="data_request_answered",
            related_object=f"portal.datasubjectrequest:{request.pk}",
        )
    return request


def is_overdue(request: DataSubjectRequest) -> bool:
    return request.status == RequestStatus.OPEN and request.due_on < today()
