"""Fixtures shared by the portal tests."""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from apps.accounts.models import User
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.patients.models import Patient
from apps.portal import services
from apps.scheduling.models import AvailabilityWindow
from apps.staff.models import StaffProfile
from apps.tenants.models import Facility

LAGOS = ZoneInfo("Africa/Lagos")


def at(day_offset: int, hour: int, minute: int = 0) -> datetime:
    day = datetime.now(LAGOS).date() + timedelta(days=day_offset)
    return datetime.combine(day, time(hour, minute), tzinfo=LAGOS)


@pytest.fixture
def facility(tenant_a):
    with tenant_context(tenant_a.id):
        return Facility.objects.create(name="Main hospital", code="main")


@pytest.fixture
def make_patient(tenant_a):
    def make(first, email=None):
        with tenant_context(tenant_a.id):
            return Patient.objects.create(
                first_name=first,
                last_name="Okoro",
                date_of_birth=date(1990, 3, 3),
                phone="+2348031234567",
                email=f"{first.lower()}@example.test" if email is None else email,
            )

    return make


@pytest.fixture
def ada(make_patient):
    return make_patient("Ada")


@pytest.fixture
def bola(make_patient):
    return make_patient("Bola")


@pytest.fixture
def front_desk(make_user, signed_in, tenant_a):
    return signed_in(make_user("desk-portal", tenant_a, [Role.FRONT_DESK]))


@pytest.fixture
def physician(make_user, tenant_a, facility):
    user = make_user("dr-portal", tenant_a, [Role.DOCTOR], first_name="Chidi", last_name="Eze")
    with tenant_context(tenant_a.id):
        StaffProfile.objects.create(
            user=user,
            staff_type="physician",
            title="Dr",
            specialty="Cardiology",
            licensing_body="mdcn",
            licence_number="MDCN-portal",
            licence_expires_on=date(2031, 1, 1),
        )
        AvailabilityWindow.objects.create(
            physician=user, facility=facility, start_at=at(2, 9), end_at=at(2, 10)
        )
    return user


@pytest.fixture
def invite(tenant_a):
    """Give a patient a portal sign-in and return (account, signed-in client factory result)."""

    def make(patient):
        with tenant_context(tenant_a.id):
            return services.invite(patient.pk)

    return make


@pytest.fixture
def as_patient(invite, signed_in):
    def make(patient):
        account = invite(patient)
        return signed_in(User.objects.get(pk=account.user_id)), account

    return make
