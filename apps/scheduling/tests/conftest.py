from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from apps.core.roles import Role
from apps.notifications.backends import LocmemSmsBackend
from apps.patients.models import Patient
from apps.scheduling.models import AvailabilityWindow
from apps.staff.models import StaffProfile
from apps.tenants.models import Department, Facility

LAGOS = ZoneInfo("Africa/Lagos")


def at(day_offset: int, hour: int, minute: int = 0) -> datetime:
    """A Lagos time ``day_offset`` days from today."""
    day = datetime.now(LAGOS).date() + timedelta(days=day_offset)
    return datetime.combine(day, time(hour, minute), tzinfo=LAGOS)


@pytest.fixture(autouse=True)
def _clear_sms_outbox():
    LocmemSmsBackend.outbox.clear()


@pytest.fixture
def org(tenant_a, as_tenant):
    with as_tenant(tenant_a):
        main = Facility.objects.create(name="Main hospital", code="main")
        return {
            "facility": main,
            "medicine": Department.objects.create(facility=main, name="Medicine"),
            "surgery": Department.objects.create(facility=main, name="Surgery"),
        }


@pytest.fixture
def make_physician(make_user, tenant_a, org, as_tenant):
    def make(username="drokafor", department="medicine"):
        user = make_user(
            username, tenant_a, [Role.DOCTOR], department=org[department], last_name="Okafor"
        )
        with as_tenant(tenant_a):
            StaffProfile.objects.create(
                user=user,
                staff_type="physician",
                title="Dr",
                licensing_body="mdcn",
                licence_number=f"MDCN-{username}",
                licence_expires_on=date(2030, 1, 1),
                consultation_fee_minor=1500000,
            )
        return user

    return make


@pytest.fixture
def physician(make_physician):
    return make_physician()


@pytest.fixture
def patient(tenant_a, as_tenant):
    with as_tenant(tenant_a):
        return Patient.objects.create(
            first_name="Ngozi",
            last_name="Eze",
            date_of_birth=date(1985, 6, 1),
            phone="+2348031234567",
            email="ngozi@example.test",
        )


@pytest.fixture
def window(tenant_a, as_tenant, physician, org):
    """Tomorrow 09:00-12:00 Lagos time."""
    with as_tenant(tenant_a):
        return AvailabilityWindow.objects.create(
            physician=physician,
            facility=org["facility"],
            department=org["medicine"],
            start_at=at(1, 9),
            end_at=at(1, 12),
        )


@pytest.fixture
def desk_user(make_user, tenant_a):
    return make_user("desk", tenant_a, [Role.FRONT_DESK])


@pytest.fixture
def desk(desk_user, signed_in):
    return signed_in(desk_user)


@pytest.fixture
def booking(patient, physician, org):
    """Build a booking payload: ``booking(start=..., **overrides)``."""

    def make(start=None, **overrides):
        return {
            "patient": str(patient.pk),
            "physician": str(physician.pk),
            "facility": str(org["facility"].pk),
            "department": str(org["medicine"].pk),
            "appointment_type": "new",
            "start_at": (start or at(1, 9)).isoformat(),
            **overrides,
        }

    return make
