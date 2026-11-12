"""Prescribing, the safety check, signing, stock and dispensing.

Event chain (CLAUDE.md Section 5): authorise -> ``prescription.authorised`` -> Celery
handlers reserve stock and add invoice lines (``billing.services``) -> dispensing ->
``prescription.dispensed`` -> billing lines become final. The prescriber's request only
commits and publishes; it never waits for stock or billing work.
"""

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.audit import services as audit
from apps.core import events
from apps.core.errors import DomainError
from apps.core.tenancy import get_current_user_id
from apps.notifications import services as notifications
from apps.patients import selectors as patients
from apps.tenants.selectors import tenant_name

from . import signing
from .events import PRESCRIPTION_AUTHORISED, PRESCRIPTION_CANCELLED, PRESCRIPTION_DISPENSED
from .interactions import get_checker
from .models import (
    OrderReceipt,
    OrderStatus,
    Prescription,
    PrescriptionAlert,
    PrescriptionItem,
    PrescriptionStatus,
    PurchaseOrder,
    PurchaseOrderLine,
    StockBatch,
    StockReservation,
    Vendor,
)

P = PrescriptionStatus


class SafetyAlertsBlock(DomainError):
    """Blocking safety alerts need an override reason before the prescription is signed."""

    code = "safety_alerts"
    status_code = 409


class PrescriptionStateError(DomainError):
    code = "prescription_state"
    status_code = 409


class OutOfStock(DomainError):
    code = "out_of_stock"
    status_code = 409


# -- authorisation and signing -------------------------------------------------------


def check_safety(prescription: Prescription):
    drugs = [item.drug for item in prescription.items.select_related("drug")]
    return get_checker().check(
        patient_id=prescription.patient_id, drugs=drugs, exclude_prescription_id=prescription.pk
    )


@transaction.atomic
def authorise(prescription: Prescription, *, overrides: dict[str, str] | None = None):
    """Run the safety check, then sign and publish ``prescription.authorised``.

    ``overrides`` maps blocking alert keys to reasons. Without a reason for every blocking
    alert nothing is saved: the prescription stays a draft and the alerts are returned.
    """
    prescription = Prescription.objects.select_for_update().get(pk=prescription.pk)
    if prescription.status != P.DRAFT:
        raise PrescriptionStateError("Only a draft prescription can be authorised.")
    if prescription.prescriber_id != get_current_user_id():
        raise PrescriptionStateError("Only the prescriber can authorise and sign.")
    if not prescription.items.exists():
        raise PrescriptionStateError("Add at least one item.")
    if patients.is_deceased(prescription.patient_id):
        raise PrescriptionStateError("The patient is recorded as deceased.")

    overrides = {k: (v or "").strip() for k, v in (overrides or {}).items()}
    alerts = check_safety(prescription)
    missing = [
        a
        for a in alerts
        if a.blocking and len(overrides.get(a.key, "")) < settings.PRESCRIPTION_MIN_OVERRIDE_REASON
    ]
    if missing:
        raise SafetyAlertsBlock(
            details={
                "alerts": [
                    {
                        "key": a.key,
                        "kind": a.kind,
                        "severity": a.severity,
                        "blocking": a.blocking,
                        "message": a.message,
                    }
                    for a in alerts
                ],
                "override_required": [a.key for a in missing],
            }
        )

    for alert in alerts:
        reason = overrides.get(alert.key, "") if alert.blocking else ""
        PrescriptionAlert.objects.create(
            prescription=prescription,
            kind=alert.kind,
            key=alert.key,
            severity=alert.severity,
            blocking=alert.blocking,
            message=alert.message,
            override_reason=reason,
        )
        if reason:
            audit.record(
                action=audit.AuditAction.UPDATE,
                resource="pharmacy.prescription",
                object_id=prescription.pk,
                reason=reason,
                details={"override": alert.key, "severity": alert.severity},
            )

    prescription.status = P.AUTHORISED
    prescription.authorised_at = timezone.now()
    prescription.signature, prescription.signing_key_id, prescription.signed_payload_sha256 = (
        signing.sign(prescription)
    )
    prescription.save()
    events.publish(PRESCRIPTION_AUTHORISED, {"prescription_id": str(prescription.pk)})
    return prescription


def verify_signature(prescription: Prescription) -> bool:
    return signing.verify(prescription)


# -- stock ---------------------------------------------------------------------------


@transaction.atomic
def reserve_stock(item: PrescriptionItem) -> int:
    """Reserve the item's outstanding quantity, earliest expiry first. Idempotent.

    Returns the quantity still unreserved (0 when fully covered). A shortfall does not
    undo the prescription: pharmacy sees it and restocks or substitutes.
    """
    item = PrescriptionItem.objects.select_for_update().get(pk=item.pk)
    reserved = sum(
        r.quantity
        for r in item.reservations.filter(
            status__in=[StockReservation.Status.RESERVED, StockReservation.Status.DISPENSED]
        )
    )
    needed = item.quantity - reserved
    if needed <= 0:
        return 0
    batches = (
        StockBatch.objects.select_for_update()
        .filter(drug_id=item.drug_id, expiry_date__gt=timezone.localdate())
        .order_by("expiry_date", "created_at")
    )
    for batch in batches:
        take = min(batch.available, needed)
        if take <= 0:
            continue
        batch.quantity_reserved += take
        batch.save(update_fields=["quantity_reserved", "updated_at", "updated_by"])
        StockReservation.objects.create(item=item, batch=batch, quantity=take)
        needed -= take
        if needed == 0:
            break
    return needed


@transaction.atomic
def release_reservations(item: PrescriptionItem) -> None:
    for reservation in item.reservations.select_for_update().filter(
        status=StockReservation.Status.RESERVED
    ):
        batch = StockBatch.objects.select_for_update().get(pk=reservation.batch_id)
        batch.quantity_reserved -= reservation.quantity
        batch.save(update_fields=["quantity_reserved", "updated_at", "updated_by"])
        reservation.status = StockReservation.Status.RELEASED
        reservation.save(update_fields=["status", "updated_at", "updated_by"])


# -- dispensing and cancellation -----------------------------------------------------


@transaction.atomic
def dispense(prescription: Prescription, quantities: dict) -> Prescription:
    """Hand out reserved stock. ``quantities`` maps item id to units given now."""
    prescription = Prescription.objects.select_for_update().get(pk=prescription.pk)
    if prescription.status not in (P.AUTHORISED, P.PARTIALLY_DISPENSED):
        raise PrescriptionStateError("Only an authorised prescription can be dispensed.")
    if not signing.verify(prescription):
        raise PrescriptionStateError("The prescription signature does not verify; do not dispense.")
    items = {str(i.pk): i for i in prescription.items.select_for_update()}
    dispensed_ids = []
    for item_id, quantity in quantities.items():
        item = items.get(str(item_id))
        if item is None:
            raise DomainError("Unknown item.", details={"items": [str(item_id)]})
        if quantity < 1 or item.quantity_dispensed + quantity > item.quantity:
            raise DomainError(
                "More than prescribed.", details={"items": [f"{item_id}: {quantity}"]}
            )
        _take_reserved(item, quantity)
        item.quantity_dispensed += quantity
        item.save(update_fields=["quantity_dispensed", "updated_at", "updated_by"], dispensing=True)
        dispensed_ids.append(str(item.pk))
    complete = all(i.quantity_dispensed == i.quantity for i in items.values())
    prescription.status = P.DISPENSED if complete else P.PARTIALLY_DISPENSED
    prescription.save(update_fields=["status", "updated_at", "updated_by"])
    events.publish(
        PRESCRIPTION_DISPENSED,
        {"prescription_id": str(prescription.pk), "item_ids": dispensed_ids, "complete": complete},
    )
    return prescription


def _take_reserved(item: PrescriptionItem, quantity: int) -> None:
    reserve_stock(item)  # top up if stock arrived since authorisation
    if _reserved_quantity(item) < quantity:
        raise OutOfStock(f"Not enough stock of {item.drug} to dispense {quantity}.")
    remaining = quantity
    for reservation in (
        item.reservations.select_for_update()
        .filter(status=StockReservation.Status.RESERVED)
        .order_by("batch__expiry_date")
    ):
        if remaining == 0:
            break
        batch = StockBatch.objects.select_for_update().get(pk=reservation.batch_id)
        take = min(reservation.quantity, remaining)
        batch.quantity_on_hand -= take
        batch.quantity_reserved -= take
        batch.save(
            update_fields=["quantity_on_hand", "quantity_reserved", "updated_at", "updated_by"]
        )
        if take == reservation.quantity:
            reservation.status = StockReservation.Status.DISPENSED
            reservation.save(update_fields=["status", "updated_at", "updated_by"])
        else:
            reservation.quantity -= take
            reservation.save(update_fields=["quantity", "updated_at", "updated_by"])
            StockReservation.objects.create(
                item=item, batch=batch, quantity=take, status=StockReservation.Status.DISPENSED
            )
        remaining -= take
    if remaining:
        raise OutOfStock(f"Not enough stock of {item.drug} to dispense {quantity}.")


def _reserved_quantity(item: PrescriptionItem) -> int:
    return sum(
        r.quantity for r in item.reservations.filter(status=StockReservation.Status.RESERVED)
    )


@transaction.atomic
def cancel(prescription: Prescription, reason: str) -> Prescription:
    prescription = Prescription.objects.select_for_update().get(pk=prescription.pk)
    if prescription.status not in (P.DRAFT, P.AUTHORISED):
        raise PrescriptionStateError("Only an undispensed prescription can be cancelled.")
    if not reason.strip():
        raise DomainError("Give a reason.", details={"reason": ["Required."]})
    was_authorised = prescription.status == P.AUTHORISED
    prescription.status = P.CANCELLED
    prescription.cancelled_reason = reason.strip()
    prescription.save(update_fields=["status", "cancelled_reason", "updated_at", "updated_by"])
    if was_authorised:
        events.publish(PRESCRIPTION_CANCELLED, {"prescription_id": str(prescription.pk)})
    return prescription


def billing_key(item_id) -> str:
    return f"pharmacy.prescriptionitem:{item_id}"


# -- buying stock ------------------------------------------------------------------------


class OrderError(DomainError):
    code = "order_refused"
    status_code = 409


def order_reference(order: PurchaseOrder) -> str:
    """The short number staff and vendors quote, for example PO-3F9A12BC."""
    return f"PO-{str(order.pk)[:8].upper()}"


def _order_status(order: PurchaseOrder) -> str:
    lines = list(order.lines.all())
    received = sum(line.quantity_received for line in lines)
    if received == 0:
        return OrderStatus.PENDING
    if all(line.quantity_received >= line.quantity_ordered for line in lines):
        return OrderStatus.COMPLETE
    return OrderStatus.PARTIALLY_RECEIVED


@transaction.atomic
def place_order(*, vendor: Vendor, lines: list[dict], note: str = "") -> PurchaseOrder:
    """Create an order and email it to the vendor. ``lines`` hold drug, quantity, unit_cost_minor.

    The email is queued, so a mail outage never blocks the order; ``email_sent_at`` records
    that it was handed on.
    """
    if not vendor.active:
        raise OrderError("This vendor is no longer active.")
    if not lines:
        raise OrderError("Add at least one item to the order.")
    drugs = [line["drug"] for line in lines]
    if not all(drug.on_formulary for drug in drugs):
        raise OrderError("Only drugs on the formulary can be ordered.")
    if len({drug.pk for drug in drugs}) != len(drugs):
        raise OrderError("Each drug can appear on an order once.")
    currencies = {drug.currency for drug in drugs}
    if len(currencies) != 1:
        raise OrderError("All items on an order must use one currency.")
    order = PurchaseOrder.objects.create(vendor=vendor, currency=currencies.pop(), note=note)
    PurchaseOrderLine.objects.bulk_create(
        PurchaseOrderLine(
            order=order,
            drug=line["drug"],
            quantity_ordered=line["quantity"],
            unit_cost_minor=line["unit_cost_minor"],
        )
        for line in lines
    )
    if vendor.email:
        rows = "\n".join(f"- {line['drug']}: {line['quantity']} units" for line in lines)
        notifications.queue_email(
            to=vendor.email,
            subject=f"Purchase order {order_reference(order)}",
            body=(
                f"Dear {vendor.name},\n\n"
                f"Please supply the following to {tenant_name(order.tenant_id) or 'us'} under "
                f"purchase order {order_reference(order)}:\n\n{rows}\n"
                + (f"\nNote: {note}\n" if note else "")
                + "\nPlease reply to confirm that you can supply this and when it will arrive. "
                f"Quote {order_reference(order)} on your delivery note and your invoice, and "
                "deliver only what is listed. Deliveries that do not match this order may be "
                "refused.\n\nThank you.\n"
            ),
            purpose="purchase_order",
            related_object=f"pharmacy.purchaseorder:{order.pk}",
        )
        order.email_sent_at = timezone.now()
        order.save(update_fields=["email_sent_at", "updated_at", "updated_by"])
    return order


@transaction.atomic
def receive_order(order: PurchaseOrder, receipts: list[dict]) -> PurchaseOrder:
    """Book a delivery, in full or in part. Each receipt holds line, quantity, batch_number
    and expiry_date. The units join stock as a batch; the order becomes partially received
    until every line has arrived."""
    order = PurchaseOrder.objects.select_for_update().get(pk=order.pk)
    if order.status in (OrderStatus.COMPLETE, OrderStatus.CANCELLED):
        raise OrderError(f"This order is already {order.get_status_display().lower()}.")
    if not receipts:
        raise OrderError("Enter the quantity received for at least one item.")
    lines = {
        line.pk: line for line in PurchaseOrderLine.objects.select_for_update().filter(order=order)
    }
    today = timezone.localdate()
    seen = set()
    for entry in receipts:
        line = lines.get(entry["line"].pk)
        if line is None:
            raise OrderError("That item is not on this order.")
        if line.pk in seen:
            raise OrderError("Each item can be received once per delivery.")
        seen.add(line.pk)
        quantity = entry["quantity"]
        outstanding = line.quantity_ordered - line.quantity_received
        if quantity < 1:
            raise OrderError("Quantities received must be at least 1.")
        if quantity > outstanding:
            raise OrderError(
                f"{line.drug.name}: only {outstanding} still expected, {quantity} entered."
            )
        if entry["expiry_date"] <= today:
            raise OrderError(f"{line.drug.name}: the expiry date must be in the future.")
        batch_number = entry["batch_number"].strip()
        if not batch_number:
            raise OrderError(f"{line.drug.name}: enter the batch number.")
        batch = (
            StockBatch.objects.select_for_update()
            .filter(drug=line.drug, batch_number=batch_number)
            .first()
        )
        if batch is None:
            StockBatch.objects.create(
                drug=line.drug,
                batch_number=batch_number,
                expiry_date=entry["expiry_date"],
                quantity_on_hand=quantity,
            )
        elif batch.expiry_date != entry["expiry_date"]:
            raise OrderError(
                f"{line.drug.name}: batch {batch_number} already exists with a different expiry."
            )
        else:
            batch.quantity_on_hand += quantity
            batch.save(update_fields=["quantity_on_hand", "updated_at", "updated_by"])
        OrderReceipt.objects.create(
            line=line,
            quantity=quantity,
            batch_number=batch_number,
            expiry_date=entry["expiry_date"],
        )
        line.quantity_received += quantity
        line.save(update_fields=["quantity_received", "updated_at", "updated_by"])
    order.status = _order_status(order)
    order.save(update_fields=["status", "updated_at", "updated_by"])
    return order


@transaction.atomic
def cancel_order(order: PurchaseOrder) -> PurchaseOrder:
    order = PurchaseOrder.objects.select_for_update().get(pk=order.pk)
    if order.status != OrderStatus.PENDING:
        raise OrderError("Only an order with nothing received can be cancelled.")
    order.status = OrderStatus.CANCELLED
    order.save(update_fields=["status", "updated_at", "updated_by"])
    return order
