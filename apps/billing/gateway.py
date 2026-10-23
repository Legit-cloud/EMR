"""The payment gateway (Paystack), behind a small interface.

Only this module talks to Paystack. It uses the standard library's HTTP client so no dependency is
added. Amounts are integer minor units (kobo), which is what Paystack uses too, so there is no
conversion. Nothing here records a payment: ``billing.services`` does that after the gateway has
confirmed one.
"""

import hashlib
import hmac
import json
import urllib.error
import urllib.request

from django.conf import settings
from django.utils.module_loading import import_string

from apps.core.errors import DomainError


class GatewayNotConfigured(DomainError):
    """Online payment is not switched on (no secret key)."""

    code = "gateway_not_configured"
    status_code = 503


class GatewayError(DomainError):
    """The gateway could not be reached or refused the request."""

    code = "gateway_error"
    status_code = 502


class PaystackGateway:
    def _request(self, method: str, path: str, payload: dict | None = None) -> dict:
        key = settings.PAYSTACK_SECRET_KEY
        if not key:
            raise GatewayNotConfigured("Online payment is not available yet.")
        request = urllib.request.Request(
            f"{settings.PAYSTACK_BASE_URL.rstrip('/')}{path}",
            data=json.dumps(payload).encode() if payload is not None else None,
            method=method,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=settings.PAYSTACK_TIMEOUT_SECONDS) as r:
                body = json.loads(r.read())
        except urllib.error.HTTPError as error:
            raise GatewayError("The payment service refused the request.") from error
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            raise GatewayError("The payment service could not be reached. Try again.") from error
        if not body.get("status"):
            raise GatewayError("The payment service refused the request.")
        return body.get("data") or {}

    def initialize(
        self, *, email: str, amount_minor: int, currency: str, reference: str, callback_url: str
    ) -> str:
        """Start a hosted checkout and return the address to send the patient to."""
        data = self._request(
            "POST",
            "/transaction/initialize",
            {
                "email": email,
                "amount": amount_minor,
                "currency": currency,
                "reference": reference,
                "callback_url": callback_url,
            },
        )
        if not data.get("authorization_url"):
            raise GatewayError("The payment service did not return a payment page.")
        return data["authorization_url"]

    def verify(self, reference: str) -> dict:
        """Ask Paystack what happened to a reference: status, amount, currency, id."""
        data = self._request("GET", f"/transaction/verify/{reference}")
        return {
            "status": data.get("status", ""),
            "amount_minor": data.get("amount"),
            "currency": data.get("currency", ""),
            "reference": data.get("reference", ""),
            "gateway_id": str(data.get("id", "")),
        }


class FakeGateway:
    """Tests: no network. ``results`` maps a reference to what verify should report."""

    initialized: list[dict] = []
    results: dict[str, dict] = {}
    fail = False

    def initialize(self, *, email, amount_minor, currency, reference, callback_url):
        if FakeGateway.fail:
            raise GatewayError("The payment service could not be reached. Try again.")
        FakeGateway.initialized.append(
            {
                "email": email,
                "amount_minor": amount_minor,
                "currency": currency,
                "reference": reference,
                "callback_url": callback_url,
            }
        )
        return f"https://checkout.paystack.test/{reference}"

    def verify(self, reference):
        if FakeGateway.fail:
            raise GatewayError("The payment service could not be reached. Try again.")
        return FakeGateway.results.get(
            reference,
            {"status": "abandoned", "amount_minor": None, "currency": "", "reference": reference},
        )

    @classmethod
    def reset(cls):
        cls.initialized = []
        cls.results = {}
        cls.fail = False


def get_gateway():
    return import_string(settings.PAYMENT_GATEWAY)()


def signature_is_valid(raw_body: bytes, header: str) -> bool:
    """Paystack signs each webhook: HMAC-SHA512 of the raw body with the secret key."""
    key = settings.PAYSTACK_SECRET_KEY
    if not key or not header:
        return False
    expected = hmac.new(key.encode(), raw_body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, header.strip())
