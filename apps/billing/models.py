from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel
from apps.core.money import Money


class PaymentStatus(models.TextChoices):
    UNPAID = "unpaid", "Unpaid"
    PARTIALLY_PAID = "partially_paid", "Partially paid"
    PAID = "paid", "Paid"


class Invoice(TenantModel):
    """A patient's bill. Lines arrive from other modules through ``billing.services``.

    Amounts are integer minor units in ``currency`` (never floats).
    """

    patient = models.ForeignKey("patients.Patient", on_delete=models.PROTECT, related_name="+")
    currency = models.CharField(max_length=3, default="NGN")
    payment_status = models.CharField(
        max_length=16, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID
    )
    total_minor = models.BigIntegerField(default=0)
    net_due_minor = models.BigIntegerField(default=0)
    # Set when the patient dies with an outstanding balance (patient.deceased).
    estate_review = models.BooleanField(default=False)

    class Meta(TenantModel.Meta):
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Invoice {self.pk} ({self.get_payment_status_display()})"

    @property
    def total(self) -> Money:
        return Money(self.total_minor, self.currency)

    @property
    def net_due(self) -> Money:
        return Money(self.net_due_minor, self.currency)


class LineStatus(models.TextChoices):
    PENDING = "pending", "Pending"  # charged, service not yet delivered (e.g. not dispensed)
    FINAL = "final", "Final"
    VOID = "void", "Void"


class InvoiceLine(TenantModel):
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="lines")
    # Where the charge comes from, e.g. "pharmacy.prescriptionitem" and its id.
    source = models.CharField(max_length=64)
    source_id = models.CharField(max_length=64)
    # The same request delivered twice (a replayed event) never adds a second line.
    idempotency_key = models.CharField(max_length=128)
    description = models.CharField(max_length=255)
    quantity = models.PositiveIntegerField()
    unit_price_minor = models.BigIntegerField()
    amount_minor = models.BigIntegerField()
    status = models.CharField(max_length=8, choices=LineStatus.choices, default=LineStatus.PENDING)

    class Meta(TenantModel.Meta):
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"], name="invoice_line_idempotent"
            ),
            models.CheckConstraint(
                condition=Q(amount_minor=models.F("unit_price_minor") * models.F("quantity")),
                name="invoice_line_amount_matches",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.description} x{self.quantity}"
