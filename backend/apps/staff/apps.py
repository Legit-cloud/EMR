from django.apps import AppConfig


class StaffConfig(AppConfig):
    name = "apps.staff"
    label = "staff"

    def ready(self):
        from apps.core import policy
        from apps.core.policy import Action
        from apps.core.roles import STAFF_ROLES, Role

        from .models import Shift, StaffProfile
        from .selectors import is_on_duty

        # Shift status feeds grants marked on_duty (CLAUDE.md Section 5).
        policy.set_on_duty_provider(is_on_duty)

        managers = {Role.HR, Role.TENANT_ADMIN}
        policy.register(
            "staff.staffprofile",
            model=StaffProfile,
            grants=[
                policy.grant(STAFF_ROLES, {Action.VIEW}),
                policy.grant(managers, {Action.CREATE, Action.UPDATE}),
            ],
            phi=False,
        )
        policy.register(
            "staff.shift",
            model=Shift,
            grants=[policy.grant(managers, {Action.VIEW})],
            phi=False,
        )
