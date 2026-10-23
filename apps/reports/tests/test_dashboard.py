"""Dashboard figures (SEC-02, SEC-07): totals from real records, each card only for roles
that see its data across the whole tenant."""

from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.billing import services as billing
from apps.billing.models import InvoiceLine, Payment
from apps.core.money import Money
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.patients.models import Patient
from apps.pharmacy.models import Drug, StockBatch
from apps.scheduling.models import Appointment
from apps.staff.models import StaffProfile
from apps.tenants.models import Facility

pytestmark = pytest.mark.django_db

URL = "/api/reports/dashboard/"


def ngn(kobo: int) -> Money:
    return Money(kobo, "NGN")


@pytest.fixture
def biller(make_user, tenant_a):
    return make_user("dash-billing", tenant_a, [Role.BILLING_OFFICER])


@pytest.fixture
def make_patient(tenant_a):
    counter = iter(range(1, 1000))

    def make(registered_days_ago=0):
        n = next(counter)
        with tenant_context(tenant_a.id):
            patient = Patient.objects.create(
                first_name="Ada", last_name=f"Synth{n}", date_of_birth=date(1970, 1, n % 28 + 1)
            )
            Patient.objects.filter(pk=patient.pk).update(
                created_at=timezone.now() - timedelta(days=registered_days_ago)
            )
        return patient

    return make


@pytest.fixture
def charge(tenant_a, biller):
    """``charge(patient, kobo, days_ago, paid=..., category=...)``: a line and a payment."""
    counter = iter(range(1, 1000))

    def make(patient, kobo, days_ago=0, *, paid=True, category="consultation", name="Consult"):
        n = next(counter)
        when = timezone.now() - timedelta(days=days_ago)
        with tenant_context(tenant_a.id, biller.pk):
            line = billing.add_line(
                patient_id=patient.pk,
                source="test",
                source_id=str(n),
                description=name,
                quantity=1,
                unit_price=ngn(kobo),
                idempotency_key=f"dash-{n}",
                revenue_category=category,
            )
            InvoiceLine.objects.filter(pk=line.pk).update(created_at=when)
            if paid:
                payment = billing.record_payment(
                    line.invoice, payer="patient", method="cash", amount=ngn(kobo)
                )
                Payment.objects.filter(pk=payment.pk).update(received_at=when)
        return line

    return make


def get(client, range_key="12m"):
    response = client.get(URL, {"range": range_key})
    assert response.status_code == 200, response.json()
    return response.json()


def test_sec_02_cards_follow_tenant_wide_view_by_role(make_user, tenant_a, signed_in):
    cards = (
        "finance",
        "patients",
        "popular_services",
        "stock",
        "my_day",
        "wards",
        "diagnostics",
        "claims",
    )

    def shown(role):
        body = get(signed_in(make_user(f"dash-{role}", tenant_a, [role])))
        return {card for card in cards if body[card] is not None}

    assert shown(Role.FINANCE) == {"finance", "popular_services", "claims"}
    assert shown(Role.BILLING_OFFICER) == {"finance", "popular_services", "claims"}
    assert shown(Role.TENANT_ADMIN) == {
        "finance",
        "patients",
        "popular_services",
        "stock",
        "wards",
        "diagnostics",
        "claims",
    }
    assert shown(Role.FRONT_DESK) == {"patients", "popular_services"}
    assert shown(Role.PHARMACIST) == {"stock"}
    # Clinicians also get their own day. Ward and test counts are open to the care team, which
    # can already list every ward and order.
    assert shown(Role.DOCTOR) == {"my_day", "wards", "diagnostics"}
    assert shown(Role.NURSE) == {"my_day", "wards", "diagnostics"}
    assert shown(Role.LAB_TECHNICIAN) == {"diagnostics"}


def test_finance_totals_by_month_with_the_previous_period(
    make_user, tenant_a, signed_in, make_patient, charge
):
    patient = make_patient()
    charge(patient, 100_000, days_ago=0, category="consultation")
    charge(patient, 50_000, days_ago=0, category="pharmacy", name="Paracetamol")
    charge(patient, 30_000, days_ago=0, paid=False, category="laboratory", name="Malaria test")
    charge(patient, 20_000, days_ago=400)  # before the range: the previous period

    finance = get(signed_in(make_user("dash-fin", tenant_a, [Role.FINANCE])))["finance"]
    assert finance["currency"] == "NGN"
    assert len(finance["periods"]) == 12
    this_month = finance["periods"][-1]
    assert this_month["collected_minor"] == 150_000
    assert this_month["billed_minor"] == 180_000
    assert finance["collected_minor"] == 150_000
    assert finance["previous_collected_minor"] == 20_000
    assert finance["revenue_mix"] == [
        {"category": "consultation", "label": "Consultations", "amount_minor": 100_000},
        {"category": "pharmacy", "label": "Pharmacy", "amount_minor": 50_000},
        {"category": "laboratory", "label": "Laboratory", "amount_minor": 30_000},
    ]


def test_thirty_day_range_groups_by_day(make_user, tenant_a, signed_in, make_patient, charge):
    charge(make_patient(), 40_000, days_ago=3)
    finance = get(signed_in(make_user("dash-fin", tenant_a, [Role.FINANCE])), "30d")["finance"]
    assert len(finance["periods"]) == 30
    assert [p["collected_minor"] for p in finance["periods"]].count(40_000) == 1


def test_popular_services_leave_out_medicines(make_user, tenant_a, signed_in, make_patient, charge):
    patient = make_patient()
    for _ in range(3):
        charge(patient, 10_000, name="General consultation")
    charge(patient, 10_000, name="Malaria test", category="laboratory")
    charge(patient, 10_000, name="Paracetamol", category="pharmacy")
    body = get(signed_in(make_user("dash-desk", tenant_a, [Role.FRONT_DESK])))
    assert body["popular_services"] == [
        {"name": "General consultation", "count": 3},
        {"name": "Malaria test", "count": 1},
    ]


@pytest.fixture
def physician(make_user, tenant_a):
    return make_user("dash-doctor", tenant_a, [Role.DOCTOR])


def test_new_and_returning_patients_count_attended_visits(
    make_user, tenant_a, signed_in, make_patient, physician
):
    with tenant_context(tenant_a.id):
        facility = Facility.objects.create(name="Main", code="main")
    new, returning, no_show = make_patient(), make_patient(400), make_patient(400)
    start = timezone.now() - timedelta(days=2)
    for patient, status in ((new, "completed"), (returning, "checked_in"), (no_show, "no_show")):
        with tenant_context(tenant_a.id):
            Appointment.objects.create(
                patient=patient,
                physician=physician,
                facility=facility,
                appointment_type="new",
                start_at=start,
                end_at=start + timedelta(minutes=20),
                status=status,
            )
    body = get(signed_in(make_user("dash-desk", tenant_a, [Role.FRONT_DESK])))
    assert body["patients"] == {"new": 1, "returning": 1}


def test_stock_counts_available_unexpired_units(make_user, tenant_a, signed_in):
    def drug(name, reorder_level=10, price=1_000):
        return Drug.objects.create(
            name=name,
            strength="500 mg",
            form="tablet",
            ingredients=[name.lower()],
            unit_price_minor=price,
            reorder_level=reorder_level,
        )

    with tenant_context(tenant_a.id):
        plenty, low, out = drug("Amoxicillin"), drug("Ibuprofen"), drug("Metformin")
        future = date.today() + timedelta(days=365)
        StockBatch.objects.create(
            drug=plenty, batch_number="A", expiry_date=future, quantity_on_hand=100
        )
        StockBatch.objects.create(
            drug=low, batch_number="B", expiry_date=future, quantity_on_hand=12, quantity_reserved=4
        )
        StockBatch.objects.create(
            drug=out, batch_number="C", expiry_date=date(2020, 1, 1), quantity_on_hand=50
        )

    stock = get(signed_in(make_user("dash-pharm", tenant_a, [Role.PHARMACIST])))["stock"]
    assert (stock["products"], stock["in_stock"], stock["low"], stock["out"]) == (3, 1, 1, 1)
    assert stock["value_minor"] == (100 + 8) * 1_000
    assert [(i["name"], i["available"]) for i in stock["low_items"]] == [
        ("Metformin 500 mg", 0),
        ("Ibuprofen 500 mg", 8),
    ]


def test_my_day_counts_own_open_work_and_a_licence_near_expiry(
    tenant_a, signed_in, physician, make_patient
):
    with tenant_context(tenant_a.id):
        StaffProfile.objects.create(
            user=physician,
            staff_type="physician",
            licensing_body="mdcn",
            licence_number="MDCN-DASH",
            licence_expires_on=date.today() + timedelta(days=20),
        )
    my_day = get(signed_in(physician))["my_day"]
    assert my_day["open_notes"] == 0 and my_day["draft_prescriptions"] == 0
    assert my_day["licence_expires_on"] == str(date.today() + timedelta(days=20))


def test_sec_07_figures_never_include_another_tenant(
    make_user, tenant_a, tenant_b, signed_in, make_patient, charge
):
    charge(make_patient(), 70_000)
    outsider = signed_in(make_user("dash-fin-b", tenant_b, [Role.FINANCE]))
    assert get(outsider)["finance"]["collected_minor"] == 0


def test_rejects_an_unknown_range(make_user, tenant_a, signed_in):
    client = signed_in(make_user("dash-fin", tenant_a, [Role.FINANCE]))
    assert client.get(URL, {"range": "5y"}).status_code == 400


def test_ward_test_and_claim_cards_count_real_records(make_user, tenant_a, signed_in, make_patient):
    from apps.diagnostics.models import DiagnosticOrder, DiagnosticResult, Investigation
    from apps.inpatient.models import Bed, BedStatus, Ward

    patient = make_patient()
    doctor = make_user("dash-doc-r2", tenant_a, [Role.DOCTOR])
    with tenant_context(tenant_a.id, doctor.pk):
        ward = Ward.objects.create(
            facility=Facility.objects.create(name="Main", code="main"), name="Medical"
        )
        Bed.objects.create(ward=ward, label="1", status=BedStatus.OCCUPIED)
        Bed.objects.create(ward=ward, label="2")
        test = Investigation.objects.create(kind="lab", name="FBC", price_minor=1000)
        waiting = DiagnosticOrder.objects.create(
            patient=patient,
            investigation=test,
            ordered_by=doctor,
            reason="x",
            unit_price_minor=1000,
            currency="NGN",
        )
        done = DiagnosticOrder.objects.create(
            patient=patient,
            investigation=test,
            ordered_by=doctor,
            reason="y",
            unit_price_minor=1000,
            currency="NGN",
            status="resulted",
        )
        DiagnosticResult.objects.create(
            order=done, value="1", reported_by=doctor, reported_at=timezone.now()
        )
        assert waiting.status == "ordered"
    body = get(signed_in(doctor))
    assert body["wards"]["beds"] == 2 and body["wards"]["occupied"] == 1
    assert body["wards"]["vacant"] == 1
    assert body["diagnostics"] == {"open_orders": 1, "results_to_review": 1}
    assert body["my_day"]["results_to_review"] == 1
    finance = get(signed_in(make_user("dash-fin-r2", tenant_a, [Role.FINANCE])))
    assert finance["claims"]["claims"] == 0 and len(finance["claims"]["bands"]) == 4
    assert (
        get(signed_in(make_user("dash-nurse-r2", tenant_a, [Role.NURSE])))["my_day"][
            "results_to_review"
        ]
        is None
    )
