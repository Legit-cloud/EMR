"""Celery handlers for the prescription event chain. Each one is idempotent."""

import logging

from celery import shared_task

from apps.billing import services as billing
from apps.core import events

from . import services
from .models import PrescriptionItem

logger = logging.getLogger(__name__)


def _items(prescription_id, item_ids=None):
    items = PrescriptionItem.objects.filter(prescription_id=prescription_id).select_related(
        "drug", "prescription"
    )
    return items.filter(pk__in=item_ids) if item_ids else items


@shared_task
def reserve_stock_for_prescription(envelope):
    """prescription.authorised -> reserve stock, earliest expiry first."""
    with events.event_context(envelope) as payload:
        short = 0
        for item in _items(payload["prescription_id"]):
            short += services.reserve_stock(item)
        if short:
            logger.warning(
                "Prescription %s is short of %d unit(s)", payload["prescription_id"], short
            )
        return {"short": short}


@shared_task
def request_invoice_lines(envelope):
    """prescription.authorised -> one pending invoice line per item, via billing.services."""
    with events.event_context(envelope) as payload:
        for item in _items(payload["prescription_id"]):
            drug = item.drug
            billing.add_line(
                patient_id=item.prescription.patient_id,
                source="pharmacy.prescriptionitem",
                source_id=item.pk,
                description=f"{drug.name} {drug.strength} ({drug.get_form_display()})",
                quantity=item.quantity,
                unit_price=item.drug.unit_price,
                idempotency_key=services.billing_key(item.pk),
                revenue_category="pharmacy",
            )


@shared_task
def finalise_invoice_lines(envelope):
    """prescription.dispensed -> lines of fully dispensed items become final."""
    with events.event_context(envelope) as payload:
        for item in _items(payload["prescription_id"], payload["item_ids"]):
            if item.quantity_dispensed == item.quantity:
                billing.finalise_line(services.billing_key(item.pk))


@shared_task
def release_cancelled_prescription(envelope):
    """prescription.cancelled -> release stock and void the pending invoice lines."""
    with events.event_context(envelope) as payload:
        for item in _items(payload["prescription_id"]):
            services.release_reservations(item)
            billing.void_line(services.billing_key(item.pk))
