from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("invoices", views.InvoiceViewSet, basename="invoice")
router.register("payments", views.PaymentViewSet, basename="payment")
router.register("insurers", views.InsurerViewSet, basename="insurer")
router.register("ledger/accounts", views.AccountViewSet, basename="ledger-account")
router.register("ledger/entries", views.JournalEntryViewSet, basename="journal-entry")

urlpatterns = router.urls
