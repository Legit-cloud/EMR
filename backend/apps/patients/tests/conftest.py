from datetime import date

import pytest

from apps.core.roles import Role
from apps.patients.models import Patient

# Synthetic people only. Never real patient data.
ADA = {
    "first_name": "Adaeze",
    "last_name": "Okonkwo",
    "date_of_birth": "1990-04-12",
    "sex": "female",
    "phone": "0803 123 4567",
}


@pytest.fixture
def clerk(make_user, tenant_a, signed_in):
    user = make_user("clerk", tenant_a, [Role.FRONT_DESK])
    return signed_in(user)


@pytest.fixture
def doctor_user(make_user, tenant_a):
    return make_user("doctor", tenant_a, [Role.DOCTOR])


@pytest.fixture
def doctor(doctor_user, signed_in):
    return signed_in(doctor_user)


@pytest.fixture
def make_patient(tenant_a, as_tenant):
    def make(tenant=None, **overrides):
        data = {
            "first_name": "Adaeze",
            "last_name": "Okonkwo",
            "date_of_birth": date(1990, 4, 12),
            "sex": "female",
            **overrides,
        }
        with as_tenant(tenant or tenant_a):
            return Patient.objects.create(**data)

    return make
