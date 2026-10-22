from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel
from apps.core.money import CURRENCY_EXPONENTS, Money


class BedStatus(models.TextChoices):
    VACANT = "vacant", "Vacant"
    OCCUPIED = "occupied", "Occupied"
    CLEANING = "cleaning", "Cleaning"
    OUT_OF_SERVICE = "out_of_service", "Out of service"


class DischargeStatus(models.TextChoices):
    DISCHARGED = "discharged", "Discharged"
    LAMA = "lama", "Left against medical advice"
    TRANSFERRED = "transferred", "Transferred"


class Ward(TenantModel):
    """A ward of a facility. The daily charge is billed for every day a patient has a bed in it."""

    facility = models.ForeignKey("tenants.Facility", on_delete=models.PROTECT, related_name="+")
    name = models.CharField(max_length=100)
    daily_charge_minor = models.PositiveBigIntegerField(default=0)
    currency = models.CharField(max_length=3, default="NGN")
    active = models.BooleanField(default=True)

    class Meta(TenantModel.Meta):
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["facility", "name"], name="ward_name_per_facility")
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def daily_charge(self) -> Money:
        return Money(self.daily_charge_minor, self.currency)

    def clean(self):
        super().clean()
        if self.currency not in CURRENCY_EXPONENTS:
            from django.core.exceptions import ValidationError

            raise ValidationError({"currency": "Unsupported currency."})


class Bed(TenantModel):
    ward = models.ForeignKey(Ward, on_delete=models.PROTECT, related_name="beds")
    label = models.CharField(max_length=30)
    status = models.CharField(max_length=16, choices=BedStatus.choices, default=BedStatus.VACANT)

    class Meta(TenantModel.Meta):
        ordering = ["ward__name", "label"]
        constraints = [models.UniqueConstraint(fields=["ward", "label"], name="bed_label_per_ward")]

    def __str__(self) -> str:
        return f"{self.ward.name}, {self.label}"


class Admission(TenantModel):
    """One stay. Open while ``discharged_at`` is empty; ``bed`` is where the patient is now."""

    patient = models.ForeignKey("patients.Patient", on_delete=models.PROTECT, related_name="+")
    bed = models.ForeignKey(Bed, on_delete=models.PROTECT, related_name="admissions")
    reason = models.CharField(max_length=300)
    admitted_at = models.DateTimeField()
    discharged_at = models.DateTimeField(null=True, blank=True)
    discharge_status = models.CharField(max_length=12, choices=DischargeStatus.choices, blank=True)
    discharge_note = models.CharField(max_length=500, blank=True)

    class Meta(TenantModel.Meta):
        ordering = ["-admitted_at"]
        constraints = [
            # A patient is in one bed at a time, and a bed holds one patient at a time.
            models.UniqueConstraint(
                fields=["patient"],
                condition=Q(discharged_at__isnull=True),
                name="one_open_admission_per_patient",
            ),
            models.UniqueConstraint(
                fields=["bed"],
                condition=Q(discharged_at__isnull=True),
                name="one_open_admission_per_bed",
            ),
            models.CheckConstraint(
                condition=(Q(discharged_at__isnull=True) & Q(discharge_status=""))
                | (Q(discharged_at__isnull=False) & ~Q(discharge_status="")),
                name="discharge_status_with_discharge",
            ),
        ]

    @property
    def is_open(self) -> bool:
        return self.discharged_at is None


class BedMove(TenantModel):
    """History of transfers within a stay."""

    admission = models.ForeignKey(Admission, on_delete=models.CASCADE, related_name="moves")
    from_bed = models.ForeignKey(Bed, on_delete=models.PROTECT, related_name="+")
    to_bed = models.ForeignKey(Bed, on_delete=models.PROTECT, related_name="+")
    reason = models.CharField(max_length=300, blank=True)

    class Meta(TenantModel.Meta):
        ordering = ["created_at"]


class WardCharge(TenantModel):
    """The bed-day charge for one admission on one date, so a day is never billed twice."""

    admission = models.ForeignKey(Admission, on_delete=models.CASCADE, related_name="charges")
    charge_date = models.DateField()
    idempotency_key = models.CharField(max_length=100)

    class Meta(TenantModel.Meta):
        ordering = ["charge_date"]
        constraints = [
            models.UniqueConstraint(
                fields=["admission", "charge_date"], name="one_ward_charge_per_day"
            )
        ]
