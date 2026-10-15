"""Read-only tenant queries that other modules may use."""

import uuid

from apps.core.errors import CrossTenantAccess, TenantInactive

from .models import Tenant


def _host_without_port(host: str) -> str:
    if host.startswith("["):  # IPv6 literal
        return host.split("]")[0] + "]"
    return host.rsplit(":", 1)[0].lower()


def resolve_tenant_id(user, host: str) -> uuid.UUID | None:
    """Work out which tenant a request acts for.

    - An authenticated user with a tenant always acts for that tenant. If the host
      belongs to a different tenant the request is refused.
    - An authenticated user without a tenant (platform staff) gets no tenant context,
      so tenant-scoped queries return nothing until access rules grant more.
    - An anonymous request on a tenant's host acts for that tenant (sign-in pages).
    - Inactive tenants are refused.
    """
    host_tenant = (
        Tenant.objects.filter(domain=_host_without_port(host)).only("id", "is_active").first()
    )
    if user is not None and user.is_authenticated:
        user_tenant_id = getattr(user, "tenant_id", None)
        if user_tenant_id is None:
            return None
        if host_tenant is not None and host_tenant.id != user_tenant_id:
            raise CrossTenantAccess("This account belongs to a different organisation.")
        if not Tenant.objects.filter(pk=user_tenant_id, is_active=True).exists():
            raise TenantInactive()
        return user_tenant_id
    if host_tenant is None:
        return None
    if not host_tenant.is_active:
        raise TenantInactive()
    return host_tenant.id


def active_tenant_ids() -> list[uuid.UUID]:
    """For system jobs that run once per tenant (licence watcher, reminders, ward charges)."""
    return list(Tenant.objects.filter(is_active=True).values_list("id", flat=True))
