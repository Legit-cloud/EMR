from django.apps import AppConfig


class AccountsConfig(AppConfig):
    name = "apps.accounts"
    label = "accounts"

    def ready(self):
        from apps.core import policy
        from apps.core.policy import Action
        from apps.core.roles import Role

        from . import schema  # noqa: F401  (OpenAPI description of bearer tokens)
        from .models import BreakGlassGrant, RoleAssignment, User

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
            grants=[
                policy.grant({Role.COMPLIANCE_OFFICER}, {Action.VIEW, Action.UPDATE}),
                policy.grant({Role.TENANT_ADMIN}, {Action.VIEW}),
            ],
            phi=False,
        )
