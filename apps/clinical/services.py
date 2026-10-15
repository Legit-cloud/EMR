"""Clinical write operations: encounters, vital signs, diagnoses and consultation notes."""

from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.core.errors import DomainError
from apps.core.models import RecordState
from apps.core.tenancy import get_current_user_id
from apps.patients import selectors as patients

from .models import (
    BMI_CODE,
    ENCOUNTER_TRANSITIONS,
    HEIGHT_CODE,
    WEIGHT_CODE,
    ConsultationNote,
    Diagnosis,
    Encounter,
    EncounterClass,
    EncounterStatus,
    LoincCode,
    NoteStatus,
    Observation,
    VitalSigns,
    compute_bmi,
)

# A height older than this is not used to compute BMI.
HEIGHT_LOOKBACK = timedelta(days=365)


# -- encounters ----------------------------------------------------------------------


def check_patient_can_have_encounter(patient_id) -> None:
    if not patients.patient_exists(patient_id):
        raise ValidationError({"patient": "Patient not found."})
    if patients.is_deceased(patient_id):
        raise ValidationError({"patient": "The patient is recorded as deceased."})


@transaction.atomic
def change_encounter_status(encounter: Encounter, status: str) -> Encounter:
    encounter = Encounter.objects.select_for_update().get(pk=encounter.pk)
    if status == encounter.status:
        return encounter
    if status not in ENCOUNTER_TRANSITIONS[encounter.status]:
        raise ValidationError({"status": f"Cannot change from {encounter.status} to {status}."})
    encounter.status = status
    if status in (EncounterStatus.FINISHED, EncounterStatus.CANCELLED):
        encounter.ended_at = timezone.now()
    encounter.save(update_fields=["status", "ended_at", "updated_at", "updated_by"])
    return encounter


# -- vital signs ---------------------------------------------------------------------


def _decimal(value, code) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValidationError({"readings": [f"{code}: not a number."]}) from None
    if not number.is_finite():
        raise ValidationError({"readings": [f"{code}: not a number."]})
    return number


def _latest_height(patient_id, before) -> Decimal | None:
    return (
        Observation.objects.filter(
            code_id=HEIGHT_CODE,
            vital_signs__patient_id=patient_id,
            vital_signs__record_state=RecordState.ACTIVE,
            vital_signs__recorded_at__lte=before,
            vital_signs__recorded_at__gte=before - HEIGHT_LOOKBACK,
        )
        .order_by("-vital_signs__recorded_at")
        .values_list("value", flat=True)
        .first()
    )


@transaction.atomic
def record_vital_signs(
    *, encounter: Encounter, readings: list[dict], recorded_at=None, note: str = ""
) -> VitalSigns:
    """Record a set of readings ``[{"code": LOINC, "value": n, "unit": UCUM?}]``.

    Units come from the LOINC table (UCUM); a supplied unit must match. Values outside the
    plausible range are rejected. BMI is never accepted: it is computed from this set's
    weight and its height, or the patient's latest height from the past year.
    """
    if not readings:
        raise ValidationError({"readings": ["Record at least one reading."]})
    codes = {c.code: c for c in LoincCode.objects.filter(code__in=[r["code"] for r in readings])}
    values: dict[str, Decimal] = {}
    errors = []
    for reading in readings:
        code = codes.get(reading["code"])
        if code is None:
            errors.append(f"{reading['code']}: unknown LOINC vital-sign code.")
            continue
        if code.derived:
            errors.append(f"{code.code}: {code.display} is calculated, not entered.")
            continue
        if code.code in values:
            errors.append(f"{code.code}: given twice.")
            continue
        unit = reading.get("unit")
        if unit and unit != code.unit:
            errors.append(f"{code.code}: unit must be {code.unit} (UCUM), not {unit}.")
            continue
        value = _decimal(reading["value"], code.code)
        if not code.min_value <= value <= code.max_value:
            errors.append(
                f"{code.code}: {value} {code.unit} is outside {code.min_value}-{code.max_value}."
            )
            continue
        values[code.code] = value
    if errors:
        raise ValidationError({"readings": errors})

    vitals = VitalSigns(encounter=encounter, recorded_at=recorded_at or timezone.now(), note=note)
    vitals.patient_id = encounter.patient_id
    vitals._assign_tenant()
    vitals.full_clean(exclude=["created_by", "updated_by"])
    vitals.save()

    if WEIGHT_CODE in values:
        height = values.get(HEIGHT_CODE) or _latest_height(encounter.patient_id, vitals.recorded_at)
        if height:
            values[BMI_CODE] = compute_bmi(values[WEIGHT_CODE], height)
    if BMI_CODE in values:
        codes[BMI_CODE] = LoincCode.objects.get(code=BMI_CODE)

    Observation.objects.bulk_create(
        Observation(vital_signs=vitals, code=codes[code], value=value, unit=codes[code].unit)
        for code, value in values.items()
    )
    return vitals


# -- diagnoses -----------------------------------------------------------------------


def next_rank(encounter_id) -> int:
    current = Diagnosis.objects.active_chart().filter(encounter_id=encounter_id)
    return (current.aggregate(top=Max("rank"))["top"] or 0) + 1


@transaction.atomic
def rank_diagnoses(encounter: Encounter, diagnosis_ids: list) -> list[Diagnosis]:
    """Set the order of an encounter's active diagnoses; the first becomes principal."""
    active = list(Diagnosis.objects.active_chart().select_for_update().filter(encounter=encounter))
    by_id = {str(d.pk): d for d in active}
    if sorted(map(str, diagnosis_ids)) != sorted(by_id):
        raise ValidationError(
            {"diagnosis_ids": ["List every active diagnosis of the encounter exactly once."]}
        )
    offset = len(active) + 1000
    # Two passes so the per-encounter unique rank holds at every step.
    for position, diagnosis_id in enumerate(diagnosis_ids, start=1):
        Diagnosis.objects.filter(pk=diagnosis_id).update(rank=offset + position)
    for position, diagnosis_id in enumerate(diagnosis_ids, start=1):
        Diagnosis.objects.filter(pk=diagnosis_id).update(rank=position)
    return list(Diagnosis.objects.active_chart().filter(encounter=encounter).order_by("rank"))


# -- consultation notes --------------------------------------------------------------


class NoteLocked(DomainError):
    code = "note_locked"
    status_code = 409


def check_note_editable(note: ConsultationNote) -> None:
    if note.status == NoteStatus.CLOSED:
        raise NoteLocked("A closed note cannot be changed. Write an addendum instead.")
    if note.created_by_id != get_current_user_id():
        raise NoteLocked("Only the author can change an open note.")


@transaction.atomic
def close_note(note: ConsultationNote) -> ConsultationNote:
    note = ConsultationNote.objects.select_for_update().get(pk=note.pk)
    check_note_editable(note)
    if not any([note.subjective, note.objective, note.assessment, note.plan]):
        raise ValidationError({"non_field_errors": ["An empty note cannot be closed."]})
    note.status = NoteStatus.CLOSED
    note.closed_at = timezone.now()
    note.save(update_fields=["status", "closed_at", "updated_at", "updated_by"])
    return note


def mark_entered_in_error(record, reason: str):
    try:
        record.mark_entered_in_error(reason)
    except ValueError as exc:
        raise ValidationError({"reason": [str(exc)]}) from exc
    return record


# -- used by scheduling --------------------------------------------------------------


@transaction.atomic
def open_encounter_for_appointment(
    *, patient_id, facility_id, department_id, practitioner_id, appointment_id
) -> Encounter:
    """Start the outpatient encounter when a consultation begins."""
    check_patient_can_have_encounter(patient_id)
    encounter = Encounter(
        patient_id=patient_id,
        encounter_class=EncounterClass.OUTPATIENT,
        facility_id=facility_id,
        department_id=department_id,
        practitioner_id=practitioner_id,
        appointment_id=appointment_id,
    )
    encounter._assign_tenant()
    encounter.full_clean(exclude=["created_by", "updated_by"])
    encounter.save()
    return encounter


def finish_encounter(encounter_id) -> None:
    encounter = Encounter.objects.filter(pk=encounter_id).first()
    if encounter is not None and encounter.status == EncounterStatus.IN_PROGRESS:
        change_encounter_status(encounter, EncounterStatus.FINISHED)
