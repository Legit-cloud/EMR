"""Read-only notification queries."""

from .models import Notification


def notifications_for(related_object: str) -> list[dict]:
    return list(
        Notification.objects.filter(related_object=related_object).values(
            "channel", "purpose", "status", "recipient_masked"
        )
    )
