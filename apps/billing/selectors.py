"""Read-only billing queries that other modules may use."""

from django.db.models import Count, Sum

from .models import InvoiceLine, LineStatus, Payment, RevenueCategory


def line_for(idempotency_key: str) -> dict | None:
    return (
        InvoiceLine.objects.filter(idempotency_key=idempotency_key)
        .values("id", "invoice_id", "status", "quantity", "amount_minor", "invoice__currency")
        .first()
    )


# -- dashboard aggregates ----------------------------------------------------------
# Totals only, never rows: the reports module turns them into dashboard cards.


def collected_by_period(start, end, currency: str, trunc) -> dict:
    """Payments received in [start, end), summed per period (``trunc`` is TruncMonth etc.)."""
    rows = (
        Payment.objects.filter(received_at__gte=start, received_at__lt=end, currency=currency)
        .annotate(period=trunc("received_at"))
        .values("period")
        .annotate(total=Sum("amount_minor"))
    )
    return {row["period"]: row["total"] for row in rows}


def billed_by_period(start, end, currency: str, trunc) -> dict:
    """Charges (not voided) raised in [start, end), summed per period."""
    rows = (
        _lines(start, end, currency)
        .annotate(period=trunc("created_at"))
        .values("period")
        .annotate(total=Sum("amount_minor"))
    )
    return {row["period"]: row["total"] for row in rows}


def revenue_by_category(start, end, currency: str) -> list[dict]:
    rows = (
        _lines(start, end, currency)
        .values("revenue_category")
        .annotate(total=Sum("amount_minor"))
        .order_by("-total")
    )
    labels = dict(RevenueCategory.choices)
    return [
        {
            "category": row["revenue_category"],
            "label": labels.get(row["revenue_category"], row["revenue_category"]),
            "amount_minor": row["total"],
        }
        for row in rows
        if row["total"]
    ]


def popular_services(start, end, limit: int = 5) -> list[dict]:
    """The services billed most often, by line description. Medicines are left out:
    they belong to the stock card, not to services."""
    rows = (
        InvoiceLine.objects.filter(created_at__gte=start, created_at__lt=end)
        .exclude(status=LineStatus.VOID)
        .exclude(revenue_category=RevenueCategory.PHARMACY)
        .values("description")
        .annotate(count=Count("id"))
        .order_by("-count", "description")[:limit]
    )
    return [{"name": row["description"], "count": row["count"]} for row in rows]


def _lines(start, end, currency: str):
    return InvoiceLine.objects.filter(
        created_at__gte=start, created_at__lt=end, invoice__currency=currency
    ).exclude(status=LineStatus.VOID)


def patient_invoices(patient_id) -> list[dict]:
    """The patient's own bills, newest first, as the patient owes them (their share only).

    A bill split with an insurer shows the patient's share as the total; the insurer's share is
    between the insurer and the hospital.
    """
    from .models import Invoice

    rows = []
    invoices = (
        Invoice.objects.filter(patient_id=patient_id)
        .prefetch_related("lines")
        .order_by("-created_at")
    )
    for invoice in invoices:
        due = max(invoice.patient_due_minor - invoice.patient_paid_minor, 0)
        if invoice.patient_due_minor == 0:
            continue
        rows.append(
            {
                "id": invoice.pk,
                "reference": f"INV-{str(invoice.pk)[:8].upper()}",
                "created_at": invoice.created_at,
                "currency": invoice.currency,
                "total_minor": invoice.patient_due_minor,
                "paid_minor": min(invoice.patient_paid_minor, invoice.patient_due_minor),
                "due_minor": due,
                "status": "paid"
                if due == 0
                else ("partially_paid" if invoice.patient_paid_minor > 0 else "unpaid"),
                "lines": [
                    {"description": line.description, "amount_minor": line.patient_amount_minor}
                    for line in invoice.lines.all()
                    if line.status != LineStatus.VOID and line.patient_amount_minor > 0
                ],
            }
        )
    return rows


def patient_balance(patient_id) -> tuple[int, str]:
    """What the patient still owes across all bills, and the currency (the first bill's)."""
    rows = patient_invoices(patient_id)
    return sum(r["due_minor"] for r in rows), (rows[0]["currency"] if rows else "NGN")
