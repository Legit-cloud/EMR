"""Write operations. Other modules call this module only through these functions."""

from django.db import transaction
from django.utils.text import slugify

from apps.core.tenancy import tenant_context

from .models import Department, Facility, Tenant


def _unique_slug(name: str) -> str:
    base = slugify(name)[:50] or "organisation"
    slug, n = base, 1
    while Tenant.objects.filter(slug=slug).exists():
        n += 1
        slug = f"{base}-{n}"
    return slug


@transaction.atomic
def create_organisation(*, name: str) -> tuple[Tenant, Facility]:
    """A new customer with its first facility (named after the organisation until renamed)."""
    tenant = Tenant.objects.create(name=name.strip(), slug=_unique_slug(name))
    with tenant_context(tenant.id):
        facility = Facility.objects.create(name=name.strip(), code="main")
    return tenant, facility


def rename_organisation_facility(*, name: str) -> Facility:
    """Name the tenant's first facility. Runs inside a tenant context."""
    facility = Facility.objects.order_by("created_at").first() or Facility(code="main")
    facility.name = name.strip()
    facility.save()
    return facility


def ensure_departments(names: list[str]) -> list[Department]:
    """Create the named departments in the first facility, skipping any that exist."""
    facility = Facility.objects.order_by("created_at").first()
    if facility is None:
        return []
    made = []
    for name in names:
        department, _ = Department.objects.get_or_create(facility=facility, name=name.strip())
        made.append(department)
    return made
