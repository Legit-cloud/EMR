from django.core.exceptions import ImproperlyConfigured
from rest_framework import viewsets

from apps.core.tenancy import activate, deactivate
from apps.tenants.selectors import resolve_tenant_id


class TenantScopedAPIMixin:
    """Re-resolve the tenant after DRF authentication (SEC-07).

    Token-authenticated clients are anonymous when the middleware runs; DRF identifies
    them inside the view. This sets the tenant and actor from that user before any
    permission check or query runs, and restores the previous context afterwards.
    Every API view that touches tenant-owned data must use it.
    """

    _tenant_tokens = None

    def perform_authentication(self, request):
        super().perform_authentication(request)
        user = request.user
        tenant_id = resolve_tenant_id(user, request.get_host())
        request.tenant_id = tenant_id
        user_id = user.pk if user.is_authenticated else None
        self._tenant_tokens = activate(tenant_id, user_id)

    def finalize_response(self, request, response, *args, **kwargs):
        try:
            return super().finalize_response(request, response, *args, **kwargs)
        finally:
            if self._tenant_tokens is not None:
                deactivate(self._tenant_tokens)
                self._tenant_tokens = None


class TenantModelViewSet(TenantScopedAPIMixin, viewsets.ModelViewSet):
    """ModelViewSet for tenant-owned models.

    Set ``model`` instead of ``queryset``: a class-level queryset is built at import
    time, before any tenant is active, so its tenant filter would be wrong. Override
    ``get_queryset`` to narrow further, starting from ``super().get_queryset()``.
    Register with an explicit ``basename`` on the router.
    """

    model = None

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if cls.__dict__.get("queryset") is not None:
            raise ImproperlyConfigured(
                f"{cls.__name__}: set `model`, not `queryset`, on tenant-scoped viewsets."
            )

    def get_queryset(self):
        if self.model is None:
            raise ImproperlyConfigured(f"{type(self).__name__} must set `model`.")
        return self.model.objects.all()
