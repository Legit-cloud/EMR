from django.apps import AppConfig


class BillingConfig(AppConfig):
    name = "apps.billing"
    label = "billing"

    def ready(self):
        from apps.core import events, policy
        from apps.core.policy import Action
        from apps.core.roles import Role
        from apps.patients.events import PATIENT_DECEASED

        from . import events as billing_events  # noqa: F401  (defines invoice.paid)
        from .models import Account, Insurer, Invoice, JournalEntry, Payment, PaymentIntent
        from .tasks import flag_invoices_for_estate_review

        events.subscribe(PATIENT_DECEASED, flag_invoices_for_estate_review)

        view, create, update = Action.VIEW, Action.CREATE, Action.UPDATE
        policy.register(
            "billing.invoice",
            model=Invoice,
            grants=[
                policy.grant({Role.BILLING_OFFICER}, {view, update}),
                policy.grant({Role.FINANCE, Role.FRONT_DESK, Role.TENANT_ADMIN}, {view}),
            ],
        )
        policy.register(
            "billing.payment",
            model=Payment,
            grants=[policy.grant({Role.BILLING_OFFICER, Role.FINANCE, Role.TENANT_ADMIN}, {view})],
        )
        policy.register(
            "billing.insurer",
            model=Insurer,
            grants=[
                policy.grant({Role.BILLING_OFFICER, Role.TENANT_ADMIN}, {view, create, update}),
                policy.grant({Role.FRONT_DESK, Role.FINANCE}, {view}),
            ],
            phi=False,
        )
        policy.register(
            "billing.ledger",
            model=Account,
            grants=[policy.grant({Role.FINANCE, Role.TENANT_ADMIN}, {view})],
            phi=False,
        )
        policy.register(
            "billing.journalentry",
            model=JournalEntry,
            grants=[policy.grant({Role.FINANCE, Role.TENANT_ADMIN}, {view})],
            phi=False,
        )
        # Online payments the gateway took, including any that need finance review.
        policy.register(
            "billing.paymentintent",
            model=PaymentIntent,
            grants=[policy.grant({Role.BILLING_OFFICER, Role.FINANCE, Role.TENANT_ADMIN}, {view})],
        )
