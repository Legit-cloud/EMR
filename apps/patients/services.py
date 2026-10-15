"""Patient registration, status changes and record corrections.

Other modules call these functions; they never write patient tables directly.
"""

import hashlib
import json

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection, transaction
from django.utils import timezone

from apps.accounts import selectors as accounts
from apps.core import events
from apps.core.errors import DomainError
from apps.core.tenancy import get_current_tenant_id, get_current_user_id

from .duplicates import find_probable_duplicates
from .events import PATIENT_DECEASED
from .models import DuplicateReview, Patient, PatientStatus, ReviewStatus


class StatusChangeRefused(DomainError):
    code = "status_change_refused"
    status_code = 409


def _lock_registrations() -> None:
    """Serialise registrations per tenant so two clerks cannot both miss a duplicate."""
    key = f"patient-registration:{get_current_tenant_id()}"
    lock_id = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big", signed=True)
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_id])


def _json_safe(data: dict) -> dict:
    return json.loads(json.dumps(data, cls=DjangoJSONEncoder))


@transaction.atomic
def register_patient(data: dict) -> Patient | DuplicateReview:
    """Create a patient, or hold the registration for review if it looks like a duplicate.

    ``data`` is validated registration data. Returns the new ``Patient``, or a pending
    ``DuplicateReview`` when an existing patient scores above the duplicate threshold.
    """
    _lock_registrations()
    matches = find_probable_duplicates(
        first_name=data["first_name"],
        last_name=data["last_name"],
        date_of_birth=data["date_of_birth"],
        national_id=data.get("national_id", ""),
    )
    if matches:
        return DuplicateReview.objects.create(
            payload=_json_safe(data), candidates=matches, top_score=matches[0]["score"]
        )
    return _create(data)


def _create(data: dict) -> Patient:
    patient = Patient(**data)
    patient.full_clean(exclude=["mrn", "first_name_key", "last_name_key", "tenant"])
    patient.save()
    return patient


@transaction.atomic
def resolve_duplicate_review(
    review: DuplicateReview, *, decision: str, note: str = "", matched_patient=None, data=None
) -> DuplicateReview:
    """Record a person's decision on a held registration.

    - ``created_new``: not a duplicate; the patient is created from ``data`` (the payload
      revalidated by the caller).
    - ``duplicate``: the person is ``matched_patient``; nothing new is created.
    - ``rejected``: the registration is dropped.
    """
    review = DuplicateReview.objects.select_for_update().get(pk=review.pk)
    if review.status != ReviewStatus.PENDING:
        raise DomainError("This review has already been resolved.")
    if decision == ReviewStatus.CREATED_NEW:
        _lock_registrations()
        review.created_patient = _create(data)
    elif decision == ReviewStatus.DUPLICATE:
        if matched_patient is None:
            raise DomainError("Choose the existing patient.", details={"matched_patient": []})
        review.matched_patient = matched_patient
    elif decision != ReviewStatus.REJECTED:
        raise DomainError("Unknown decision.")
    review.status = decision
    review.resolution_note = note
    review.resolved_by_id = get_current_user_id()
    review.resolved_at = timezone.now()
    review.save()
    return review


@transaction.atomic
def change_status(patient: Patient, *, status: str, deceased_at=None) -> Patient:
    """Change status. Setting Deceased publishes ``patient.deceased`` after commit."""
    patient = Patient.objects.select_for_update().get(pk=patient.pk)
    if patient.status == status:
        return patient
    if patient.status == PatientStatus.DECEASED:
        raise StatusChangeRefused(
            "A deceased patient cannot be reactivated. Correct a wrong death record "
            "through a clinical records correction."
        )
    if status == PatientStatus.DECEASED:
        roles = accounts.roles_of(get_current_user_id())
        if not roles & set(settings.PATIENT_DECEASED_ROLES):
            raise StatusChangeRefused("Your role cannot record a death.")
    patient.status = status
    patient.deceased_at = deceased_at if status == PatientStatus.DECEASED else None
    patient.full_clean(exclude=["mrn", "first_name_key", "last_name_key", "tenant"])
    patient.save()
    if status == PatientStatus.DECEASED:
        events.publish(
            PATIENT_DECEASED,
            {"patient_id": str(patient.pk), "deceased_at": patient.deceased_at.isoformat()},
        )
    return patient


def mark_entered_in_error(record, reason: str):
    """Hide a patient, allergy or attachment from the active chart. History is kept."""
    try:
        record.mark_entered_in_error(reason)
    except ValueError as exc:
        raise DomainError(str(exc), details={"reason": [str(exc)]}) from exc
    return record
