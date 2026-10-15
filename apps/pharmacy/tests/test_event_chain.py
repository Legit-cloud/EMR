"""The event chain: authorised -> reserve stock + invoice line -> dispensed -> line final.

The prescriber's request never waits for stock or billing work.
"""

import time
from unittest import mock

import pytest

from apps.billing.models import Invoice, InvoiceLine
from apps.core import events
from apps.pharmacy import services, tasks
from apps.pharmacy.models import Prescription, StockBatch, StockReservation

pytestmark = pytest.mark.django_db

PRESCRIPTIONS = "/api/pharmacy/prescriptions/"


def authorise(client, prescription):
    return client.post(f"{PRESCRIPTIONS}{prescription['id']}/authorise/", {}, format="json")


def dispense(client, prescription, quantity):
    item = prescription["items"][0]["id"]
    return client.post(
        f"{PRESCRIPTIONS}{prescription['id']}/dispense/", {"items": {item: quantity}}, format="json"
    )


def batch(name, stock):
    stock[name].refresh_from_db()
    return stock[name].quantity_on_hand, stock[name].quantity_reserved


def test_end_to_end_authorised_prescription_reserves_stock_and_bills(
    doctor, pharmacist, prescribe, stock, patient, django_capture_on_commit_callbacks
):
    draft = prescribe("paracetamol", quantity=12)
    with django_capture_on_commit_callbacks(execute=True):
        assert authorise(doctor, draft).status_code == 200

    # Earliest expiry first, expired stock never used.
    assert batch("expired", stock) == (50, 0)
    assert batch("early", stock) == (10, 10)
    assert batch("late", stock) == (100, 2)

    line = InvoiceLine.all_tenants.get()
    assert (line.quantity, line.unit_price_minor, line.amount_minor) == (12, 2500, 30000)
    assert line.status == "pending" and line.source == "pharmacy.prescriptionitem"
    invoice = Invoice.all_tenants.get()
    assert invoice.patient_id == patient.pk
    assert (invoice.total_minor, invoice.net_due_minor, invoice.currency) == (30000, 30000, "NGN")

    with django_capture_on_commit_callbacks(execute=True):
        partial = dispense(pharmacist, draft, 10)
    assert partial.json()["status"] == "partially_dispensed"
    line.refresh_from_db()
    assert line.status == "pending"  # not final until fully dispensed
    with django_capture_on_commit_callbacks(execute=True):
        done = dispense(pharmacist, draft, 2)
    assert done.json()["status"] == "dispensed"
    line.refresh_from_db()
    assert line.status == "final"
    assert batch("early", stock) == (0, 0)
    assert batch("late", stock) == (98, 0)


def test_replayed_authorised_event_changes_nothing(
    doctor, prescribe, stock, tenant_a, django_capture_on_commit_callbacks
):
    draft = prescribe("paracetamol", quantity=12)
    with django_capture_on_commit_callbacks(execute=True):
        authorise(doctor, draft)
    envelope = {
        "event_id": "replay",
        "name": "prescription.authorised",
        "tenant_id": str(tenant_a.id),
        "actor_id": None,
        "occurred_at": "2026-10-15T00:00:00+00:00",
        "payload": {"prescription_id": draft["id"]},
    }
    tasks.reserve_stock_for_prescription(envelope)
    tasks.request_invoice_lines(envelope)
    assert InvoiceLine.all_tenants.count() == 1
    assert sum(StockReservation.all_tenants.values_list("quantity", flat=True)) == 12
    assert Invoice.all_tenants.get().net_due_minor == 30000


def test_slow_billing_never_blocks_the_prescriber(
    doctor, prescribe, stock, django_capture_on_commit_callbacks
):
    draft = prescribe("paracetamol")

    def slow_billing(**kwargs):
        time.sleep(3)

    with mock.patch("apps.billing.services.add_line", side_effect=slow_billing) as billing:
        with django_capture_on_commit_callbacks(execute=False) as callbacks:
            started = time.monotonic()
            response = authorise(doctor, draft)
            elapsed = time.monotonic() - started
    assert response.status_code == 200
    assert elapsed < 1.5
    assert billing.call_count == 0  # billing runs later, in a Celery worker
    assert len(callbacks) == 1  # only the publish of prescription.authorised


def test_handlers_are_enqueued_not_run_in_the_request(
    doctor, prescribe, stock, django_capture_on_commit_callbacks
):
    draft = prescribe("paracetamol")
    with (
        mock.patch.object(tasks.request_invoice_lines, "delay") as bill_later,
        mock.patch.object(tasks.reserve_stock_for_prescription, "delay") as reserve_later,
        django_capture_on_commit_callbacks(execute=True),
    ):
        authorise(doctor, draft)
    assert bill_later.call_count == reserve_later.call_count == 1
    envelope = bill_later.call_args.args[0]
    assert envelope["name"] == "prescription.authorised"
    assert envelope["payload"] == {"prescription_id": draft["id"]}


def test_a_failing_billing_handler_does_not_undo_the_prescription(
    doctor, prescribe, stock, django_capture_on_commit_callbacks
):
    draft = prescribe("paracetamol")
    with (
        mock.patch("apps.billing.services.add_line", side_effect=RuntimeError("billing down")),
        django_capture_on_commit_callbacks(execute=True),
    ):
        response = authorise(doctor, draft)
    assert response.status_code == 200
    assert Prescription.all_tenants.get(pk=draft["id"]).status == "authorised"


def test_cancelling_releases_stock_and_voids_the_charge(
    doctor, prescribe, stock, django_capture_on_commit_callbacks
):
    draft = prescribe("paracetamol", quantity=12)
    with django_capture_on_commit_callbacks(execute=True):
        authorise(doctor, draft)
        response = doctor.post(
            f"{PRESCRIPTIONS}{draft['id']}/cancel/", {"reason": "Changed plan"}, format="json"
        )
    assert response.json()["status"] == "cancelled"
    assert batch("early", stock) == (10, 0) and batch("late", stock) == (100, 0)
    assert InvoiceLine.all_tenants.get().status == "void"
    assert Invoice.all_tenants.get().net_due_minor == 0


def test_shortage_is_reserved_partially_and_dispensing_beyond_stock_fails(
    doctor, pharmacist, prescribe, stock, django_capture_on_commit_callbacks
):
    StockBatch.all_tenants.filter(batch_number="LATE").update(quantity_on_hand=0)
    draft = prescribe("paracetamol", quantity=12)
    with django_capture_on_commit_callbacks(execute=True):
        authorise(doctor, draft)
    assert batch("early", stock) == (10, 10)
    response = dispense(pharmacist, draft, 12)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "out_of_stock"
    assert dispense(pharmacist, draft, 10).status_code == 200


def test_deceased_patient_invoices_are_flagged_for_estate_review(
    doctor, prescribe, stock, patient, django_capture_on_commit_callbacks
):
    from django.utils import timezone

    with django_capture_on_commit_callbacks(execute=True):
        authorise(doctor, prescribe("paracetamol"))
        doctor.post(
            f"/api/patients/patients/{patient.pk}/status/",
            {"status": "deceased", "deceased_at": timezone.localdate().isoformat()},
            format="json",
        )
    assert Invoice.all_tenants.get().estate_review is True


def test_billing_key_is_stable():
    assert services.billing_key("abc") == "pharmacy.prescriptionitem:abc"
    assert events.get("prescription.authorised").name == "prescription.authorised"
