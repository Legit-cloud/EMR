"""Release 1 hardening: PHI kept out of logs and error reports, headers, rate limits,
CSRF, input handling, admin MFA, deployment checks and the OpenAPI schema (SEC-06)."""

import io
import logging
import os
import subprocess
import sys
from pathlib import Path
from unittest import mock

import pytest
from django.conf import settings
from django.core.management import call_command
from rest_framework.test import APIClient
from rest_framework.throttling import UserRateThrottle

from apps.core.redaction import PhiRedactingFilter, redact, scrub_sentry_event
from apps.core.roles import Role

ROOT = Path(__file__).resolve().parent.parent


# -- PHI in logs ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "leaked"),
    [
        ("GET /api/patients/patients/?q=okonkwo HTTP/1.1", "okonkwo"),
        (
            "GET /api/clinical/vitals/?patient=3f2b9c1e-1234-4bcd-9876-123456789012&q=okonkwo",
            "okonkwo",
        ),
        ("sent to ngozi.eze@example.test", "ngozi.eze@example.test"),
        ("sms to +2348031234567 queued", "2348031234567"),
        ("call 0803 123 4567", "0803 123 4567"),
        ("call 0803-123-4567", "0803-123-4567"),
    ],
)
def test_phi_is_redacted(text, leaked):
    assert leaked not in redact(text)


def test_identifiers_survive_redaction():
    line = (
        "patient 3f2b9c1e-1234-4bcd-9876-123456789012 read by 11111111-2222-3333-4444-555555555555"
    )
    assert redact(line) == line


def test_log_handler_writes_redacted_lines():
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(PhiRedactingFilter())
    logger = logging.getLogger("test.redaction")
    logger.addHandler(handler)
    try:
        logger.warning("lookup %s for %s", "/api/patients/patients/?q=Adaeze", "ada@example.test")
    finally:
        logger.removeHandler(handler)
    written = stream.getvalue()
    assert "Adaeze" not in written and "ada@example.test" not in written
    assert "[redacted]" in written and "[email]" in written


def test_every_configured_handler_redacts():
    for name, handler in settings.LOGGING["handlers"].items():
        assert "redact_phi" in handler.get("filters", []), name
    for name in ("uvicorn.access", "gunicorn.access", "celery"):
        assert settings.LOGGING["loggers"][name]["handlers"] == ["console"]


def test_sentry_events_are_scrubbed():
    event = {
        "request": {
            "url": "https://emr.example/api/patients/patients/?q=okonkwo",
            "query_string": "q=okonkwo",
            "data": {"first_name": "Ngozi"},
            "cookies": {"sessionid": "secret"},
            "headers": {"Authorization": "Bearer secret", "User-Agent": "test", "Cookie": "x"},
        },
        "user": {"id": "u1", "email": "doc@example.test", "username": "doc"},
        "exception": {
            "values": [
                {
                    "value": "Patient ngozi@example.test not found",
                    "stacktrace": {"frames": [{"vars": {"patient": "Ngozi Eze"}}]},
                }
            ]
        },
        "breadcrumbs": {"values": [{"message": "sms +2348031234567", "data": {"body": "x"}}]},
    }
    scrubbed = repr(scrub_sentry_event(event))
    for leak in ("okonkwo", "Ngozi", "secret", "doc@example.test", "ngozi@", "2348031234567"):
        assert leak not in scrubbed
    assert event["request"]["headers"] == {"User-Agent": "test"}
    assert event["user"] == {"id": "u1"}


# -- headers, rate limits, CSRF, input -------------------------------------------------


@pytest.mark.django_db
def test_sec_06_security_headers(client):
    response = client.get("/healthz")
    assert "frame-ancestors 'none'" in response["Content-Security-Policy"]
    assert "camera=()" in response["Permissions-Policy"]
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["Cross-Origin-Opener-Policy"] == "same-origin"
    api = client.get("/api/accounts/auth/me/")
    assert api["Cache-Control"] == "no-store"


@pytest.mark.django_db
def test_sec_06_api_requests_are_rate_limited(token_client, user_a):
    client = token_client(user_a)
    with mock.patch.dict(UserRateThrottle.THROTTLE_RATES, {"user": "3/min"}):
        statuses = [client.get("/api/accounts/auth/me/").status_code for _ in range(4)]
    assert statuses == [200, 200, 200, 429]


@pytest.mark.django_db
def test_sec_06_session_sign_in_requires_csrf(user_a):
    credentials = {"username": "alice", "password": "not-a-real-password-123", "mode": "session"}
    client = APIClient(enforce_csrf_checks=True)
    response = client.post("/api/accounts/auth/login/", credentials, format="json")
    assert response.status_code == 403
    token = client.get("/api/accounts/auth/csrf/").json()["csrf_token"]
    response = client.post(
        "/api/accounts/auth/login/", credentials, format="json", HTTP_X_CSRFTOKEN=token
    )
    # Past the CSRF check and the password: the emailed code is the next step.
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "mfa_required"


@pytest.mark.django_db
def test_sec_06_token_sign_in_needs_no_csrf(user_a):
    client = APIClient(enforce_csrf_checks=True)
    response = client.post(
        "/api/accounts/auth/login/",
        {"username": "alice", "password": "not-a-real-password-123", "mode": "token"},
        format="json",
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "mfa_required"


@pytest.mark.django_db
def test_sec_06_malformed_ids_are_not_found(signed_in, user_a):
    client = signed_in(user_a)
    for url in ("/api/patients/patients/not-a-uuid/", "/api/patients/patients/1%27%20OR%201=1/"):
        assert client.get(url).status_code == 404


@pytest.mark.django_db
def test_admin_requires_mfa(make_user, signed_in):
    admin_user = make_user("root", is_staff=True, is_superuser=True)
    assert signed_in(admin_user, mfa=False).get("/admin/").status_code == 302
    assert signed_in(admin_user).get("/admin/").status_code == 200


# -- deployment checks and API description ---------------------------------------------


def test_sec_01_django_deployment_checks_pass_for_production():
    env = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": "config.settings.production",
        "SECRET_KEY": "k8Jq2v-production-like-secret-for-the-check-0f9e8d7c6b5a4z3y2x1w",
        "ALLOWED_HOSTS": "emr.example.com,healthcheck.railway.app",
        "DATABASE_URL": "postgres://user:pass@db:5432/emr",
        "REDIS_URL": "redis://redis:6379/0",
        "PRESCRIPTION_SIGNING_KEY": "cHJvZHVjdGlvbi10ZXN0LWtleS1ub3QtcmVhbC0zMmI=",
    }
    result = subprocess.run(
        [sys.executable, "manage.py", "check", "--deploy", "--fail-level", "WARNING"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.django_db
def test_openapi_schema_is_valid_without_warnings(tmp_path):
    call_command(
        "spectacular", "--validate", "--fail-on-warn", "--file", str(tmp_path / "schema.yml")
    )
    assert "bearerAuth" in (tmp_path / "schema.yml").read_text()


@pytest.mark.django_db
def test_openapi_schema_is_served_to_signed_in_users(signed_in, user_a, api_client):
    assert api_client.get("/api/schema/").status_code == 401
    assert signed_in(user_a).get("/api/schema/").status_code == 200


def test_roles_cover_section_7():
    assert {r.value for r in Role} >= {"doctor", "nurse", "pharmacist", "compliance_officer"}


@pytest.mark.django_db
def test_demo_seed_refuses_without_debug():
    from django.core.management.base import CommandError

    with pytest.raises(CommandError, match="DEBUG"):
        call_command("seed_demo_data", "--password", "x")


@pytest.mark.django_db
def test_demo_seed_creates_synthetic_data(settings):
    from apps.patients.models import Patient

    settings.DEBUG = True
    out = io.StringIO()
    call_command("seed_demo_data", "--password", "demo-pass-123456", "--patients", "5", stdout=out)
    assert Patient.all_tenants.count() == 5
    assert "MFA-verified API token for demo-doctor" in out.getvalue()
