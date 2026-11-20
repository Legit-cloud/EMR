"""Email over Resend's HTTPS API (for hosts that block SMTP).
Requirement IDs: SEC-04 (key from the environment), DG-01 (no address in errors)."""

import json
import urllib.error
from unittest import mock

import pytest
from django.core.mail import EmailMessage
from django.test import override_settings

from apps.notifications.backends import ResendBackend, ResendError

SETTINGS = {
    "RESEND_API_KEY": "re_test_key",
    "DEFAULT_FROM_EMAIL": "EMR <no-reply@mail.example.test>",
}


class FakeResponse:
    def __init__(self, status=200):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def send(message, urlopen):
    with mock.patch("urllib.request.urlopen", urlopen):
        return ResendBackend().send_messages([message])


@override_settings(**SETTINGS)
def test_posts_the_message_with_the_key_and_a_timeout():
    seen = {}

    def urlopen(request, timeout):
        seen.update(
            url=request.full_url,
            auth=request.get_header("Authorization"),
            agent=request.get_header("User-agent"),
            body=json.loads(request.data),
            timeout=timeout,
        )
        return FakeResponse()

    message = EmailMessage("Your code", "Code 123456", None, ["ada@example.test"])
    assert send(message, urlopen) == 1
    assert seen["url"] == "https://api.resend.com/emails"
    assert seen["auth"] == "Bearer re_test_key" and seen["agent"] == "emr-mailer/1.0"
    assert seen["timeout"] == 15
    assert seen["body"] == {
        "from": "EMR <no-reply@mail.example.test>",
        "to": ["ada@example.test"],
        "subject": "Your code",
        "text": "Code 123456",
    }


@override_settings(**SETTINGS)
def test_attachments_such_as_the_calendar_file_are_base64_encoded():
    seen = {}
    message = EmailMessage("Booked", "See attached", "x@mail.example.test", ["ada@example.test"])
    message.attach("visit.ics", b"BEGIN:VCALENDAR", "text/calendar")

    def urlopen(request, timeout):
        seen.update(json.loads(request.data))
        return FakeResponse()

    send(message, urlopen)
    assert seen["from"] == "x@mail.example.test"
    assert seen["attachments"] == [{"filename": "visit.ics", "content": "QkVHSU46VkNBTEVOREFS"}]


@override_settings(**SETTINGS)
def test_a_refusal_raises_so_the_task_retries_and_never_echoes_the_address():
    def refuse(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 422, "bad ada@example.test", {}, None)

    message = EmailMessage("s", "b", None, ["ada@example.test"])
    with pytest.raises(ResendError) as caught:
        send(message, refuse)
    assert "422" in str(caught.value) and "ada@example.test" not in str(caught.value)


@override_settings(**SETTINGS)
def test_a_timeout_or_unreachable_host_raises():
    def hang(request, timeout):
        raise TimeoutError("timed out")

    with pytest.raises(ResendError, match="could not be reached"):
        send(EmailMessage("s", "b", None, ["ada@example.test"]), hang)


@override_settings(**SETTINGS)
def test_fail_silently_swallows_the_error_and_counts_nothing():
    def refuse(request, timeout):
        raise urllib.error.URLError("down")

    with mock.patch("urllib.request.urlopen", refuse):
        assert (
            ResendBackend(fail_silently=True).send_messages(
                [EmailMessage("s", "b", None, ["ada@example.test"])]
            )
            == 0
        )


@override_settings(**SETTINGS)
def test_a_message_with_no_recipient_is_skipped():
    called = []
    assert send(EmailMessage("s", "b", None, []), lambda *a, **k: called.append(1)) == 0
    assert called == []


def test_the_key_switches_the_backend_and_smtp_has_a_timeout():
    import importlib
    import os

    import config.settings.base as base

    try:
        with mock.patch.dict(os.environ, {"RESEND_API_KEY": "re_x"}):
            with_key = importlib.reload(base)
            assert with_key.EMAIL_BACKEND == "apps.notifications.backends.ResendBackend"
            assert with_key.EMAIL_TIMEOUT == 15
        with mock.patch.dict(os.environ, {"RESEND_API_KEY": "", "EMAIL_URL": "consolemail://"}):
            without = importlib.reload(base)
            assert without.EMAIL_BACKEND == "django.core.mail.backends.console.EmailBackend"
    finally:
        importlib.reload(base)
