"""Live OPD queue over WebSockets: ``ws/queue/<physician_id>/``.

On connect the client gets the current queue. Each check-in, triage change or start of a
consultation signals the physician's group, and every connection reloads the queue under
its own access scope, so a viewer never receives a patient outside their scope.
"""

from asgiref.sync import async_to_sync
from channels.generic.websocket import JsonWebsocketConsumer
from django.db.models import Q

from apps.accounts import selectors as accounts
from apps.audit import services as audit
from apps.core import policy
from apps.core.errors import TenantError
from apps.core.policy import Action
from apps.core.tenancy import tenant_context
from apps.tenants.selectors import resolve_tenant_id

from . import services

CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403


class QueueConsumer(JsonWebsocketConsumer):
    group = None
    tenant_id = None
    scope_filter = None

    def connect(self):
        user = self.scope.get("user")
        self.physician_id = self.scope["url_route"]["kwargs"]["physician_id"]
        if user is None or not user.is_authenticated:
            self.close(code=CLOSE_UNAUTHENTICATED)
            return
        host = dict(self.scope.get("headers", [])).get(b"host", b"").decode()
        try:
            self.tenant_id = resolve_tenant_id(user, host)
        except TenantError:
            self.tenant_id = None
        with tenant_context(self.tenant_id, user.pk):
            reason = self._refusal(user)
            if reason:
                audit.record(
                    action=audit.AuditAction.ACCESS,
                    outcome=audit.AuditOutcome.DENIED,
                    actor=user,
                    resource="scheduling.queue",
                    object_id=self.physician_id,
                    reason=reason,
                )
                self.close(code=CLOSE_FORBIDDEN)
                return
            snapshot = services.queue_for(self.physician_id, self.scope_filter)
            audit.record(
                action=audit.AuditAction.READ,
                actor=user,
                resource="scheduling.queue",
                object_id=self.physician_id,
                details={"channel": "websocket"},
            )
        self.group = services.queue_group(self.tenant_id, self.physician_id)
        async_to_sync(self.channel_layer.group_add)(self.group, self.channel_name)
        self.accept()
        self.send_json({"type": "queue", "queue": snapshot})

    def _refusal(self, user) -> str:
        if self.tenant_id is None:
            return "no_tenant"
        if accounts.mfa_required(user) and not accounts.is_session_mfa_verified(
            self.scope.get("session"), user
        ):
            return "mfa_required"
        subject = policy.subject_for(user, self.tenant_id)
        q = policy.scope_q(subject, policy.get_resource("scheduling.appointment"), Action.VIEW)
        if q is None:
            return "permission_denied"
        self.scope_filter = None if q == Q() else q
        return ""

    def disconnect(self, code):
        if self.group:
            async_to_sync(self.channel_layer.group_discard)(self.group, self.channel_name)

    def queue_update(self, event):
        user = self.scope["user"]
        with tenant_context(self.tenant_id, user.pk):
            queue = services.queue_for(self.physician_id, self.scope_filter)
        self.send_json({"type": "queue", "queue": queue})
