"""Read-only queries that other modules may use."""

from django.db.models import F, Q, Sum

from .models import Drug, Prescription, PrescriptionStatus


def stock_summary(today, currency: str, low_limit: int = 5) -> dict:
    """Formulary stock for the dashboard: units available per drug (unexpired, not reserved),
    the value at selling price, and how many drugs are in stock, low or out."""
    available = Sum(
        F("batches__quantity_on_hand") - F("batches__quantity_reserved"),
        filter=Q(batches__expiry_date__gte=today),
        default=0,
    )
    drugs = list(
        Drug.objects.filter(on_formulary=True)
        .annotate(available=available)
        .values(
            "id", "name", "strength", "unit_price_minor", "currency", "reorder_level", "available"
        )
    )
    out = [d for d in drugs if d["available"] <= 0]
    low = [d for d in drugs if 0 < d["available"] <= d["reorder_level"]]
    low_first = sorted(low + out, key=lambda d: (d["available"] > 0, d["available"], d["name"]))
    return {
        "currency": currency,
        "value_minor": sum(
            d["available"] * d["unit_price_minor"]
            for d in drugs
            if d["available"] > 0 and d["currency"] == currency
        ),
        "products": len(drugs),
        "in_stock": len(drugs) - len(low) - len(out),
        "low": len(low),
        "out": len(out),
        "low_items": [
            {
                "drug": str(d["id"]),
                "name": f"{d['name']} {d['strength']}".strip(),
                "available": d["available"],
                "reorder_level": d["reorder_level"],
            }
            for d in low_first[:low_limit]
        ],
    }


def draft_prescription_count(prescriber_id) -> int:
    """Prescriptions this prescriber started but has not signed."""
    return Prescription.objects.filter(
        prescriber_id=prescriber_id, status=PrescriptionStatus.DRAFT
    ).count()
