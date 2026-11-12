from datetime import date

import pytest

from apps.clinical.models import Encounter
from apps.core.roles import Role
from apps.patients.models import Patient
from apps.tenants.models import Department, Facility


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
def patient(tenant_a, as_tenant):
    with as_tenant(tenant_a):
        return Patient.objects.create(
            first_name="Ngozi", last_name="Eze", date_of_birth=date(1985, 6, 1), sex="female"
        )


@pytest.fixture
def doctor_user(make_user, tenant_a, org):
    return make_user("doctor", tenant_a, [Role.DOCTOR], department=org["medicine"])


@pytest.fixture
def doctor(doctor_user, signed_in):
    return signed_in(doctor_user)


@pytest.fixture
def make_encounter(tenant_a, as_tenant, org, doctor_user, patient):
    def make(department="medicine", **overrides):
        data = {
            "patient": patient,
            "encounter_class": "outpatient",
            "facility": org["facility"],
            "department": org[department],
            "practitioner": doctor_user,
            **overrides,
        }
        with as_tenant(tenant_a, doctor_user):
            return Encounter.objects.create(**data)

    return make


@pytest.fixture
def encounter(make_encounter):
    return make_encounter()
