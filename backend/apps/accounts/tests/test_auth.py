"""Sign-in with an emailed one-time code, bearer tokens, sign-out and password recovery."""

import re
from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone
from django_otp.plugins.otp_email.models import EmailDevice
from rest_framework.test import APIClient

from apps.accounts.models import ApiToken
from apps.audit.models import AuditEntry
from apps.core.roles import Role

pytestmark = pytest.mark.django_db

LOGIN = "/api/accounts/auth/login/"
ME = "/api/accounts/auth/me/"
PASSWORD = "not-a-real-password-123"
RECORDS = "/test-api/records/"
CREDENTIALS = {"username": "doc", "password": PASSWORD}


@pytest.fixture
def request_code(api_client, django_capture_on_commit_callbacks):
    """Post the password alone, which emails a code, and return that code."""

    def request(client=None, credentials=CREDENTIALS):
        with django_capture_on_commit_callbacks(execute=True):
            response = (client or api_client).post(LOGIN, credentials, format="json")
        assert response.json()["error"]["code"] == "mfa_required"
        return re.search(r"code is (\d{6})", mail.outbox[-1].body).group(1)

    return request


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


def test_sign_in_needs_the_emailed_code_even_on_a_first_sign_in(api_client, doctor, request_code):
    assert not EmailDevice.objects.filter(user=doctor).exists()
    code = request_code()
    assert mail.outbox[-1].to == ["doc@example.test"]
    assert EmailDevice.objects.filter(user=doctor, confirmed=True).exists()
    # The password alone signs nobody in.
    assert api_client.get(ME).status_code in (401, 403)

    response = api_client.post(LOGIN, {**CREDENTIALS, "otp_token": code}, format="json")
    assert response.status_code == 200
    assert api_client.get(RECORDS).status_code == 200
    entry = AuditEntry.objects.get(action="login", actor_id=doctor.pk)
    assert entry.details["mfa"] is True


def test_a_wrong_code_is_refused_and_audited(api_client, doctor, request_code):
    request_code()
    response = api_client.post(LOGIN, {**CREDENTIALS, "otp_token": "000000"}, format="json")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_otp"
    assert AuditEntry.objects.filter(action="login_failed", reason="invalid_otp").exists()
    assert api_client.get(RECORDS).status_code in (401, 403)


def test_a_code_works_once(api_client, doctor, request_code):
    code = request_code()
    signed = {**CREDENTIALS, "otp_token": code}
    assert api_client.post(LOGIN, signed, format="json").status_code == 200
    again = APIClient().post(LOGIN, signed, format="json")
    assert again.json()["error"]["code"] == "invalid_otp"


def test_an_expired_code_is_refused(api_client, doctor, request_code):
    code = request_code()
    EmailDevice.objects.filter(user=doctor).update(
        valid_until=timezone.now() - timedelta(seconds=1)
    )
    response = api_client.post(LOGIN, {**CREDENTIALS, "otp_token": code}, format="json")
    assert response.json()["error"]["code"] == "invalid_otp"


def test_a_second_request_inside_the_cooldown_sends_no_new_code(
    api_client, doctor, request_code, settings, django_capture_on_commit_callbacks
):
    settings.OTP_EMAIL_COOLDOWN_DURATION = 60
    code = request_code()
    with django_capture_on_commit_callbacks(execute=True):
        api_client.post(LOGIN, CREDENTIALS, format="json")
    assert len(mail.outbox) == 1
    # The earlier code still works.
    response = api_client.post(LOGIN, {**CREDENTIALS, "otp_token": code}, format="json")
    assert response.status_code == 200


def test_an_account_without_an_email_cannot_get_a_code(api_client, make_user, tenant_a):
    make_user("nomail", tenant_a, [Role.DOCTOR], email="")
    response = api_client.post(LOGIN, {"username": "nomail", "password": PASSWORD}, format="json")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "no_email"
    assert mail.outbox == []


def test_token_sign_in_returns_a_hashed_expiring_token(doctor, request_code):
    code = request_code(APIClient(), {**CREDENTIALS, "mode": "token"})
    response = APIClient().post(
        LOGIN, {**CREDENTIALS, "otp_token": code, "mode": "token"}, format="json"
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
