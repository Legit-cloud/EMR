"""Billing operations other modules call: add, finalise and void invoice lines.

Every call is idempotent on its ``idempotency_key``, so an event delivered twice never
bills twice. Totals are recalculated in the same transaction.
"""

from django.db import IntegrityError, transaction
from django.db.models import Sum

from apps.core.errors import DomainError
from apps.core.money import Money

from .models import Invoice, InvoiceLine, LineStatus, PaymentStatus


def _open_invoice(patient_id, currency: str) -> Invoice:
    invoice = (
        Invoice.objects.select_for_update()
        .filter(patient_id=patient_id, currency=currency)
        .exclude(payment_status=PaymentStatus.PAID)
        .order_by("created_at")
        .first()
    )
    return invoice or Invoice.objects.create(patient_id=patient_id, currency=currency)


def recalculate(invoice: Invoice) -> Invoice:
    """Total of non-void lines; net due is the total until payments exist (Prompt 8)."""
    total = (
        invoice.lines.exclude(status=LineStatus.VOID).aggregate(total=Sum("amount_minor"))["total"]
        or 0
    )
    invoice.total_minor = total
    invoice.net_due_minor = total
    invoice.save(update_fields=["total_minor", "net_due_minor", "updated_at", "updated_by"])
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
) -> InvoiceLine:
    """Charge the patient. Returns the existing line if the key was already used."""
    if not isinstance(unit_price, Money):
        raise TypeError("unit_price must be Money")
    if quantity < 1:
        raise DomainError("Quantity must be at least 1.")
    existing = InvoiceLine.objects.filter(idempotency_key=idempotency_key).first()
    if existing is not None:
        return existing
    invoice = _open_invoice(patient_id, unit_price.currency)
    amount = unit_price * quantity
    try:
        with transaction.atomic():
            line = InvoiceLine.objects.create(
                invoice=invoice,
                source=source,
                source_id=str(source_id),
                idempotency_key=idempotency_key,
                description=description[:255],
                quantity=quantity,
                unit_price_minor=unit_price.amount_minor,
                amount_minor=amount.amount_minor,
            )
    except IntegrityError:
        # The same event was handled at the same moment by another worker.
        return InvoiceLine.objects.get(idempotency_key=idempotency_key)
    recalculate(invoice)
    return line


@transaction.atomic
def finalise_line(idempotency_key: str) -> InvoiceLine | None:
    """The service was delivered (for example the medicine was dispensed)."""
    line = InvoiceLine.objects.select_for_update().filter(idempotency_key=idempotency_key).first()
    if line is None or line.status != LineStatus.PENDING:
        return line
    line.status = LineStatus.FINAL
    line.save(update_fields=["status", "updated_at", "updated_by"])
    return line


@transaction.atomic
def void_line(idempotency_key: str) -> InvoiceLine | None:
    """Remove a pending charge (for example a cancelled prescription)."""
    line = InvoiceLine.objects.select_for_update().filter(idempotency_key=idempotency_key).first()
    if line is None or line.status == LineStatus.VOID:
        return line
    if line.status == LineStatus.FINAL:
        raise DomainError("A final charge cannot be voided; issue a credit instead.")
    line.status = LineStatus.VOID
    line.save(update_fields=["status", "updated_at", "updated_by"])
    recalculate(line.invoice)
    return line
