from django.apps import AppConfig


class SchedulingConfig(AppConfig):
    name = "apps.scheduling"
    label = "scheduling"

    def ready(self):
        from apps.core import events
        from apps.patients.events import PATIENT_DECEASED

        from .tasks import cancel_appointments_for_deceased_patient

        events.subscribe(PATIENT_DECEASED, cancel_appointments_for_deceased_patient)
