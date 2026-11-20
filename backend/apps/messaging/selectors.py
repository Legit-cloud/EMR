"""Read-only queries. A person sees only the threads they belong to."""

from django.db.models import OuterRef, Subquery

from .models import Message, Thread, ThreadMember


def threads_for(user_id):
    """The user's threads, newest activity first, each with ``last_body``."""
    last = Message.objects.filter(thread=OuterRef("pk")).order_by("-created_at")
    return Thread.objects.filter(members__user_id=user_id).annotate(
        last_body=Subquery(last.values("body")[:1])
    )


def unread_count(thread: Thread, user_id) -> int:
    """Messages from other people since the user last opened the thread."""
    member = ThreadMember.objects.filter(thread=thread, user_id=user_id).first()
    messages = Message.objects.filter(thread=thread).exclude(created_by_id=user_id)
    if member and member.last_read_at:
        messages = messages.filter(created_at__gt=member.last_read_at)
    return messages.count()


def member_ids(thread: Thread) -> list:
    return list(ThreadMember.objects.filter(thread=thread).values_list("user_id", flat=True))
