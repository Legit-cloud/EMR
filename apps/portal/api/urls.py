from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("accounts", views.AccountViewSet, basename="portal-account")

urlpatterns = [
    path("home/", views.HomeView.as_view(), name="portal-home"),
    path("appointments/", views.AppointmentsView.as_view(), name="portal-appointments"),
    path("appointment-slots/", views.SlotsView.as_view(), name="portal-slots"),
    path(
        "appointments/<uuid:pk>/cancel/",
        views.AppointmentCancelView.as_view(),
        name="portal-appointment-cancel",
    ),
    path("results/", views.ResultsView.as_view(), name="portal-results"),
    path("results/<uuid:pk>/seen/", views.ResultSeenView.as_view(), name="portal-result-seen"),
    path("prescriptions/", views.PrescriptionsView.as_view(), name="portal-prescriptions"),
    path("invoices/", views.InvoicesView.as_view(), name="portal-invoices"),
    path("invoices/<uuid:pk>/pay/", views.InvoicePayView.as_view(), name="portal-invoice-pay"),
    path(
        "payments/<str:reference>/verify/",
        views.PaymentVerifyView.as_view(),
        name="portal-payment-verify",
    ),
    path("profile/", views.ProfileView.as_view(), name="portal-profile"),
    *router.urls,
]
