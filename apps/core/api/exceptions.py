"""Standard API error format.

Every error response has the same shape::

    {"error": {"code": "validation_error", "message": "...", "details": {...}}}

``code`` is stable and machine-readable; ``message`` is for people; ``details`` carries
field errors or extra context. Unexpected exceptions are not formatted here and become a
plain 500 so no internals leak.
"""

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from apps.core.errors import DomainError

_CODES = {
    exceptions.ValidationError: "validation_error",
    exceptions.ParseError: "parse_error",
    exceptions.NotAuthenticated: "not_authenticated",
    exceptions.AuthenticationFailed: "authentication_failed",
    exceptions.PermissionDenied: "permission_denied",
    exceptions.NotFound: "not_found",
    exceptions.MethodNotAllowed: "method_not_allowed",
    exceptions.NotAcceptable: "not_acceptable",
    exceptions.UnsupportedMediaType: "unsupported_media_type",
    exceptions.Throttled: "throttled",
}


def error_body(code: str, message: str, details=None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def api_exception_handler(exc, context):
    if isinstance(exc, DomainError):
        return Response(error_body(exc.code, exc.message, exc.details), status=exc.status_code)

    if isinstance(exc, DjangoValidationError):
        # Model rules raised outside a serializer (for example in a service).
        from .serializers import _as_detail

        exc = exceptions.ValidationError(_as_detail(exc))

    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()

    code = next((c for cls, c in _CODES.items() if isinstance(exc, cls)), "error")
    # Subclasses such as MFARequired carry a more specific code on their detail.
    detail_code = getattr(getattr(exc, "detail", None), "code", None)
    if isinstance(detail_code, str) and detail_code not in ("invalid", "error"):
        code = detail_code
    if isinstance(exc, exceptions.ValidationError):
        detail = exc.detail
        details = detail if isinstance(detail, dict) else {"non_field_errors": detail}
        message = "Invalid input."
    else:
        details = {}
        message = str(exc.detail) if hasattr(exc, "detail") else str(exc)
    if response.status_code == status.HTTP_429_TOO_MANY_REQUESTS and getattr(exc, "wait", None):
        details = {"retry_after_seconds": int(exc.wait)}
    response.data = error_body(code, message, details)
    return response
