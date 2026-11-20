"""Email delivery through Resend's HTTPS API.

Some hosts (Railway on its smaller plans, for one) block outbound SMTP, so a worker that
talks SMTP waits for a connection that never opens. This backend sends over HTTPS instead.
It is chosen by setting ``RESEND_API_KEY``; without it Django's ``EMAIL_URL`` backend is used.
A failure raises, so the delivery task retries and then records the failure.
"""

import base64
import json
import urllib.error
import urllib.request

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

API_URL = "https://api.resend.com/emails"


class ResendError(Exception):
    """Resend refused the message or could not be reached."""


class ResendBackend(BaseEmailBackend):
    def send_messages(self, email_messages) -> int:
        sent = 0
        for message in email_messages:
            if not message.recipients():
                continue
            try:
                self._send(message)
            except ResendError:
                if not self.fail_silently:
                    raise
            else:
                sent += 1
        return sent

    def _payload(self, message) -> dict:
        payload = {
            "from": message.from_email or settings.DEFAULT_FROM_EMAIL,
            "to": list(message.to),
            "subject": message.subject,
            "text": message.body,
        }
        if message.cc:
            payload["cc"] = list(message.cc)
        if message.bcc:
            payload["bcc"] = list(message.bcc)
        if message.reply_to:
            payload["reply_to"] = list(message.reply_to)
        attachments = []
        for attachment in message.attachments:
            if isinstance(attachment, tuple):
                name, content, _mime = attachment
                if isinstance(content, str):
                    content = content.encode()
                attachments.append(
                    {"filename": name, "content": base64.b64encode(content).decode()}
                )
        if attachments:
            payload["attachments"] = attachments
        return payload

    def _send(self, message) -> None:
        request = urllib.request.Request(
            API_URL,
            data=json.dumps(self._payload(message)).encode(),
            headers={
                "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                "Content-Type": "application/json",
                # Resend sits behind Cloudflare, which refuses the default Python agent.
                "User-Agent": "emr-mailer/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=settings.EMAIL_TIMEOUT) as response:
                if response.status >= 300:
                    raise ResendError(f"Resend answered {response.status}")
        except urllib.error.HTTPError as error:
            # Never put the response body in the error: it can echo the address.
            raise ResendError(f"Resend answered {error.code}") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise ResendError(f"Resend could not be reached: {type(error).__name__}") from error
