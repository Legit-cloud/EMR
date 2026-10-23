from django.apps import AppConfig


class PortalConfig(AppConfig):
    name = "apps.portal"
    label = "portal"

    def ready(self):
        from apps.core import events, policy
        from apps.core.policy import Action
        from apps.core.roles import Role
        from apps.patients.events import PATIENT_DECEASED

        from . import tasks
        from .models import DataSubjectRequest, PortalAccount

        events.subscribe(PATIENT_DECEASED, tasks.revoke_portal_access_for_deceased_patient)

        # Staff invite patients and switch access off. The patient's own use of the portal is not
        # a policy resource: it works on the signed-in patient's record only (see api/views.py).
        policy.register(
            "portal.account",
            model=PortalAccount,
            grants=[
                policy.grant({Role.FRONT_DESK, Role.TENANT_ADMIN}, {Action.VIEW}),
                policy.grant({Role.FRONT_DESK, Role.TENANT_ADMIN}, {Action.CREATE, Action.UPDATE}),
            ],
        )
        # Patients' data-protection requests are answered by compliance, with the admin as backup.
        policy.register(
            "portal.request",
            model=DataSubjectRequest,
            grants=[
                policy.grant(
                    {Role.COMPLIANCE_OFFICER, Role.TENANT_ADMIN}, {Action.VIEW, Action.UPDATE}
                )
            ],
        )
