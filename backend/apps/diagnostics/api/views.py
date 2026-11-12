from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.mixins import TenantModelViewSet, TenantReadOnlyViewSet
from apps.core.api.schema import list_filters
from apps.core.policy import Action

from .. import selectors, services
from ..models import DiagnosticOrder, DiagnosticResult, Investigation
from . import serializers as s


@list_filters("kind")
class InvestigationViewSet(TenantModelViewSet):
    """The catalogue of tests and scans. The administrator sets it up with POST and PATCH."""

    model = Investigation
    policy_resource = "diagnostics.investigation"
    serializer_class = s.InvestigationSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        if self.request.query_params.get("kind"):
            queryset = queryset.filter(kind=self.request.query_params["kind"])
        return queryset


def _with_names(orders):
    orders = list(orders)
    names = selectors.names_for({o.patient_id for o in orders})
    for order in orders:
        order.patient_name = names.get(order.patient_id, {}).get("name", "")
        order.patient_mrn = names.get(order.patient_id, {}).get("mrn", "")
    return orders


@list_filters("patient", "status", "kind")
class OrderViewSet(TenantReadOnlyViewSet):
    """Orders for tests and scans. Ordering, collecting and cancelling are actions."""

    model = DiagnosticOrder
    policy_resource = "diagnostics.order"
    policy_actions = {"collect": Action.UPDATE, "cancel": Action.UPDATE}
    serializer_class = s.DiagnosticOrderSerializer

    def get_base_queryset(self):
        queryset = (
            super()
            .get_base_queryset()
            .select_related("investigation", "ordered_by")
            .prefetch_related("results")
        )
        params = self.request.query_params
        if params.get("patient"):
            queryset = queryset.filter(patient_id=params["patient"])
        if params.get("status"):
            queryset = queryset.filter(status__in=params["status"].split(","))
        if params.get("kind"):
            queryset = queryset.filter(investigation__kind=params["kind"])
        return queryset

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        data = s.DiagnosticOrderSerializer(_with_names(page), many=True).data
        return self.get_paginated_response(data)

    def retrieve(self, request, *args, **kwargs):
        order = _with_names([self.get_object()])[0]
        return Response(s.DiagnosticOrderSerializer(order).data)

    @extend_schema(
        request=s.PlaceDiagnosticOrderSerializer, responses={201: s.DiagnosticOrderSerializer}
    )
    def create(self, request):
        data = s.PlaceDiagnosticOrderSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            order = services.place_order(
                patient_id=data.validated_data["patient"],
                investigation=data.validated_data["investigation"],
                reason=data.validated_data["reason"],
                priority=data.validated_data["priority"],
                encounter_id=data.validated_data["encounter_id"],
            )
            self.audit_write(Action.CREATE, order, ["investigation", "priority"])
        return Response(s.DiagnosticOrderSerializer(_with_names([order])[0]).data, status=201)

    @extend_schema(request=None, responses=s.DiagnosticOrderSerializer)
    @action(detail=True, methods=["post"])
    def collect(self, request, pk=None):
        order = self.get_object()
        with transaction.atomic():
            order = services.mark_collected(order)
            self.audit_write(Action.UPDATE, order, ["status"])
        return Response(s.DiagnosticOrderSerializer(_with_names([order])[0]).data)

    @extend_schema(request=s.CancelDiagnosticOrderSerializer, responses=s.DiagnosticOrderSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        order = self.get_object()
        data = s.CancelDiagnosticOrderSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            order = services.cancel_order(order, reason=data.validated_data["reason"])
            self.audit_write(Action.UPDATE, order, ["status", "cancelled_reason"])
        return Response(s.DiagnosticOrderSerializer(_with_names([order])[0]).data)


@list_filters("order", "patient")
class ResultViewSet(TenantReadOnlyViewSet):
    """Results, newest version first. Recording and correcting are for the technician; a
    doctor reviews."""

    model = DiagnosticResult
    policy_resource = "diagnostics.result"
    policy_actions = {"correct": Action.UPDATE, "review": Action.APPROVE}
    serializer_class = s.ResultSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset().select_related("reported_by")
        params = self.request.query_params
        if params.get("order"):
            queryset = queryset.filter(order_id=params["order"])
        if params.get("patient"):
            queryset = queryset.filter(order__patient_id=params["patient"])
        return queryset

    @extend_schema(request=s.RecordResultSerializer, responses={201: s.ResultSerializer})
    def create(self, request):
        data = s.RecordResultSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            result = services.record_result(
                data.validated_data["order"],
                value=data.validated_data["value"],
                report=data.validated_data["report"],
                flag=data.validated_data["flag"],
            )
            self.audit_write(Action.CREATE, result, ["order", "flag"])
        return Response(s.ResultSerializer(result).data, status=201)

    @extend_schema(request=s.CorrectResultSerializer, responses={201: s.ResultSerializer})
    @action(detail=True, methods=["post"])
    def correct(self, request, pk=None):
        previous = self.get_object()
        data = s.CorrectResultSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            result = services.correct_result(
                previous.order,
                reason=data.validated_data["reason"],
                value=data.validated_data["value"],
                report=data.validated_data["report"],
                flag=data.validated_data["flag"],
            )
            self.audit_write(Action.UPDATE, result, ["order", "version"])
        return Response(s.ResultSerializer(result).data, status=201)

    @extend_schema(request=None, responses=s.ResultSerializer)
    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        result = self.get_object()
        with transaction.atomic():
            result = services.review_result(result.order)
            self.audit_write(Action.APPROVE, result, ["reviewed_at"])
        return Response(s.ResultSerializer(result).data)
