from dataclasses import asdict

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.mixins import TenantModelViewSet
from apps.core.api.schema import list_filters
from apps.core.policy import Action

from .. import services
from ..models import Drug, Prescription, StockBatch
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
    serializer_class = s.StockBatchSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_base_queryset(self):
        queryset = super().get_base_queryset().select_related("drug")
        drug = self.request.query_params.get("drug")
        return queryset.filter(drug_id=drug) if drug else queryset


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
