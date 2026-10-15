from datetime import date

import pytest

from apps.billing.models import Insurer
from apps.core.money import Money
from apps.core.roles import Role
from apps.core.tenancy import tenant_context
from apps.patients.models import Patient


@pytest.fixture
def ctx(tenant_a, billing_user):
    """Run service calls as a billing officer of tenant A."""
    return lambda: tenant_context(tenant_a.id, billing_user.pk)


@pytest.fixture
def billing_user(make_user, tenant_a):
    return make_user("billing", tenant_a, [Role.BILLING_OFFICER])


@pytest.fixture
def billing(billing_user, signed_in):
    return signed_in(billing_user)


@pytest.fixture
def finance(make_user, tenant_a, signed_in):
    return signed_in(make_user("finance", tenant_a, [Role.FINANCE]))


@pytest.fixture
def make_patient(tenant_a):
    counter = iter(range(1, 1000))

    def make(first="Ngozi"):
        n = next(counter)
        with tenant_context(tenant_a.id):
            return Patient.objects.create(
                first_name=first, last_name="Eze", date_of_birth=date(1960 + n, 1, 1)
            )

    return make


@pytest.fixture
def patient(make_patient):
    return make_patient()


@pytest.fixture
def insurer(tenant_a):
    with tenant_context(tenant_a.id):
        return Insurer.objects.create(name="Synthetic HMO", code="synth-hmo")


def ngn(kobo: int) -> Money:
    return Money(kobo, "NGN")
