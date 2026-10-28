"""What the billing screen needs from the invoice API: names, search, sorting, the header
summary and payment reminders (F12). Requirement IDs: SEC-02, SEC-07, SEC-03."""

from datetime import date, timedelta

import pytest
from django.core import mail
from django.utils import timezone

from apps.audit.models import AuditEntry
from apps.core.money import Money
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.patients.models import Patient

from .conftest import ngn
from .test_billing import charge, invoice_of

pytestmark = pytest.mark.django_db

INVOICES = "/api/billing/invoices/"


@pytest.fixture
def reachable(tenant_a):
    """A patient with a phone and an email, so a reminder has somewhere to go."""
    with tenant_context(tenant_a.id):
        return Patient.objects.create(
            first_name="Amaka",
            last_name="Obi",
            date_of_birth=date(1985, 5, 5),
            phone="+2348012345678",
            email="amaka@example.test",
        )


@pytest.fixture
def unreachable(make_patient):
    return make_patient("Zainab")


@pytest.fixture
def books(ctx, make_patient):
    """Three bills: one unpaid, one part-paid, one paid."""
    with ctx():
        ada, bayo, chidi = (make_patient(name) for name in ("Ada", "Bayo", "Chidi"))
        unpaid = invoice_of(charge(ada, "u", 10_000, delivered=True))
        part = invoice_of(charge(bayo, "p", 30_000, delivered=True))
        from apps.billing import services

        services.record_payment(part, payer="patient", method="cash", amount=ngn(5_000))
        paid = invoice_of(charge(chidi, "d", 20_000, delivered=True))
        services.record_payment(paid, payer="patient", method="cash", amount=ngn(20_000))
    return {"unpaid": unpaid, "part": part, "paid": paid, "patients": (ada, bayo, chidi)}


def test_rows_carry_the_number_patient_and_line_count(billing, books):
    rows = billing.get(INVOICES).json()["results"]
    row = next(r for r in rows if r["id"] == str(books["unpaid"].pk))
    assert row["reference"] == f"INV-{str(books['unpaid'].pk)[:8].upper()}"
    assert row["patient_name"] == "Ada Eze"
    assert row["patient_mrn"]
    assert row["line_count"] == 1
    assert "lines" not in row  # the list stays light; the drawer loads the detail


def test_detail_has_the_patient_name_and_lines(billing, books):
    body = billing.get(f"{INVOICES}{books['part'].pk}/").json()
    assert body["patient_name"] == "Bayo Eze"
    assert len(body["lines"]) == 1 and len(body["payments"]) == 1


def test_search_by_name_mrn_and_invoice_number(billing, books):
    def found(text):
        return {r["id"] for r in billing.get(INVOICES, {"q": text}).json()["results"]}

    ada = books["patients"][0]
    assert found("ada") == {str(books["unpaid"].pk)}
    assert found("Bayo Eze") == {str(books["part"].pk)}
    assert found(ada.mrn) == {str(books["unpaid"].pk)}
    assert found(f"#INV-{str(books['paid'].pk)[:6]}") == {str(books["paid"].pk)}
    assert found("nobody") == set()


def test_sort_filter_and_page_size(billing, books):
    ordered = billing.get(INVOICES, {"ordering": "-total"}).json()["results"]
    assert [r["total_minor"] for r in ordered] == [30_000, 20_000, 10_000]
    only_paid = billing.get(INVOICES, {"payment_status": "paid"}).json()
    assert [r["id"] for r in only_paid["results"]] == [str(books["paid"].pk)]
    page = billing.get(INVOICES, {"page_size": 2}).json()
    assert page["count"] == 3 and len(page["results"]) == 2


def test_summary_counts_and_amounts(billing, books):
    body = billing.get(f"{INVOICES}summary/").json()
    assert body == {
        "currency": "NGN",
        "unpaid_count": 1,
        "partially_paid_count": 1,
        "paid_count": 1,
        "billed_minor": 60_000,
        "collected_minor": 25_000,
        "outstanding_minor": 35_000,
    }
    searched = billing.get(f"{INVOICES}summary/", {"q": "bayo"}).json()
    assert (searched["billed_minor"], searched["collected_minor"]) == (30_000, 5_000)


def test_summary_is_empty_for_another_currency(billing, books):
    body = billing.get(f"{INVOICES}summary/", {"currency": "GHS"}).json()
    assert body["billed_minor"] == 0 and body["paid_count"] == 0


@pytest.mark.parametrize("role", [Role.DOCTOR, Role.NURSE, Role.PHARMACIST])
def test_sec_02_clinical_roles_cannot_read_the_summary(role, make_user, tenant_a, signed_in):
    client = signed_in(make_user("someone", tenant_a, [role]))
    assert client.get(f"{INVOICES}summary/").status_code == 403


@pytest.mark.parametrize("role", [Role.FINANCE, Role.TENANT_ADMIN, Role.FRONT_DESK])
def test_sec_02_view_roles_read_the_summary_but_cannot_send_reminders(
    role, make_user, tenant_a, signed_in, books
):
    client = signed_in(make_user("viewer", tenant_a, [role]))
    assert client.get(f"{INVOICES}summary/").status_code == 200
    assert client.post(f"{INVOICES}{books['unpaid'].pk}/remind/").status_code == 403


def test_sec_07_another_tenants_billing_officer_sees_nothing(books, make_user, tenant_b, signed_in):
    other = signed_in(make_user("other-billing", tenant_b, [Role.BILLING_OFFICER]))
    assert other.get(INVOICES).json()["count"] == 0
    assert other.get(f"{INVOICES}summary/").json()["billed_minor"] == 0
    assert other.post(f"{INVOICES}{books['unpaid'].pk}/remind/").status_code == 404


# -- reminders -------------------------------------------------------------------------


@pytest.fixture
def owed(ctx, reachable):
    with ctx():
        return invoice_of(charge(reachable, "owed", 15_000, delivered=True))


def test_a_reminder_goes_by_email_and_is_audited(billing, owed, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        response = billing.post(f"{INVOICES}{owed.pk}/remind/")
    assert response.status_code == 200, response.json()
    assert response.json()["channels"] == ["email"]
    assert len(mail.outbox) == 1
    message = mail.outbox[0]
    reference = f"INV-{str(owed.pk)[:8].upper()}"
    assert (
        reference in message.subject and "150.00" not in message.subject
    )  # no amount in the subject
    assert reference in message.body and str(Money(15_000, "NGN")) in message.body
    owed.refresh_from_db()
    assert owed.last_reminder_at is not None
    assert owed.reminder_count == 1
    assert AuditEntry.objects.filter(
        action="update", resource="billing.invoice", object_id=str(owed.pk)
    ).exists()


def test_a_second_reminder_inside_the_interval_is_refused(billing, owed):
    assert billing.post(f"{INVOICES}{owed.pk}/remind/").status_code == 200
    again = billing.post(f"{INVOICES}{owed.pk}/remind/")
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "reminder_refused"


def test_a_reminder_is_allowed_again_after_the_interval(billing, owed, settings):
    assert billing.post(f"{INVOICES}{owed.pk}/remind/").status_code == 200
    owed.refresh_from_db()
    owed.last_reminder_at = timezone.now() - timedelta(
        hours=settings.BILLING_REMINDER_INTERVAL_HOURS
    )
    type(owed).all_tenants.filter(pk=owed.pk).update(last_reminder_at=owed.last_reminder_at)
    assert billing.post(f"{INVOICES}{owed.pk}/remind/").status_code == 200


def test_nothing_is_sent_for_a_paid_invoice(billing, books):
    response = billing.post(f"{INVOICES}{books['paid'].pk}/remind/")
    assert response.status_code == 409
    assert mail.outbox == []


def test_nothing_is_sent_without_contact_details(billing, ctx, unreachable):
    with ctx():
        invoice = invoice_of(charge(unreachable, "nocontact", 5_000, delivered=True))
    response = billing.post(f"{INVOICES}{invoice.pk}/remind/")
    assert response.status_code == 409
    assert "no email address" in response.json()["error"]["message"]


def test_nothing_is_sent_for_an_invoice_held_for_estate_review(billing, owed):
    type(owed).all_tenants.filter(pk=owed.pk).update(estate_review=True)
    response = billing.post(f"{INVOICES}{owed.pk}/remind/")
    assert response.status_code == 409
    assert "estate review" in response.json()["error"]["message"]


def test_reminders_stop_after_the_cap_and_point_to_a_person(billing, owed, settings):
    settings.BILLING_REMINDER_MAX = 2
    for _ in range(2):
        assert billing.post(f"{INVOICES}{owed.pk}/remind/").status_code == 200
        type(owed).all_tenants.filter(pk=owed.pk).update(last_reminder_at=None)
    third = billing.post(f"{INVOICES}{owed.pk}/remind/")
    assert third.status_code == 409
    assert "Contact the patient directly" in third.json()["error"]["message"]


def test_a_reminder_asks_only_for_the_patients_share_not_the_insurers(
    billing, ctx, reachable, django_capture_on_commit_callbacks
):
    from apps.billing import services as billing_services
    from apps.billing.models import Insurer

    with ctx():
        insurer = Insurer.objects.create(name="Reminder HMO", code="rem-hmo")
        invoice = invoice_of(charge(reachable, "insured", 100_000))
        billing_services.set_coverage(invoice, insurer=insurer, coverage_bp=8_000)
    with django_capture_on_commit_callbacks(execute=True):
        assert billing.post(f"{INVOICES}{invoice.pk}/remind/").status_code == 200
    assert str(Money(20_000, "NGN")) in mail.outbox[-1].body  # the 20% the patient owes
    assert str(Money(100_000, "NGN")) not in mail.outbox[-1].body


def test_the_default_gap_between_reminders_is_three_days(settings):
    assert settings.BILLING_REMINDER_INTERVAL_HOURS == 72


def test_a_reminder_is_refused_when_the_patient_has_asked_to_stop_reminders(
    billing, owed, ctx, reachable
):
    with ctx():
        type(reachable).all_tenants.filter(pk=reachable.pk).update(email_reminders=False)
    response = billing.post(f"{INVOICES}{owed.pk}/remind/")
    assert response.status_code == 409
    assert "asked not to receive reminders" in response.json()["error"]["message"]
    assert mail.outbox == []
