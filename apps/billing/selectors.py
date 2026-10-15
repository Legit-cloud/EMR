"""Read-only billing queries that other modules may use."""

from .models import InvoiceLine


def line_for(idempotency_key: str) -> dict | None:
    return (
        InvoiceLine.objects.filter(idempotency_key=idempotency_key)
        .values("id", "invoice_id", "status", "quantity", "amount_minor", "invoice__currency")
        .first()
    )
