from django.conf import settings
from django.http import JsonResponse

from apps.core.api.exceptions import error_body
from apps.core.errors import TenantError
from apps.core.tenancy import tenant_context

from .selectors import resolve_tenant_id


class TenantMiddleware:
    """Activate the tenant and actor for the whole request (SEC-07).

    Runs after AuthenticationMiddleware, so session users are known here. API clients
    that authenticate inside DRF (tokens) are handled by ``TenantScopedAPIMixin``.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Paths that never touch tenant data, such as /healthz, which must still answer
        # when the database is down.
        if request.path in settings.TENANT_EXEMPT_PATHS:
            return self.get_response(request)
        user = getattr(request, "user", None)
        try:
            tenant_id = resolve_tenant_id(user, request.get_host())
        except TenantError as exc:
            return JsonResponse(error_body(exc.code, exc.message), status=exc.status_code)
        request.tenant_id = tenant_id
        user_id = user.pk if user is not None and user.is_authenticated else None
        with tenant_context(tenant_id, user_id):
            return self.get_response(request)
