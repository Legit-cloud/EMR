from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.core.models import RecordState, SoftStateModel, TenantModel

# -- reference data (shared by all tenants) ------------------------------------------


class LoincCode(models.Model):
    """LOINC observation code with its UCUM unit and a plausibility range."""

    code = models.CharField(max_length=16, primary_key=True)
    display = models.CharField(max_length=200)
    unit = models.CharField("UCUM unit", max_length=32)
    min_value = models.DecimalField(max_digits=8, decimal_places=2)
    max_value = models.DecimalField(max_digits=8, decimal_places=2)
    derived = models.BooleanField(default=False, help_text="Computed, never entered (BMI).")

    class Meta:
        ordering = ["display"]

    def __str__(self) -> str:
        return f"{self.code} {self.display}"


class Icd10Code(models.Model):
    code = models.CharField(max_length=8, primary_key=True)
    display = models.CharField(max_length=255)

    class Meta:
        ordering = ["code"]
        verbose_name = "ICD-10 code"

    def __str__(self) -> str:
        return f"{self.code} {self.display}"


# -- encounters ----------------------------------------------------------------------


class EncounterClass(models.TextChoices):
    OUTPATIENT = "outpatient", "Outpatient"
    INPATIENT = "inpatient", "Inpatient"
    EMERGENCY = "emergency", "Emergency"
    VIRTUAL = "virtual", "Virtual"


class EncounterStatus(models.TextChoices):
    PLANNED = "planned", "Planned"
    IN_PROGRESS = "in_progress", "In progress"
    FINISHED = "finished", "Finished"
    CANCELLED = "cancelled", "Cancelled"


ENCOUNTER_TRANSITIONS = {
    EncounterStatus.PLANNED: {EncounterStatus.IN_PROGRESS, EncounterStatus.CANCELLED},
    EncounterStatus.IN_PROGRESS: {EncounterStatus.FINISHED, EncounterStatus.CANCELLED},
    EncounterStatus.FINISHED: set(),
    EncounterStatus.CANCELLED: set(),
}


class Encounter(SoftStateModel):
    """A contact between a patient and the facility. Clinical entries hang off it."""

    patient = models.ForeignKey("patients.Patient", on_delete=models.PROTECT, related_name="+")
    encounter_class = models.CharField(max_length=12, choices=EncounterClass.choices)
    status = models.CharField(
        max_length=12, choices=EncounterStatus.choices, default=EncounterStatus.IN_PROGRESS
    )
    facility = models.ForeignKey("tenants.Facility", on_delete=models.PROTECT, related_name="+")
    department = models.ForeignKey(
        "tenants.Department", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    practitioner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    started_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)
    reason = models.CharField(max_length=500, blank=True)
    # Set by scheduling when the encounter starts from an appointment.
    appointment_id = models.UUIDField(null=True, blank=True, db_index=True)

    class Meta(SoftStateModel.Meta):
        ordering = ["-started_at"]

    def __str__(self) -> str:
        return f"{self.get_encounter_class_display()} {self.started_at:%Y-%m-%d}"

    def clean(self):
        super().clean()
        if self.department_id and self.department.facility_id != self.facility_id:
            raise ValidationError({"department": "The department is in a different facility."})
        if self.practitioner_id and self.practitioner.tenant_id != self.tenant_id:
            raise ValidationError({"practitioner": "Choose a member of this organisation."})
        if self.ended_at and self.ended_at < self.started_at:
            raise ValidationError({"ended_at": "Cannot be before the start."})

    @property
    def accepts_entries(self) -> bool:
        return self.status != EncounterStatus.CANCELLED and self.record_state == RecordState.ACTIVE


class EncounterEntry(SoftStateModel):
    """Base for clinical entries: always linked to an encounter and its patient."""

    patient = models.ForeignKey("patients.Patient", on_delete=models.PROTECT, related_name="+")
    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT, related_name="+")

    class Meta(SoftStateModel.Meta):
        abstract = True

    def clean(self):
        super().clean()
        if self.encounter_id:
            if self.patient_id and self.patient_id != self.encounter.patient_id:
                raise ValidationError({"encounter": "The encounter belongs to another patient."})
            if self._state.adding and not self.encounter.accepts_entries:
                raise ValidationError({"encounter": "This encounter is closed to new entries."})

    def save(self, *args, **kwargs):
        if self.encounter_id and not self.patient_id:
            self.patient_id = self.encounter.patient_id
        super().save(*args, **kwargs)


# -- vitals --------------------------------------------------------------------------

BMI_CODE = "39156-5"
HEIGHT_CODE = "8302-2"
WEIGHT_CODE = "29463-7"


class VitalSigns(EncounterEntry):
    """One set of vital-sign readings taken together (FHIR vital-signs panel 85353-1)."""

    recorded_at = models.DateTimeField(default=timezone.now)
    note = models.CharField(max_length=500, blank=True)

    class Meta(EncounterEntry.Meta):
        ordering = ["-recorded_at"]
        verbose_name_plural = "vital signs"

    def __str__(self) -> str:
        return f"Vitals {self.recorded_at:%Y-%m-%d %H:%M}"

    def clean(self):
        super().clean()
        if self.recorded_at and self.recorded_at > timezone.now() + timedelta(minutes=5):
            raise ValidationError({"recorded_at": "Cannot be in the future."})


class Observation(TenantModel):
    """A single coded reading inside a vital-signs set."""

    vital_signs = models.ForeignKey(
        VitalSigns, on_delete=models.PROTECT, related_name="observations"
    )
    code = models.ForeignKey(LoincCode, on_delete=models.PROTECT, related_name="+")
    value = models.DecimalField(max_digits=8, decimal_places=2)
    unit = models.CharField("UCUM unit", max_length=32)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["vital_signs", "code"], name="one_reading_per_code")
        ]

    def __str__(self) -> str:
        return f"{self.code_id} = {self.value} {self.unit}"


def compute_bmi(weight_kg: Decimal, height_cm: Decimal) -> Decimal:
    metres = Decimal(height_cm) / 100
    return (Decimal(weight_kg) / (metres * metres)).quantize(Decimal("0.1"))


# -- diagnoses -----------------------------------------------------------------------


class CodeSystem(models.TextChoices):
    ICD10 = "icd10", "ICD-10"
    SNOMED = "snomed", "SNOMED CT"


class ClinicalStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    RECURRENCE = "recurrence", "Recurrence"
    REMISSION = "remission", "Remission"
    RESOLVED = "resolved", "Resolved"
    INACTIVE = "inactive", "Inactive"


class VerificationStatus(models.TextChoices):
    UNCONFIRMED = "unconfirmed", "Unconfirmed / suspected"
    CONFIRMED = "confirmed", "Confirmed"
    REFUTED = "refuted", "Refuted"
    ENTERED_IN_ERROR = "entered_in_error", "Entered in error"


_ACTIVE_LIKE = {ClinicalStatus.ACTIVE, ClinicalStatus.RECURRENCE}
CLINICAL_TRANSITIONS = {
    ClinicalStatus.ACTIVE: {
        ClinicalStatus.REMISSION,
        ClinicalStatus.RESOLVED,
        ClinicalStatus.INACTIVE,
    },
    ClinicalStatus.RECURRENCE: {
        ClinicalStatus.REMISSION,
        ClinicalStatus.RESOLVED,
        ClinicalStatus.INACTIVE,
    },
    ClinicalStatus.REMISSION: {
        ClinicalStatus.RECURRENCE,
        ClinicalStatus.RESOLVED,
        ClinicalStatus.INACTIVE,
    },
    ClinicalStatus.RESOLVED: {ClinicalStatus.RECURRENCE},
    ClinicalStatus.INACTIVE: {ClinicalStatus.RECURRENCE, ClinicalStatus.RESOLVED},
}
# Entered-in-Error is reached only through the Entered-in-Error action, which also hides it.
VERIFICATION_TRANSITIONS = {
    VerificationStatus.UNCONFIRMED: {VerificationStatus.CONFIRMED, VerificationStatus.REFUTED},
    VerificationStatus.CONFIRMED: {VerificationStatus.REFUTED},
    VerificationStatus.REFUTED: set(),
    VerificationStatus.ENTERED_IN_ERROR: set(),
}


class Diagnosis(EncounterEntry):
    code_system = models.CharField(max_length=8, choices=CodeSystem.choices)
    code = models.CharField(max_length=20)
    display = models.CharField(max_length=255)
    clinical_status = models.CharField(
        max_length=12, choices=ClinicalStatus.choices, default=ClinicalStatus.ACTIVE
    )
    verification_status = models.CharField(
        max_length=16, choices=VerificationStatus.choices, default=VerificationStatus.UNCONFIRMED
    )
    onset_date = models.DateField(null=True, blank=True)
    abatement_date = models.DateField(null=True, blank=True)
    # 1 is the principal diagnosis of the encounter.
    rank = models.PositiveSmallIntegerField()
    note = models.TextField(blank=True)

    class Meta(EncounterEntry.Meta):
        verbose_name_plural = "diagnoses"
        ordering = ["encounter", "rank"]
        constraints = [
            models.UniqueConstraint(
                fields=["encounter", "rank"],
                condition=Q(record_state="active"),
                name="diagnosis_rank_unique_per_encounter",
            ),
            models.CheckConstraint(
                condition=~Q(clinical_status="resolved") | Q(abatement_date__isnull=False),
                name="diagnosis_resolved_needs_abatement",
            ),
            models.CheckConstraint(condition=Q(rank__gte=1), name="diagnosis_rank_positive"),
        ]

    def __str__(self) -> str:
        return f"{self.code} {self.display}"

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        instance._loaded_statuses = (
            instance.__dict__.get("clinical_status"),
            instance.__dict__.get("verification_status"),
        )
        return instance

    def clean(self):
        super().clean()
        errors = {}
        loaded = getattr(self, "_loaded_statuses", None)
        if loaded and not self._state.adding:
            old_clinical, old_verification = loaded
            if (
                self.clinical_status != old_clinical
                and self.clinical_status not in (CLINICAL_TRANSITIONS[old_clinical])
            ):
                errors["clinical_status"] = (
                    f"Cannot change from {old_clinical} to {self.clinical_status}."
                )
            if (
                self.verification_status != old_verification
                and self.verification_status not in (VERIFICATION_TRANSITIONS[old_verification])
            ):
                errors["verification_status"] = (
                    f"Cannot change from {old_verification} to {self.verification_status}."
                )
        elif self.verification_status == VerificationStatus.ENTERED_IN_ERROR:
            errors["verification_status"] = "Use the Entered-in-Error action."
        if self.clinical_status == ClinicalStatus.RESOLVED and not self.abatement_date:
            errors["abatement_date"] = "Required when the diagnosis is resolved."
        if self.clinical_status in _ACTIVE_LIKE and self.abatement_date:
            errors["abatement_date"] = "Only set when the condition has abated."
        if self.abatement_date:
            if self.abatement_date > timezone.localdate():
                errors["abatement_date"] = "Cannot be in the future."
            elif self.onset_date and self.abatement_date < self.onset_date:
                errors["abatement_date"] = "Cannot be before the onset."
        if self.onset_date and self.onset_date > timezone.localdate():
            errors["onset_date"] = "Cannot be in the future."
        if errors:
            raise ValidationError(errors)

    def mark_entered_in_error(self, reason: str) -> None:
        self.verification_status = VerificationStatus.ENTERED_IN_ERROR
        Diagnosis.objects.filter(pk=self.pk).update(
            verification_status=VerificationStatus.ENTERED_IN_ERROR
        )
        super().mark_entered_in_error(reason)


# -- consultation notes --------------------------------------------------------------


class NoteStatus(models.TextChoices):
    OPEN = "open", "Open"
    CLOSED = "closed", "Closed"


class ConsultationNote(EncounterEntry):
    """SOAP consultation note. Editable by its author while open; closing signs it off.

    A closed note is never edited: corrections are made in an addendum note.
    """

    subjective = models.TextField(blank=True)
    objective = models.TextField(blank=True)
    assessment = models.TextField(blank=True)
    plan = models.TextField(blank=True)
    status = models.CharField(max_length=8, choices=NoteStatus.choices, default=NoteStatus.OPEN)
    closed_at = models.DateTimeField(null=True, blank=True)
    addendum_to = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="addenda"
    )

    class Meta(EncounterEntry.Meta):
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Note {self.created_at:%Y-%m-%d %H:%M} ({self.status})"

    def clean(self):
        super().clean()
        if self.addendum_to_id:
            if self.addendum_to.status != NoteStatus.CLOSED:
                raise ValidationError({"addendum_to": "Only closed notes take addenda."})
            if self.addendum_to.encounter_id != self.encounter_id:
                raise ValidationError({"addendum_to": "The note is from another encounter."})
