from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView

from apps.core.api.views import healthz

urlpatterns = [
    path("healthz", healthz, name="healthz"),
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="api-schema"),
    path("api/accounts/", include("apps.accounts.api.urls")),
    path("api/audit/", include("apps.audit.api.urls")),
    path("api/patients/", include("apps.patients.api.urls")),
]
