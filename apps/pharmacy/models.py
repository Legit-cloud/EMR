from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

from apps.core.models import TenantModel
from apps.core.money import Money

# -- interaction knowledge (shared reference data) -------------------------------------


class InteractionSeverity(models.TextChoices):
    MINOR = "minor", "Minor"
    MODERATE = "moderate", "Moderate"
    MAJOR = "major", "Major"
    CONTRAINDICATED = "contraindicated", "Contraindicated"


BLOCKING_SEVERITIES = {InteractionSeverity.MAJOR, InteractionSeverity.CONTRAINDICATED}


class InteractionRule(models.Model):
    """A drug-drug interaction between two ingredients (or ingredient classes).

    The starter rows are synthetic examples for development; the real knowledge base is an
    open decision (CLAUDE.md Section 12) and plugs in behind ``interactions.Checker``.
    """

    ingredient_a = models.CharField(max_length=100)
    ingredient_b = models.CharField(max_length=100)
    severity = models.CharField(max_length=16, choices=InteractionSeverity.choices)
    description = models.CharField(max_length=500)
    source = models.CharField(max_length=100, default="synthetic starter set")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["ingredient_a", "ingredient_b"], name="interaction_pair_unique"
            ),
            models.CheckConstraint(
                condition=Q(ingredient_a__lt=F("ingredient_b")), name="interaction_pair_ordered"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.ingredient_a} + {self.ingredient_b} ({self.severity})"


# -- formulary and stock ----------------------------------------------------------------


class DosageForm(models.TextChoices):
    TABLET = "tablet", "Tablet"
    CAPSULE = "capsule", "Capsule"
    SYRUP = "syrup", "Syrup / suspension"
    INJECTION = "injection", "Injection"
    CREAM = "cream", "Cream / ointment"
    INHALER = "inhaler", "Inhaler"
    DROPS = "drops", "Drops"
    OTHER = "other", "Other"


class Drug(TenantModel):
    """A formulary item. ``ingredients`` and ``classes`` drive the safety checks."""

    name = models.CharField(max_length=200, help_text="Generic name with strength")
    brand_name = models.CharField(max_length=200, blank=True)
    form = models.CharField(max_length=12, choices=DosageForm.choices)
    strength = models.CharField(max_length=50)
    # Lower-case active ingredients, e.g. ["amoxicillin", "clavulanic acid"].
    ingredients = ArrayField(models.CharField(max_length=100))
    # Lower-case drug classes used for allergy matching, e.g. ["penicillin", "beta-lactam"].
    classes = ArrayField(models.CharField(max_length=100), default=list, blank=True)
    unit_price_minor = models.BigIntegerField()
    currency = models.CharField(max_length=3, default="NGN")
    on_formulary = models.BooleanField(default=True)

    class Meta(TenantModel.Meta):
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} {self.strength} {self.get_form_display()}"

    @property
    def unit_price(self) -> Money:
        return Money(self.unit_price_minor, self.currency)

    def save(self, *args, **kwargs):
        self.ingredients = sorted({i.strip().casefold() for i in self.ingredients if i.strip()})
        self.classes = sorted({c.strip().casefold() for c in self.classes if c.strip()})
        super().save(*args, **kwargs)


class StockBatch(TenantModel):
    drug = models.ForeignKey(Drug, on_delete=models.PROTECT, related_name="batches")
    batch_number = models.CharField(max_length=50)
    expiry_date = models.DateField()
    quantity_on_hand = models.PositiveIntegerField()
    quantity_reserved = models.PositiveIntegerField(default=0)

    class Meta(TenantModel.Meta):
        ordering = ["expiry_date"]
        verbose_name_plural = "stock batches"
        constraints = [
            models.UniqueConstraint(fields=["drug", "batch_number"], name="batch_unique_per_drug"),
            models.CheckConstraint(
                condition=Q(quantity_reserved__lte=F("quantity_on_hand")),
                name="reserved_within_on_hand",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.drug} batch {self.batch_number}"

    @property
    def available(self) -> int:
        return self.quantity_on_hand - self.quantity_reserved


# -- prescriptions ----------------------------------------------------------------------


class PrescriptionStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    AUTHORISED = "authorised", "Authorised (signed)"
    PARTIALLY_DISPENSED = "partially_dispensed", "Partially dispensed"
    DISPENSED = "dispensed", "Dispensed"
    CANCELLED = "cancelled", "Cancelled"


class SignedRecordLocked(Exception):
    """Signed prescriptions are never edited (SEC-09)."""


class Prescription(TenantModel):
    patient = models.ForeignKey("patients.Patient", on_delete=models.PROTECT, related_name="+")
    encounter = models.ForeignKey("clinical.Encounter", on_delete=models.PROTECT, related_name="+")
    prescriber = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    status = models.CharField(
        max_length=20, choices=PrescriptionStatus.choices, default=PrescriptionStatus.DRAFT
    )
    note = models.CharField(max_length=500, blank=True)
    authorised_at = models.DateTimeField(null=True, blank=True)
    signature = models.TextField(blank=True)
    signing_key_id = models.CharField(max_length=32, blank=True)
    signed_payload_sha256 = models.CharField(max_length=64, blank=True)
    cancelled_reason = models.CharField(max_length=500, blank=True)

    class Meta(TenantModel.Meta):
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Prescription {self.pk} ({self.status})"

    def clean(self):
        super().clean()
        if self.encounter_id and self.patient_id and self.encounter.patient_id != self.patient_id:
            raise ValidationError({"encounter": "The encounter belongs to another patient."})


class PrescriptionItem(TenantModel):
    prescription = models.ForeignKey(Prescription, on_delete=models.CASCADE, related_name="items")
    drug = models.ForeignKey(Drug, on_delete=models.PROTECT, related_name="+")
    dose = models.CharField(max_length=50, help_text="For example 500 mg")
    frequency = models.CharField(max_length=50, help_text="For example three times daily")
    route = models.CharField(max_length=30, default="oral")
    duration_days = models.PositiveSmallIntegerField()
    quantity = models.PositiveIntegerField(help_text="Units to dispense")
    instructions = models.CharField(max_length=500, blank=True)
    quantity_dispensed = models.PositiveIntegerField(default=0)

    class Meta(TenantModel.Meta):
        ordering = ["created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gte=1), name="item_quantity_positive"),
            models.CheckConstraint(
                condition=Q(quantity_dispensed__lte=F("quantity")), name="dispensed_within_quantity"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.drug} {self.dose} {self.frequency}"

    def save(self, *args, **kwargs):
        if self.prescription.status != PrescriptionStatus.DRAFT and not kwargs.pop(
            "dispensing", False
        ):
            raise SignedRecordLocked("Items of a signed prescription cannot change.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.prescription.status != PrescriptionStatus.DRAFT:
            raise SignedRecordLocked("Items of a signed prescription cannot be removed.")
        return super().delete(*args, **kwargs)


class AlertKind(models.TextChoices):
    ALLERGY = "allergy", "Allergy"
    INTERACTION = "interaction", "Drug interaction"
    DUPLICATE = "duplicate", "Duplicate therapy"


class PrescriptionAlert(TenantModel):
    """Every alert raised at authorisation, with the override reason where one was given."""

    prescription = models.ForeignKey(Prescription, on_delete=models.CASCADE, related_name="alerts")
    kind = models.CharField(max_length=12, choices=AlertKind.choices)
    key = models.CharField(max_length=200)
    severity = models.CharField(max_length=16)
    blocking = models.BooleanField()
    message = models.CharField(max_length=500)
    override_reason = models.TextField(blank=True)

    class Meta(TenantModel.Meta):
        ordering = ["-blocking", "kind"]

    def __str__(self) -> str:
        return f"{self.kind}: {self.message}"


class StockReservation(TenantModel):
    class Status(models.TextChoices):
        RESERVED = "reserved", "Reserved"
        DISPENSED = "dispensed", "Dispensed"
        RELEASED = "released", "Released"

    item = models.ForeignKey(
        PrescriptionItem, on_delete=models.PROTECT, related_name="reservations"
    )
    batch = models.ForeignKey(StockBatch, on_delete=models.PROTECT, related_name="reservations")
    quantity = models.PositiveIntegerField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RESERVED)

    class Meta(TenantModel.Meta):
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.quantity} of {self.batch} ({self.status})"
