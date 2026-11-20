"""Celery tasks."""

import base64
import logging

from celery import shared_task
from django.core.mail import EmailMessage, EmailMultiAlternatives

from apps.core.tenancy import tenant_context

from .models import DeliveryStatus, Notification

logger = logging.getLogger(__name__)


def _finish(notification_id, *, reference: str = "", error: str = "") -> None:
    Notification.objects.filter(pk=notification_id).update(
        status=DeliveryStatus.FAILED if error else DeliveryStatus.SENT,
        provider_reference=reference[:100],
        error=error[:255],
    )


def _compose(subject, body, to, html):
    """Plain text first, with the styled version beside it for mail apps that show HTML."""
    if html:
        message = EmailMultiAlternatives(subject, body, None, [to])
        message.attach_alternative(html, "text/html")
        return message
    return EmailMessage(subject, body, None, [to])


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def deliver_email(self, tenant_id, notification_id, to, subject, body, attachments, html=""):
    with tenant_context(tenant_id):
        message = _compose(subject, body, to, html)
        for name, content, mime in attachments:
            message.attach(name, base64.b64decode(content), mime)
        try:
            message.send()
        except Exception as exc:
            logger.warning("Email delivery failed for notification %s", notification_id)
            if self.request.retries >= self.max_retries:
                _finish(notification_id, error=type(exc).__name__)
                return
            raise self.retry(exc=exc) from exc
        _finish(notification_id, reference="email")


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def deliver_untracked_email(self, to, subject, body, html=""):
    try:
        _compose(subject, body, to, html).send()
    except Exception as exc:
        logger.warning("Untracked email delivery failed")
        if self.request.retries >= self.max_retries:
            return
        raise self.retry(exc=exc) from exc
