"""Self-service sign-up: an emailed code proves the mailbox, then the organisation, its first
administrator and a first facility are created together and the person is signed in.

Nothing is created before the code is entered, an address that already has an account is never
revealed, and codes are stored hashed with an expiry and a limited number of tries.
"""

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.utils import timezone

from apps.accounts import services as accounts
from apps.audit import services as audit
from apps.core.errors import DomainError
from apps.core.tenancy import tenant_context
from apps.notifications import services as notifications
from apps.tenants import services as tenants

from .models import OnboardingProfile, Signup

messages = notifications.messages  # the words of each email, kept in the notifications module

MAX_ATTEMPTS = 5


class SignupError(DomainError):
    code = "signup_refused"
    status_code = 400


class SignupClosed(DomainError):
    code = "signup_closed"
    status_code = 403


class InvalidCode(DomainError):
    """One message for a wrong, expired or used-up code, so nothing leaks."""

    code = "invalid_code"
    status_code = 400


def _new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _send_code(signup: Signup, code: str) -> None:
    notifications.queue_untracked_message(
        to=signup.email,
        message=messages.signup_code(
            signup.first_name,
            code,
            max(1, settings.SIGNUP_CODE_TTL_MINUTES),
            signup.organisation_name,
        ),
    )


def _tell_existing_owner(email: str, first_name: str) -> None:
    notifications.queue_untracked_message(to=email, message=messages.already_registered(first_name))


@transaction.atomic
def start_signup(
    *,
    email: str,
    first_name: str,
    last_name: str,
    organisation_name: str,
    password: str,
    accepted_terms: bool,
) -> None:
    """Record the request and email a code. Answers the same whether or not the address is
    already registered, so the form cannot be used to find out who has an account."""
    if not settings.SELF_SIGNUP_ENABLED:
        raise SignupClosed("Sign-up is not open. Ask us for an invitation.")
    if not accepted_terms:
        raise SignupError("Accept the terms and the privacy notice to continue.")
    email = email.strip().lower()
    validate_password(password)
    if accounts.email_in_use(email):
        _tell_existing_owner(email, first_name)
        return
    Signup.objects.filter(email__iexact=email).delete()
    code = _new_code()
    now = timezone.now()
    signup = Signup.objects.create(
        email=email,
        first_name=first_name.strip(),
        last_name=last_name.strip(),
        organisation_name=organisation_name.strip(),
        password_hash=make_password(password),
        code_hash=make_password(code),
        code_expires_at=now + timedelta(minutes=settings.SIGNUP_CODE_TTL_MINUTES),
        code_sent_at=now,
        terms_accepted_at=now,
    )
    _send_code(signup, code)


@transaction.atomic
def resend_code(*, email: str) -> None:
    """A fresh code for a pending request, at most once a minute. Silent for unknown addresses."""
    signup = Signup.objects.select_for_update().filter(email__iexact=email.strip()).first()
    if signup is None:
        return
    now = timezone.now()
    if now - signup.code_sent_at < timedelta(seconds=settings.SIGNUP_RESEND_SECONDS):
        return
    code = _new_code()
    signup.code_hash = make_password(code)
    signup.code_expires_at = now + timedelta(minutes=settings.SIGNUP_CODE_TTL_MINUTES)
    signup.code_sent_at = now
    signup.attempts = 0
    signup.save()
    _send_code(signup, code)


def verify_signup(request, *, email: str, code: str):
    """Check the code; on success create the organisation and its administrator and sign them
    in. Returns the new user."""
    refused = InvalidCode("That code is not valid. Request a new one.")
    signup = Signup.objects.filter(email__iexact=email.strip()).first()
    if signup is None or signup.attempts >= MAX_ATTEMPTS:
        raise refused
    if signup.code_expires_at < timezone.now():
        raise InvalidCode("That code has expired. Request a new one.")
    if not check_password(code.strip(), signup.code_hash):
        # Counted outside the creation transaction below, so a wrong guess is always recorded.
        Signup.objects.filter(pk=signup.pk).update(attempts=signup.attempts + 1)
        raise refused
    with transaction.atomic():
        # Two requests with the right code at once: only the one that still finds the row wins.
        signup = Signup.objects.select_for_update().filter(pk=signup.pk).first()
        if signup is None or accounts.email_in_use(signup.email):
            raise refused
        tenant, _facility = tenants.create_organisation(name=signup.organisation_name)
        user = accounts.create_tenant_admin(
            tenant_id=tenant.id,
            email=signup.email,
            first_name=signup.first_name,
            last_name=signup.last_name,
            password_hash=signup.password_hash,
        )
        with tenant_context(tenant.id, user.pk):
            OnboardingProfile.objects.create(facility_name=signup.organisation_name)
            audit.record(
                action=audit.AuditAction.CREATE,
                request=request,
                actor=user,
                resource="onboarding.signup",
                object_id=str(tenant.id),
                details={"terms_accepted_at": signup.terms_accepted_at.isoformat()},
            )
        signup.delete()
    accounts.start_session(request, user, how="signup")
    return user


# -- the onboarding questions --------------------------------------------------------------

REQUIRED_TO_COMPLETE = ("facility_name", "facility_type", "staff_band", "phone")


class OnboardingIncomplete(DomainError):
    code = "onboarding_incomplete"
    status_code = 400


@transaction.atomic
def save_answers(profile: OnboardingProfile, answers: dict) -> OnboardingProfile:
    for field, value in answers.items():
        setattr(profile, field, value)
    profile.save()
    return profile


@transaction.atomic
def complete(profile: OnboardingProfile) -> OnboardingProfile:
    """Set up the facility and departments from the answers. Safe to call again."""
    missing = [f for f in REQUIRED_TO_COMPLETE if not getattr(profile, f)]
    if missing:
        raise OnboardingIncomplete("Answer every required question before finishing.")
    tenants.rename_organisation_facility(name=profile.facility_name)
    tenants.ensure_departments(list(profile.departments))
    if profile.completed_at is None:
        profile.completed_at = timezone.now()
        profile.save()
    return profile
