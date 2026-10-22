from django.apps import AppConfig


class InpatientConfig(AppConfig):
    name = "apps.inpatient"
    label = "inpatient"

    def ready(self):
        from apps.core import events, policy
        from apps.core.policy import Action
        from apps.core.roles import Role

        from . import tasks
        from .events import PATIENT_ADMITTED, PATIENT_DISCHARGED
        from .models import Admission, Bed, Ward

        events.subscribe(PATIENT_ADMITTED, tasks.charge_first_day)
        events.subscribe(PATIENT_DISCHARGED, tasks.finalise_stay)

        view, create, update = Action.VIEW, Action.CREATE, Action.UPDATE
        care = {Role.DOCTOR, Role.NURSE}
        # Wards and beds are set up by the administrator; nurses mark beds ready or out of use.
        policy.register(
            "inpatient.ward",
            model=Ward,
            grants=[
                policy.grant(care | {Role.TENANT_ADMIN}, {view}),
                policy.grant({Role.TENANT_ADMIN}, {create, update}),
            ],
            phi=False,
        )
        policy.register(
            "inpatient.bed",
            model=Bed,
            grants=[
                policy.grant(care | {Role.TENANT_ADMIN}, {view}),
                policy.grant({Role.TENANT_ADMIN}, {create}),
                policy.grant(care, {update}),
            ],
            phi=False,
        )
        # Who is in which bed is clinical information. The care team admits, moves and
        # discharges; the tenant admin looks (ADR 0010).
        policy.register(
            "inpatient.admission",
            model=Admission,
            grants=[
                policy.grant(care | {Role.TENANT_ADMIN}, {view}),
                policy.grant(care, {create, update}),
            ],
        )
