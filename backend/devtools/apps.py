from django.apps import AppConfig


class DevtoolsConfig(AppConfig):
    """Development-only tooling (demo data). Installed by local and test settings only."""

    name = "devtools"
    label = "devtools"
