"""Billing operations: charges, insurer and patient splits, payments, ledger and reconciliation.

Other modules call ``add_line``, ``finalise_line`` and ``void_line``. Every call is
idempotent on its key, so an event delivered twice never bills twice.

Ledger rules (CLAUDE.md Section 5):

- a line becomes final (service delivered): Debit Accounts Receivable (patient and insurer
  shares), Credit Revenue;
- a payment is received: Debit Cash/Bank, Credit Accounts Receivable. Each payment is
  posted when received, so when an invoice reaches Paid its receivable has been fully
  moved to Cash/Bank.
"""

import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Q, Sum
from django.utils import timezone

from apps.accounts import selectors as accounts
from apps.core import events
from apps.core.errors import DomainError
from apps.core.money import Money
from apps.core.roles import Role
from apps.core.tenancy import get_current_user_id
from apps.notifications import services as notifications
from apps.patients import selectors as patients

from . import gateway as payment_gateway
from . import ledger
from .events import INVOICE_PAID
from .models import (
    FULL_COVERAGE_BP,
    IntentStatus,
    Invoice,
    InvoiceLine,
    LineStatus,
    Payer,
    Payment,
    PaymentIntent,
    PaymentMethod,
    PaymentStatus,
    RevenueCategory,
)


class PaymentRefused(DomainError):
    code = "payment_refused"
    status_code = 409


class BillingLocked(DomainError):
    code = "billing_locked"
    status_code = 409


# -- invoices and lines --------------------------------------------------------------


def _open_invoice(patient_id, currency: str) -> Invoice:
    invoice = (
        Invoice.objects.select_for_update()
        .filter(patient_id=patient_id, currency=currency)
        .exclude(payment_status=PaymentStatus.PAID)
        .order_by("created_at")
        .first()
    )
    return invoice or Invoice.objects.create(patient_id=patient_id, currency=currency)


def split(invoice: Invoice, amount: Money) -> tuple[Money, Money]:
    """(insurer share, patient share) of an amount, without losing a minor unit."""
    coverage = invoice.insurer_coverage_bp
    if coverage == 0:
        return Money.zero(amount.currency), amount
    if coverage == FULL_COVERAGE_BP:
        return amount, Money.zero(amount.currency)
    insurer, patient = amount.allocate([coverage, FULL_COVERAGE_BP - coverage])
    return insurer, patient


def recalculate(invoice: Invoice) -> Invoice:
    """Derive every total and the payment status from lines and payments."""
    live = invoice.lines.exclude(status=LineStatus.VOID)
    line_totals = live.aggregate(
        total=Sum("amount_minor"),
        insurer=Sum("insurer_amount_minor"),
        patient=Sum("patient_amount_minor"),
    )
    paid = invoice.payments.aggregate(
        insurer=Sum("amount_minor", filter=Q(payer=Payer.INSURER)),
        patient=Sum("amount_minor", filter=Q(payer=Payer.PATIENT)),
    )
    invoice.total_minor = line_totals["total"] or 0
    invoice.insurer_due_minor = line_totals["insurer"] or 0
    invoice.patient_due_minor = line_totals["patient"] or 0
    invoice.insurer_paid_minor = paid["insurer"] or 0
    invoice.patient_paid_minor = paid["patient"] or 0
    total_paid = invoice.insurer_paid_minor + invoice.patient_paid_minor
    invoice.net_due_minor = invoice.total_minor - total_paid
    was_paid = invoice.payment_status == PaymentStatus.PAID
    if total_paid == 0:
        invoice.payment_status = PaymentStatus.UNPAID
    elif invoice.net_due_minor > 0:
        invoice.payment_status = PaymentStatus.PARTIALLY_PAID
    else:
        invoice.payment_status = PaymentStatus.PAID
    if invoice.payment_status == PaymentStatus.PAID and not was_paid:
        invoice.paid_at = timezone.now()
        events.publish(INVOICE_PAID, {"invoice_id": str(invoice.pk)})
    invoice.save()
    return invoice


@transaction.atomic
def add_line(
    *,
    patient_id,
    source: str,
    source_id,
    description: str,
    quantity: int,
    unit_price: Money,
    idempotency_key: str,
    revenue_category: str = RevenueCategory.OTHER,
) -> InvoiceLine:
    """Charge the patient. Returns the existing line if the key was already used.

    Used by pharmacy (prescriptions), scheduling (consultations), and later laboratory,
    imaging and ward charges.
    """
    if not isinstance(unit_price, Money):
        raise TypeError("unit_price must be Money")
    if quantity < 1:
        raise DomainError("Quantity must be at least 1.")
    if unit_price.amount_minor < 0:
        raise DomainError("Charges cannot be negative; issue a credit instead.")
    existing = InvoiceLine.objects.filter(idempotency_key=idempotency_key).first()
    if existing is not None:
        return existing
    invoice = _open_invoice(patient_id, unit_price.currency)
    amount = unit_price * quantity
    insurer_share, patient_share = split(invoice, amount)
    try:
        with transaction.atomic():
            line = InvoiceLine.objects.create(
                invoice=invoice,
                source=source,
                source_id=str(source_id),
                idempotency_key=idempotency_key,
                description=description[:255],
                revenue_category=revenue_category,
                quantity=quantity,
                unit_price_minor=unit_price.amount_minor,
                amount_minor=amount.amount_minor,
                insurer_amount_minor=insurer_share.amount_minor,
                patient_amount_minor=patient_share.amount_minor,
            )
    except IntegrityError:
        # The same event was handled at the same moment by another worker.
        return InvoiceLine.objects.get(idempotency_key=idempotency_key)
    recalculate(invoice)
    return line


@transaction.atomic
def finalise_line(idempotency_key: str) -> InvoiceLine | None:
    """The service was delivered: recognise the revenue in the ledger. Idempotent."""
    line = (
        InvoiceLine.objects.select_for_update()
        .select_related("invoice")
        .filter(idempotency_key=idempotency_key)
        .first()
    )
    if line is None or line.status != LineStatus.PENDING:
        return line
    line.status = LineStatus.FINAL
    line.finalised_at = timezone.now()
    line.save(update_fields=["status", "finalised_at", "updated_at", "updated_by"])
    currency = line.invoice.currency
    zero = Money.zero(currency)
    if line.amount_minor:
        ledger.post(
            description=f"Charge: {line.description}",
            source="billing.invoiceline",
            source_id=line.pk,
            idempotency_key=f"revenue:{line.pk}",
            lines=[
                (ledger.AR_PATIENTS, Money(line.patient_amount_minor, currency), zero),
                (ledger.AR_INSURERS, Money(line.insurer_amount_minor, currency), zero),
                (ledger.REVENUE[line.revenue_category], zero, Money(line.amount_minor, currency)),
            ],
        )
    return line


@transaction.atomic
def charge_delivered(**kwargs) -> InvoiceLine:
    """Add a line for a service already delivered (for example a completed consultation)."""
    line = add_line(**kwargs)
    return finalise_line(line.idempotency_key)


@transaction.atomic
def void_line(idempotency_key: str) -> InvoiceLine | None:
    """Remove a pending charge (for example a cancelled prescription)."""
    line = InvoiceLine.objects.select_for_update().filter(idempotency_key=idempotency_key).first()
    if line is None or line.status == LineStatus.VOID:
        return line
    if line.status == LineStatus.FINAL:
        raise BillingLocked("A delivered charge cannot be voided; issue a credit instead.")
    invoice = Invoice.objects.select_for_update().get(pk=line.invoice_id)
    paid = invoice.insurer_paid_minor + invoice.patient_paid_minor
    if invoice.total_minor - line.amount_minor < paid:
        raise BillingLocked("Voiding this charge would leave the invoice overpaid; refund first.")
    line.status = LineStatus.VOID
    line.save(update_fields=["status", "updated_at", "updated_by"])
    recalculate(invoice)
    return line


@transaction.atomic
def set_coverage(invoice: Invoice, *, insurer, coverage_bp: int) -> Invoice:
    """Set the insurer and its share. Only before any charge is final or anything is paid."""
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if not 0 <= coverage_bp <= FULL_COVERAGE_BP:
        raise DomainError("Coverage must be between 0 and 10000 basis points.")
    if coverage_bp and insurer is None:
        raise DomainError("Choose the insurer.")
    if invoice.payments.exists() or invoice.lines.filter(status=LineStatus.FINAL).exists():
        raise BillingLocked("Coverage is fixed once a charge is final or a payment is made.")
    invoice.insurer = insurer if coverage_bp else None
    invoice.insurer_coverage_bp = coverage_bp
    invoice.save(update_fields=["insurer", "insurer_coverage_bp", "updated_at", "updated_by"])
    for line in invoice.lines.exclude(status=LineStatus.VOID):
        insurer_share, patient_share = split(invoice, Money(line.amount_minor, invoice.currency))
        line.insurer_amount_minor = insurer_share.amount_minor
        line.patient_amount_minor = patient_share.amount_minor
        line.save(update_fields=["insurer_amount_minor", "patient_amount_minor", "updated_at"])
    return recalculate(invoice)


# -- payments ------------------------------------------------------------------------

_CASH_ACCOUNT = {
    PaymentMethod.CASH: ledger.CASH,
    PaymentMethod.CARD: ledger.BANK,
    PaymentMethod.TRANSFER: ledger.BANK,
    PaymentMethod.INSURER_REMITTANCE: ledger.BANK,
    PaymentMethod.ONLINE: ledger.BANK,
}


@transaction.atomic
def record_payment(
    invoice: Invoice,
    *,
    payer: str,
    method: str,
    amount: Money,
    reference: str = "",
    idempotency_key: str | None = None,
) -> Payment:
    """Record money received and post Debit Cash/Bank, Credit Accounts Receivable.

    Refuses another currency, nothing, or more than the payer still owes. Retrying with
    the same ``idempotency_key`` returns the first payment.
    """
    if idempotency_key:
        existing = Payment.objects.filter(idempotency_key=idempotency_key).first()
        if existing is not None:
            return existing
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if amount.currency != invoice.currency:
        raise PaymentRefused(f"This invoice is in {invoice.currency}.")
    if amount.amount_minor <= 0:
        raise PaymentRefused("Payments must be positive.")
    if payer == Payer.INSURER and invoice.insurer_id is None:
        raise PaymentRefused("This invoice has no insurer.")
    if (method == PaymentMethod.INSURER_REMITTANCE) != (payer == Payer.INSURER):
        raise PaymentRefused("Insurer remittance is only for insurer payments.")
    owed = (
        invoice.insurer_due_minor - invoice.insurer_paid_minor
        if payer == Payer.INSURER
        else invoice.patient_due_minor - invoice.patient_paid_minor
    )
    if amount.amount_minor > owed:
        raise PaymentRefused(
            f"The {payer} owes {Money(max(owed, 0), invoice.currency)}; refunds are separate."
        )
    payment = Payment.objects.create(
        invoice=invoice,
        payer=payer,
        method=method,
        amount_minor=amount.amount_minor,
        currency=amount.currency,
        reference=reference,
        idempotency_key=idempotency_key or f"payment:{uuid.uuid4()}",
        received_at=timezone.now(),
        received_by_id=get_current_user_id(),
    )
    zero = Money.zero(amount.currency)
    receivable = ledger.AR_INSURERS if payer == Payer.INSURER else ledger.AR_PATIENTS
    ledger.post(
        description=f"Payment received ({payment.get_method_display()})",
        source="billing.payment",
        source_id=payment.pk,
        idempotency_key=f"payment:{payment.pk}",
        lines=[(_CASH_ACCOUNT[method], amount, zero), (receivable, zero, amount)],
    )
    recalculate(invoice)
    return payment


# -- reconciliation ------------------------------------------------------------------


class ReminderRefused(DomainError):
    code = "reminder_refused"
    status_code = 409


def invoice_reference(invoice: Invoice) -> str:
    """The short number staff and patients quote, for example INV-3F9A12BC."""
    return f"INV-{str(invoice.pk)[:8].upper()}"


@transaction.atomic
def send_payment_reminder(invoice: Invoice) -> list[str]:
    """Email the patient what they still owe on a bill. Returns the channels used (email only).

    Only the patient's own share is asked for, never the insurer's. Refused when nothing is due from
    the patient, when the bill is held for estate review, when the patient has no email address on
    file, after ``BILLING_REMINDER_MAX`` reminders (then a person should call), or too soon after
    the last one. The subject carries the bill number but not the amount.
    """
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    owed = max(invoice.patient_due_minor - invoice.patient_paid_minor, 0)
    if invoice.payment_status == PaymentStatus.PAID or owed <= 0:
        raise ReminderRefused("Nothing is due from the patient on this invoice.")
    if invoice.estate_review or patients.is_deceased(invoice.patient_id):
        raise ReminderRefused("This invoice is held for estate review. Do not send a reminder.")
    contact = patients.contact_details(invoice.patient_id)
    if not contact or not contact["email"]:
        raise ReminderRefused("The patient has no email address on file.")
    if not contact["email_reminders"]:
        raise ReminderRefused("The patient has asked not to receive reminders.")
    if invoice.reminder_count >= settings.BILLING_REMINDER_MAX:
        raise ReminderRefused(
            f"{invoice.reminder_count} reminders have already been sent. "
            "Contact the patient directly."
        )
    wait = timedelta(hours=settings.BILLING_REMINDER_INTERVAL_HOURS)
    if invoice.last_reminder_at and timezone.now() - invoice.last_reminder_at < wait:
        raise ReminderRefused(
            f"A reminder was sent recently. Wait {settings.BILLING_REMINDER_INTERVAL_HOURS} "
            "hours between reminders."
        )

    reference = invoice_reference(invoice)
    online = (
        f"\nYou can also pay online: {settings.PORTAL_URL.rstrip('/')}/portal/invoices\n"
        if settings.PORTAL_URL
        else ""
    )
    body = (
        f"Dear {contact['first_name']},\n\n"
        f"This is a friendly reminder that {Money(owed, invoice.currency)} is still to be paid on "
        f"your bill {reference}.\n\n"
        f"You can pay at the cashier or by bank transfer, quoting {reference}.{online}\n"
        "If you have already paid, or you think this reminder is a mistake, please speak to our "
        "billing office. Thank you.\n"
    )
    notifications.queue_email(
        to=contact["email"],
        subject=f"A reminder about your bill {reference}",
        body=body,
        purpose="invoice_reminder",
        related_object=f"billing.invoice:{invoice.pk}",
    )
    invoice.last_reminder_at = timezone.now()
    invoice.reminder_count += 1
    invoice.save(update_fields=["last_reminder_at", "reminder_count", "updated_at", "updated_by"])
    return ["email"]


def reconcile(currency: str = "NGN") -> list[str]:
    """Check invoices, payments and the ledger agree, in the current tenant.

    An empty list means everything reconciles.
    """
    problems = []
    final_total = 0
    for invoice in Invoice.objects.filter(currency=currency).prefetch_related("lines", "payments"):
        lines = [line for line in invoice.lines.all() if line.status != LineStatus.VOID]
        payments = list(invoice.payments.all())
        total = sum(line.amount_minor for line in lines)
        paid = sum(p.amount_minor for p in payments)
        final_total += sum(line.amount_minor for line in lines if line.status == LineStatus.FINAL)
        label = f"invoice {invoice.pk}"
        if invoice.total_minor != total:
            problems.append(f"{label}: total {invoice.total_minor} != lines {total}")
        if invoice.net_due_minor != total - paid:
            problems.append(f"{label}: net due {invoice.net_due_minor} != {total} - {paid}")
        if any(
            line.insurer_amount_minor + line.patient_amount_minor != line.amount_minor
            for line in lines
        ):
            problems.append(f"{label}: a line's split does not add up")
        expected = (
            PaymentStatus.UNPAID
            if paid == 0
            else PaymentStatus.PAID
            if paid >= total
            else PaymentStatus.PARTIALLY_PAID
        )
        if invoice.payment_status != expected:
            problems.append(f"{label}: status {invoice.payment_status}, expected {expected}")
        if paid > total:
            problems.append(f"{label}: overpaid by {paid - total}")

    debits, credits = ledger.trial_balance(currency)
    if debits != credits:
        problems.append(f"ledger: debits {debits} != credits {credits}")
    balances = ledger.balances(currency)
    payments_total = (
        Payment.objects.filter(currency=currency).aggregate(total=Sum("amount_minor"))["total"] or 0
    )
    revenue = -sum(balances.get(code, 0) for code in ledger.REVENUE.values())
    receivable = balances.get(ledger.AR_PATIENTS, 0) + balances.get(ledger.AR_INSURERS, 0)
    cash = balances.get(ledger.CASH, 0) + balances.get(ledger.BANK, 0)
    if revenue != final_total:
        problems.append(f"ledger: revenue {revenue} != final charges {final_total}")
    if cash != payments_total:
        problems.append(f"ledger: cash and bank {cash} != payments {payments_total}")
    if receivable != final_total - payments_total:
        problems.append(
            f"ledger: receivable {receivable} != final charges {final_total} - payments "
            f"{payments_total}"
        )
    return problems


# -- online payments (Paystack, ADR 0023) ----------------------------------------------------
#
# The rule that matters: a bill is credited only after the gateway has confirmed the same
# reference and amount, and then once. A patient's browser coming back from the payment page
# proves nothing by itself; the server asks the gateway (or receives its signed webhook).

logger = logging.getLogger(__name__)


class OnlinePaymentRefused(DomainError):
    code = "online_payment_refused"
    status_code = 409


class OnlinePaymentNotFound(DomainError):
    code = "not_found"
    status_code = 404


def new_reference() -> str:
    return f"emr_{uuid.uuid4().hex}"


def patient_owes(invoice: Invoice) -> int:
    """What the patient still owes on the bill (their own share, not the insurer's)."""
    return max(invoice.patient_due_minor - invoice.patient_paid_minor, 0)


def start_online_payment(
    *, patient_id, invoice_id, amount_minor: int, email: str, callback_url: str
) -> PaymentIntent:
    """Begin a hosted checkout for part or all of what the patient owes on one of their bills.

    Returns the intent, whose ``authorization_url`` is where to send the patient. The bill is not
    touched. Someone else's bill is simply not found. The gateway is called outside the database
    transaction so a slow gateway never holds a lock.
    """
    with transaction.atomic():
        invoice = (
            Invoice.objects.select_for_update().filter(pk=invoice_id, patient_id=patient_id).first()
        )
        if invoice is None:
            raise OnlinePaymentNotFound("Not found.")
        if invoice.currency != "NGN":
            raise OnlinePaymentRefused("Online payment is only for bills in naira.")
        if invoice.estate_review or patients.is_deceased(patient_id):
            raise OnlinePaymentRefused("Please contact the billing office about this bill.")
        owed = patient_owes(invoice)
        if owed <= 0:
            raise OnlinePaymentRefused("Nothing is due on this bill.")
        if amount_minor < 1:
            raise OnlinePaymentRefused("Enter the amount you want to pay.")
        if amount_minor > owed:
            raise OnlinePaymentRefused(f"You owe {Money(owed, invoice.currency)} on this bill.")
        if not email:
            raise OnlinePaymentRefused("Add your email address to your profile first.")
        recent = timezone.now() - timedelta(minutes=settings.PAYMENT_INTENT_MINUTES)
        open_intent = PaymentIntent.objects.filter(
            invoice=invoice, status=IntentStatus.PENDING, created_at__gte=recent
        ).first()
        if open_intent is not None:
            if open_intent.amount_minor == amount_minor and open_intent.authorization_url:
                return open_intent  # the patient closed the tab: send them back to the same page
            raise OnlinePaymentRefused(
                "A payment for this bill is already in progress. Finish it, "
                "or try again in a few minutes."
            )
        intent = PaymentIntent.objects.create(
            invoice=invoice,
            amount_minor=amount_minor,
            currency=invoice.currency,
            reference=new_reference(),
        )
    try:
        url = payment_gateway.get_gateway().initialize(
            email=email,
            amount_minor=amount_minor,
            currency=intent.currency,
            reference=intent.reference,
            callback_url=callback_url,
        )
    except DomainError:
        intent.status = IntentStatus.FAILED
        intent.note = "The payment page could not be opened."
        intent.completed_at = timezone.now()
        intent.save(update_fields=["status", "note", "completed_at", "updated_at", "updated_by"])
        raise
    intent.authorization_url = url
    intent.save(update_fields=["authorization_url", "updated_at", "updated_by"])
    return intent


def _flag(intent: PaymentIntent, reason: str) -> PaymentIntent:
    """The gateway took money that cannot be applied. Park it and tell finance."""
    intent.status = IntentStatus.FLAGGED
    intent.note = reason[:300]
    intent.completed_at = timezone.now()
    intent.save(update_fields=["status", "note", "completed_at", "updated_at", "updated_by"])
    logger.error("Online payment %s needs review: %s", intent.reference, reason)
    for to in accounts.emails_of_role_holders([Role.BILLING_OFFICER, Role.FINANCE]):
        notifications.queue_email(
            to=to,
            subject="An online payment needs review",
            body=(
                f"Payment {intent.reference} for bill {invoice_reference(intent.invoice)} was "
                f"taken by the payment service but could not be applied: {reason}\n\n"
                "Please check it in the payment service dashboard and refund or apply it by hand."
            ),
            purpose="payment_flagged",
            related_object=f"billing.paymentintent:{intent.pk}",
        )
    return intent


@transaction.atomic
def settle_online_payment(reference: str, confirmation: dict) -> PaymentIntent | None:
    """Apply a payment the gateway has confirmed. Safe to call any number of times.

    ``confirmation`` is what the gateway reported: status, amount_minor, currency, and an id. The
    payment is recorded only if the gateway says it succeeded for exactly the amount and currency
    that was asked for. Returns the intent, or None for a reference we never issued.
    """
    intent = (
        PaymentIntent.objects.select_for_update()
        .select_related("invoice")
        .filter(reference=reference)
        .first()
    )
    if intent is None:
        return None
    if intent.status in (IntentStatus.SUCCEEDED, IntentStatus.FLAGGED):
        return intent
    if confirmation.get("status") != "success":
        return intent
    if (
        confirmation.get("amount_minor") != intent.amount_minor
        or confirmation.get("currency") != intent.currency
    ):
        return _flag(intent, "The amount paid does not match the amount requested.")
    try:
        payment = record_payment(
            intent.invoice,
            payer=Payer.PATIENT,
            method=PaymentMethod.ONLINE,
            amount=Money(intent.amount_minor, intent.currency),
            reference=reference,
            idempotency_key=f"paystack:{reference}",
        )
    except PaymentRefused as error:
        return _flag(intent, f"The bill could not take it: {error.message}")
    intent.status = IntentStatus.SUCCEEDED
    intent.payment = payment
    intent.completed_at = timezone.now()
    intent.gateway_transaction_id = str(confirmation.get("gateway_id", ""))[:40]
    intent.save(
        update_fields=[
            "status",
            "payment",
            "completed_at",
            "gateway_transaction_id",
            "updated_at",
            "updated_by",
        ]
    )
    return intent


def verify_online_payment(reference: str, *, patient_id=None) -> PaymentIntent:
    """Ask the gateway about a payment still waiting, and apply it if it succeeded.

    With ``patient_id``, a reference that belongs to someone else's bill is not found.
    """
    intent = PaymentIntent.objects.select_related("invoice").filter(reference=reference).first()
    if intent is None or (patient_id is not None and intent.invoice.patient_id != patient_id):
        raise OnlinePaymentNotFound("Not found.")
    if intent.status == IntentStatus.PENDING:
        confirmation = payment_gateway.get_gateway().verify(reference)
        intent = settle_online_payment(reference, confirmation) or intent
    return intent
