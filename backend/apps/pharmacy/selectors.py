"""Read-only queries that other modules may use."""

from django.db.models import Case, CharField, F, OuterRef, Q, Subquery, Sum, Value, When
from django.db.models.functions import Coalesce

from .models import Drug, OrderStatus, Prescription, PrescriptionStatus, PurchaseOrderLine


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


def inventory(today, text: str = "", status: str = ""):
    """Formulary drugs with units available (unexpired, not reserved), how many are on order,
    and a stock status: ``in_stock``, ``low`` (at or under the reorder level) or ``out``."""
    available = Sum(
        F("batches__quantity_on_hand") - F("batches__quantity_reserved"),
        filter=Q(batches__expiry_date__gte=today),
        default=0,
    )
    expected = (
        PurchaseOrderLine.objects.filter(
            drug=OuterRef("pk"),
            order__status__in=[OrderStatus.PENDING, OrderStatus.PARTIALLY_RECEIVED],
        )
        .values("drug")
        .annotate(total=Sum(F("quantity_ordered") - F("quantity_received")))
        .values("total")
    )
    queryset = (
        Drug.objects.filter(on_formulary=True)
        .annotate(available=available)
        .annotate(on_order=Coalesce(Subquery(expected), 0))
        .annotate(
            stock_status=Case(
                When(available__lte=0, then=Value("out")),
                When(available__lte=F("reorder_level"), then=Value("low")),
                default=Value("in_stock"),
                output_field=CharField(),
            )
        )
        .annotate(value_minor=F("available") * F("unit_price_minor"))
    )
    if text:
        queryset = queryset.filter(Q(name__icontains=text) | Q(brand_name__icontains=text))
    if status:
        queryset = queryset.filter(stock_status=status)
    return queryset


def patient_prescriptions(patient_id) -> list[dict]:
    """The patient's signed prescriptions, newest first. Drafts and cancelled ones are not shown.

    ``active`` is true while something is still to be taken or collected.
    """
    shown = [
        PrescriptionStatus.AUTHORISED,
        PrescriptionStatus.PARTIALLY_DISPENSED,
        PrescriptionStatus.DISPENSED,
    ]
    rows = []
    prescriptions = (
        Prescription.objects.filter(patient_id=patient_id, status__in=shown)
        .select_related("prescriber")
        .prefetch_related("items__drug")
        .order_by("-authorised_at")
    )
    for p in prescriptions:
        rows.append(
            {
                "id": p.pk,
                "prescribed_at": p.authorised_at,
                "doctor_name": p.prescriber.get_full_name() or p.prescriber.get_username(),
                "active": p.status != PrescriptionStatus.DISPENSED,
                "items": [
                    {
                        "id": item.pk,
                        "drug_name": str(item.drug),
                        "dose": item.dose,
                        "frequency": item.frequency,
                        "route": item.route,
                        "duration_days": item.duration_days,
                        "quantity": item.quantity,
                        "instructions": item.instructions,
                    }
                    for item in p.items.all()
                ],
            }
        )
    return rows
