from django.db import models

from apps.core.models import TenantModel


class Channel(models.TextChoices):
    EMAIL = "email", "Email"


class DeliveryStatus(models.TextChoices):
    QUEUED = "queued", "Queued"
    SENT = "sent", "Sent"
    FAILED = "failed", "Failed"


class Notification(TenantModel):
    """Delivery log. Holds the purpose and a masked recipient, never the message text."""

    channel = models.CharField(max_length=8, choices=Channel.choices)
    purpose = models.CharField(max_length=64)
    recipient_masked = models.CharField(max_length=64)
    related_object = models.CharField(max_length=100, blank=True)
    status = models.CharField(
        max_length=8, choices=DeliveryStatus.choices, default=DeliveryStatus.QUEUED
    )
    provider_reference = models.CharField(max_length=100, blank=True)
    error = models.CharField(max_length=255, blank=True)

    class Meta(TenantModel.Meta):
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.channel} {self.purpose} ({self.status})"
