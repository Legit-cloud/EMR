"""SMS provider adapters. Email uses Django's mail backends (Mailpit locally).

The real SMS provider is an open decision (CLAUDE.md Section 12); add its adapter here and
select it with ``SMS_BACKEND``.
"""

import logging

from django.conf import settings
from django.utils.module_loading import import_string

logger = logging.getLogger(__name__)


class BaseSmsBackend:
    def send(self, to: str, body: str, sender_id: str) -> str:
        """Send one message and return the provider's message reference."""
        raise NotImplementedError


class ConsoleSmsBackend(BaseSmsBackend):
    """Development: logs that a message was sent, without its content (it may hold PHI)."""

    def send(self, to, body, sender_id):
        logger.info("SMS from %s to %s…%s (%d characters)", sender_id, to[:4], to[-2:], len(body))
        return "console"


class LocmemSmsBackend(BaseSmsBackend):
    """Tests: keeps messages in ``outbox``."""

    outbox: list[dict] = []

    def send(self, to, body, sender_id):
        LocmemSmsBackend.outbox.append({"to": to, "body": body, "sender_id": sender_id})
        return f"locmem-{len(LocmemSmsBackend.outbox)}"


def get_sms_backend() -> BaseSmsBackend:
    return import_string(settings.SMS_BACKEND)()
