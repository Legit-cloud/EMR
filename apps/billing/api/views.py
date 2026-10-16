import uuid

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.mixins import TenantModelViewSet, TenantReadOnlyViewSet
from apps.core.api.schema import list_filters
from apps.core.money import Money
from apps.core.policy import Action

from .. import ledger, services
from ..models import Account, Insurer, Invoice, JournalEntry, Payment
from . import serializers as s


class InsurerViewSet(TenantModelViewSet):
    model = Insurer
    policy_resource = "billing.insurer"
    serializer_class = s.InsurerSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]


@list_filters("patient", "payment_status", "estate_review")
class InvoiceViewSet(TenantReadOnlyViewSet):
    """Invoices are built from charges; billing staff set coverage and take payments."""

    model = Invoice
    policy_resource = "billing.invoice"
    policy_actions = {
        "coverage": Action.UPDATE,
        "pay": Action.UPDATE,
        "charge": Action.UPDATE,
    }
    serializer_class = s.InvoiceSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset().prefetch_related("lines", "payments")
        params = self.request.query_params
        if params.get("patient"):
            queryset = queryset.filter(patient_id=params["patient"])
        if params.get("payment_status"):
            queryset = queryset.filter(payment_status=params["payment_status"])
        if params.get("estate_review") == "true":
            queryset = queryset.filter(estate_review=True)
        return queryset

    def _respond(self, invoice):
        return Response(self.get_serializer(Invoice.objects.get(pk=invoice.pk)).data)

    @extend_schema(request=s.CoverageSerializer, responses=s.InvoiceSerializer)
    @action(detail=True, methods=["post"])
    def coverage(self, request, pk=None):
        invoice = self.get_object()
        data = s.CoverageSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            invoice = services.set_coverage(
                invoice,
                insurer=data.validated_data.get("insurer"),
                coverage_bp=data.validated_data["coverage_bp"],
            )
            self.audit_write(Action.UPDATE, invoice, ["insurer", "insurer_coverage_bp"])
        return self._respond(invoice)

    @extend_schema(request=s.PaymentRequestSerializer, responses={201: s.PaymentSerializer})
    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        invoice = self.get_object()
        data = s.PaymentRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        with transaction.atomic():
            payment = services.record_payment(
                invoice,
                payer=values["payer"],
                method=values["method"],
                amount=Money(values["amount_minor"], invoice.currency),
                reference=values["reference"],
                idempotency_key=values.get("idempotency_key"),
            )
            self.audit_write(Action.UPDATE, invoice, ["payment"])
        body = s.PaymentSerializer(payment).data
        return Response(body, status=status.HTTP_201_CREATED)

    @extend_schema(request=s.ManualChargeSerializer, responses={201: s.InvoiceLineSerializer})
    @action(detail=True, methods=["post"])
    def charge(self, request, pk=None):
        """A manual charge, such as a registration fee."""
        invoice = self.get_object()
        data = s.ManualChargeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        add = services.charge_delivered if values["delivered"] else services.add_line
        with transaction.atomic():
            line = add(
                patient_id=invoice.patient_id,
                source="billing.manual",
                source_id=invoice.pk,
                description=values["description"],
                quantity=values["quantity"],
                unit_price=Money(values["unit_price_minor"], invoice.currency),
                idempotency_key=f"manual:{values.get('idempotency_key') or uuid.uuid4()}",
                revenue_category=values["revenue_category"],
            )
            self.audit_write(Action.UPDATE, invoice, ["charge"])
        return Response(s.InvoiceLineSerializer(line).data, status=status.HTTP_201_CREATED)


@list_filters("invoice")
class PaymentViewSet(TenantReadOnlyViewSet):
    model = Payment
    policy_resource = "billing.payment"
    serializer_class = s.PaymentSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        invoice = self.request.query_params.get("invoice")
        return queryset.filter(invoice_id=invoice) if invoice else queryset


class AccountViewSet(TenantReadOnlyViewSet):
    """Chart of accounts with balances, and reconciliation, for finance."""

    model = Account
    policy_resource = "billing.ledger"
    policy_actions = {"reconcile": Action.VIEW, "trial_balance": Action.VIEW}
    serializer_class = s.AccountSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["balances"] = ledger.balances(self.request.query_params.get("currency", "NGN"))
        return context

    @extend_schema(responses=s.ReconciliationSerializer)
    @action(detail=False, methods=["get"])
    def reconcile(self, request):
        problems = services.reconcile(request.query_params.get("currency", "NGN"))
        return Response({"reconciled": not problems, "problems": problems})

    @extend_schema(responses=s.TrialBalanceSerializer)
    @action(detail=False, methods=["get"], url_path="trial-balance")
    def trial_balance(self, request):
        debits, credits = ledger.trial_balance(request.query_params.get("currency", "NGN"))
        return Response({"debits_minor": debits, "credits_minor": credits})


class JournalEntryViewSet(TenantReadOnlyViewSet):
    model = JournalEntry
    policy_resource = "billing.journalentry"
    serializer_class = s.JournalEntrySerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset().prefetch_related("lines__account")
        source = self.request.query_params.get("source")
        return queryset.filter(source=source) if source else queryset
