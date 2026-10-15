"""Domain events published by the pharmacy module."""

from apps.core import events

# Payload: {"prescription_id": str}
PRESCRIPTION_AUTHORISED = events.define("prescription.authorised")
# Payload: {"prescription_id": str, "item_ids": [str], "complete": bool}
PRESCRIPTION_DISPENSED = events.define("prescription.dispensed")
# Payload: {"prescription_id": str}. Only for prescriptions that were authorised.
PRESCRIPTION_CANCELLED = events.define("prescription.cancelled")
