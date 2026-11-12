from django.contrib import admin
from django.urls import include, path
from django_otp.admin import OTPAdminSite
from drf_spectacular.views import SpectacularAPIView

from apps.core.api.views import healthz

# The Django admin bypasses the API's policy layer, so it at least requires MFA.
admin.site.__class__ = OTPAdminSite

urlpatterns = [
    path("healthz", healthz, name="healthz"),
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="api-schema"),
    path("api/tenants/", include("apps.tenants.api.urls")),
    path("api/accounts/", include("apps.accounts.api.urls")),
    path("api/audit/", include("apps.audit.api.urls")),
    path("api/patients/", include("apps.patients.api.urls")),
    path("api/clinical/", include("apps.clinical.api.urls")),
    path("api/staff/", include("apps.staff.api.urls")),
    path("api/scheduling/", include("apps.scheduling.api.urls")),
    path("api/pharmacy/", include("apps.pharmacy.api.urls")),
    path("api/billing/", include("apps.billing.api.urls")),
    path("api/inpatient/", include("apps.inpatient.api.urls")),
    path("api/diagnostics/", include("apps.diagnostics.api.urls")),
    path("api/portal/", include("apps.portal.api.urls")),
    path("api/reports/", include("apps.reports.api.urls")),
]
