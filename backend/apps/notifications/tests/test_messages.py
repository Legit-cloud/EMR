"""The look and words of every email.
Requirement IDs: SEC-06 (nothing injected into HTML), DG-01 (no clinical detail), SEC-04."""

import inspect
import json
from unittest import mock

import pytest
from django.core import mail
from django.test import override_settings

from apps.notifications import layout, messages
from apps.notifications.backends import ResendBackend
from apps.notifications.layout import Email
from apps.notifications.tasks import deliver_untracked_email

SAMPLES = {
    "signup_code": ("Ada", "123456", 15, "Sunrise Clinic"),
    "already_registered": ("Ada",),
    "sign_in_code": ("Ada", "654321", 5),
    "staff_invitation": ("Ada", "Sunrise Clinic", "Nurse", "https://app.example.test/x", 24),
    "patient_invitation": ("Ada", "Sunrise Clinic", "https://app.example.test/x", 24),
    "password_reset": ("Ada", "https://app.example.test/x", 24),
    "appointment_confirmed": ("Ada", "Dr Bello", "Mon 3 Dec, 10:00", "Main", "AB12CD34", False),
    "appointment_reminder": ("Ada", "Dr Bello", "Mon 3 Dec, 10:00"),
    "new_message": (),
    "leave_decision": ("Ada", "Annual leave", "1 Dec 2026", "3 Dec 2026", True, "Enjoy"),
    "licence_alert": ("Dr Bello", "MDCN", True, "01 December 2026"),
    "payment_reminder": ("Ada", "₦5,000.00", "INV-1", True),
    "payment_flagged": ("ref_1", "INV-1", "Amount differs"),
    "purchase_order": ("Acme Pharma", "Sunrise Clinic", "PO-1", [("Paracetamol", 100)], "Urgent"),
    "critical_result": ("Malaria test for patient 2026/0001",),
    "result_corrected": ("Malaria test for patient 2026/0001",),
    "data_request_received": ("Ada", "access request", "20 December 2026"),
    "data_request_answered": ("Ada", "access request"),
    "data_request_staff": ("access request", "20 December 2026"),
}


def test_every_email_has_a_sample_here():
    builders = {
        name
        for name, f in inspect.getmembers(messages, inspect.isfunction)
        if f.__module__ == messages.__name__ and not name.startswith("_") and name != "link"
    }
    assert builders == set(SAMPLES), "add a sample for each new email"


@pytest.mark.parametrize("name", sorted(SAMPLES))
def test_each_email_has_a_subject_plain_text_and_styled_html(name):
    email = getattr(messages, name)(*SAMPLES[name])
    assert isinstance(email, Email) and email.subject.strip()
    assert email.text.strip() and email.html.startswith("<!doctype html>")
    assert layout.brand() in email.html and "sans-serif" in email.html
    # Every email can be read without the styling too.
    assert "<" not in email.text.replace("<br>", "")


@pytest.mark.parametrize("name", sorted(SAMPLES))
def test_links_come_from_the_web_apps_address_never_localhost(name):
    email = getattr(messages, name)(*SAMPLES[name])
    for body in (email.text, email.html):
        assert "localhost" not in body and "127.0.0.1" not in body


def test_the_sign_in_code_is_shown_big_and_in_the_text():
    email = messages.sign_in_code("Ada", "654321", 5)
    assert "654321" in email.text and "letter-spacing" in email.html
    assert "5 minutes" in email.text and "forgot-password" in email.text


def test_the_button_has_a_plain_link_under_it():
    email = messages.password_reset("Ada", "https://app.example.test/reset?a=1&b=2", 24)
    assert 'href="https://app.example.test/reset?a=1&amp;b=2"' in email.html
    assert "copy this address" in email.html
    assert "https://app.example.test/reset?a=1&b=2" in email.text


def test_dynamic_text_cannot_inject_html():
    email = messages.leave_decision(
        '<script>alert("x")</script>', "<b>Annual</b>", "1", "2", False, "<img src=x onerror=y>"
    )
    assert "<script>" not in email.html and "<img src=x" not in email.html
    assert "&lt;script&gt;" in email.html


def test_the_invitation_names_the_organisation_and_the_role():
    email = messages.staff_invitation("Ada", "Sunrise Clinic", "Nurse", "https://x.test/p", 24)
    assert "Sunrise Clinic" in email.subject and "Nurse" in email.text
    assert "24 hours" in email.text and "sign in with this email address" in email.text.lower()


def test_dg_01_critical_result_emails_carry_no_result_value():
    email = messages.critical_result("Malaria test for patient 2026/0001")
    assert "never sent by email" in email.text


@override_settings(FRONTEND_URL="https://emr.example.org/")
def test_the_trailing_slash_of_the_web_address_is_ignored():
    assert messages.link("/messages") == "https://emr.example.org/messages"


def test_a_message_without_a_first_name_still_reads_well():
    assert "Hello," in messages.sign_in_code("", "111111", 5).text


# -- delivery ----------------------------------------------------------------------------------


def test_delivery_sends_plain_text_with_the_styled_version_beside_it():
    email = messages.sign_in_code("Ada", "111111", 5)
    deliver_untracked_email("ada@example.test", email.subject, email.text, email.html)
    sent = mail.outbox[0]
    assert sent.body == email.text
    assert sent.alternatives == [(email.html, "text/html")]


def test_delivery_without_html_stays_plain():
    deliver_untracked_email("ada@example.test", "s", "b")
    assert getattr(mail.outbox[0], "alternatives", []) == []


@override_settings(RESEND_API_KEY="re_test_key", DEFAULT_FROM_EMAIL="EMR <no-reply@x.test>")
def test_resend_receives_the_html_too():
    seen = {}

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def urlopen(request, timeout):
        seen.update(json.loads(request.data))
        return Response()

    email = messages.sign_in_code("Ada", "111111", 5)
    message = mail.EmailMultiAlternatives(email.subject, email.text, None, ["ada@example.test"])
    message.attach_alternative(email.html, "text/html")
    with mock.patch("urllib.request.urlopen", urlopen):
        ResendBackend().send_messages([message])
    assert seen["html"] == email.html and seen["text"] == email.text
