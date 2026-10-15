from django.apps import AppConfig


class TenancyAppConfig(AppConfig):
    """Test-only app with tenant-owned models, installed by config.settings.test."""

    name = "tests.tenancy_app"
    label = "tenancy_app"
