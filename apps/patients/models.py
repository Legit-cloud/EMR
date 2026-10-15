import uuid
from datetime import date
from pathlib import Path

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone

from apps.core.models import SoftStateModel, TenantModel

from .normalize import clean_name, name_key, validate_e164, validate_person_name


class PatientStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    INACTIVE = "inactive", "Inactive"
    DECEASED = "deceased", "Deceased"


class Sex(models.TextChoices):
    """Administrative sex (FHIR AdministrativeGender)."""

    FEMALE = "female", "Female"
    MALE = "male", "Male"
    OTHER = "other", "Other"
    UNKNOWN = "unknown", "Unknown"


def validate_birth_date(value: date) -> None:
    if value > timezone.localdate():
        raise ValidationError("Date of birth cannot be in the future.")
    if value.year < 1880:
        raise ValidationError("Date of birth is too far in the past.")


class MRNSequence(models.Model):
    """Per-tenant, per-year counter behind MRNs. Only touched by ``mrn.next_mrn``."""

    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.PROTECT, related_name="+")
    year = models.PositiveSmallIntegerField()
    last_value = models.PositiveIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "year"], name="mrn_sequence_per_tenant_year")
        ]

    def __str__(self) -> str:
        return f"{self.tenant_id} {self.year}: {self.last_value}"


class Patient(SoftStateModel):
    mrn = models.CharField("MRN", max_length=20, editable=False)
    first_name = models.CharField(max_length=100, validators=[validate_person_name])
    middle_name = models.CharField(max_length=100, blank=True)
    last_name = models.CharField(max_length=100, validators=[validate_person_name])
    date_of_birth = models.DateField(validators=[validate_birth_date])
    sex = models.CharField(max_length=8, choices=Sex.choices, default=Sex.UNKNOWN)
    national_id = models.CharField(max_length=32, blank=True)
    phone = models.CharField(max_length=16, blank=True, validators=[validate_e164])
    email = models.EmailField(blank=True)
    address_line = models.CharField(max_length=200, blank=True)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=2, default="NG")
    status = models.CharField(
        max_length=10, choices=PatientStatus.choices, default=PatientStatus.ACTIVE
    )
    deceased_at = models.DateField(null=True, blank=True)
    # Accent- and case-folded copies used for trigram duplicate matching.
    first_name_key = models.CharField(max_length=100, editable=False)
    last_name_key = models.CharField(max_length=100, editable=False)

    class Meta(SoftStateModel.Meta):
        ordering = ["last_name", "first_name"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "mrn"], name="patient_mrn_unique_per_tenant"),
            models.CheckConstraint(
                condition=~models.Q(status="deceased") | models.Q(deceased_at__isnull=False),
                name="patient_deceased_needs_date",
            ),
        ]
        indexes = [
            GinIndex(
                fields=["first_name_key"], opclasses=["gin_trgm_ops"], name="patient_first_trgm"
            ),
            GinIndex(
                fields=["last_name_key"], opclasses=["gin_trgm_ops"], name="patient_last_trgm"
            ),
            models.Index(fields=["tenant", "date_of_birth"], name="patient_dob"),
            models.Index(fields=["tenant", "national_id"], name="patient_national_id"),
        ]

    def __str__(self) -> str:
        return f"{self.mrn} {self.first_name} {self.last_name}"

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        instance._loaded_mrn = instance.__dict__.get("mrn")
        return instance

    def clean(self):
        super().clean()
        if self.status == PatientStatus.DECEASED:
            if self.deceased_at is None:
                raise ValidationError({"deceased_at": "Required when the patient is deceased."})
            if self.deceased_at > timezone.localdate():
                raise ValidationError({"deceased_at": "Cannot be in the future."})
            if self.date_of_birth and self.deceased_at < self.date_of_birth:
                raise ValidationError({"deceased_at": "Cannot be before the date of birth."})
        elif self.deceased_at is not None:
            raise ValidationError({"deceased_at": "Only set for deceased patients."})

    def save(self, *args, **kwargs):
        self.first_name = clean_name(self.first_name)
        self.middle_name = clean_name(self.middle_name)
        self.last_name = clean_name(self.last_name)
        self.first_name_key = name_key(self.first_name)
        self.last_name_key = name_key(self.last_name)
        if self._state.adding:
            from .mrn import next_mrn

            with transaction.atomic():
                self._assign_tenant()
                if self.mrn:
                    raise ValidationError({"mrn": "MRNs are generated, never supplied."})
                self.mrn = next_mrn(self.tenant_id)
                super().save(*args, **kwargs)
            return
        if getattr(self, "_loaded_mrn", self.mrn) != self.mrn:
            raise ValidationError({"mrn": "An MRN can never be changed."})
        super().save(*args, **kwargs)


class AllergyCategory(models.TextChoices):
    MEDICATION = "medication", "Medication"
    FOOD = "food", "Food"
    ENVIRONMENT = "environment", "Environment"
    BIOLOGIC = "biologic", "Biologic"


class AllergySeverity(models.TextChoices):
    MILD = "mild", "Mild"
    MODERATE = "moderate", "Moderate"
    SEVERE = "severe", "Severe"


class Allergy(SoftStateModel):
    """Structured allergy, used by the prescription interaction and allergy check."""

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="allergies")
    substance = models.CharField(max_length=200)
    # Optional coded substance (for example an RxNorm or SNOMED CT code).
    substance_code = models.CharField(max_length=64, blank=True)
    category = models.CharField(max_length=12, choices=AllergyCategory.choices)
    reaction = models.CharField(max_length=500)
    severity = models.CharField(max_length=10, choices=AllergySeverity.choices)
    onset_date = models.DateField(null=True, blank=True)
    note = models.TextField(blank=True)

    class Meta(SoftStateModel.Meta):
        verbose_name_plural = "allergies"
        ordering = ["substance"]

    def __str__(self) -> str:
        return f"{self.substance} ({self.get_severity_display()})"


class AttachmentCategory(models.TextChoices):
    ID_DOCUMENT = "id_document", "ID document"
    REFERRAL = "referral", "Referral letter"
    CONSENT = "consent", "Consent form"
    REPORT = "report", "External report"
    OTHER = "other", "Other"


def attachment_path(instance: "Attachment", filename: str) -> str:
    """Storage key never contains the uploaded file name (it may hold PHI)."""
    suffix = Path(filename).suffix.lower()[:10]
    return f"tenants/{instance.tenant_id}/patients/{instance.patient_id}/{uuid.uuid4()}{suffix}"


class Attachment(SoftStateModel):
    """A file in private object storage. Read only through short-lived signed URLs (SEC-05)."""

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="attachments")
    file = models.FileField(upload_to=attachment_path, max_length=255)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()
    category = models.CharField(max_length=16, choices=AttachmentCategory.choices)
    description = models.CharField(max_length=500, blank=True)

    class Meta(SoftStateModel.Meta):
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.original_name

    def save(self, *args, **kwargs):
        self._assign_tenant()  # the storage path needs the tenant
        super().save(*args, **kwargs)


class ReviewStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    CREATED_NEW = "created_new", "Not a duplicate: new patient created"
    DUPLICATE = "duplicate", "Duplicate of an existing patient"
    REJECTED = "rejected", "Registration rejected"


class DuplicateReview(TenantModel):
    """A registration held back because it looks like an existing patient (score > 85%)."""

    status = models.CharField(
        max_length=12, choices=ReviewStatus.choices, default=ReviewStatus.PENDING
    )
    # The submitted registration, kept until a person decides.
    payload = models.JSONField()
    # [{"patient_id", "mrn", "score", "components"}], best match first.
    candidates = models.JSONField()
    top_score = models.FloatField()
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.TextField(blank=True)
    matched_patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    created_patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )

    class Meta(TenantModel.Meta):
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Duplicate review {self.pk} ({self.status})"
