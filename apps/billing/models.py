from django.conf import settings
from django.db import models
from django.db.models import F, Q

from apps.core.models import TenantModel
from apps.core.money import Money

FULL_COVERAGE_BP = 10_000  # coverage in basis points: 10 000 = 100%


class Insurer(TenantModel):
    """An HMO or insurer that pays part of a patient's bill."""

    name = models.CharField(max_length=200)
    code = models.SlugField(max_length=32)
    is_active = models.BooleanField(default=True)

    class Meta(TenantModel.Meta):
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "code"], name="insurer_code_per_tenant")
        ]

    def __str__(self) -> str:
        return self.name


class PaymentStatus(models.TextChoices):
    UNPAID = "unpaid", "Unpaid"
    PARTIALLY_PAID = "partially_paid", "Partially paid"
    PAID = "paid", "Paid"


class Invoice(TenantModel):
    """A patient's bill. Lines arrive from other modules through ``billing.services``.

    All amounts are integer minor units in ``currency``; never floats. Totals are derived
    from lines and payments by ``services.recalculate`` and checked by ``reconcile``.
    """

    patient = models.ForeignKey("patients.Patient", on_delete=models.PROTECT, related_name="+")
    currency = models.CharField(max_length=3, default="NGN")
    insurer = models.ForeignKey(
        Insurer, on_delete=models.PROTECT, null=True, blank=True, related_name="invoices"
    )
    insurer_coverage_bp = models.PositiveIntegerField(default=0)
    payment_status = models.CharField(
        max_length=16, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID
    )
    total_minor = models.BigIntegerField(default=0)
    insurer_due_minor = models.BigIntegerField(default=0)
    patient_due_minor = models.BigIntegerField(default=0)
    insurer_paid_minor = models.BigIntegerField(default=0)
    patient_paid_minor = models.BigIntegerField(default=0)
    net_due_minor = models.BigIntegerField(default=0)
    paid_at = models.DateTimeField(null=True, blank=True)
    # Set when the patient dies with an outstanding balance (patient.deceased).
    estate_review = models.BooleanField(default=False)
    # When a payment reminder was last sent, so patients are not messaged repeatedly.
    last_reminder_at = models.DateTimeField(null=True, blank=True)
    reminder_count = models.PositiveSmallIntegerField(default=0)

    class Meta(TenantModel.Meta):
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=Q(insurer_coverage_bp__lte=FULL_COVERAGE_BP), name="coverage_at_most_100"
            ),
            models.CheckConstraint(
                condition=Q(insurer_coverage_bp=0) | Q(insurer__isnull=False),
                name="coverage_needs_insurer",
            ),
        ]

    def __str__(self) -> str:
        return f"Invoice {self.pk} ({self.get_payment_status_display()})"

    def _money(self, minor: int) -> Money:
        return Money(minor, self.currency)

    @property
    def total(self) -> Money:
        return self._money(self.total_minor)

    @property
    def net_due(self) -> Money:
        return self._money(self.net_due_minor)


class LineStatus(models.TextChoices):
    PENDING = "pending", "Pending"  # charged, service not yet delivered (e.g. not dispensed)
    FINAL = "final", "Final"  # delivered: revenue recognised in the ledger
    VOID = "void", "Void"


class RevenueCategory(models.TextChoices):
    PHARMACY = "pharmacy", "Pharmacy"
    CONSULTATION = "consultation", "Consultations"
    LABORATORY = "laboratory", "Laboratory"
    IMAGING = "imaging", "Imaging"
    WARD = "ward", "Ward and bed"
    PROCEDURE = "procedure", "Procedures"
    OTHER = "other", "Other services"


class InvoiceLine(TenantModel):
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="lines")
    # Where the charge comes from, e.g. "pharmacy.prescriptionitem" and its id.
    source = models.CharField(max_length=64)
    source_id = models.CharField(max_length=64)
    # The same request delivered twice (a replayed event) never adds a second line.
    idempotency_key = models.CharField(max_length=128)
    description = models.CharField(max_length=255)
    revenue_category = models.CharField(
        max_length=16, choices=RevenueCategory.choices, default=RevenueCategory.OTHER
    )
    quantity = models.PositiveIntegerField()
    unit_price_minor = models.BigIntegerField()
    amount_minor = models.BigIntegerField()
    insurer_amount_minor = models.BigIntegerField(default=0)
    patient_amount_minor = models.BigIntegerField(default=0)
    status = models.CharField(max_length=8, choices=LineStatus.choices, default=LineStatus.PENDING)
    finalised_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantModel.Meta):
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"], name="invoice_line_idempotent"
            ),
            models.CheckConstraint(
                condition=Q(amount_minor=F("unit_price_minor") * F("quantity")),
                name="invoice_line_amount_matches",
            ),
            models.CheckConstraint(
                condition=Q(amount_minor=F("insurer_amount_minor") + F("patient_amount_minor")),
                name="invoice_line_split_adds_up",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.description} x{self.quantity}"


class Payer(models.TextChoices):
    PATIENT = "patient", "Patient"
    INSURER = "insurer", "Insurer"


class PaymentMethod(models.TextChoices):
    CASH = "cash", "Cash"
    CARD = "card", "Card / POS"
    TRANSFER = "transfer", "Bank transfer"
    INSURER_REMITTANCE = "insurer_remittance", "Insurer remittance"
    # Only ever set by the gateway integration, after Paystack confirms the payment. Staff cannot
    # choose it when taking a payment by hand.
    ONLINE = "online", "Online (Paystack)"


class Payment(TenantModel):
    """Money received against an invoice. For an online payment the reference is the gateway's, and
    the payment exists only because the gateway confirmed it (see PaymentIntent)."""

    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="payments")
    payer = models.CharField(max_length=8, choices=Payer.choices)
    method = models.CharField(max_length=20, choices=PaymentMethod.choices)
    amount_minor = models.BigIntegerField()
    currency = models.CharField(max_length=3)
    reference = models.CharField(max_length=100, blank=True)
    idempotency_key = models.CharField(max_length=128)
    received_at = models.DateTimeField()
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )

    class Meta(TenantModel.Meta):
        ordering = ["received_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"], name="payment_idempotent"
            ),
            models.CheckConstraint(condition=Q(amount_minor__gt=0), name="payment_positive"),
        ]

    def __str__(self) -> str:
        return f"{self.currency} {self.amount_minor} from {self.payer}"

    @property
    def amount(self) -> Money:
        return Money(self.amount_minor, self.currency)


# -- general ledger ------------------------------------------------------------------


class AccountType(models.TextChoices):
    ASSET = "asset", "Asset"
    LIABILITY = "liability", "Liability"
    EQUITY = "equity", "Equity"
    REVENUE = "revenue", "Revenue"
    EXPENSE = "expense", "Expense"


class Account(TenantModel):
    code = models.CharField(max_length=10)
    name = models.CharField(max_length=100)
    account_type = models.CharField(max_length=10, choices=AccountType.choices)

    class Meta(TenantModel.Meta):
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "code"], name="account_code_per_tenant")
        ]

    def __str__(self) -> str:
        return f"{self.code} {self.name}"


class JournalEntry(TenantModel):
    """A balanced, append-only double-entry posting.

    The database refuses UPDATE and DELETE on journal tables, and a deferred constraint
    trigger refuses to commit an entry whose debits and credits differ. Mistakes are
    corrected with a reversing entry, never by editing.
    """

    posted_at = models.DateTimeField()
    description = models.CharField(max_length=255)
    source = models.CharField(max_length=64)
    source_id = models.CharField(max_length=64)
    idempotency_key = models.CharField(max_length=128)
    currency = models.CharField(max_length=3)

    class Meta(TenantModel.Meta):
        ordering = ["posted_at"]
        verbose_name_plural = "journal entries"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"], name="journal_entry_idempotent"
            )
        ]

    def __str__(self) -> str:
        return f"{self.posted_at:%Y-%m-%d} {self.description}"


class JournalLine(TenantModel):
    entry = models.ForeignKey(JournalEntry, on_delete=models.PROTECT, related_name="lines")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="lines")
    debit_minor = models.BigIntegerField(default=0)
    credit_minor = models.BigIntegerField(default=0)

    class Meta(TenantModel.Meta):
        constraints = [
            models.CheckConstraint(
                condition=(Q(debit_minor__gt=0) & Q(credit_minor=0))
                | (Q(debit_minor=0) & Q(credit_minor__gt=0)),
                name="journal_line_one_side",
            )
        ]

    def __str__(self) -> str:
        side = f"Dr {self.debit_minor}" if self.debit_minor else f"Cr {self.credit_minor}"
        return f"{self.account.code} {side}"


class IntentStatus(models.TextChoices):
    PENDING = "pending", "Waiting for the patient to pay"
    SUCCEEDED = "succeeded", "Paid and recorded"
    FAILED = "failed", "Failed"
    # The gateway took money that could not be applied to the bill (it was paid or changed in the
    # meantime, or the amount differed). A person must look at it; finance is emailed.
    FLAGGED = "flagged", "Needs finance review"


class PaymentIntent(TenantModel):
    """A patient's start of an online payment. Nothing is credited to the bill until the gateway
    confirms the same reference and amount, and then exactly once (the payment is keyed by it)."""

    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="intents")
    amount_minor = models.BigIntegerField()
    currency = models.CharField(max_length=3)
    reference = models.CharField(max_length=64, unique=True)
    gateway = models.CharField(max_length=20, default="paystack")
    status = models.CharField(
        max_length=10, choices=IntentStatus.choices, default=IntentStatus.PENDING
    )
    authorization_url = models.TextField(blank=True)
    gateway_transaction_id = models.CharField(max_length=40, blank=True)
    note = models.CharField(max_length=300, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    payment = models.OneToOneField(
        Payment, on_delete=models.PROTECT, null=True, blank=True, related_name="intent"
    )

    class Meta(TenantModel.Meta):
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(amount_minor__gt=0), name="intent_positive")
        ]

    def __str__(self) -> str:
        return f"{self.reference} ({self.status})"
