"""Domain events published by the diagnostics module."""

from apps.core import events

# Payload: {"order_id": str}. Handler: put the test or scan on the patient's bill.
ORDERED = events.define("diagnostics.ordered")
# Payload: {"order_id": str}. Handlers: the charge becomes final; a critical result is phoned
# through to the person who ordered it.
RESULTED = events.define("diagnostics.resulted")
# Payload: {"order_id": str}. Handler: take the charge off the bill.
CANCELLED = events.define("diagnostics.cancelled")
# Payload: {"order_id": str}. Handler: tell the person who ordered it the result has changed.
RESULT_CORRECTED = events.define("diagnostics.result_corrected")
