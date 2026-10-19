from django.apps import AppConfig


class AuditConfig(AppConfig):
    name = "apps.audit"
    label = "audit"

    def ready(self):
        from apps.core import policy
        from apps.core.policy import Action
        from apps.core.roles import Role

        from .models import AuditEntry

        policy.register(
            "audit.auditentry",
            model=AuditEntry,
            grants=[policy.grant({Role.COMPLIANCE_OFFICER, Role.TENANT_ADMIN}, {Action.VIEW})],
            phi=True,
        )
