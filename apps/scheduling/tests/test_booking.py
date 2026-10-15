"""Booking: confirmations with ICS, no double-booking (database constraint), emergency
overbooking, availability, recurrence and free slots."""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from django.core import mail
from django.db import connection

from apps.core.tenancy import tenant_context
from apps.notifications.backends import LocmemSmsBackend
from apps.notifications.models import Notification
from apps.scheduling import services
from apps.scheduling.ics import build_ics
from apps.scheduling.models import Appointment, AvailabilityWindow

from .conftest import at

pytestmark = pytest.mark.django_db

APPOINTMENTS = "/api/scheduling/appointments/"


def test_booking_confirms_by_sms_and_email_with_an_ics_invite(
    desk, booking, window, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = desk.post(APPOINTMENTS, booking(), format="json")
    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["status"] == "booked"
    assert body["end_at"] is not None  # default slot length applied

    assert len(LocmemSmsBackend.outbox) == 1
    sms = LocmemSmsBackend.outbox[0]
    assert sms["to"] == "+2348031234567" and "Dr" in sms["body"]
    assert len(mail.outbox) == 1
    name, content, mimetype = mail.outbox[0].attachments[0]
    assert (name, mimetype) == ("appointment.ics", "text/calendar")
    ics = content.decode() if isinstance(content, bytes) else content
    assert "BEGIN:VEVENT" in ics and "METHOD:REQUEST" in ics
    assert f"UID:{body['id']}@" in ics
    statuses = set(Notification.all_tenants.values_list("status", flat=True))
    assert statuses == {"sent"}
    # The delivery log never stores the message or the full number.
    assert set(Notification.all_tenants.values_list("recipient_masked", flat=True)) == {
        "+234***67",
        "n***@example.test",
    }


def test_double_booking_is_refused(desk, booking, window):
    assert desk.post(APPOINTMENTS, booking(), format="json").status_code == 201
    for start in (at(1, 9), at(1, 9, 10)):
        response = desk.post(APPOINTMENTS, booking(start=start), format="json")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "slot_taken"
    assert desk.post(APPOINTMENTS, booking(start=at(1, 9, 15)), format="json").status_code == 201


def test_emergency_may_overbook(desk, booking, window):
    desk.post(APPOINTMENTS, booking(), format="json")
    response = desk.post(APPOINTMENTS, booking(appointment_type="emergency"), format="json")
    assert response.status_code == 201


def test_cancelled_slot_can_be_rebooked(desk, booking, window):
    first = desk.post(APPOINTMENTS, booking(), format="json").json()
    desk.post(
        f"{APPOINTMENTS}{first['id']}/status/",
        {"status": "cancelled", "cancellation_reason": "Patient travelling"},
        format="json",
    )
    assert desk.post(APPOINTMENTS, booking(), format="json").status_code == 201


@pytest.mark.django_db(transaction=True)
def test_concurrent_bookings_for_one_slot_produce_exactly_one_success(
    tenant_a, physician, patient, org, window
):
    attempts = 6
    barrier = threading.Barrier(attempts)

    def attempt(_):
        try:
            with tenant_context(tenant_a.id):
                barrier.wait()
                try:
                    services.book(
                        {
                            "patient_id": patient.pk,
                            "physician_id": physician.pk,
                            "facility_id": org["facility"].pk,
                            "appointment_type": "new",
                            "start_at": at(1, 10),
                        }
                    )
                    return "booked"
                except services.SlotTaken:
                    return "taken"
        finally:
            connection.close()

    with ThreadPoolExecutor(attempts) as pool:
        outcomes = list(pool.map(attempt, range(attempts)))
    assert outcomes.count("booked") == 1
    assert outcomes.count("taken") == attempts - 1
    assert Appointment.all_tenants.count() == 1


@pytest.mark.parametrize(
    ("start", "field"),
    [
        (at(1, 13), "start_at"),  # outside the availability window
        (at(-1, 10), "start_at"),  # in the past
    ],
)
def test_booking_must_be_in_the_future_and_inside_availability(desk, booking, window, start, field):
    response = desk.post(APPOINTMENTS, booking(start=start), format="json")
    assert response.status_code == 400
    assert field in response.json()["error"]["details"]


def test_booking_needs_a_physician_and_a_living_patient(
    desk, booking, window, desk_user, patient, tenant_a, as_tenant
):
    response = desk.post(APPOINTMENTS, booking(physician=str(desk_user.pk)), format="json")
    assert "physician" in response.json()["error"]["details"]
    with as_tenant(tenant_a):
        type(patient).objects.filter(pk=patient.pk).update(
            status="deceased", deceased_at="2026-01-01"
        )
    response = desk.post(APPOINTMENTS, booking(), format="json")
    assert "patient" in response.json()["error"]["details"]


def test_recurring_booking_is_all_or_nothing(desk, booking, tenant_a, as_tenant, physician, org):
    with as_tenant(tenant_a):
        for week in range(3):
            AvailabilityWindow.objects.create(
                physician=physician,
                facility=org["facility"],
                start_at=at(1 + 7 * week, 9),
                end_at=at(1 + 7 * week, 12),
            )
    series = desk.post(
        APPOINTMENTS, booking(recurrence={"frequency": "weekly", "count": 3}), format="json"
    )
    assert series.status_code == 201, series.json()
    assert len({a["series_id"] for a in series.json()}) == 1
    assert len(series.json()) == 3

    # A second series clashing in week 3 creates nothing.
    clash = desk.post(
        APPOINTMENTS,
        booking(start=at(1, 9) - timedelta(days=0), recurrence={"frequency": "weekly", "count": 3}),
        format="json",
    )
    assert clash.status_code == 409
    assert Appointment.all_tenants.count() == 3


def test_free_slots_skip_booked_and_past_times(desk, booking, window, physician):
    desk.post(APPOINTMENTS, booking(start=at(1, 9, 15)), format="json")
    slots = desk.get(
        f"{APPOINTMENTS}free-slots/",
        {"physician": str(physician.pk), "date": at(1, 9).date().isoformat()},
    ).json()
    starts = [s["start_at"][11:16] for s in slots]
    # Times are reported in UTC; 09:00 Lagos is 08:00 UTC.
    assert starts[:3] == ["08:00", "08:30", "08:45"]
    assert len(starts) == 11


def test_sec_02_only_front_desk_books(signed_in, physician, booking, window):
    assert signed_in(physician).post(APPOINTMENTS, booking(), format="json").status_code == 403


def test_sec_07_another_tenants_physician_cannot_be_booked(
    desk, booking, window, make_user, tenant_b
):
    from apps.core.roles import Role

    outsider = make_user("outsider", tenant_b, [Role.DOCTOR])
    response = desk.post(APPOINTMENTS, booking(physician=str(outsider.pk)), format="json")
    assert response.status_code == 400


# -- ICS -----------------------------------------------------------------------------


def test_ics_is_rfc_5545_shaped():
    from datetime import UTC, datetime

    content = build_ics(
        uid="abc@emr.local",
        start=datetime(2026, 11, 2, 8, 0, tzinfo=UTC),
        end=datetime(2026, 11, 2, 8, 15, tzinfo=UTC),
        summary="Appointment with Dr Okafor, clinic; room 2",
        location="Main hospital",
        description="x" * 200,
    ).decode()
    lines = content.split("\r\n")
    assert content.endswith("\r\n")
    assert "DTSTART:20261102T080000Z" in lines
    assert "SUMMARY:Appointment with Dr Okafor\\, clinic\\; room 2" in lines
    assert all(len(line.encode()) <= 75 for line in lines)
    assert any(line.startswith(" ") for line in lines)  # folded description


def test_a_deadlocked_colliding_insert_is_reported_as_slot_taken(desk, booking, window):
    """PostgreSQL may abort one of two colliding inserts with deadlock_detected (40P01)."""
    from unittest import mock

    from django.db import OperationalError

    class Deadlock(Exception):
        sqlstate = "40P01"

    error = OperationalError("deadlock detected")
    error.__cause__ = Deadlock()
    with mock.patch.object(Appointment, "save", side_effect=error):
        response = desk.post(APPOINTMENTS, booking(), format="json")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "slot_taken"
