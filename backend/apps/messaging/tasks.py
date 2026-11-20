"""Celery handlers."""

import logging

from celery import shared_task

from apps.accounts import selectors as accounts
from apps.core import events
from apps.notifications import services as notifications

from . import selectors
from .models import Message

logger = logging.getLogger(__name__)


@shared_task
def notify_members(envelope) -> int:
    """messaging.sent -> email everyone but the sender. The email says that a message is
    waiting, never what it says: the text stays inside the system."""
    sent = 0
    with events.event_context(envelope) as payload:
        message = Message.objects.select_related("thread").get(pk=payload["message_id"])
        for user_id in selectors.member_ids(message.thread):
            if user_id == message.created_by_id:
                continue
            address = accounts.email_of(user_id)
            if not address:
                continue
            notifications.queue_email(
                to=address,
                subject="You have a new message",
                body="You have a new message in the staff inbox. Sign in to read it.",
                purpose="staff_message",
                related_object=f"thread:{message.thread_id}",
            )
            sent += 1
    return sent
