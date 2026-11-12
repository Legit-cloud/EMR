from django.apps import AppConfig


class TenancyAppConfig(AppConfig):
    """Test-only app with tenant-owned models, installed by config.settings.test."""

    name = "tests.tenancy_app"
    label = "tenancy_app"

    def ready(self):
        from apps.core import policy
        from apps.core.policy import Action, Scope
        from apps.core.roles import STAFF_ROLES, Role

        from .models import Folder, Record

        policy.register(
            "tenancy_app.folder",
            model=Folder,
            grants=[
                policy.grant(STAFF_ROLES, {Action.VIEW}),
                policy.grant({Role.TENANT_ADMIN}, {Action.CREATE, Action.UPDATE, Action.DELETE}),
                policy.grant({Role.DOCTOR}, {Action.CREATE, Action.UPDATE, Action.DELETE}),
            ],
            phi=False,
        )
        policy.register(
            "tenancy_app.record",
            model=Record,
            grants=[
                policy.grant(
                    {Role.DOCTOR}, {Action.VIEW, Action.CREATE, Action.UPDATE}, Scope.DEPARTMENT
                ),
                policy.grant({Role.NURSE}, {Action.VIEW}, Scope.CARE_TEAM, on_duty=True),
                policy.grant({Role.LAB_TECHNICIAN}, {Action.VIEW}, Scope.FACILITY),
            ],
            facility_field="facility",
            department_field="department",
            break_glass=True,
        )
