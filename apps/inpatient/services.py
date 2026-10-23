"""Admissions, beds and bed-day charges (CLAUDE.md Section 5).

Admitting a patient makes the bed Occupied in the same transaction. A Celery beat job at 00:00
adds the daily ward charge to the patient's pending bill until discharge; the first day is
billed when the patient is admitted, and each later day at midnight. Billing work happens in
event handlers, so a slow ledger never holds up a nurse.
"""

from datetime import date
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.billing import services as billing
from apps.core import events
from apps.core.errors import DomainError
from apps.patients import selectors as patients

from .events import PATIENT_ADMITTED, PATIENT_DISCHARGED
from .models import Admission, Bed, BedMove, BedStatus, DischargeStatus, WardCharge


class BedUnavailable(DomainError):
    """The bed is not vacant."""

    code = "bed_unavailable"
    status_code = 409


class AdmissionRefused(DomainError):
    code = "admission_refused"
    status_code = 409


def today() -> date:
    """The ward's calendar day, in the hospital's time zone (not UTC)."""
    return timezone.now().astimezone(ZoneInfo(settings.INPATIENT_TIME_ZONE)).date()


def _lock_beds(*bed_ids) -> dict:
    """Lock beds in a fixed order, so two transfers can never wait on each other."""
    beds = Bed.objects.select_for_update().select_related("ward").filter(pk__in=bed_ids)
    return {bed.pk: bed for bed in sorted(beds, key=lambda b: str(b.pk))}


def _require_vacant(bed: Bed) -> None:
    if bed.status != BedStatus.VACANT:
        raise BedUnavailable(f"{bed.label} is {bed.get_status_display().lower()}.")
    if not bed.ward.active:
        raise BedUnavailable(f"{bed.ward.name} is closed.")


@transaction.atomic
def admit(*, patient_id, bed: Bed, reason: str) -> Admission:
    """Put a patient in a vacant bed. Vacant to Occupied happens in this transaction."""
    reason = reason.strip()
    if not reason:
        raise AdmissionRefused("Say why the patient is being admitted.")
    if not patients.patient_exists(patient_id):
        raise AdmissionRefused("That patient does not exist.")
    if patients.is_deceased(patient_id):
        raise AdmissionRefused("A deceased patient cannot be admitted.")
    if Admission.objects.filter(patient_id=patient_id, discharged_at__isnull=True).exists():
        raise AdmissionRefused("This patient is already admitted.")
    bed = _lock_beds(bed.pk)[bed.pk]
    _require_vacant(bed)
    admission = Admission.objects.create(
        patient_id=patient_id, bed=bed, reason=reason, admitted_at=timezone.now()
    )
    bed.status = BedStatus.OCCUPIED
    bed.save(update_fields=["status", "updated_at", "updated_by"])
    events.publish(PATIENT_ADMITTED, {"admission_id": str(admission.pk)})
    return admission


@transaction.atomic
def transfer(admission: Admission, *, bed: Bed, reason: str = "") -> Admission:
    """Move an admitted patient to another vacant bed. The old bed goes to cleaning."""
    admission = Admission.objects.select_for_update().get(pk=admission.pk)
    if not admission.is_open:
        raise AdmissionRefused("This patient has already left.")
    if bed.pk == admission.bed_id:
        raise AdmissionRefused("The patient is already in that bed.")
    beds = _lock_beds(admission.bed_id, bed.pk)
    old, new = beds[admission.bed_id], beds[bed.pk]
    _require_vacant(new)
    old.status = BedStatus.CLEANING
    new.status = BedStatus.OCCUPIED
    old.save(update_fields=["status", "updated_at", "updated_by"])
    new.save(update_fields=["status", "updated_at", "updated_by"])
    BedMove.objects.create(admission=admission, from_bed=old, to_bed=new, reason=reason.strip())
    admission.bed = new
    admission.save(update_fields=["bed", "updated_at", "updated_by"])
    return admission


@transaction.atomic
def discharge(admission: Admission, *, status: str, note: str = "") -> Admission:
    """End the stay as Discharged, LAMA or Transferred. The bed goes to cleaning."""
    if status not in DischargeStatus.values:
        raise AdmissionRefused("Choose how the patient left.")
    note = note.strip()
    if status == DischargeStatus.DIED:
        patient_id = Admission.objects.values_list("patient_id", flat=True).get(pk=admission.pk)
        if not patients.is_deceased(patient_id):
            raise AdmissionRefused(
                "Record the death on the patient's chart first, then close the stay as Died."
            )
    elif status != DischargeStatus.DISCHARGED and len(note) < 5:
        raise AdmissionRefused(
            "Note what the patient was told about leaving."
            if status == DischargeStatus.LAMA
            else "Say where the patient is being transferred to."
        )
    admission = Admission.objects.select_for_update().get(pk=admission.pk)
    if not admission.is_open:
        raise AdmissionRefused("This patient has already left.")
    bed = _lock_beds(admission.bed_id)[admission.bed_id]
    bed.status = BedStatus.CLEANING
    bed.save(update_fields=["status", "updated_at", "updated_by"])
    admission.discharged_at = timezone.now()
    admission.discharge_status = status
    admission.discharge_note = note
    admission.save(
        update_fields=[
            "discharged_at",
            "discharge_status",
            "discharge_note",
            "updated_at",
            "updated_by",
        ]
    )
    events.publish(PATIENT_DISCHARGED, {"admission_id": str(admission.pk), "status": status})
    return admission


@transaction.atomic
def mark_ready(bed: Bed) -> Bed:
    bed = _lock_beds(bed.pk)[bed.pk]
    if bed.status != BedStatus.CLEANING:
        raise BedUnavailable("Only a bed being cleaned can be marked ready.")
    bed.status = BedStatus.VACANT
    bed.save(update_fields=["status", "updated_at", "updated_by"])
    return bed


@transaction.atomic
def set_out_of_service(bed: Bed, out: bool) -> Bed:
    """Take a vacant bed out of use for maintenance, or put it back."""
    bed = _lock_beds(bed.pk)[bed.pk]
    if out:
        if bed.status not in (BedStatus.VACANT, BedStatus.CLEANING):
            raise BedUnavailable("Only an empty bed can be taken out of service.")
        bed.status = BedStatus.OUT_OF_SERVICE
    else:
        if bed.status != BedStatus.OUT_OF_SERVICE:
            raise BedUnavailable("This bed is not out of service.")
        bed.status = BedStatus.VACANT
    bed.save(update_fields=["status", "updated_at", "updated_by"])
    return bed


# -- bed-day charges --------------------------------------------------------------------


def charge_key(admission_id, day: date) -> str:
    return f"inpatient.admission:{admission_id}:{day.isoformat()}"


def charge_day(admission: Admission, day: date) -> bool:
    """Add one bed-day to the patient's pending bill. Safe to call twice for the same day.

    No charge is made for a closed stay, a deceased patient, or a ward with no daily charge.
    """
    if not admission.is_open or patients.is_deceased(admission.patient_id):
        return False
    ward = admission.bed.ward
    price = ward.daily_charge
    if price.is_zero():
        return False
    key = charge_key(admission.pk, day)
    with transaction.atomic():
        _, created = WardCharge.objects.get_or_create(
            admission=admission, charge_date=day, defaults={"idempotency_key": key}
        )
        if not created:
            return False
        billing.add_line(
            patient_id=admission.patient_id,
            source="inpatient.admission",
            source_id=admission.pk,
            description=f"{ward.name}, {day:%d %b %Y}",
            quantity=1,
            unit_price=price,
            idempotency_key=key,
            revenue_category="ward",
        )
    return True


def charge_open_admissions(day: date | None = None) -> int:
    """The midnight job for the current tenant: bill ``day`` for every open admission."""
    day = day or today()
    billed = 0
    for admission in Admission.objects.filter(discharged_at__isnull=True).select_related(
        "bed__ward"
    ):
        billed += charge_day(admission, day)
    return billed


def finalise_charges(admission: Admission) -> int:
    """The stay is over: its pending bed-days become final revenue, except the day the patient left.

    The admission day counts and the day of leaving does not (a patient is charged for each night
    in a bed), unless they came and went on the same day, which is one day. Safe to run twice.
    """
    zone = ZoneInfo(settings.INPATIENT_TIME_ZONE)
    left = admission.discharged_at.astimezone(zone).date() if admission.discharged_at else None
    arrived = admission.admitted_at.astimezone(zone).date()
    done = 0
    for charge in WardCharge.objects.filter(admission=admission, voided=False):
        if left is not None and charge.charge_date == left and left != arrived:
            billing.void_line(charge.idempotency_key)
            charge.voided = True
            charge.save(update_fields=["voided", "updated_at", "updated_by"])
            continue
        done += billing.finalise_line(charge.idempotency_key) is not None
    return done
