import uuid

from django.db import transaction
from django.db.models import CharField, Count, F, Q, Sum
from django.db.models.functions import Cast
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core import policy
from apps.core.api.mixins import TenantModelViewSet, TenantReadOnlyViewSet
from apps.core.api.pagination import PageSizePagination
from apps.core.api.schema import list_filters, query
from apps.core.money import Money
from apps.core.policy import Action
from apps.patients import selectors as patients

from .. import ledger, services
from ..models import Account, Insurer, Invoice, JournalEntry, LineStatus, Payment, PaymentStatus
from . import serializers as s

STATUSES = (PaymentStatus.UNPAID, PaymentStatus.PARTIALLY_PAID, PaymentStatus.PAID)


class InsurerViewSet(TenantModelViewSet):
    model = Insurer
    policy_resource = "billing.insurer"
    serializer_class = s.InsurerSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]


# Sort fields the invoice table offers; a leading "-" reverses.
INVOICE_ORDERING = {
    "created": "created_at",
    "total": "total_minor",
    "due": "net_due_minor",
    "status": "payment_status",
}


def _ordering(value: str | None) -> list[str]:
    value = value or "-created"
    field = INVOICE_ORDERING.get(value.lstrip("-"), "created_at")
    return [f"-{field}" if value.startswith("-") else field, "pk"]


@list_filters("patient", "payment_status", "estate_review", "q", "ordering", "page_size")
class InvoiceViewSet(TenantReadOnlyViewSet):
    """Invoices are built from charges; billing staff set coverage and take payments."""

    model = Invoice
    policy_resource = "billing.invoice"
    policy_actions = {
        "coverage": Action.UPDATE,
        "pay": Action.UPDATE,
        "charge": Action.UPDATE,
        "remind": Action.UPDATE,
        "summary": Action.VIEW,
    }
    pagination_class = PageSizePagination

    def get_serializer_class(self):
        return s.InvoiceListSerializer if self.action == "list" else s.InvoiceSerializer

    def _search(self, queryset):
        """Match the patient's name, MRN or phone, or the start of the invoice number."""
        text = self.request.query_params.get("q", "").strip()[:100]
        if not text:
            return queryset
        match = Q(patient_id__in=patients.search_ids(text))
        number = text.lstrip("#").lower().removeprefix("inv-")
        if len(number) >= 4 and set(number) <= set("0123456789abcdef"):
            queryset = queryset.annotate(id_text=Cast("id", CharField()))
            match |= Q(id_text__startswith=number)
        return queryset.filter(match)

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        params = self.request.query_params
        if params.get("patient"):
            queryset = queryset.filter(patient_id=params["patient"])
        if params.get("payment_status"):
            queryset = queryset.filter(payment_status=params["payment_status"])
        if params.get("estate_review") == "true":
            queryset = queryset.filter(estate_review=True)
        if self.action != "list":
            return queryset.prefetch_related("lines", "payments")
        live_lines = Count("lines", filter=~Q(lines__status=LineStatus.VOID))
        return (
            self._search(queryset)
            .annotate(line_count=live_lines)
            .order_by(*_ordering(params.get("ordering")))
        )

    def _context_for(self, invoices) -> dict:
        found = patients.summaries({invoice.patient_id for invoice in invoices})
        return {**self.get_serializer_context(), "patients": found}

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        rows = list(queryset if page is None else page)
        data = self.get_serializer(rows, many=True, context=self._context_for(rows)).data
        return Response(data) if page is None else self.get_paginated_response(data)

    def retrieve(self, request, *args, **kwargs):
        invoice = self.get_object()
        return Response(self.get_serializer(invoice, context=self._context_for([invoice])).data)

    def _respond(self, invoice):
        invoice = Invoice.objects.get(pk=invoice.pk)
        return Response(self.get_serializer(invoice, context=self._context_for([invoice])).data)

    @extend_schema(
        parameters=[query("q"), OpenApiParameter("currency", str, OpenApiParameter.QUERY)],
        responses=s.InvoiceSummarySerializer,
    )
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Counts by payment status and the money billed, collected and still due."""
        currency = request.query_params.get("currency", "NGN")
        invoices = policy.filter_queryset(
            self.policy_subject(),
            self.get_policy_resource(),
            Action.VIEW,
            self._search(Invoice.objects.filter(currency=currency)),
        )
        by_status = {status: Count("pk", filter=Q(payment_status=status)) for status in STATUSES}
        totals = invoices.aggregate(
            **by_status,
            billed=Sum("total_minor"),
            collected=Sum(F("insurer_paid_minor") + F("patient_paid_minor")),
            outstanding=Sum("net_due_minor"),
        )
        return Response(
            {
                "currency": currency,
                "unpaid_count": totals[PaymentStatus.UNPAID],
                "partially_paid_count": totals[PaymentStatus.PARTIALLY_PAID],
                "paid_count": totals[PaymentStatus.PAID],
                "billed_minor": totals["billed"] or 0,
                "collected_minor": totals["collected"] or 0,
                "outstanding_minor": totals["outstanding"] or 0,
            }
        )

    @extend_schema(request=None, responses=s.ReminderResultSerializer)
    @action(detail=True, methods=["post"])
    def remind(self, request, pk=None):
        """Message the patient about the balance still due."""
        invoice = self.get_object()
        with transaction.atomic():
            channels = services.send_payment_reminder(invoice)
            invoice.refresh_from_db(fields=["last_reminder_at"])
            self.audit_write(Action.UPDATE, invoice, ["reminder"])
        return Response({"channels": channels, "last_reminder_at": invoice.last_reminder_at})

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
