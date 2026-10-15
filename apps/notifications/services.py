"""Send SMS and email through the configured providers.

Callers queue messages; Celery workers deliver them, so a request never waits on a
provider. Message text is never stored or logged.
"""

import base64

from django.db import transaction

from .models import Channel, Notification


def mask(recipient: str) -> str:
    if "@" in recipient:
        name, _, domain = recipient.partition("@")
        return f"{name[:1]}***@{domain}"
    return f"{recipient[:4]}***{recipient[-2:]}"


def queue_sms(*, to: str, body: str, purpose: str, related_object: str = "") -> Notification:
    from .tasks import deliver_sms

    note = Notification.objects.create(
        channel=Channel.SMS,
        purpose=purpose,
        recipient_masked=mask(to),
        related_object=related_object,
    )
    transaction.on_commit(lambda: deliver_sms.delay(str(note.tenant_id), str(note.pk), to, body))
    return note


def queue_email(
    *,
    to: str,
    subject: str,
    body: str,
    purpose: str,
    related_object: str = "",
    attachments: list[tuple[str, bytes, str]] = (),
) -> Notification:
    """``attachments`` are ``(filename, content, mimetype)``."""
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
        lambda: deliver_email.delay(str(note.tenant_id), str(note.pk), to, subject, body, encoded)
    )
    return note
