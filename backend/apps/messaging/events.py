"""Domain events published by the messaging module."""

from apps.core import events

# Payload: {"message_id": str}. Handler: email the other members that something is waiting.
MESSAGE_SENT = events.define("messaging.sent")
