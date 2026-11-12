from django.apps import AppConfig


class DiagnosticsConfig(AppConfig):
    name = "apps.diagnostics"
    label = "diagnostics"

    def ready(self):
        from apps.core import events, policy
        from apps.core.policy import Action
        from apps.core.roles import Role

        from . import tasks
        from .events import CANCELLED, ORDERED, RESULT_CORRECTED, RESULTED
        from .models import DiagnosticOrder, DiagnosticResult, Investigation

        events.subscribe(ORDERED, tasks.request_invoice_line)
        events.subscribe(RESULTED, tasks.finalise_invoice_line)
        events.subscribe(RESULTED, tasks.alert_critical_result)
        events.subscribe(CANCELLED, tasks.void_invoice_line)
        events.subscribe(RESULT_CORRECTED, tasks.notify_correction)

        view, create, update = Action.VIEW, Action.CREATE, Action.UPDATE
        care = {Role.DOCTOR, Role.NURSE}
        lab = {Role.LAB_TECHNICIAN}
        # What the facility offers and its prices: set up by the administrator, read by the
        # people who order, perform and bill.
        policy.register(
            "diagnostics.investigation",
            model=Investigation,
            grants=[
                policy.grant(
                    care | lab | {Role.TENANT_ADMIN, Role.BILLING_OFFICER, Role.FINANCE}, {view}
                ),
                policy.grant({Role.TENANT_ADMIN}, {create, update}),
            ],
            phi=False,
        )
        # Doctors order. Doctors and technicians cancel an order or mark the sample taken.
        policy.register(
            "diagnostics.order",
            model=DiagnosticOrder,
            grants=[
                policy.grant(care | lab | {Role.TENANT_ADMIN}, {view}),
                policy.grant({Role.DOCTOR}, {create}),
                policy.grant({Role.DOCTOR} | lab, {update}),
            ],
        )
        # Technicians record and correct results; a doctor signs them off (APPROVE), so the
        # person who typed a result is never the one who releases it to the patient.
        policy.register(
            "diagnostics.result",
            model=DiagnosticResult,
            grants=[
                policy.grant(care | lab | {Role.TENANT_ADMIN}, {view}),
                policy.grant(lab, {create, update}),
                policy.grant({Role.DOCTOR}, {Action.APPROVE}),
            ],
        )
