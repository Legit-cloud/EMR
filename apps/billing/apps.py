from django.apps import AppConfig


class BillingConfig(AppConfig):
    name = "apps.billing"
    label = "billing"

    def ready(self):
        from apps.core import events
        from apps.patients.events import PATIENT_DECEASED

        from .tasks import flag_invoices_for_estate_review

        events.subscribe(PATIENT_DECEASED, flag_invoices_for_estate_review)
