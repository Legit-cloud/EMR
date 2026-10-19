from django.apps import AppConfig


class PharmacyConfig(AppConfig):
    name = "apps.pharmacy"
    label = "pharmacy"

    def ready(self):
        from apps.core import events, policy
        from apps.core.policy import Action, Scope
        from apps.core.roles import Role

        from . import tasks
        from .events import PRESCRIPTION_AUTHORISED, PRESCRIPTION_CANCELLED, PRESCRIPTION_DISPENSED
        from .models import Drug, Prescription, StockBatch

        events.subscribe(PRESCRIPTION_AUTHORISED, tasks.reserve_stock_for_prescription)
        events.subscribe(PRESCRIPTION_AUTHORISED, tasks.request_invoice_lines)
        events.subscribe(PRESCRIPTION_DISPENSED, tasks.finalise_invoice_lines)
        events.subscribe(PRESCRIPTION_CANCELLED, tasks.release_cancelled_prescription)

        view, create, update = Action.VIEW, Action.CREATE, Action.UPDATE
        policy.register(
            "pharmacy.drug",
            model=Drug,
            grants=[
                policy.grant({Role.DOCTOR, Role.NURSE, Role.PHARMACIST, Role.TENANT_ADMIN}, {view}),
                policy.grant({Role.PHARMACIST}, {create, update}),
            ],
            phi=False,
        )
        policy.register(
            "pharmacy.stockbatch",
            model=StockBatch,
            grants=[
                policy.grant({Role.PHARMACIST}, {view, create, update}),
                policy.grant({Role.TENANT_ADMIN}, {view}),
            ],
            phi=False,
        )
        policy.register(
            "pharmacy.prescription",
            model=Prescription,
            grants=[
                policy.grant({Role.DOCTOR}, {view, create, update}, Scope.DEPARTMENT),
                policy.grant({Role.NURSE}, {view}, Scope.DEPARTMENT),
                policy.grant({Role.PHARMACIST}, {view, Action.DISPENSE}),
            ],
            facility_field="encounter__facility",
            department_field="encounter__department",
            break_glass=True,
        )
