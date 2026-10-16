"""The seven appointment states, check-in, the queue (HTTP and WebSocket), reminders and
the Deceased cascade."""

import json
from datetime import date, timedelta

import pytest
from asgiref.sync import async_to_sync
from asgiref.testing import ApplicationCommunicator
from channels.db import database_sync_to_async
from django.core import mail
from django.utils import timezone

from apps.clinical.models import Encounter
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.notifications.backends import LocmemSmsBackend
from apps.patients.models import Patient
from apps.scheduling import services
from apps.scheduling.models import Appointment
from config.asgi import application

from .conftest import at

pytestmark = pytest.mark.django_db

APPOINTMENTS = "/api/scheduling/appointments/"


@pytest.fixture
def make_appointment(tenant_a, as_tenant, patient, physician, org):
    def make(start=None, patient_obj=None, **overrides):
        start = start or at(1, 9)
        data = {
            "patient": patient_obj or patient,
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


def move(client, appointment, status, **extra):
    return client.post(
        f"{APPOINTMENTS}{appointment.pk}/status/", {"status": status, **extra}, format="json"
    )


# -- state machine -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "allowed"),
    [
        (["confirmed", "checked_in", "in_consultation", "completed"], True),
        (["checked_in", "in_consultation", "completed"], True),
        (["checked_in", "completed"], False),
        (["in_consultation"], False),
        (["confirmed", "booked"], False),
        (["completed"], False),
    ],
)
def test_appointment_transitions(desk, signed_in, physician, make_appointment, path, allowed):
    appointment = make_appointment(start=at(0, 0, 1))
    doctor = signed_in(physician)
    responses = []
    for status in path:
        client = doctor if status in ("in_consultation", "completed") else desk
        responses.append(move(client, appointment, status))
    assert all(r.status_code == 200 for r in responses[:-1]), [r.json() for r in responses]
    assert (responses[-1].status_code == 200) is allowed, responses[-1].json()


def test_cancellation_needs_a_reason(desk, make_appointment):
    appointment = make_appointment()
    response = move(desk, appointment, "cancelled")
    assert response.status_code == 400
    response = move(desk, appointment, "cancelled", cancellation_reason="Clinic closed")
    assert response.json()["status"] == "cancelled"
    assert move(desk, appointment, "confirmed").status_code == 409


def test_no_show_only_after_the_start(desk, make_appointment):
    assert move(desk, make_appointment(), "no_show").status_code == 409
    past = make_appointment(start=timezone.now() - timedelta(hours=1))
    assert move(desk, past, "no_show").status_code == 200


def test_check_in_records_the_clerk_time_and_triage(desk, desk_user, make_appointment):
    routine = make_appointment()
    body = move(desk, routine, "checked_in").json()
    assert body["checked_in_by"] == str(desk_user.pk)
    assert body["checked_in_at"] and body["triage_priority"] == 3
    emergency = make_appointment(appointment_type="emergency")
    assert move(desk, emergency, "checked_in").json()["triage_priority"] == 1
    urgent = make_appointment(start=at(1, 10))
    assert move(desk, urgent, "checked_in", triage_priority=2).json()["triage_priority"] == 2


def test_consultation_opens_and_completion_finishes_the_encounter(
    desk, signed_in, physician, make_appointment, tenant_a, as_tenant
):
    appointment = make_appointment()
    move(desk, appointment, "checked_in")
    doctor = signed_in(physician)
    started = move(doctor, appointment, "in_consultation").json()
    with as_tenant(tenant_a):
        encounter = Encounter.objects.get(pk=started["encounter_id"])
    assert encounter.appointment_id == appointment.pk
    assert encounter.practitioner_id == physician.pk and encounter.status == "in_progress"
    move(doctor, appointment, "completed")
    encounter.refresh_from_db()
    assert encounter.status == "finished"


# -- queue ---------------------------------------------------------------------------


def test_queue_is_sorted_by_triage_priority_then_arrival(
    desk, signed_in, physician, make_appointment, tenant_a, as_tenant
):
    with as_tenant(tenant_a):
        others = [
            Patient.objects.create(
                first_name=n, last_name="Test", date_of_birth=date(1990 + i, 1, 1)
            )
            for i, n in enumerate(["Bisi", "Chidi", "Dayo"])
        ]
    first = make_appointment(start=at(1, 9), patient_obj=others[0])
    second = make_appointment(start=at(1, 9, 15), patient_obj=others[1])
    urgent = make_appointment(start=at(1, 9, 30), patient_obj=others[2])
    move(desk, first, "checked_in")
    move(desk, second, "checked_in")
    move(desk, urgent, "checked_in", triage_priority=1)
    queue = signed_in(physician).get(f"{APPOINTMENTS}queue/", {"physician": str(physician.pk)})
    assert [e["patient_name"] for e in queue.json()] == ["Dayo Test", "Bisi Test", "Chidi Test"]


class WebSocketClient:
    """Minimal ASGI WebSocket client (channels.testing needs daphne, which we do not use)."""

    def __init__(self, client, physician_id, host="a.example.test"):
        session = client.cookies.get("sessionid")
        cookie = f"sessionid={session.value}" if session else ""
        scope = {
            "type": "websocket",
            "path": f"/ws/queue/{physician_id}/",
            "headers": [
                (b"host", host.encode()),
                (b"origin", f"http://{host}".encode()),
                (b"cookie", cookie.encode()),
            ],
            "subprotocols": [],
        }
        self.communicator = ApplicationCommunicator(application, scope)

    async def connect(self):
        await self.communicator.send_input({"type": "websocket.connect"})
        reply = await self.communicator.receive_output(timeout=5)
        if reply["type"] == "websocket.close":
            return False, reply.get("code")
        return True, None

    async def receive_json(self, timeout=5):
        message = await self.communicator.receive_output(timeout=timeout)
        assert message["type"] == "websocket.send", message
        return json.loads(message["text"])

    async def disconnect(self):
        await self.communicator.send_input({"type": "websocket.disconnect", "code": 1000})
        await self.communicator.wait(timeout=5)


def _ws(client, physician_id):
    return WebSocketClient(client, physician_id)


@pytest.mark.django_db(transaction=True)
def test_check_in_updates_the_physician_queue_over_websocket(
    signed_in, physician, make_appointment, tenant_a, desk_user
):
    appointment = make_appointment()
    client = signed_in(physician)

    def check_in():
        with tenant_context(tenant_a.id, desk_user.pk):
            services.change_status(appointment, "checked_in")

    async def scenario():
        communicator = _ws(client, physician.pk)
        connected, _ = await communicator.connect()
        assert connected
        assert await communicator.receive_json() == {"type": "queue", "queue": []}
        await database_sync_to_async(check_in)()
        update = await communicator.receive_json()
        await communicator.disconnect()
        return update

    update = async_to_sync(scenario)()
    assert update["type"] == "queue"
    assert [e["appointment_id"] for e in update["queue"]] == [str(appointment.pk)]
    assert update["queue"][0]["patient_name"] == "Ngozi Eze"


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize(
    ("who", "mfa", "expected"),
    [("anonymous", False, 4401), ("billing", True, 4403), ("physician", False, 4403)],
)
def test_queue_websocket_refuses_unauthorised_viewers(
    who, mfa, expected, signed_in, physician, make_user, tenant_a, api_client
):
    if who == "anonymous":
        client = api_client
    elif who == "billing":
        client = signed_in(make_user("billing", tenant_a, [Role.BILLING_OFFICER]), mfa=mfa)
    else:
        client = signed_in(physician, mfa=mfa)

    async def scenario():
        communicator = _ws(client, physician.pk)
        connected, code = await communicator.connect()
        return connected, code

    connected, code = async_to_sync(scenario)()
    assert not connected and code == expected


# -- reminders -----------------------------------------------------------------------


def test_reminders_go_out_once_per_offset(
    make_appointment, tenant_a, as_tenant, django_capture_on_commit_callbacks
):
    appointment = make_appointment(start=timezone.now() + timedelta(hours=30))
    start = appointment.start_at
    with as_tenant(tenant_a), django_capture_on_commit_callbacks(execute=True):
        assert services.send_due_reminders(now=start - timedelta(hours=30)) == 0
        assert services.send_due_reminders(now=start - timedelta(hours=23)) == 1
        assert services.send_due_reminders(now=start - timedelta(hours=22)) == 0
        assert services.send_due_reminders(now=start - timedelta(hours=1)) == 1
        assert services.send_due_reminders(now=start - timedelta(minutes=30)) == 0
    assert len(LocmemSmsBackend.outbox) == 2
    assert len(mail.outbox) == 2
    with as_tenant(tenant_a):
        assert sorted(appointment.reminders.values_list("offset_hours", flat=True)) == [2, 24]


def test_late_booking_gets_a_single_reminder(
    make_appointment, tenant_a, as_tenant, django_capture_on_commit_callbacks
):
    appointment = make_appointment(start=timezone.now() + timedelta(hours=1))
    with as_tenant(tenant_a), django_capture_on_commit_callbacks(execute=True):
        assert services.send_due_reminders() == 1
        assert services.send_due_reminders() == 0
    assert len(LocmemSmsBackend.outbox) == 1
    with as_tenant(tenant_a):
        assert appointment.reminders.count() == 2


def test_cancelled_appointments_get_no_reminder(desk, make_appointment, tenant_a, as_tenant):
    appointment = make_appointment(start=timezone.now() + timedelta(hours=1))
    move(desk, appointment, "cancelled", cancellation_reason="Rescheduled")
    with as_tenant(tenant_a):
        assert services.send_due_reminders() == 0


# -- Deceased cascade ----------------------------------------------------------------


def test_deceased_patient_appointments_are_cancelled(
    make_appointment, signed_in, physician, desk, patient, django_capture_on_commit_callbacks
):
    upcoming = make_appointment(start=at(1, 9))
    recurring = [
        make_appointment(start=at(1 + 7 * i, 10), series_id="00000000-0000-0000-0000-000000000001")
        for i in range(2)
    ]
    finished = make_appointment(start=at(1, 11))
    move(desk, finished, "checked_in")
    move(signed_in(physician), finished, "in_consultation")
    move(signed_in(physician), finished, "completed")

    with django_capture_on_commit_callbacks(execute=True):
        response = signed_in(physician).post(
            f"/api/patients/patients/{patient.pk}/status/",
            {"status": "deceased", "deceased_at": timezone.localdate().isoformat()},
            format="json",
        )
    assert response.status_code == 200
    for appointment in [upcoming, *recurring]:
        appointment.refresh_from_db()
        assert appointment.status == "cancelled"
        assert appointment.cancellation_reason == "Patient deceased"
    finished.refresh_from_db()
    assert finished.status == "completed"


def test_completed_consultation_bills_the_fee_once(
    desk, signed_in, physician, make_appointment, tenant_a, django_capture_on_commit_callbacks
):
    from apps.billing.models import InvoiceLine
    from apps.scheduling.tasks import charge_consultation_fee

    appointment = make_appointment()
    doctor = signed_in(physician)
    move(desk, appointment, "checked_in")
    move(doctor, appointment, "in_consultation")
    with django_capture_on_commit_callbacks(execute=True):
        move(doctor, appointment, "completed")
    line = InvoiceLine.all_tenants.get()
    assert (line.amount_minor, line.status, line.revenue_category) == (
        1500000,
        "final",
        "consultation",
    )
    # Replaying the event bills nothing more.
    charge_consultation_fee(
        {
            "event_id": "replay",
            "tenant_id": str(tenant_a.id),
            "actor_id": None,
            "payload": {"appointment_id": str(appointment.pk)},
        }
    )
    assert InvoiceLine.all_tenants.count() == 1


def test_blank_cancellation_reason_is_accepted_except_when_cancelling(desk, make_appointment):
    """Clients may send cancellation_reason="" with any status change (the web app does)."""
    appointment = make_appointment()
    response = move(desk, appointment, "checked_in", cancellation_reason="")
    assert response.status_code == 200, response.json()
    other = make_appointment(start=at(1, 10))
    response = move(desk, other, "cancelled", cancellation_reason="  ")
    assert response.status_code == 400
    assert "cancellation_reason" in response.json()["error"]["details"]
