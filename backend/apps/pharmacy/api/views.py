from dataclasses import asdict

from django.conf import settings
from django.db import transaction
from django.db.models import CharField, Count, F, Q, Sum
from django.db.models.functions import Cast, Coalesce
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.mixins import TenantModelViewSet, TenantReadOnlyViewSet
from apps.core.api.pagination import PageSizePagination
from apps.core.api.schema import list_filters, query
from apps.core.policy import Action

from .. import selectors, services
from ..models import Drug, Prescription, PurchaseOrder, StockBatch, Vendor
from . import serializers as s


@list_filters("q", "formulary")
class DrugViewSet(TenantModelViewSet):
    """The formulary."""

    model = Drug
    policy_resource = "pharmacy.drug"
    serializer_class = s.DrugSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        query = self.request.query_params.get("q")
        if query:
            queryset = queryset.filter(name__icontains=query)
        if self.request.query_params.get("formulary") == "true":
            queryset = queryset.filter(on_formulary=True)
        return queryset


@list_filters("drug")
class StockBatchViewSet(TenantModelViewSet):
    model = StockBatch
    policy_resource = "pharmacy.stockbatch"
    policy_actions = {"summary": Action.VIEW, "inventory": Action.VIEW}
    serializer_class = s.StockBatchSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_base_queryset(self):
        queryset = super().get_base_queryset().select_related("drug")
        drug = self.request.query_params.get("drug")
        return queryset.filter(drug_id=drug) if drug else queryset

    @extend_schema(responses=s.StockSummarySerializer)
    @action(detail=False, methods=["get"], pagination_class=None)
    def summary(self, request):
        """Asset value, product count and how many drugs are in stock, low or out."""
        today = timezone.localdate()
        return Response(selectors.stock_summary(today, settings.REPORTING_CURRENCY, low_limit=5))

    @extend_schema(
        parameters=[query("q"), query("status"), query("page_size")],
        responses=s.InventoryRowSerializer(many=True),
    )
    @action(detail=False, methods=["get"], pagination_class=PageSizePagination)
    def inventory(self, request):
        """One row per formulary drug: units available, on order, and its stock status."""
        params = request.query_params
        rows = selectors.inventory(
            timezone.localdate(), params.get("q", "").strip()[:100], params.get("status", "")
        ).order_by("name", "pk")
        page = self.paginate_queryset(rows)
        return self.get_paginated_response(s.InventoryRowSerializer(page, many=True).data)


@list_filters("patient", "encounter", "status")
class PrescriptionViewSet(TenantModelViewSet):
    """Prescribing (draft, safety check, sign) and dispensing."""

    model = Prescription
    policy_resource = "pharmacy.prescription"
    policy_actions = {
        "check": Action.UPDATE,
        "authorise": Action.UPDATE,
        "cancel": Action.UPDATE,
        "verify": Action.VIEW,
        "dispense": Action.DISPENSE,
    }
    serializer_class = s.PrescriptionSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_base_queryset(self):
        queryset = super().get_base_queryset().prefetch_related("items__drug", "alerts")
        params = self.request.query_params
        for name in ("patient", "encounter", "status"):
            if params.get(name):
                field = "status" if name == "status" else f"{name}_id"
                queryset = queryset.filter(**{field: params[name]})
        return queryset

    def perform_create(self, serializer):
        serializer.validated_data["prescriber"] = self.request.user
        super().perform_create(serializer)

    @extend_schema(request=None, responses=s.SafetyAlertSerializer(many=True))
    @action(detail=True, methods=["post"], pagination_class=None)
    def check(self, request, pk=None):
        """Preview the safety alerts of a draft without signing."""
        prescription = self.get_object()
        return Response([asdict(alert) for alert in services.check_safety(prescription)])

    @extend_schema(request=s.AuthoriseSerializer, responses=s.PrescriptionSerializer)
    @action(detail=True, methods=["post"])
    def authorise(self, request, pk=None):
        prescription = self.get_object()
        data = s.AuthoriseSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            prescription = services.authorise(
                prescription, overrides=data.validated_data["overrides"]
            )
            self.audit_write(Action.UPDATE, prescription, ["status", "signature"])
        return Response(self.get_serializer(prescription).data)

    @extend_schema(responses=s.SignatureCheckSerializer)
    @action(detail=True, methods=["get"])
    def verify(self, request, pk=None):
        prescription = self.get_object()
        return Response(
            {
                "signed": bool(prescription.signature),
                "valid": services.verify_signature(prescription),
                "signing_key_id": prescription.signing_key_id,
            }
        )

    @extend_schema(request=s.DispenseSerializer, responses=s.PrescriptionSerializer)
    @action(detail=True, methods=["post"])
    def dispense(self, request, pk=None):
        prescription = self.get_object()
        data = s.DispenseSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            prescription = services.dispense(prescription, data.validated_data["items"])
            self.audit_write(Action.DISPENSE, prescription, sorted(data.validated_data["items"]))
        return Response(self.get_serializer(prescription).data)

    @extend_schema(request=s.CancelSerializer, responses=s.PrescriptionSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        prescription = self.get_object()
        data = s.CancelSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            prescription = services.cancel(prescription, data.validated_data["reason"])
            self.audit_write(Action.UPDATE, prescription, ["status"])
        return Response(self.get_serializer(prescription).data)


# -- stock overview and ordering --------------------------------------------------------


class VendorViewSet(TenantModelViewSet):
    model = Vendor
    policy_resource = "pharmacy.vendor"
    serializer_class = s.VendorSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    pagination_class = None

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        if self.request.query_params.get("active") == "true":
            queryset = queryset.filter(active=True)
        return queryset


ORDER_ORDERING = {
    "created": "created_at",
    "status": "status",
    "total": "total_minor",
    "vendor": "vendor__name",
}


@list_filters("q", "status", "ordering", "page_size")
class PurchaseOrderViewSet(TenantReadOnlyViewSet):
    """Orders to vendors. Placing and receiving are actions; nothing edits an order."""

    model = PurchaseOrder
    policy_resource = "pharmacy.purchaseorder"
    policy_actions = {"place": Action.CREATE, "receive": Action.UPDATE, "cancel": Action.UPDATE}
    pagination_class = PageSizePagination

    def get_serializer_class(self):
        return s.OrderListSerializer if self.action == "list" else s.OrderSerializer

    def get_base_queryset(self):
        queryset = (
            super()
            .get_base_queryset()
            .select_related("vendor")
            .annotate(
                line_count=Count("lines"),
                units_ordered=Coalesce(Sum("lines__quantity_ordered"), 0),
                units_received=Coalesce(Sum("lines__quantity_received"), 0),
                total_minor=Coalesce(
                    Sum(F("lines__quantity_ordered") * F("lines__unit_cost_minor")), 0
                ),
            )
        )
        params = self.request.query_params
        if params.get("status"):
            queryset = queryset.filter(status=params["status"])
        text = params.get("q", "").strip()[:100]
        if text:
            match = Q(vendor__name__icontains=text)
            number = text.lstrip("#").lower().removeprefix("po-")
            if len(number) >= 4 and set(number) <= set("0123456789abcdef"):
                queryset = queryset.annotate(id_text=Cast("id", CharField()))
                match |= Q(id_text__startswith=number)
            queryset = queryset.filter(match)
        if self.action != "list":
            queryset = queryset.prefetch_related("lines__drug", "lines__receipts")
        ordering = params.get("ordering") or "-created"
        field = ORDER_ORDERING.get(ordering.lstrip("-"), "created_at")
        return queryset.order_by(f"-{field}" if ordering.startswith("-") else field, "pk")

    def _fresh(self, order):
        queryset = self.get_queryset()
        return s.OrderSerializer(queryset.get(pk=order.pk), context=self.get_serializer_context())

    @extend_schema(request=s.PlaceOrderSerializer, responses={201: s.OrderSerializer})
    @action(detail=False, methods=["post"], pagination_class=None)
    def place(self, request):
        data = s.PlaceOrderSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            order = services.place_order(
                vendor=data.validated_data["vendor"],
                lines=data.validated_data["lines"],
                note=data.validated_data["note"],
            )
            self.audit_write(Action.CREATE, order, ["lines"])
        return Response(self._fresh(order).data, status=201)

    @extend_schema(request=s.ReceiveSerializer, responses=s.OrderSerializer)
    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        order = self.get_object()
        data = s.ReceiveSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            services.receive_order(order, data.validated_data["receipts"])
            self.audit_write(Action.UPDATE, order, ["status", "stock"])
        return Response(self._fresh(order).data)

    @extend_schema(request=None, responses=s.OrderSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        order = self.get_object()
        with transaction.atomic():
            services.cancel_order(order)
            self.audit_write(Action.UPDATE, order, ["status"])
        return Response(self._fresh(order).data)
