from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel
from apps.core.money import CURRENCY_EXPONENTS, Money


class Kind(models.TextChoices):
    LAB = "lab", "Laboratory"
    IMAGING = "imaging", "Imaging"


class Priority(models.TextChoices):
    ROUTINE = "routine", "Routine"
    URGENT = "urgent", "Urgent"
    STAT = "stat", "Immediately"


class OrderStatus(models.TextChoices):
    ORDERED = "ordered", "Ordered"
    COLLECTED = "collected", "Sample taken or patient arrived"
    RESULTED = "resulted", "Resulted"
    CANCELLED = "cancelled", "Cancelled"


class Flag(models.TextChoices):
    NORMAL = "normal", "Normal"
    ABNORMAL = "abnormal", "Abnormal"
    CRITICAL = "critical", "Critical"


class Investigation(TenantModel):
    """One test or scan the facility offers, with its price."""

    kind = models.CharField(max_length=8, choices=Kind.choices)
    name = models.CharField(max_length=150)
    # Optional LOINC code (CLAUDE.md Section 2) and the UCUM unit results are reported in.
    code = models.CharField(max_length=20, blank=True)
    unit = models.CharField("UCUM unit", max_length=32, blank=True)
    reference_range = models.CharField(max_length=100, blank=True)
    price_minor = models.PositiveBigIntegerField(default=0)
    currency = models.CharField(max_length=3, default="NGN")
    active = models.BooleanField(default=True)

    class Meta(TenantModel.Meta):
        ordering = ["kind", "name"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "kind", "name"], name="investigation_name")
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def price(self) -> Money:
        return Money(self.price_minor, self.currency)

    def clean(self):
        super().clean()
        if self.currency not in CURRENCY_EXPONENTS:
            raise ValidationError({"currency": "Unsupported currency."})


class DiagnosticOrder(TenantModel):
    """A request for one test or scan for one patient. The price is fixed when it is ordered."""

    patient = models.ForeignKey("patients.Patient", on_delete=models.PROTECT, related_name="+")
    investigation = models.ForeignKey(Investigation, on_delete=models.PROTECT, related_name="+")
    ordered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    # The encounter it was ordered in, if any. Kept as an id: the clinical module owns encounters.
    encounter_id = models.UUIDField(null=True, blank=True)
    reason = models.CharField(max_length=300)
    priority = models.CharField(max_length=8, choices=Priority.choices, default=Priority.ROUTINE)
    status = models.CharField(
        max_length=10, choices=OrderStatus.choices, default=OrderStatus.ORDERED
    )
    unit_price_minor = models.PositiveBigIntegerField()
    currency = models.CharField(max_length=3)
    collected_at = models.DateTimeField(null=True, blank=True)
    cancelled_reason = models.CharField(max_length=300, blank=True)

    class Meta(TenantModel.Meta):
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=~Q(status="cancelled") | ~Q(cancelled_reason=""),
                name="cancelled_order_has_reason",
            )
        ]

    @property
    def unit_price(self) -> Money:
        return Money(self.unit_price_minor, self.currency)


class DiagnosticResult(TenantModel):
    """What came back. Never edited: a correction is a new version and the old one is kept."""

    order = models.ForeignKey(DiagnosticOrder, on_delete=models.PROTECT, related_name="results")
    version = models.PositiveSmallIntegerField(default=1)
    superseded = models.BooleanField(default=False)
    # Laboratory: the value as reported. Imaging: ``report`` holds the findings and impression.
    value = models.CharField(max_length=200, blank=True)
    unit = models.CharField("UCUM unit", max_length=32, blank=True)
    reference_range = models.CharField(max_length=100, blank=True)
    flag = models.CharField(max_length=10, choices=Flag.choices, default=Flag.NORMAL)
    report = models.TextField(blank=True)
    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    reported_at = models.DateTimeField()
    correction_reason = models.CharField(max_length=300, blank=True)
    # A clinician looks at the result before the patient can see it (ADR 0025).
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # When the patient first opened it in the portal.
    patient_seen_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantModel.Meta):
        ordering = ["order", "-version"]
        constraints = [
            models.UniqueConstraint(fields=["order", "version"], name="one_result_per_version"),
            models.UniqueConstraint(
                fields=["order"], condition=Q(superseded=False), name="one_current_result"
            ),
        ]

    @property
    def is_reviewed(self) -> bool:
        return self.reviewed_at is not None
