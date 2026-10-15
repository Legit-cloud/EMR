from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from rest_framework import exceptions, viewsets

from apps.audit import services as audit
from apps.core import policy
from apps.core.policy import Action
from apps.core.tenancy import activate, deactivate
from apps.tenants.selectors import resolve_tenant_id

from .permissions import PolicyPermission

MAX_AUDITED_IDS = 500
_DRF_ACTIONS = {
    "list": Action.VIEW,
    "retrieve": Action.VIEW,
    "create": Action.CREATE,
    "update": Action.UPDATE,
    "partial_update": Action.UPDATE,
    "destroy": Action.DELETE,
    "metadata": Action.VIEW,
}
_AUDIT_WRITE = {
    Action.CREATE: audit.AuditAction.CREATE,
    Action.UPDATE: audit.AuditAction.UPDATE,
    Action.DELETE: audit.AuditAction.DELETE,
}


class TenantScopedAPIMixin:
    """Re-resolve the tenant after DRF authentication (SEC-07).

    Token-authenticated clients are anonymous when the middleware runs; DRF identifies
    them inside the view. This sets the tenant and actor from that user before any
    permission check or query runs, and restores the previous context afterwards.
    """

    _tenant_tokens = None

    def perform_authentication(self, request):
        super().perform_authentication(request)
        user = request.user
        tenant_id = resolve_tenant_id(user, request.get_host())
        request.tenant_id = tenant_id
        request._request.tenant_id = tenant_id
        user_id = user.pk if user.is_authenticated else None
        self._tenant_tokens = activate(tenant_id, user_id)

    def finalize_response(self, request, response, *args, **kwargs):
        try:
            return super().finalize_response(request, response, *args, **kwargs)
        finally:
            if self._tenant_tokens is not None:
                deactivate(self._tenant_tokens)
                self._tenant_tokens = None


class PolicyViewSetMixin(TenantScopedAPIMixin):
    """Base for every API view over tenant data: policy checks plus automatic auditing.

    Subclasses set:

    - ``model``: not ``queryset``. A class-level queryset is built at import time, before
      any tenant is active, so its tenant filter would be wrong.
    - ``policy_resource``: the name registered with ``apps.core.policy.register``.
    - ``policy_actions``: policy action for each custom ``@action`` (``{"approve": UPDATE}``).

    Override ``get_base_queryset`` (not ``get_queryset``) to narrow the rows. List views are
    filtered to the user's scope; detail views check the object, so a row outside the
    scope gives 403 and can be opened with break-glass where the resource allows it.

    Audit: reads of PHI resources, every write and every denied request are recorded.
    """

    model = None
    policy_resource: str | None = None
    policy_actions: dict = {}
    permission_classes = [PolicyPermission]
    policy_decision = None

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if cls.__dict__.get("queryset") is not None:
            raise ImproperlyConfigured(
                f"{cls.__name__}: set `model`, not `queryset`, on tenant-scoped viewsets."
            )

    # -- policy --------------------------------------------------------------------

    def get_policy_resource(self) -> policy.Resource:
        if not self.policy_resource:
            raise ImproperlyConfigured(f"{type(self).__name__} must set `policy_resource`.")
        return policy.get_resource(self.policy_resource)

    @property
    def policy_action(self) -> Action:
        action = self.policy_actions.get(self.action) or _DRF_ACTIONS.get(self.action)
        if action is None:
            raise ImproperlyConfigured(
                f"{type(self).__name__}.{self.action} needs an entry in `policy_actions`."
            )
        return Action(action)

    def policy_subject(self) -> policy.Subject:
        request = self.request
        subject = getattr(request, "_policy_subject", None)
        if subject is None:
            subject = policy.subject_for(request.user, request.tenant_id)
            request._policy_subject = subject
        return subject

    def get_base_queryset(self):
        if self.model is None:
            raise ImproperlyConfigured(f"{type(self).__name__} must set `model`.")
        return self.model.objects.all()

    def get_queryset(self):
        queryset = self.get_base_queryset()
        if not queryset.ordered:
            # A stable order for pagination.
            names = {f.name for f in queryset.model._meta.get_fields()}
            queryset = queryset.order_by(
                *(["created_at", "pk"] if "created_at" in names else ["pk"])
            )
        if self.action == "list":
            queryset = policy.filter_queryset(
                self.policy_subject(), self.get_policy_resource(), Action.VIEW, queryset
            )
        return queryset

    def _require_in_scope(self, instance, action: Action) -> None:
        """After a write, the row must still be inside the user's scope."""
        decision = policy.check_object(
            self.policy_subject(),
            self.get_policy_resource(),
            action,
            instance,
            self.get_base_queryset(),
        )
        if not decision.allowed or decision.break_glass_grant_id:
            raise exceptions.PermissionDenied("This record would be outside your access.")

    # -- writes --------------------------------------------------------------------

    def perform_create(self, serializer):
        with transaction.atomic():
            instance = serializer.save()
            self._require_in_scope(instance, Action.CREATE)
            self.audit_write(Action.CREATE, instance, sorted(serializer.validated_data))

    def perform_update(self, serializer):
        with transaction.atomic():
            instance = serializer.save()
            self._require_in_scope(instance, Action.UPDATE)
            self.audit_write(Action.UPDATE, instance, sorted(serializer.validated_data))

    def perform_destroy(self, instance):
        with transaction.atomic():
            self.audit_write(Action.DELETE, instance, [])
            instance.delete()

    def audit_write(self, action: Action, instance, fields: list[str]) -> None:
        audit.record(
            action=_AUDIT_WRITE.get(action, audit.AuditAction.UPDATE),
            request=self.request,
            resource=self.policy_resource,
            object_id=instance.pk,
            details={"fields": fields, "view_action": self.action},
        )

    # -- reads and denials ---------------------------------------------------------

    def finalize_response(self, request, response, *args, **kwargs):
        # Runs before the tenant context is restored by TenantScopedAPIMixin.
        try:
            self._audit_response(request, response)
        finally:
            response = super().finalize_response(request, response, *args, **kwargs)
        return response

    def _audit_response(self, request, response) -> None:
        if not self.policy_resource or getattr(self, "action", None) is None:
            return
        status = response.status_code
        object_id = self.kwargs.get(self.lookup_url_kwarg or self.lookup_field, "")
        try:
            action = self.policy_action
        except ImproperlyConfigured:
            action = None
        if status in (401, 403):
            data = response.data if isinstance(response.data, dict) else {}
            code = data.get("error", {}).get("code", "")
            audit.record(
                action=audit.AuditAction.ACCESS,
                outcome=audit.AuditOutcome.DENIED,
                request=request,
                resource=self.policy_resource,
                object_id=object_id,
                reason=code,
                details={"view_action": self.action, "policy_action": action, "status": status},
            )
            return
        if status == 404 and object_id:
            audit.record(
                action=audit.AuditAction.ACCESS,
                outcome=audit.AuditOutcome.NOT_FOUND,
                request=request,
                resource=self.policy_resource,
                object_id=object_id,
                details={"view_action": self.action, "status": status},
            )
            return
        if not (200 <= status < 300) or action != Action.VIEW:
            return
        if not self.get_policy_resource().phi:
            return
        details = {"view_action": self.action}
        reason = ""
        if self.action == "list":
            rows = response.data.get("results", []) if isinstance(response.data, dict) else []
            if isinstance(response.data, list):
                rows = response.data
            ids = [str(row.get("id")) for row in rows if isinstance(row, dict)]
            details["object_ids"] = ids[:MAX_AUDITED_IDS]
            details["count"] = len(ids)
        decision = self.policy_decision
        if decision is not None and decision.break_glass_grant_id:
            details["break_glass_grant_id"] = str(decision.break_glass_grant_id)
            reason = "break_glass"
        audit.record(
            action=audit.AuditAction.READ,
            request=request,
            resource=self.policy_resource,
            object_id=object_id,
            reason=reason,
            details=details,
        )


class TenantModelViewSet(PolicyViewSetMixin, viewsets.ModelViewSet):
    pass


class TenantReadOnlyViewSet(PolicyViewSetMixin, viewsets.ReadOnlyModelViewSet):
    pass
