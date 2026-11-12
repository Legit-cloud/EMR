"""Domain events published by the scheduling module."""

from apps.core import events

# Payload: {"appointment_id": str}. Billing of the consultation fee reacts to it.
APPOINTMENT_COMPLETED = events.define("appointment.completed")
