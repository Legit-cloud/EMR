"""Send email through the configured mail backend.

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
        lambda: deliver_email.delay(str(note.tenant_id), str(note.pk), to, subject, body, encoded),
        robust=True,
    )
    return note


def queue_untracked_email(*, to: str, subject: str, body: str) -> None:
    """For people outside any tenant (platform staff): delivered the same way, not logged."""
    from .tasks import deliver_untracked_email

    transaction.on_commit(lambda: deliver_untracked_email.delay(to, subject, body), robust=True)
