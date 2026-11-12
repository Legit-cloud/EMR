from django.apps import AppConfig


class TenantsConfig(AppConfig):
    name = "apps.tenants"
    label = "tenants"

    def ready(self):
        from apps.core import policy
        from apps.core.policy import Action
        from apps.core.roles import STAFF_ROLES, Role

        from .models import Department, Facility

        for name, model in (("tenants.facility", Facility), ("tenants.department", Department)):
            policy.register(
                name,
                model=model,
                grants=[
                    policy.grant(STAFF_ROLES, {Action.VIEW}),
                    policy.grant({Role.TENANT_ADMIN}, {Action.CREATE, Action.UPDATE}),
                ],
                phi=False,
            )
