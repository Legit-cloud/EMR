"""Read-only queries that other modules, the chart and the portal may use."""

from apps.patients import selectors as patients

from .models import DiagnosticOrder, DiagnosticResult, OrderStatus


def open_order_count() -> int:
    return DiagnosticOrder.objects.filter(
        status__in=[OrderStatus.ORDERED, OrderStatus.COLLECTED]
    ).count()


def unreviewed_result_count() -> int:
    return DiagnosticResult.objects.filter(superseded=False, reviewed_at__isnull=True).count()


def released_results(patient_id) -> list[dict]:
    """What the patient may see: current results a clinician has reviewed, newest first.

    Shaped for the portal: a laboratory flag of critical is shown as abnormal, and an imaging
    report goes in ``note``.
    """
    rows = (
        DiagnosticResult.objects.filter(
            order__patient_id=patient_id, superseded=False, reviewed_at__isnull=False
        )
        .select_related("order__investigation", "order__ordered_by")
        .order_by("-reported_at")
    )
    return [
        {
            "id": r.pk,
            "kind": r.order.investigation.kind,
            "name": r.order.investigation.name,
            "taken_at": r.order.collected_at or r.reported_at,
            "ordered_by": r.order.ordered_by.get_full_name() or r.order.ordered_by.get_username(),
            "seen": r.patient_seen_at is not None,
            "flag": "normal" if r.flag == "normal" else "abnormal",
            "value": r.value,
            "unit": r.unit,
            "low": None,
            "high": None,
            "note": r.report,
        }
        for r in rows
    ]


def names_for(patient_ids) -> dict:
    return patients.summaries(patient_ids)
