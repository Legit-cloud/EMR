from django.apps import AppConfig


class SchedulingConfig(AppConfig):
    name = "apps.scheduling"
    label = "scheduling"

    def ready(self):
        from apps.core import events, policy
        from apps.core.policy import Action, Scope
        from apps.core.roles import Role
        from apps.patients.events import PATIENT_DECEASED

        from .events import APPOINTMENT_COMPLETED
        from .models import Appointment, AvailabilityWindow
        from .tasks import cancel_appointments_for_deceased_patient, charge_consultation_fee

        events.subscribe(PATIENT_DECEASED, cancel_appointments_for_deceased_patient)
        events.subscribe(APPOINTMENT_COMPLETED, charge_consultation_fee)

        view, create, update, remove = Action.VIEW, Action.CREATE, Action.UPDATE, Action.DELETE
        policy.register(
            "scheduling.appointment",
            model=Appointment,
            grants=[
                policy.grant({Role.FRONT_DESK}, {view, create, update}),
                policy.grant({Role.NURSE}, {view, update}, Scope.DEPARTMENT),
                policy.grant({Role.DOCTOR}, {view, update}, Scope.CARE_TEAM),
                policy.grant({Role.DOCTOR}, {view}, Scope.DEPARTMENT),
            ],
            facility_field="facility",
            department_field="department",
        )
        policy.register(
            "scheduling.availabilitywindow",
            model=AvailabilityWindow,
            grants=[
                policy.grant({Role.FRONT_DESK, Role.TENANT_ADMIN}, {view, create, update, remove}),
                policy.grant({Role.DOCTOR, Role.NURSE}, {view}),
            ],
            phi=False,
        )
