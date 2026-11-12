"""Domain events published by the billing module."""

from apps.core import events

# Payload: {"invoice_id": str}. Published once, when an invoice becomes Paid.
INVOICE_PAID = events.define("invoice.paid")
