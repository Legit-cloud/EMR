import io

import pytest
from django.core.management import call_command

from apps.accounts.models import RoleAssignment
from apps.core.roles import Role


@pytest.mark.django_db
def test_create_hospital_admin_makes_a_tenant_admin_who_can_authenticate():
    from django.contrib.auth import authenticate, get_user_model

    out = io.StringIO()
    call_command(
        "create_hospital_admin",
        "--email",
        "demo@admin.com",
        "--password",
        "Str0ng-pass-9921",
        stdout=out,
    )
    user = get_user_model().objects.get(username="demo")
    assert authenticate(username="demo", password="Str0ng-pass-9921") == user
    assert RoleAssignment.all_tenants.filter(user=user, role=Role.TENANT_ADMIN).exists()
