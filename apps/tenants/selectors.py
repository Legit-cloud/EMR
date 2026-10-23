"""Read-only tenant queries that other modules may use."""

import uuid

from django.core.cache import cache

from apps.core.errors import CrossTenantAccess, TenantInactive

from .models import Tenant


def _host_without_port(host: str) -> str:
    if host.startswith("["):  # IPv6 literal
        return host.split("]")[0] + "]"
    return host.rsplit(":", 1)[0].lower()


CACHE_SECONDS = 60


def _host_tenant(host: str) -> tuple[uuid.UUID, bool] | None:
    """(tenant id, active) for a host name, cached; invalidated when a tenant is saved."""
    key = f"tenant:host:{host}"
    cached = cache.get(key)
    if cached is None:
        row = Tenant.objects.filter(domain=host).values_list("id", "is_active").first()
        cached = row or ("none", False)
        cache.set(key, cached, CACHE_SECONDS)
    return None if cached[0] == "none" else (cached[0], cached[1])


def _tenant_active(tenant_id) -> bool:
    key = f"tenant:active:{tenant_id}"
    cached = cache.get(key)
    if cached is None:
        cached = Tenant.objects.filter(pk=tenant_id, is_active=True).exists()
        cache.set(key, cached, CACHE_SECONDS)
    return cached


def forget_tenant(tenant: Tenant) -> None:
    """Drop cached lookups for a tenant (called when it is saved)."""
    keys = [f"tenant:active:{tenant.pk}"]
    if tenant.domain:
        keys.append(f"tenant:host:{tenant.domain}")
    cache.delete_many(keys)


def resolve_tenant_id(user, host: str) -> uuid.UUID | None:
    """Work out which tenant a request acts for.

    - An authenticated user with a tenant always acts for that tenant. If the host
      belongs to a different tenant the request is refused.
    - An authenticated user without a tenant (platform staff) gets no tenant context,
      so tenant-scoped queries return nothing until access rules grant more.
    - An anonymous request on a tenant's host acts for that tenant (sign-in pages).
    - Inactive tenants are refused.
    """
    host_tenant = _host_tenant(_host_without_port(host))
    if user is not None and user.is_authenticated:
        user_tenant_id = getattr(user, "tenant_id", None)
        if user_tenant_id is None:
            return None
        if host_tenant is not None and host_tenant[0] != user_tenant_id:
            raise CrossTenantAccess("This account belongs to a different organisation.")
        if not _tenant_active(user_tenant_id):
            raise TenantInactive()
        return user_tenant_id
    if host_tenant is None:
        return None
    tenant_id, active = host_tenant
    if not active:
        raise TenantInactive()
    return tenant_id


def active_tenant_ids() -> list[uuid.UUID]:
    """For system jobs that run once per tenant (licence watcher, reminders, ward charges)."""
    return list(Tenant.objects.filter(is_active=True).values_list("id", flat=True))


def tenant_name(tenant_id) -> str:
    """The organisation's name, for notices addressed to its patients."""
    return Tenant.objects.filter(pk=tenant_id).values_list("name", flat=True).first() or ""
