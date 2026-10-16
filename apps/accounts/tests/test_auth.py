"""Sign-in, bearer tokens, MFA (django-otp TOTP), sign-out and password recovery."""

import re
from datetime import timedelta

import pytest
from django.core import mail
from django_otp.oath import TOTP
from django_otp.plugins.otp_totp.models import TOTPDevice
from rest_framework.test import APIClient

from apps.accounts.models import ApiToken
from apps.audit.models import AuditEntry
from apps.core.roles import Role

pytestmark = pytest.mark.django_db

LOGIN = "/api/accounts/auth/login/"
ME = "/api/accounts/auth/me/"
PASSWORD = "not-a-real-password-123"
RECORDS = "/test-api/records/"


def current_code(device: TOTPDevice) -> str:
    totp = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
    return f"{totp.token():0{device.digits}d}"


@pytest.fixture
def doctor(make_user, tenant_a):
    return make_user("doc", tenant_a, [Role.DOCTOR])


# -- sign-in -----------------------------------------------------------------------


def test_wrong_password_is_refused_and_audited(api_client, doctor):
    response = api_client.post(LOGIN, {"username": "doc", "password": "wrong"}, format="json")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"
    entry = AuditEntry.objects.get(action="login_failed")
    assert entry.details == {"username": "doc"}
    assert entry.outcome == "failed"


def test_session_sign_in_without_device_asks_for_enrolment(api_client, doctor):
    response = api_client.post(LOGIN, {"username": "doc", "password": PASSWORD}, format="json")
    assert response.status_code == 200
    assert response.json()["mfa_enrolment_required"] is True
    assert api_client.get(ME).status_code == 200
    # Signed in, but not allowed near clinical data until MFA is set up.
    assert api_client.get(RECORDS).json()["error"]["code"] == "mfa_required"
    assert AuditEntry.objects.filter(action="login", actor_id=doctor.pk).exists()


def test_sign_in_with_device_needs_a_valid_code(api_client, doctor, otp_device):
    device = otp_device(doctor)
    credentials = {"username": "doc", "password": PASSWORD}
    response = api_client.post(LOGIN, credentials, format="json")
    assert response.json()["error"]["code"] == "mfa_required"
    response = api_client.post(LOGIN, {**credentials, "otp_token": "000000"}, format="json")
    assert response.json()["error"]["code"] == "invalid_otp"

    response = api_client.post(
        LOGIN, {**credentials, "otp_token": current_code(device)}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["mfa_enrolment_required"] is False
    assert api_client.get(RECORDS).status_code == 200


def test_token_sign_in_returns_a_hashed_expiring_token(doctor, otp_device):
    device = otp_device(doctor)
    response = APIClient().post(
        LOGIN,
        {
            "username": "doc",
            "password": PASSWORD,
            "otp_token": current_code(device),
            "mode": "token",
        },
        format="json",
    )
    key = response.json()["token"]
    token = ApiToken.objects.get(user=doctor)
    assert token.mfa_verified is True
    assert key not in (token.key_hash, token.prefix) and token.prefix == key[:8]

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {key}")
    assert client.get(RECORDS).status_code == 200


def test_expired_or_unknown_token_is_rejected(token_client, doctor):
    expired = token_client(doctor, ttl=timedelta(seconds=-1))
    response = expired.get(ME)
    assert response.status_code == 401
    assert response["WWW-Authenticate"] == "Bearer"
    unknown = APIClient()
    unknown.credentials(HTTP_AUTHORIZATION="Bearer not-a-token")
    assert unknown.get(ME).status_code == 401


def test_token_of_deactivated_user_is_rejected(token_client, doctor):
    client = token_client(doctor)
    doctor.is_active = False
    doctor.save()
    assert client.get(ME).status_code == 401


def test_logout_revokes_the_token(token_client, doctor):
    client = token_client(doctor)
    assert client.post("/api/accounts/auth/logout/").status_code == 204
    assert client.get(ME).status_code == 401
    assert AuditEntry.objects.filter(action="logout", actor_id=doctor.pk).exists()


def test_logout_ends_the_session(signed_in, doctor):
    client = signed_in(doctor)
    assert client.post("/api/accounts/auth/logout/").status_code == 204
    assert client.get(ME).status_code in (401, 403)


def test_sign_in_is_rate_limited(api_client, doctor):
    payload = {"username": "doc", "password": "wrong"}
    statuses = [api_client.post(LOGIN, payload, format="json").status_code for _ in range(11)]
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429


def test_me_shows_roles_and_mfa_state(signed_in, doctor):
    body = signed_in(doctor).get(ME).json()
    assert body["roles"] == ["doctor"]
    assert body["mfa_enabled"] is True
    assert body["tenant"] == str(doctor.tenant_id)


# -- MFA enrolment -----------------------------------------------------------------


def test_totp_enrolment_with_a_token_client(token_client, doctor):
    client = token_client(doctor, mfa=False)
    response = client.post("/api/accounts/auth/mfa/totp/enrol/")
    assert response.status_code == 201
    assert response.json()["config_url"].startswith("otpauth://totp/")

    device = TOTPDevice.objects.get(user=doctor, confirmed=False)
    bad = client.post("/api/accounts/auth/mfa/totp/confirm/", {"token": "000000"}, format="json")
    assert bad.json()["error"]["code"] == "invalid_otp"
    response = client.post(
        "/api/accounts/auth/mfa/totp/confirm/", {"token": current_code(device)}, format="json"
    )
    assert response.status_code == 200
    assert client.get(RECORDS).status_code == 200  # the token is now MFA-verified
    assert AuditEntry.objects.filter(action="mfa_confirm", actor_id=doctor.pk).exists()


def test_totp_enrolment_with_a_session_verifies_the_session(signed_in, doctor):
    client = signed_in(doctor, mfa=False)
    client.post("/api/accounts/auth/mfa/totp/enrol/")
    device = TOTPDevice.objects.get(user=doctor, confirmed=False)
    client.post(
        "/api/accounts/auth/mfa/totp/confirm/", {"token": current_code(device)}, format="json"
    )
    assert client.get(RECORDS).status_code == 200


def test_cannot_enrol_twice(signed_in, doctor):
    response = signed_in(doctor).post("/api/accounts/auth/mfa/totp/enrol/")
    assert response.status_code == 400  # signed_in already confirmed a device


# -- password recovery -------------------------------------------------------------


def test_password_reset_does_not_reveal_unknown_addresses(api_client, doctor):
    response = api_client.post(
        "/api/accounts/auth/password-reset/", {"email": "nobody@example.test"}, format="json"
    )
    assert response.status_code == 202
    assert mail.outbox == []


def test_password_reset_end_to_end(
    api_client, token_client, doctor, django_capture_on_commit_callbacks
):
    other_session_token = token_client(doctor)
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(
            "/api/accounts/auth/password-reset/", {"email": "DOC@example.test"}, format="json"
        )
    assert response.status_code == 202
    assert len(mail.outbox) == 1
    uid, token = re.search(r"uid=([^&\s]+)&token=(\S+)", mail.outbox[0].body).groups()

    confirm = "/api/accounts/auth/password-reset/confirm/"
    weak = api_client.post(
        confirm, {"uid": uid, "token": token, "new_password": "123"}, format="json"
    )
    assert weak.status_code == 400
    assert "new_password" in weak.json()["error"]["details"]

    new_password = "a-much-better-passphrase-42"
    payload = {"uid": uid, "token": token, "new_password": new_password}
    assert api_client.post(confirm, payload, format="json").status_code == 204
    doctor.refresh_from_db()
    assert doctor.check_password(new_password)
    assert other_session_token.get(ME).status_code == 401  # tokens revoked
    # The link works once only.
    assert api_client.post(confirm, payload, format="json").status_code == 400
    assert AuditEntry.objects.filter(action="password_reset", actor_id=doctor.pk).exists()


def test_password_reset_with_a_bad_token_fails(api_client, doctor):
    response = api_client.post(
        "/api/accounts/auth/password-reset/confirm/",
        {"uid": "bad", "token": "bad", "new_password": "a-much-better-passphrase-42"},
        format="json",
    )
    assert response.status_code == 400
