"""Abstract base models shared by every module."""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from .errors import CrossTenantAccess, HardDeleteNotAllowed, TenantContextMissing
from .tenancy import get_current_tenant_id, get_current_user_id


class UUIDModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class TimestampedModel(UUIDModel):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class TenantQuerySet(models.QuerySet):
    def bulk_create(self, objs, *args, **kwargs):
        objs = list(objs)
        for obj in objs:
            obj._assign_tenant()
        return super().bulk_create(objs, *args, **kwargs)


class TenantManager(models.Manager.from_queryset(TenantQuerySet)):
    """Default manager: only rows of the current tenant, and nothing when no tenant is active.

    Failing closed means a query that runs outside a tenant context returns no rows
    instead of every tenant's rows. System code that must cross tenants uses the explicit
    ``all_tenants`` manager.
    """

    def get_queryset(self):
        queryset = super().get_queryset()
        tenant_id = get_current_tenant_id()
        if tenant_id is None:
            return queryset.none()
        return queryset.filter(tenant_id=tenant_id)


class UnscopedManager(models.Manager):
    """Every tenant's rows. For system code only; each use needs a reason in review."""


class TenantModel(TimestampedModel):
    """Base for every tenant-owned row (SEC-07).

    - ``objects`` is scoped to the current tenant; ``all_tenants`` is unscoped.
    - New rows take the current tenant. Writing a row of another tenant raises.
    - Foreign keys to other tenant-owned rows must point inside the same tenant.
    """

    tenant = models.ForeignKey(
        "tenants.Tenant", on_delete=models.PROTECT, related_name="+", editable=False
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        editable=False,
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        editable=False,
    )

    # ``objects`` must stay first: subclasses that declare their own Meta lose
    # default_manager_name, and Django then uses the first manager declared.
    objects = TenantManager()
    all_tenants = UnscopedManager()

    class Meta:
        abstract = True
        default_manager_name = "objects"
        base_manager_name = "all_tenants"

    def save(self, *args, **kwargs):
        self._assign_tenant()
        self._check_related_tenants()
        user_id = get_current_user_id()
        if user_id is not None:
            if self._state.adding and self.created_by_id is None:
                self.created_by_id = user_id
            self.updated_by_id = user_id
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        self._check_current_tenant()
        return super().delete(*args, **kwargs)

    def _assign_tenant(self) -> None:
        if self.tenant_id is None:
            tenant_id = get_current_tenant_id()
            if tenant_id is None:
                raise TenantContextMissing()
            self.tenant_id = tenant_id
        self._check_current_tenant()

    def _check_current_tenant(self) -> None:
        tenant_id = get_current_tenant_id()
        if tenant_id is not None and self.tenant_id != tenant_id:
            raise CrossTenantAccess()

    def _check_related_tenants(self) -> None:
        for field in self._meta.concrete_fields:
            if not field.is_relation or field.name == "tenant":
                continue
            related_model = field.related_model
            if not (isinstance(related_model, type) and issubclass(related_model, TenantModel)):
                continue
            related_id = getattr(self, field.attname)
            if related_id is None:
                continue
            cached = field.get_cached_value(self, default=None)
            if cached is not None:
                same_tenant = cached.tenant_id == self.tenant_id
            else:
                same_tenant = related_model.all_tenants.filter(
                    pk=related_id, tenant_id=self.tenant_id
                ).exists()
            if not same_tenant:
                raise CrossTenantAccess(details={"field": field.name})


class RecordState(models.TextChoices):
    ACTIVE = "active", "Active"
    ENTERED_IN_ERROR = "entered_in_error", "Entered in error"


class SoftStateQuerySet(TenantQuerySet):
    def active_chart(self):
        """Rows shown on the active chart. History views use the unfiltered queryset."""
        return self.filter(record_state=RecordState.ACTIVE)

    def delete(self):
        raise HardDeleteNotAllowed()


class SoftStateManager(TenantManager.from_queryset(SoftStateQuerySet)):
    pass


class SoftStateModel(TenantModel):
    """Tenant-owned record that is hidden with Entered-in-Error, never hard-deleted."""

    record_state = models.CharField(
        max_length=20, choices=RecordState.choices, default=RecordState.ACTIVE
    )
    entered_in_error_at = models.DateTimeField(null=True, blank=True, editable=False)
    entered_in_error_reason = models.TextField(blank=True, editable=False)

    objects = SoftStateManager()
    all_tenants = UnscopedManager()

    class Meta(TenantModel.Meta):
        abstract = True

    def delete(self, *args, **kwargs):
        raise HardDeleteNotAllowed()

    def mark_entered_in_error(self, reason: str) -> None:
        if not reason or not reason.strip():
            raise ValueError("A reason is required to mark a record Entered-in-Error.")
        self.record_state = RecordState.ENTERED_IN_ERROR
        self.entered_in_error_at = timezone.now()
        self.entered_in_error_reason = reason.strip()
        self.save(
            update_fields=[
                "record_state",
                "entered_in_error_at",
                "entered_in_error_reason",
                "updated_at",
                "updated_by",
            ]
        )
