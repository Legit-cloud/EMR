"""Laboratory and imaging orders and results (CLAUDE.md Section 5).

A doctor orders a test or scan; the charge is put on the bill by an event handler. The
laboratory or imaging technician records the result, which makes the charge final. A clinician
reviews it, and only then can the patient see it in the portal. A result is never edited: a
correction is a new version and the earlier one stays on record.
"""

from django.db import transaction
from django.utils import timezone

from apps.core import events
from apps.core.errors import DomainError
from apps.core.tenancy import get_current_user_id
from apps.patients import selectors as patients

from .events import CANCELLED, ORDERED, RESULT_CORRECTED, RESULTED
from .models import (
    DiagnosticOrder,
    DiagnosticResult,
    Flag,
    Investigation,
    Kind,
    OrderStatus,
)


class OrderRefused(DomainError):
    code = "order_refused"
    status_code = 409


class ResultRefused(DomainError):
    code = "result_refused"
    status_code = 409


def billing_key(order_id) -> str:
    return f"diagnostics.order:{order_id}"


@transaction.atomic
def place_order(
    *, patient_id, investigation: Investigation, reason: str, priority: str, encounter_id=None
) -> DiagnosticOrder:
    reason = reason.strip()
    if len(reason) < 3:
        raise OrderRefused("Say why the test or scan is needed.")
    if not investigation.active:
        raise OrderRefused(f"{investigation.name} is not offered at the moment.")
    if not patients.patient_exists(patient_id):
        raise OrderRefused("That patient does not exist.")
    if patients.is_deceased(patient_id):
        raise OrderRefused("A deceased patient cannot have tests ordered.")
    order = DiagnosticOrder.objects.create(
        patient_id=patient_id,
        investigation=investigation,
        reason=reason,
        priority=priority,
        encounter_id=encounter_id,
        unit_price_minor=investigation.price_minor,
        currency=investigation.currency,
        ordered_by_id=_actor_id(),
    )
    events.publish(ORDERED, {"order_id": str(order.pk)})
    return order


def _actor_id():
    actor = get_current_user_id()
    if actor is None:
        raise DomainError("This needs a signed-in user.")
    return actor


def _lock(order: DiagnosticOrder) -> DiagnosticOrder:
    return (
        DiagnosticOrder.objects.select_for_update().select_related("investigation").get(pk=order.pk)
    )


@transaction.atomic
def mark_collected(order: DiagnosticOrder) -> DiagnosticOrder:
    order = _lock(order)
    if order.status != OrderStatus.ORDERED:
        raise OrderRefused(f"This order is already {order.get_status_display().lower()}.")
    order.status = OrderStatus.COLLECTED
    order.collected_at = timezone.now()
    order.save(update_fields=["status", "collected_at", "updated_at", "updated_by"])
    return order


@transaction.atomic
def cancel_order(order: DiagnosticOrder, *, reason: str) -> DiagnosticOrder:
    order = _lock(order)
    reason = reason.strip()
    if len(reason) < 3:
        raise OrderRefused("Say why the order is being cancelled.")
    if order.status == OrderStatus.RESULTED:
        raise OrderRefused("A result has been recorded; ask for a correction instead.")
    if order.status == OrderStatus.CANCELLED:
        raise OrderRefused("This order is already cancelled.")
    order.status = OrderStatus.CANCELLED
    order.cancelled_reason = reason
    order.save(update_fields=["status", "cancelled_reason", "updated_at", "updated_by"])
    events.publish(CANCELLED, {"order_id": str(order.pk)})
    return order


def _check_content(order, *, value, report, flag):
    kind = order.investigation.kind
    if flag not in Flag.values:
        raise ResultRefused("Choose normal, abnormal or critical.")
    if kind == Kind.LAB and not value.strip():
        raise ResultRefused("Enter the result value.")
    if kind == Kind.IMAGING and len(report.strip()) < 10:
        raise ResultRefused("Write the findings and impression.")


@transaction.atomic
def record_result(
    order: DiagnosticOrder, *, value: str = "", report: str = "", flag: str = Flag.NORMAL
) -> DiagnosticResult:
    """The first result. Makes the order Resulted and its charge final."""
    order = _lock(order)
    if order.status == OrderStatus.CANCELLED:
        raise ResultRefused("This order was cancelled.")
    if order.status == OrderStatus.RESULTED:
        raise ResultRefused("A result is already recorded; use a correction to change it.")
    _check_content(order, value=value, report=report, flag=flag)
    investigation = order.investigation
    result = DiagnosticResult.objects.create(
        order=order,
        version=1,
        value=value.strip(),
        unit=investigation.unit,
        reference_range=investigation.reference_range,
        flag=flag,
        report=report.strip(),
        reported_by_id=_actor_id(),
        reported_at=timezone.now(),
    )
    order.status = OrderStatus.RESULTED
    order.save(update_fields=["status", "updated_at", "updated_by"])
    events.publish(RESULTED, {"order_id": str(order.pk), "flag": flag})
    return result


@transaction.atomic
def correct_result(
    order: DiagnosticOrder, *, reason: str, value: str = "", report: str = "", flag: str
) -> DiagnosticResult:
    """A new version of the result. The old one is kept and marked superseded."""
    order = _lock(order)
    reason = reason.strip()
    if order.status != OrderStatus.RESULTED:
        raise ResultRefused("There is no result to correct.")
    if len(reason) < 5:
        raise ResultRefused("Say what was wrong with the earlier result.")
    _check_content(order, value=value, report=report, flag=flag)
    current = DiagnosticResult.objects.select_for_update().get(order=order, superseded=False)
    current.superseded = True
    current.save(update_fields=["superseded", "updated_at", "updated_by"])
    result = DiagnosticResult.objects.create(
        order=order,
        version=current.version + 1,
        value=value.strip(),
        unit=current.unit,
        reference_range=current.reference_range,
        flag=flag,
        report=report.strip(),
        reported_by_id=_actor_id(),
        reported_at=timezone.now(),
        correction_reason=reason,
    )
    events.publish(RESULT_CORRECTED, {"order_id": str(order.pk), "flag": flag})
    return result


@transaction.atomic
def review_result(order: DiagnosticOrder) -> DiagnosticResult:
    """A clinician has looked at the current result: the patient may now see it."""
    order = _lock(order)
    result = (
        DiagnosticResult.objects.select_for_update().filter(order=order, superseded=False).first()
    )
    if result is None:
        raise ResultRefused("There is no result to review yet.")
    if result.is_reviewed:
        return result
    result.reviewed_by_id = _actor_id()
    result.reviewed_at = timezone.now()
    result.save(update_fields=["reviewed_by", "reviewed_at", "updated_at", "updated_by"])
    return result


@transaction.atomic
def mark_seen(result_id, *, patient_id) -> bool:
    """The patient opened a released result. False if there is no such result for them."""
    result = (
        DiagnosticResult.objects.select_for_update()
        .filter(
            pk=result_id,
            order__patient_id=patient_id,
            superseded=False,
            reviewed_at__isnull=False,
        )
        .first()
    )
    if result is None:
        return False
    if result.patient_seen_at is None:
        result.patient_seen_at = timezone.now()
        result.save(update_fields=["patient_seen_at", "updated_at", "updated_by"])
    return True
