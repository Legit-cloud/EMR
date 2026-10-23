from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views, webhooks

router = SimpleRouter()
router.register("invoices", views.InvoiceViewSet, basename="invoice")
router.register("payments", views.PaymentViewSet, basename="payment")
router.register("payment-intents", views.PaymentIntentViewSet, basename="payment-intent")
router.register("insurers", views.InsurerViewSet, basename="insurer")
router.register("ledger/accounts", views.AccountViewSet, basename="ledger-account")
router.register("ledger/entries", views.JournalEntryViewSet, basename="journal-entry")

urlpatterns = [
    path("webhooks/paystack/", webhooks.PaystackWebhookView.as_view(), name="paystack-webhook"),
    *router.urls,
]
