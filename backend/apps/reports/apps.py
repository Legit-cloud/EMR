from django.apps import AppConfig


class ReportsConfig(AppConfig):
    """Dashboard figures. Owns no tables: it combines totals from other modules' selectors."""

    name = "apps.reports"
    label = "reports"
