"""Account operations: sign-in, tokens, password recovery, break-glass, invitations."""

from datetime import timedelta

import django_otp
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.db import transaction
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django_otp.plugins.otp_email.models import EmailDevice

from apps.audit import services as audit
from apps.core import policy
from apps.core.errors import DomainError
from apps.core.tenancy import tenant_context
from apps.notifications import services as notifications

from . import selectors
from .models import ApiToken, BreakGlassGrant, BreakGlassReview, User


class AuthError(DomainError):
    code = "invalid_credentials"
    status_code = 401


class MFARequiredError(AuthError):
    """A sign-in code has been emailed and must be sent back with the password."""

    code = "mfa_required"


class InvalidOTP(AuthError):
    """The one-time code is not valid."""

    code = "invalid_otp"


class NoSignInEmail(AuthError):
    """The account has no email address to send a sign-in code to."""

    code = "no_email"


class BreakGlassError(DomainError):
    code = "break_glass_refused"
    status_code = 403


# -- sign-in ---------------------------------------------------------------------


def _sign_in_device(user: User) -> EmailDevice:
    """The user's email device, created on first sign-in so every account uses a code."""
    if not user.email:
        raise NoSignInEmail("This account has no email address for sign-in codes.")
    device = selectors.confirmed_device(user)
    if device is None:
        device = EmailDevice.objects.create(user=user, name="Email", confirmed=True)
    return device


def _send_sign_in_code(user: User, device: EmailDevice) -> None:
    """Email a fresh code. Does nothing while the previous code is still recent."""
    allowed, _ = device.generate_is_allowed()
    if not allowed:
        return
    device.cooldown_set(commit=False)
    device.generate_token(valid_secs=settings.OTP_EMAIL_TOKEN_VALIDITY, commit=True)
    minutes = max(1, settings.OTP_EMAIL_TOKEN_VALIDITY // 60)
    _queue_email(
        user,
        subject="Your sign-in code",
        body=(
            f"Your sign-in code is {device.token}\n\n"
            f"It works for {minutes} minutes and only once. "
            "If you did not try to sign in, change your password."
        ),
        purpose="login_code",
    )


def sign_in(request, *, username: str, password: str, otp_token: str = "", mode: str):
    """Check the password, then the emailed code. Returns (user, raw_token or None).

    Without a code, one is emailed and ``MFARequiredError`` is raised; the client then
    sends the password again together with the code.
    """
    user = authenticate(request, username=username, password=password)
    if user is None:
        audit.record(
            action=audit.AuditAction.LOGIN_FAILED,
            outcome=audit.AuditOutcome.FAILED,
            request=request,
            tenant_id=None,
            details={"username": username[:150]},
        )
        raise AuthError("Invalid username or password.")

    device = _sign_in_device(user)
    if not otp_token:
        _send_sign_in_code(user, device)
        raise MFARequiredError()
    if not device.verify_token(otp_token.strip()):
        audit.record(
            action=audit.AuditAction.LOGIN_FAILED,
            outcome=audit.AuditOutcome.FAILED,
            request=request,
            actor=user,
            reason="invalid_otp",
        )
        raise InvalidOTP()

    raw_token = None
    if mode == "token":
        _, raw_token = ApiToken.issue(
            user, ttl=timedelta(minutes=settings.API_TOKEN_TTL_MINUTES), mfa_verified=True
        )
    else:
        login(request, user)
        django_otp.login(request, device)
    audit.record(
        action=audit.AuditAction.LOGIN,
        request=request,
        actor=user,
        details={"mode": mode, "mfa": True},
    )
    return user, raw_token


def sign_out(request) -> None:
    user = request.user
    if isinstance(request.auth, ApiToken):
        ApiToken.objects.filter(pk=request.auth.pk).update(revoked_at=timezone.now())
    else:
        logout(request)
    audit.record(action=audit.AuditAction.LOGOUT, request=request, actor=user)


# -- password recovery and invitations -------------------------------------------


def _queue_email(user: User, *, subject: str, body: str, purpose: str) -> None:
    """Queue the email; a slow or unreachable mail server never fails the request.

    The delivery log keeps only a masked address and the purpose, never the body.
    """
    if user.tenant_id is None:
        # Platform staff have no tenant to log the delivery under.
        notifications.queue_untracked_email(to=user.email, subject=subject, body=body)
        return
    with tenant_context(user.tenant_id, user.pk):
        notifications.queue_email(
            to=user.email,
            subject=subject,
            body=body,
            purpose=purpose,
            related_object=f"accounts.user:{user.pk}",
        )


def _send_password_link(user: User, subject: str) -> None:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    link = settings.PASSWORD_RESET_URL.format(uid=uid, token=token)
    body = (
        f"Use this link to set your password:\n\n{link}\n\n"
        "If you did not expect this message, ignore it."
    )
    _queue_email(user, subject=subject, body=body, purpose="password_link")


def request_password_reset(request, email: str) -> None:
    """Send a reset link if the address matches an active user. Never reveals whether it did."""
    users = list(User.objects.filter(email__iexact=email.strip(), is_active=True))
    for user in users:
        _send_password_link(user, "Reset your password")
    audit.record(
        action=audit.AuditAction.PASSWORD_RESET_REQUEST,
        request=request,
        actor=users[0] if len(users) == 1 else None,
        tenant_id=users[0].tenant_id if len(users) == 1 else None,
        details={"matched": len(users)},
    )


def reset_password(request, *, uid: str, token: str, new_password: str) -> User:
    try:
        user = User.objects.get(pk=force_str(urlsafe_base64_decode(uid)), is_active=True)
    except (User.DoesNotExist, ValueError, TypeError, OverflowError):
        user = None
    if user is None or not default_token_generator.check_token(user, token):
        raise DomainError("This link is invalid or has expired.")
    validate_password(new_password, user)
    with transaction.atomic():
        user.set_password(new_password)
        user.save(update_fields=["password"])
        ApiToken.objects.filter(user=user, revoked_at__isnull=True).update(
            revoked_at=timezone.now()
        )
        audit.record(action=audit.AuditAction.PASSWORD_RESET, request=request, actor=user)
    return user


def invite_user(user: User) -> None:
    """New users get no password; they set one through an emailed link."""
    if user.email:
        _send_password_link(user, "You have been invited")


def deactivate_user(user: User) -> None:
    with transaction.atomic():
        user.is_active = False
        user.save(update_fields=["is_active"])
        ApiToken.objects.filter(user=user, revoked_at__isnull=True).update(
            revoked_at=timezone.now()
        )


# -- break-glass -----------------------------------------------------------------


def request_break_glass(
    request, *, resource_name: str, object_id: str, reason: str
) -> BreakGlassGrant:
    """Open one record outside the user's scope for a limited time, with a logged reason."""
    resource = policy.get_resource(resource_name)
    user = request.user
    if not resource.break_glass:
        raise BreakGlassError("Break-glass is not available for this kind of record.")
    if not selectors.roles_of(user.pk) & set(settings.BREAK_GLASS_ROLES):
        raise BreakGlassError("Your role cannot use break-glass access.")
    reason = reason.strip()
    if len(reason) < settings.BREAK_GLASS_MIN_REASON_LENGTH:
        raise DomainError(
            "Give a fuller reason for break-glass access.",
            details={"reason": [f"At least {settings.BREAK_GLASS_MIN_REASON_LENGTH} characters."]},
        )
    if not resource.model.objects.filter(pk=object_id).exists():
        raise DomainError("Record not found.", details={"object_id": object_id})
    with transaction.atomic():
        grant = BreakGlassGrant.objects.create(
            user=user,
            resource=resource_name,
            object_id=object_id,
            reason=reason,
            expires_at=timezone.now() + timedelta(minutes=settings.BREAK_GLASS_MINUTES),
        )
        audit.record(
            action=audit.AuditAction.BREAK_GLASS,
            request=request,
            resource=resource_name,
            object_id=object_id,
            reason=reason,
            details={"grant_id": str(grant.id), "expires_at": grant.expires_at},
        )
    return grant


def review_break_glass(request, grant: BreakGlassGrant, *, outcome: str, note: str):
    if outcome not in (BreakGlassReview.APPROPRIATE, BreakGlassReview.INAPPROPRIATE):
        raise DomainError("Outcome must be appropriate or inappropriate.")
    if grant.user_id == request.user.pk:
        raise BreakGlassError("You cannot review your own break-glass access.")
    if grant.review_status != BreakGlassReview.PENDING:
        raise DomainError("This access has already been reviewed.")
    with transaction.atomic():
        grant.review_status = outcome
        grant.reviewed_by = request.user
        grant.reviewed_at = timezone.now()
        grant.review_note = note
        grant.save()
        audit.record(
            action=audit.AuditAction.BREAK_GLASS_REVIEW,
            request=request,
            resource="accounts.breakglassgrant",
            object_id=grant.pk,
            reason=note,
            details={"outcome": outcome},
        )
    return grant
