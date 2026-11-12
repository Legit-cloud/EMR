"""Domain events published by the patients module."""

from apps.core import events

# Payload: {"patient_id": str, "deceased_at": "YYYY-MM-DD"}. Handlers: scheduling cancels
# appointments, billing flags invoices for estate settlement, accounts revokes portal access.
PATIENT_DECEASED = events.define("patient.deceased")
