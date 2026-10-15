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
from apps.patients import selectors as patients

from . import signing
from .events import PRESCRIPTION_AUTHORISED, PRESCRIPTION_CANCELLED, PRESCRIPTION_DISPENSED
from .interactions import get_checker
from .models import (
    Prescription,
    PrescriptionAlert,
    PrescriptionItem,
    PrescriptionStatus,
    StockBatch,
    StockReservation,
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
