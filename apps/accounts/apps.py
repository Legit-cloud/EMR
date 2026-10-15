from django.apps import AppConfig


class AccountsConfig(AppConfig):
    name = "apps.accounts"
    label = "accounts"

    def ready(self):
        from apps.core import events, policy
        from apps.core.policy import Action
        from apps.core.roles import Role
        from apps.patients.events import PATIENT_DECEASED

        from .models import BreakGlassGrant, RoleAssignment, User
        from .tasks import revoke_portal_access_for_deceased_patient

        events.subscribe(PATIENT_DECEASED, revoke_portal_access_for_deceased_patient)

        policy.register(
            "accounts.user",
            model=User,
            grants=[
                policy.grant({Role.TENANT_ADMIN}, {Action.VIEW, Action.CREATE, Action.UPDATE}),
                policy.grant({Role.HR}, {Action.VIEW}),
            ],
            phi=False,
        )
        policy.register(
            "accounts.roleassignment",
            model=RoleAssignment,
            grants=[
                policy.grant({Role.TENANT_ADMIN}, {Action.VIEW, Action.CREATE, Action.DELETE}),
            ],
            phi=False,
        )
        policy.register(
            "accounts.breakglassgrant",
            model=BreakGlassGrant,
            grants=[policy.grant({Role.COMPLIANCE_OFFICER}, {Action.VIEW, Action.UPDATE})],
            phi=False,
        )
