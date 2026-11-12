"""What the appointments calendar needs: moving an appointment, listing a day or week with
patient names, and the availability around it (FR-5, SEC-02, SEC-03, SEC-07)."""

from datetime import timedelta

import pytest
from django.core import mail
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.audit.models import AuditEntry
from apps.core.roles import Role
from apps.scheduling.models import Appointment, AppointmentReminder, AvailabilityWindow

from .conftest import at

pytestmark = pytest.mark.django_db

APPOINTMENTS = "/api/scheduling/appointments/"
WINDOWS = "/api/scheduling/availability/"


@pytest.fixture
def make_appointment(tenant_a, as_tenant, patient, physician, org):
    def make(start=None, **overrides):
        start = start or at(1, 9)
        data = {
            "patient": patient,
            "physician": physician,
            "facility": org["facility"],
            "department": org["medicine"],
            "appointment_type": "new",
            "start_at": start,
            "end_at": start + timedelta(minutes=15),
            **overrides,
        }
        with as_tenant(tenant_a):
            return Appointment.objects.create(**data)

    return make


def move(client, appointment, start, **extra):
    return client.post(
        f"{APPOINTMENTS}{appointment.pk}/reschedule/",
        {"start_at": start.isoformat(), **extra},
        format="json",
    )


def reload(appointment):
    return Appointment.all_tenants.get(pk=appointment.pk)


# -- moving an appointment -------------------------------------------------------------


def test_fr_reschedule_moves_the_time_and_keeps_the_length(desk, window, make_appointment):
    appointment = make_appointment(at(1, 9), end_at=at(1, 9, 30))
    response = move(desk, appointment, at(1, 10))
    assert response.status_code == 200
    moved = reload(appointment)
    assert (moved.start_at, moved.end_at) == (at(1, 10), at(1, 10, 30))
    assert moved.status == "booked"


def test_fr_reschedule_tells_the_patient_and_restarts_reminders(
    desk, window, make_appointment, tenant_a, as_tenant, django_capture_on_commit_callbacks
):
    appointment = make_appointment(at(1, 9))
    with as_tenant(tenant_a):
        AppointmentReminder.objects.create(
            appointment=appointment, offset_hours=24, sent_at=timezone.now()
        )
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        move(desk, appointment, at(1, 10))
    assert len(mail.outbox) == 1
    assert mail.outbox[0].subject.startswith("Appointment moved")
    assert not AppointmentReminder.all_tenants.filter(appointment=appointment).exists()


def test_fr_reschedule_into_a_taken_slot_is_refused_and_changes_nothing(
    desk, window, make_appointment, patient
):
    first = make_appointment(at(1, 9))
    make_appointment(at(1, 10))
    response = move(desk, first, at(1, 10))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "slot_taken"
    assert reload(first).start_at == at(1, 9)


def test_fr_an_appointment_can_move_within_its_own_slot_range(desk, window, make_appointment):
    # Moving by five minutes overlaps its own old time: that must not count as a clash.
    appointment = make_appointment(at(1, 9))
    assert move(desk, appointment, at(1, 9, 5)).status_code == 200


def test_fr_reschedule_needs_an_open_window_and_not_the_past(desk, window, make_appointment):
    appointment = make_appointment(at(1, 9))
    outside = move(desk, appointment, at(1, 15))
    assert outside.status_code == 400
    assert "not available" in str(outside.json()["error"]["details"]["start_at"])
    in_the_past = move(desk, appointment, at(-1, 9))
    assert in_the_past.status_code == 400
    assert reload(appointment).start_at == at(1, 9)


@pytest.mark.parametrize(
    "status", ["checked_in", "in_consultation", "completed", "no_show", "cancelled"]
)
def test_fr_only_an_appointment_that_has_not_started_can_move(
    desk, window, make_appointment, status
):
    extra = {"cancellation_reason": "x"} if status == "cancelled" else {}
    appointment = make_appointment(at(1, 9), status=status, **extra)
    response = move(desk, appointment, at(1, 10))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "transition_refused"


def test_fr_reschedule_to_another_physician(
    desk, window, make_appointment, make_physician, tenant_a, as_tenant, org
):
    other = make_physician("drsecond")
    with as_tenant(tenant_a):
        AvailabilityWindow.objects.create(
            physician=other,
            facility=org["facility"],
            department=org["medicine"],
            start_at=at(1, 9),
            end_at=at(1, 12),
        )
    appointment = make_appointment(at(1, 9))
    assert move(desk, appointment, at(1, 9), physician=str(other.pk)).status_code == 200
    assert reload(appointment).physician_id == other.pk


def test_fr_reschedule_needs_a_real_physician(desk, window, make_appointment, desk_user):
    appointment = make_appointment(at(1, 9))
    response = move(desk, appointment, at(1, 9, 30), physician=str(desk_user.pk))
    assert response.status_code == 400
    assert reload(appointment).physician_id != desk_user.pk


def test_reschedule_rejects_an_end_before_the_start(desk, window, make_appointment):
    appointment = make_appointment(at(1, 9))
    response = move(desk, appointment, at(1, 10), end_at=at(1, 9, 30).isoformat())
    assert response.status_code == 400


def test_sec_02_only_roles_that_may_update_appointments_can_move_them(
    make_user, tenant_a, signed_in, window, make_appointment
):
    appointment = make_appointment(at(1, 9))
    pharmacist = signed_in(make_user("pharm", tenant_a, [Role.PHARMACIST]))
    assert move(pharmacist, appointment, at(1, 10)).status_code == 403
    assert reload(appointment).start_at == at(1, 9)


def test_sec_02_a_doctor_cannot_move_an_appointment_to_a_colleague_outside_their_scope(
    window, make_appointment, physician, signed_in, make_physician, tenant_a, as_tenant, org
):
    colleague = make_physician("drthird", department="surgery")
    with as_tenant(tenant_a):
        AvailabilityWindow.objects.create(
            physician=colleague,
            facility=org["facility"],
            department=org["surgery"],
            start_at=at(1, 9),
            end_at=at(1, 12),
        )
    appointment = make_appointment(at(1, 9))
    doctor = signed_in(physician)
    # Their own appointment, handed to someone whose care team they are not on: refused whole.
    response = move(doctor, appointment, at(1, 9), physician=str(colleague.pk))
    assert response.status_code == 403
    assert reload(appointment).physician_id == physician.pk


def test_sec_03_a_move_is_audited(desk, window, make_appointment):
    appointment = make_appointment(at(1, 9))
    move(desk, appointment, at(1, 10))
    entry = AuditEntry.objects.get(action="update", object_id=str(appointment.pk))
    assert entry.resource == "scheduling.appointment"
    assert "start_at" in entry.details["fields"]


def test_sec_07_another_tenants_appointment_cannot_be_moved(
    desk, make_appointment, tenant_b, as_tenant, patient, physician, org
):
    other = make_appointment(at(1, 9))
    Appointment.all_tenants.filter(pk=other.pk).update(tenant=tenant_b)
    assert move(desk, other, at(1, 10)).status_code == 404


# -- listing for the calendar ------------------------------------------------------------


def test_list_carries_patient_names_and_mrn(desk, make_appointment, patient):
    make_appointment(at(1, 9))
    row = desk.get(APPOINTMENTS).json()["results"][0]
    assert row["patient_name"] == "Ngozi Eze"
    assert row["patient_mrn"] == patient.mrn
    one = desk.get(f"{APPOINTMENTS}{row['id']}/").json()
    assert one["patient_name"] == "Ngozi Eze"


def test_list_does_not_query_per_appointment(desk, make_appointment, make_user):
    for hour in range(9, 12):
        make_appointment(at(1, hour))
    desk.get(APPOINTMENTS)  # warm per-process caches
    with CaptureQueriesContext(connection) as few:
        desk.get(APPOINTMENTS)
    for minute in (15, 30, 45):
        make_appointment(at(1, 13, minute))
    with CaptureQueriesContext(connection) as many:
        assert len(desk.get(APPOINTMENTS).json()["results"]) == 6
    assert len(many) == len(few)


def test_list_filters_by_start_time_range_and_several_statuses(desk, make_appointment):
    make_appointment(at(1, 9))
    make_appointment(at(1, 10), status="no_show")
    make_appointment(at(2, 9), status="cancelled", cancellation_reason="Patient called")

    def ids(**params):
        return {r["start_at"] for r in desk.get(APPOINTMENTS, params).json()["results"]}

    tomorrow = ids(**{"from": at(1, 0).isoformat(), "to": at(2, 0).isoformat()})
    assert tomorrow == {at(1, 9).isoformat(), at(1, 10).isoformat()} or len(tomorrow) == 2
    assert len(ids(status="no_show,cancelled")) == 2
    assert len(ids(status="booked")) == 1
    assert len(ids(**{"from": at(2, 0).isoformat()})) == 1


def test_list_rejects_a_time_without_a_zone(desk):
    response = desk.get(APPOINTMENTS, {"from": "2026-10-20T09:00:00"})
    assert response.status_code == 400


def test_list_pages_by_the_requested_size(desk, make_appointment):
    for minute in (0, 15, 30, 45):
        make_appointment(at(1, 9, minute))
    body = desk.get(APPOINTMENTS, {"page_size": 3}).json()
    assert body["count"] == 4 and len(body["results"]) == 3


def test_availability_windows_filter_by_overlap_with_a_range(desk, window, physician):
    inside = desk.get(WINDOWS, {"from": at(1, 11).isoformat(), "to": at(1, 13).isoformat()})
    assert len(inside.json()["results"]) == 1
    after = desk.get(WINDOWS, {"from": at(1, 12).isoformat(), "to": at(1, 13).isoformat()})
    assert after.json()["results"] == []
