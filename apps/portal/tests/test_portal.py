"""The patient portal: accounts, isolation between patients, booking, bills and consent.
Requirement IDs: SEC-02, SEC-03, SEC-07, DG-02 (consent), and the deceased cascade (Section 5)."""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core import mail

from apps.accounts.models import RoleAssignment, User
from apps.audit.models import AuditEntry
from apps.billing import services as billing
from apps.core.money import Money
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.patients.models import Patient
from apps.portal import services
from apps.portal.api.views import PortalPermission
from apps.portal.models import PortalAccount
from apps.scheduling.models import Appointment

pytestmark = pytest.mark.django_db

LAGOS = ZoneInfo("Africa/Lagos")
PORTAL = "/api/portal/"


def at(day_offset: int, hour: int, minute: int = 0) -> datetime:
    day = datetime.now(LAGOS).date() + timedelta(days=day_offset)
    return datetime.combine(day, time(hour, minute), tzinfo=LAGOS)


# -- invitations ---------------------------------------------------------------------------


def test_front_desk_invites_a_patient_who_gets_a_set_password_email(
    front_desk, ada, tenant_a, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = front_desk.post(f"{PORTAL}accounts/", {"patient": str(ada.pk)}, format="json")
    assert response.status_code == 201
    assert response.json()["active"] is True
    with tenant_context(tenant_a.id):
        account = PortalAccount.objects.get(patient=ada)
        user = User.objects.get(pk=account.user_id)
        assert not user.has_usable_password()
        assert RoleAssignment.objects.filter(user=user, role=Role.PATIENT).exists()
    (message,) = [m for m in mail.outbox if m.to == [ada.email]]
    assert "set your password" in message.body.lower()


def test_an_invitation_needs_an_email_and_is_refused_twice_or_for_the_deceased(
    front_desk, make_patient, tenant_a
):
    no_email = make_patient("Nomail", email="")
    assert (
        front_desk.post(
            f"{PORTAL}accounts/", {"patient": str(no_email.pk)}, format="json"
        ).status_code
        == 409
    )
    dead = make_patient("Late")
    with tenant_context(tenant_a.id):
        Patient.objects.filter(pk=dead.pk).update(status="deceased", deceased_at=date(2026, 10, 1))
    assert (
        front_desk.post(f"{PORTAL}accounts/", {"patient": str(dead.pk)}, format="json").status_code
        == 409
    )
    fine = make_patient("Fine")
    assert (
        front_desk.post(f"{PORTAL}accounts/", {"patient": str(fine.pk)}, format="json").status_code
        == 201
    )
    assert (
        front_desk.post(f"{PORTAL}accounts/", {"patient": str(fine.pk)}, format="json").status_code
        == 409
    )


def test_an_email_already_used_by_an_account_cannot_be_invited_again(front_desk, make_patient):
    first = make_patient("Twin", email="shared@example.test")
    second = make_patient("Twins", email="shared@example.test")
    assert (
        front_desk.post(f"{PORTAL}accounts/", {"patient": str(first.pk)}, format="json").status_code
        == 201
    )
    assert (
        front_desk.post(
            f"{PORTAL}accounts/", {"patient": str(second.pk)}, format="json"
        ).status_code
        == 409
    )


def test_sec_02_only_front_desk_and_the_admin_manage_portal_accounts(
    ada, make_user, signed_in, tenant_a
):
    for role, allowed in (
        (Role.FRONT_DESK, True),
        (Role.TENANT_ADMIN, True),
        (Role.DOCTOR, False),
        (Role.NURSE, False),
        (Role.BILLING_OFFICER, False),
        (Role.PHARMACIST, False),
    ):
        client = signed_in(make_user(f"u-{role}", tenant_a, [role]))
        # A new patient per role, so one invitation does not block the next.
        with tenant_context(tenant_a.id):
            patient = Patient.objects.create(
                first_name=f"P{role}"[:20].replace("_", ""),
                last_name="Okoro",
                date_of_birth=date(1990, 1, 1),
                email=f"{role}@example.test",
            )
        response = client.post(f"{PORTAL}accounts/", {"patient": str(patient.pk)}, format="json")
        assert (response.status_code == 201) is allowed, role


# -- the patient sees only themselves ------------------------------------------------------


def test_sec_02_staff_and_anonymous_users_cannot_use_the_patient_endpoints(
    api_client, make_user, signed_in, tenant_a
):
    for name in ("home", "appointments", "results", "prescriptions", "invoices", "profile"):
        assert api_client.get(f"{PORTAL}{name}/").status_code in (401, 403), name
    for role in (Role.DOCTOR, Role.TENANT_ADMIN, Role.FRONT_DESK):
        staff = signed_in(make_user(f"s-{role}", tenant_a, [role]))
        for name in ("home", "appointments", "results", "prescriptions", "invoices", "profile"):
            response = staff.get(f"{PORTAL}{name}/")
            assert response.status_code == 403, (role, name)
        assert (
            staff.patch(f"{PORTAL}profile/", {"phone": "+2348000000000"}, format="json").status_code
            == 403
        )


def test_sec_02_every_patient_endpoint_uses_the_portal_permission():
    from django.urls import get_resolver

    seen = []

    def walk(patterns, prefix=""):
        for pattern in patterns:
            if hasattr(pattern, "url_patterns"):
                walk(pattern.url_patterns, prefix + str(pattern.pattern))
            elif (pattern.name or "").startswith("portal-") and not any(
                staff in pattern.name for staff in ("account", "data-request")
            ):
                seen.append((prefix + str(pattern.pattern), pattern.callback.cls))

    walk(get_resolver().url_patterns)
    assert len(seen) == 14
    for route, view in seen:
        assert view.permission_classes == [PortalPermission], route


def test_sec_02_a_patient_sees_their_own_appointments_bills_and_medicines_only(
    as_patient, ada, bola, physician, tenant_a, facility
):
    ada_client, _ = as_patient(ada)
    bola_client, _ = as_patient(bola)
    with tenant_context(tenant_a.id):
        for patient, hour in ((ada, 9), (bola, 10)):
            Appointment.objects.create(
                patient=patient,
                physician=physician,
                facility=facility,
                appointment_type="new",
                start_at=at(5, hour),
                end_at=at(5, hour, 15),
                reason=f"{patient.first_name} visit",
            )
        billing.add_line(
            patient_id=ada.pk,
            source="test",
            source_id="1",
            description="Ada bill",
            quantity=1,
            unit_price=Money(1_000_000, "NGN"),
            idempotency_key="portal:ada",
        )
    assert [a["reason"] for a in ada_client.get(f"{PORTAL}appointments/").json()] == ["Ada visit"]
    assert [a["reason"] for a in bola_client.get(f"{PORTAL}appointments/").json()] == ["Bola visit"]
    assert len(ada_client.get(f"{PORTAL}invoices/").json()) == 1
    assert bola_client.get(f"{PORTAL}invoices/").json() == []
    # There is nowhere to put another patient's id: a query parameter is ignored.
    assert [
        a["reason"] for a in ada_client.get(f"{PORTAL}appointments/?patient={bola.pk}").json()
    ] == ["Ada visit"]


def test_sec_02_a_patient_cannot_cancel_someone_elses_visit(
    as_patient, ada, bola, physician, tenant_a, facility
):
    ada_client, _ = as_patient(ada)
    with tenant_context(tenant_a.id):
        theirs = Appointment.objects.create(
            patient=bola,
            physician=physician,
            facility=facility,
            appointment_type="new",
            start_at=at(5, 9),
            end_at=at(5, 9, 15),
        )
    response = ada_client.post(
        f"{PORTAL}appointments/{theirs.pk}/cancel/", {"reason": "Not mine"}, format="json"
    )
    assert response.status_code == 404
    with tenant_context(tenant_a.id):
        assert Appointment.objects.get(pk=theirs.pk).status == "booked"


def test_sec_07_another_tenants_patient_account_sees_nothing_of_ours(
    as_patient, ada, make_user, signed_in, tenant_b
):
    ada_client, _ = as_patient(ada)
    # A user of another tenant with no portal account has no access, whatever the role.
    outsider = signed_in(make_user("out-patient", tenant_b, [Role.PATIENT]))
    assert outsider.get(f"{PORTAL}home/").status_code == 403
    assert ada_client.get(f"{PORTAL}home/").status_code == 200


# -- booking and cancelling ----------------------------------------------------------------


def test_a_patient_books_a_free_slot_and_it_is_then_taken(
    as_patient, ada, bola, physician, tenant_a
):
    ada_client, _ = as_patient(ada)
    bola_client, _ = as_patient(bola)
    slots = ada_client.get(f"{PORTAL}appointment-slots/").json()
    assert len(slots) == 4  # a one-hour window in 15-minute slots
    assert slots[0]["doctor_name"].endswith("Eze")
    assert slots[0]["specialty"] == "Cardiology"
    taken = slots[0]["id"]
    response = ada_client.post(
        f"{PORTAL}appointments/", {"slot": taken, "reason": "Blood pressure check"}, format="json"
    )
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "booked"
    assert body["reason"] == "Blood pressure check"
    assert body["can_cancel"] is True
    assert taken not in [s["id"] for s in bola_client.get(f"{PORTAL}appointment-slots/").json()]
    again = bola_client.post(
        f"{PORTAL}appointments/", {"slot": taken, "reason": "Me too"}, format="json"
    )
    assert again.status_code == 409


def test_booking_needs_a_reason_a_real_slot_and_stops_at_the_limit(
    as_patient, ada, physician, settings
):
    client, _ = as_patient(ada)
    slots = client.get(f"{PORTAL}appointment-slots/").json()
    assert client.post(
        f"{PORTAL}appointments/", {"slot": slots[0]["id"], "reason": "  "}, format="json"
    ).status_code in (400, 409)
    for bad in ("nonsense", f"{physician.pk}_1", f"{physician.pk}_x"):
        assert (
            client.post(
                f"{PORTAL}appointments/", {"slot": bad, "reason": "Checkup"}, format="json"
            ).status_code
            == 409
        )
    settings.PORTAL_MAX_UPCOMING_VISITS = 2
    for slot in slots[:2]:
        assert (
            client.post(
                f"{PORTAL}appointments/", {"slot": slot["id"], "reason": "Checkup"}, format="json"
            ).status_code
            == 201
        )
    third = client.post(
        f"{PORTAL}appointments/", {"slot": slots[2]["id"], "reason": "Checkup"}, format="json"
    )
    assert third.status_code == 409
    assert "already have 2" in third.json()["error"]["message"]


def test_a_patient_cancels_with_a_reason_but_not_a_visit_that_is_too_close(
    as_patient, ada, physician, tenant_a, facility
):
    client, _ = as_patient(ada)
    with tenant_context(tenant_a.id):
        far = Appointment.objects.create(
            patient=ada,
            physician=physician,
            facility=facility,
            appointment_type="new",
            start_at=at(5, 9),
            end_at=at(5, 9, 15),
        )
        soon = Appointment.objects.create(
            patient=ada,
            physician=physician,
            facility=facility,
            appointment_type="new",
            start_at=datetime.now(LAGOS) + timedelta(minutes=30),
            end_at=datetime.now(LAGOS) + timedelta(minutes=45),
        )
    rows = {r["id"]: r for r in client.get(f"{PORTAL}appointments/").json()}
    assert rows[str(far.pk)]["can_cancel"] is True
    assert rows[str(soon.pk)]["can_cancel"] is False
    url = lambda a: f"{PORTAL}appointments/{a.pk}/cancel/"  # noqa: E731
    assert client.post(url(far), {"reason": "  "}, format="json").status_code in (400, 409)
    assert client.post(url(soon), {"reason": "Cannot come"}, format="json").status_code == 409
    done = client.post(url(far), {"reason": "Travelling"}, format="json")
    assert done.status_code == 200
    assert done.json()["status"] == "cancelled"
    with tenant_context(tenant_a.id):
        assert "Travelling" in Appointment.objects.get(pk=far.pk).cancellation_reason
    assert client.post(url(far), {"reason": "Again"}, format="json").status_code == 409


# -- bills, medicines, results -------------------------------------------------------------


def test_bills_show_what_the_patient_owes_and_part_payments(as_patient, ada, tenant_a):
    client, _ = as_patient(ada)
    with tenant_context(tenant_a.id):
        line = billing.charge_delivered(
            patient_id=ada.pk,
            source="test",
            source_id="1",
            description="Consultation",
            quantity=1,
            unit_price=Money(1_000_000, "NGN"),
            idempotency_key="portal:bill",
            revenue_category="consultation",
        )
        invoice = line.invoice
    (bill,) = client.get(f"{PORTAL}invoices/").json()
    assert (bill["total_minor"], bill["paid_minor"], bill["due_minor"]) == (1_000_000, 0, 1_000_000)
    assert bill["status"] == "unpaid"
    assert bill["lines"] == [{"description": "Consultation", "amount_minor": 1_000_000}]
    with tenant_context(tenant_a.id):
        billing.record_payment(
            invoice, payer="patient", method="cash", amount=Money(400_000, "NGN"), reference="R1"
        )
    (bill,) = client.get(f"{PORTAL}invoices/").json()
    assert (bill["paid_minor"], bill["due_minor"], bill["status"]) == (
        400_000,
        600_000,
        "partially_paid",
    )
    home = client.get(f"{PORTAL}home/").json()
    assert home["balance_minor"] == 600_000


def test_there_is_no_endpoint_that_records_a_payment_without_the_gateway(as_patient, ada):
    client, _ = as_patient(ada)
    for path in ("payments/", "invoices/pay/"):
        assert client.post(f"{PORTAL}{path}", {"amount_minor": 1}, format="json").status_code == 404


def test_results_are_empty_until_the_diagnostics_module_releases_them(as_patient, ada):
    client, _ = as_patient(ada)
    assert client.get(f"{PORTAL}results/").json() == []
    assert client.get(f"{PORTAL}home/").json()["new_results"] == 0
    assert client.post(f"{PORTAL}results/{ada.pk}/seen/").status_code == 404


def test_home_shows_the_next_visit_and_the_first_name(
    as_patient, ada, physician, tenant_a, facility
):
    client, _ = as_patient(ada)
    with tenant_context(tenant_a.id):
        for day in (6, 4):
            Appointment.objects.create(
                patient=ada,
                physician=physician,
                facility=facility,
                appointment_type="new",
                start_at=at(day, 9),
                end_at=at(day, 9, 15),
                reason=f"day {day}",
            )
    home = client.get(f"{PORTAL}home/").json()
    assert home["first_name"] == "Ada"
    assert home["next_appointment"]["reason"] == "day 4"


# -- profile and consent -------------------------------------------------------------------


def test_the_patient_corrects_their_phone_and_email_but_not_their_name(as_patient, ada, tenant_a):
    client, _ = as_patient(ada)
    profile = client.get(f"{PORTAL}profile/").json()
    assert (profile["first_name"], profile["mrn"]) == (
        "Ada",
        Patient.all_tenants.get(pk=ada.pk).mrn,
    )
    ok = client.patch(
        f"{PORTAL}profile/",
        {"phone": "+2348055500000", "email": "ada.new@example.test"},
        format="json",
    )
    assert ok.status_code == 200
    assert ok.json()["phone"] == "+2348055500000"
    bad = client.patch(f"{PORTAL}profile/", {"phone": "08031234567"}, format="json")
    assert bad.status_code == 400
    ignored = client.patch(f"{PORTAL}profile/", {"first_name": "Mallory"}, format="json")
    assert ignored.json()["first_name"] == "Ada"


def test_dg_02_the_reminders_choice_is_saved_on_the_patient_record_and_audited(
    as_patient, ada, tenant_a
):
    client, _ = as_patient(ada)
    assert client.get(f"{PORTAL}profile/").json()["email_reminders"] is True  # on unless asked
    response = client.patch(f"{PORTAL}profile/", {"email_reminders": False}, format="json")
    assert response.status_code == 200
    assert response.json()["email_reminders"] is False
    assert "consents" not in response.json()  # no switches that change nothing
    with tenant_context(tenant_a.id):
        assert Patient.objects.get(pk=ada.pk).email_reminders is False
        entry = AuditEntry.objects.filter(resource="portal.profile", action="update").latest(
            "sequence"
        )
    assert entry.details["email_reminders"] is False
    assert entry.details["changed"] == ["email_reminders"]
    assert str(entry.object_id) == str(ada.pk)


def test_sec_03_the_patients_reads_and_refused_requests_are_audited(
    as_patient, ada, make_user, signed_in, tenant_a
):
    client, _ = as_patient(ada)
    client.get(f"{PORTAL}invoices/")
    client.get(f"{PORTAL}prescriptions/")
    stranger = signed_in(make_user("doc-audit", tenant_a, [Role.DOCTOR]))
    stranger.get(f"{PORTAL}home/")
    with tenant_context(tenant_a.id):
        resources = set(
            AuditEntry.objects.filter(tenant_id=tenant_a.id).values_list("resource", flat=True)
        )
        denied = AuditEntry.objects.filter(resource="portal", outcome="denied")
    assert {"portal.invoice", "portal.prescription"} <= resources
    assert denied.exists()


# -- switching access off ------------------------------------------------------------------


def test_staff_can_switch_a_patients_access_off_and_it_stops_at_once(
    as_patient, front_desk, ada, tenant_a
):
    client, account = as_patient(ada)
    assert client.get(f"{PORTAL}home/").status_code == 200
    response = front_desk.post(f"{PORTAL}accounts/{account.pk}/revoke/")
    assert response.status_code == 200
    assert response.json()["active"] is False
    assert client.get(f"{PORTAL}home/").status_code in (401, 403)
    with tenant_context(tenant_a.id):
        assert not User.objects.get(pk=account.user_id).is_active


def test_a_patients_death_switches_off_their_portal_access(as_patient, ada, tenant_a):
    client, account = as_patient(ada)
    with tenant_context(tenant_a.id):
        Patient.objects.filter(pk=ada.pk).update(status="deceased", deceased_at=date(2026, 10, 20))
        assert services.revoke_for_deceased_patient(ada.pk) == 1
        assert services.revoke_for_deceased_patient(ada.pk) == 0
        saved = PortalAccount.objects.get(pk=account.pk)
        assert saved.active is False
        assert saved.revoked_reason == "deceased"
    assert client.get(f"{PORTAL}home/").status_code in (401, 403)


def test_a_deceased_patient_with_an_active_account_is_refused_even_before_revocation(
    as_patient, ada, tenant_a
):
    client, _ = as_patient(ada)
    with tenant_context(tenant_a.id):
        Patient.objects.filter(pk=ada.pk).update(status="deceased", deceased_at=date(2026, 10, 20))
    assert client.get(f"{PORTAL}profile/").status_code == 403


def test_dg_02_a_patient_who_stops_reminders_still_gets_booking_confirmations(
    as_patient, ada, physician, tenant_a, django_capture_on_commit_callbacks
):
    from django.core import mail as outbox

    from apps.scheduling import services as scheduling

    client, _ = as_patient(ada)
    client.patch(f"{PORTAL}profile/", {"email_reminders": False}, format="json")
    slot = client.get(f"{PORTAL}appointment-slots/").json()[0]["id"]
    outbox.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        booked = client.post(
            f"{PORTAL}appointments/", {"slot": slot, "reason": "Checkup"}, format="json"
        )
    assert booked.status_code == 201
    assert any("confirmed" in m.subject.lower() for m in outbox.outbox)  # still told of the booking
    outbox.outbox.clear()
    with tenant_context(tenant_a.id), django_capture_on_commit_callbacks(execute=True):
        appointment = Appointment.objects.get(patient=ada)
        scheduling.send_due_reminders(now=appointment.start_at - timedelta(hours=1))
    assert outbox.outbox == []  # but no reminder
