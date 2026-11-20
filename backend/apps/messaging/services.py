"""Starting threads and posting messages."""

from django.db import transaction
from django.utils import timezone

from apps.accounts import selectors as accounts
from apps.core import events
from apps.core.errors import DomainError

from .events import MESSAGE_SENT
from .models import Message, Thread, ThreadMember


class MessageRefused(DomainError):
    code = "message_refused"
    status_code = 400


@transaction.atomic
def start_thread(*, sender_id, recipient_ids, subject: str, body: str) -> Thread:
    subject, body = subject.strip(), body.strip()
    if not subject or not body:
        raise MessageRefused("A subject and a message are both needed.")
    recipients = set(recipient_ids) - {sender_id}
    if not recipients:
        raise MessageRefused("Choose at least one other person.")
    # Staff only, and only people of this tenant (the lookup is tenant-scoped).
    if recipients - accounts.staff_user_ids(recipients):
        raise MessageRefused("Messages can only be sent to active staff of this facility.")
    thread = Thread.objects.create(subject=subject[:150])
    now = timezone.now()
    ThreadMember.objects.create(thread=thread, user_id=sender_id, last_read_at=now)
    for user_id in recipients:
        ThreadMember.objects.create(thread=thread, user_id=user_id)
    _post(thread, body)
    return thread


def _post(thread: Thread, body: str) -> Message:
    message = Message.objects.create(thread=thread, body=body)
    thread.save(update_fields=["updated_at"])
    events.publish(MESSAGE_SENT, {"message_id": str(message.pk)})
    return message


@transaction.atomic
def reply(thread: Thread, *, sender_id, body: str) -> Message:
    body = body.strip()
    if not body:
        raise MessageRefused("The message is empty.")
    message = _post(thread, body)
    ThreadMember.objects.filter(thread=thread, user_id=sender_id).update(
        last_read_at=timezone.now()
    )
    return message


def mark_read(thread: Thread, user_id) -> None:
    ThreadMember.objects.filter(thread=thread, user_id=user_id).update(last_read_at=timezone.now())
