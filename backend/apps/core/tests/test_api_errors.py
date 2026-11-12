import pytest
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404
from rest_framework import exceptions

from apps.core.api.exceptions import api_exception_handler
from apps.core.errors import DomainError, HardDeleteNotAllowed


def handle(exc):
    return api_exception_handler(exc, {})


def test_validation_errors_keep_field_details():
    response = handle(exceptions.ValidationError({"name": ["This field is required."]}))
    assert response.status_code == 400
    assert response.data == {
        "error": {
            "code": "validation_error",
            "message": "Invalid input.",
            "details": {"name": ["This field is required."]},
        }
    }


def test_non_field_validation_errors():
    response = handle(exceptions.ValidationError(["Bad combination."]))
    assert response.data["error"]["details"] == {"non_field_errors": ["Bad combination."]}


@pytest.mark.parametrize(
    ("exc", "status", "code"),
    [
        (exceptions.NotAuthenticated(), 401, "not_authenticated"),
        (exceptions.PermissionDenied(), 403, "permission_denied"),
        (exceptions.NotFound(), 404, "not_found"),
        (Http404(), 404, "not_found"),
        (DjangoPermissionDenied(), 403, "permission_denied"),
        (exceptions.MethodNotAllowed("POST"), 405, "method_not_allowed"),
    ],
)
def test_standard_errors_have_stable_codes(exc, status, code):
    response = handle(exc)
    assert response.status_code == status
    assert response.data["error"]["code"] == code
    assert set(response.data["error"]) == {"code", "message", "details"}


def test_throttled_reports_retry_after():
    response = handle(exceptions.Throttled(wait=30))
    assert response.status_code == 429
    assert response.data["error"]["details"] == {"retry_after_seconds": 30}


def test_domain_errors_use_their_own_code_and_status():
    response = handle(HardDeleteNotAllowed())
    assert response.status_code == 409
    assert response.data["error"]["code"] == "hard_delete_not_allowed"

    response = handle(DomainError("Slot taken", details={"slot": "x"}))
    assert response.status_code == 400
    assert response.data["error"] == {
        "code": "domain_error",
        "message": "Slot taken",
        "details": {"slot": "x"},
    }


def test_unexpected_exceptions_are_not_formatted():
    assert handle(RuntimeError("internal detail")) is None
