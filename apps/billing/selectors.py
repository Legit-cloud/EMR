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
