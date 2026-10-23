"""The Paystack webhook (ADR 0023).

Paystack calls this when a payment succeeds. It is anonymous by nature, so the only thing that lets
a request in is the HMAC-SHA512 signature over the raw body, made with the secret key. A request
without a valid signature is refused and logged; nothing in its body is trusted or acted on.

Even a signed message is applied only through ``settle_online_payment``, which credits a bill only
for a reference we issued, for the exact amount and currency we asked for, and once. The tenant is
taken from our own record of the reference, never from the request.
"""

import json
import logging

from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.core.tenancy import tenant_context

from .. import services
from ..gateway import signature_is_valid
from ..models import PaymentIntent

logger = logging.getLogger(__name__)


class PaystackWebhookView(APIView):
    authentication_classes: list = []
    permission_classes: list = []
    throttle_classes: list = []

    @extend_schema(request=None, responses={200: None, 401: None})
    def post(self, request):
        raw = request.body  # read before anything parses it: the signature covers these bytes
        if not signature_is_valid(raw, request.headers.get("x-paystack-signature", "")):
            audit.record(
                action=audit.AuditAction.ACCESS,
                outcome=audit.AuditOutcome.DENIED,
                request=request,
                tenant_id=None,
                resource="billing.webhook",
                details={"gateway": "paystack", "reason": "bad_signature"},
            )
            return Response({"error": {"code": "bad_signature"}}, status=401)
        try:
            event = json.loads(raw)
        except ValueError:
            return Response(status=200)
        if event.get("event") == "charge.success":
            data = event.get("data") or {}
            reference = str(data.get("reference", ""))
            intent = PaymentIntent.all_tenants.filter(reference=reference).first()
            if intent is None:
                logger.warning("Paystack webhook for an unknown reference")
            else:
                with tenant_context(intent.tenant_id):
                    settled = services.settle_online_payment(
                        reference,
                        {
                            "status": data.get("status", ""),
                            "amount_minor": data.get("amount"),
                            "currency": data.get("currency", ""),
                            "gateway_id": data.get("id", ""),
                        },
                    )
                    audit.record(
                        action=audit.AuditAction.UPDATE,
                        request=request,
                        resource="billing.paymentintent",
                        object_id=intent.pk,
                        details={"via": "webhook", "result": settled.status if settled else ""},
                    )
        # Always 200 for a signed message, so Paystack does not retry what we have handled.
        return Response(status=200)
