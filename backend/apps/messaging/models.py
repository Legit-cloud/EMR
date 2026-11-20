from django.conf import settings
from django.db import models

from apps.core.models import TenantModel


class Thread(TenantModel):
    """A conversation between named staff members. For work talk, not for the chart: nothing
    here is part of the clinical record and patients never see it."""

    subject = models.CharField(max_length=150)

    class Meta(TenantModel.Meta):
        ordering = ["-updated_at"]


class ThreadMember(TenantModel):
    thread = models.ForeignKey(Thread, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    last_read_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["thread", "user"], name="one_membership_per_thread")
        ]


class Message(TenantModel):
    """One post. The sender is ``created_by``. Messages are never edited or removed."""

    thread = models.ForeignKey(Thread, on_delete=models.CASCADE, related_name="messages")
    body = models.TextField(max_length=4000)

    class Meta(TenantModel.Meta):
        ordering = ["created_at"]
