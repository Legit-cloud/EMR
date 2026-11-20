"""Send email through the configured mail backend.

Callers queue messages; Celery workers deliver them, so a request never waits on a
provider. Message text is never stored or logged.
"""

import base64

from django.db import transaction

from . import messages  # noqa: F401  (other modules reach the email wording through here)
from .layout import Email
from .models import Channel, Notification


def mask(recipient: str) -> str:
    if "@" in recipient:
        name, _, domain = recipient.partition("@")
        return f"{name[:1]}***@{domain}"
    return f"{recipient[:4]}***{recipient[-2:]}"


def queue_email(
    *,
    to: str,
    subject: str,
    body: str,
    purpose: str,
    related_object: str = "",
    attachments: list[tuple[str, bytes, str]] = (),
    html: str = "",
) -> Notification:
    """``attachments`` are ``(filename, content, mimetype)``. ``html`` is the styled version;
    ``body`` stays as the plain-text version every mail app can show."""
    from .tasks import deliver_email

    note = Notification.objects.create(
        channel=Channel.EMAIL,
        purpose=purpose,
        recipient_masked=mask(to),
        related_object=related_object,
    )
    encoded = [
        (name, base64.b64encode(content).decode(), mime) for name, content, mime in attachments
    ]
    transaction.on_commit(
        lambda: deliver_email.delay(
            str(note.tenant_id), str(note.pk), to, subject, body, encoded, html
        ),
        robust=True,
    )
    return note


def queue_message(
    *,
    to: str,
    message: Email,
    purpose: str,
    related_object: str = "",
    attachments: list[tuple[str, bytes, str]] = (),
) -> Notification:
    """Queue an email built by ``notifications.messages`` (styled HTML plus plain text)."""
    return queue_email(
        to=to,
        subject=message.subject,
        body=message.text,
        html=message.html,
        purpose=purpose,
        related_object=related_object,
        attachments=attachments,
    )


def queue_untracked_email(*, to: str, subject: str, body: str, html: str = "") -> None:
    """For people outside any tenant (platform staff, and people signing up): delivered the same
    way, not logged."""
    from .tasks import deliver_untracked_email

    transaction.on_commit(
        lambda: deliver_untracked_email.delay(to, subject, body, html), robust=True
    )


def queue_untracked_message(*, to: str, message: Email) -> None:
    queue_untracked_email(to=to, subject=message.subject, body=message.text, html=message.html)
