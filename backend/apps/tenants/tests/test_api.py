"""Facilities and departments: listed for all staff, maintained by tenant admins."""

import pytest

from apps.core.roles import Role
from apps.tenants.models import Facility

pytestmark = pytest.mark.django_db


def test_tenant_admin_creates_facilities_and_departments(make_user, tenant_a, signed_in):
    admin = signed_in(make_user("admin", tenant_a, [Role.TENANT_ADMIN]))
    facility = admin.post(
        "/api/tenants/facilities/", {"name": "Annex", "code": "annex"}, format="json"
    )
    assert facility.status_code == 201, facility.json()
    department = admin.post(
        "/api/tenants/departments/",
        {"facility": facility.json()["id"], "name": "Paediatrics"},
        format="json",
    )
    assert department.status_code == 201


def test_staff_list_departments_of_a_facility(user_a, signed_in, tenant_a, as_tenant):
    from apps.tenants.models import Department

    with as_tenant(tenant_a):
        main = Facility.objects.create(name="Main", code="main")
        annex = Facility.objects.create(name="Annex", code="annex")
        Department.objects.create(facility=main, name="Medicine")
        Department.objects.create(facility=annex, name="Surgery")
    client = signed_in(user_a)
    names = [
        d["name"]
        for d in client.get("/api/tenants/departments/", {"facility": str(main.pk)}).json()[
            "results"
        ]
    ]
    assert names == ["Medicine"]
    assert (
        client.post(
            "/api/tenants/facilities/", {"name": "X", "code": "x"}, format="json"
        ).status_code
        == 403
    )


def test_sec_07_other_tenants_facilities_are_invisible(user_a, signed_in, tenant_b, as_tenant):
    with as_tenant(tenant_b):
        Facility.objects.create(name="Elsewhere", code="b")
    assert signed_in(user_a).get("/api/tenants/facilities/").json()["results"] == []
