"""Celery handlers for the diagnostics event chain. Each one is safe to run twice."""

import logging

from celery import shared_task

from apps.accounts import selectors as accounts
from apps.billing import services as billing
from apps.core import events
from apps.notifications import services as notifications
from apps.patients import selectors as patients

from . import services
from .models import DiagnosticOrder, Flag, Kind

logger = logging.getLogger(__name__)


def _order(order_id):
    return DiagnosticOrder.objects.select_related("investigation").filter(pk=order_id).first()


@shared_task
def request_invoice_line(envelope):
    """diagnostics.ordered -> a pending invoice line, via billing.services."""
    with events.event_context(envelope) as payload:
        order = _order(payload["order_id"])
        if order is None:
            return {"billed": False}
        kind = order.investigation.kind
        billing.add_line(
            patient_id=order.patient_id,
            source="diagnostics.order",
            source_id=order.pk,
            description=order.investigation.name,
            quantity=1,
            unit_price=order.unit_price,
            idempotency_key=services.billing_key(order.pk),
            revenue_category="laboratory" if kind == Kind.LAB else "imaging",
        )
        return {"billed": True}


@shared_task
def finalise_invoice_line(envelope):
    """diagnostics.resulted -> the charge becomes final revenue."""
    with events.event_context(envelope) as payload:
        line = billing.finalise_line(services.billing_key(payload["order_id"]))
        return {"finalised": line is not None}


@shared_task
def void_invoice_line(envelope):
    """diagnostics.cancelled -> take the pending charge off the bill."""
    with events.event_context(envelope) as payload:
        try:
            billing.void_line(services.billing_key(payload["order_id"]))
        except billing.BillingLocked:
            logger.warning("Order %s is cancelled but its charge is locked", payload["order_id"])
            return {"voided": False}
        return {"voided": True}


def _tell_orderer(order, subject, body, purpose):
    to = accounts.email_of(order.ordered_by_id)
    if not to:
        return False
    notifications.queue_email(
        to=to,
        subject=subject,
        body=body,
        purpose=purpose,
        related_object=f"diagnostics.order:{order.pk}",
    )
    return True


def _label(order) -> str:
    mrn = patients.summaries([order.patient_id]).get(order.patient_id, {}).get("mrn", "")
    return f"{order.investigation.name} for patient {mrn}"


@shared_task
def alert_critical_result(envelope):
    """diagnostics.resulted with a critical flag -> tell the person who ordered it.

    The email names the test and the MRN only; the value stays in the system.
    """
    with events.event_context(envelope) as payload:
        if payload.get("flag") != Flag.CRITICAL:
            return {"alerted": False}
        order = _order(payload["order_id"])
        if order is None:
            return {"alerted": False}
        return {
            "alerted": _tell_orderer(
                order,
                "A critical result needs your attention",
                f"The result of {_label(order)} is marked critical. "
                "Please open it in the system and act on it now.",
                "critical_result",
            )
        }


@shared_task
def notify_correction(envelope):
    """diagnostics.result_corrected -> the person who ordered it should look again."""
    with events.event_context(envelope) as payload:
        order = _order(payload["order_id"])
        if order is None:
            return {"notified": False}
        return {
            "notified": _tell_orderer(
                order,
                "A result has been corrected",
                f"The result of {_label(order)} was corrected. Please review the new version.",
                "result_corrected",
            )
        }
