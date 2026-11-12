"""OpenAPI description of the bearer-token authentication (drf-spectacular extension)."""

from drf_spectacular.extensions import OpenApiAuthenticationExtension


class ApiTokenScheme(OpenApiAuthenticationExtension):
    target_class = "apps.accounts.authentication.ApiTokenAuthentication"
    name = "bearerAuth"

    def get_security_definition(self, auto_schema):
        return {
            "type": "http",
            "scheme": "bearer",
            "description": "Hashed, expiring token from /api/accounts/auth/login/ (mode=token).",
        }
