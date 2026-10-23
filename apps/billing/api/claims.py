from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.mixins import TenantReadOnlyViewSet
from apps.core.api.schema import list_filters
from apps.core.policy import Action
from apps.patients import selectors as patients

from .. import claims
from ..models import Claim
from . import claim_serializers as s


def _named(rows):
    rows = list(rows)
    found = patients.summaries({c.invoice.patient_id for c in rows})
    for claim in rows:
        info = found.get(claim.invoice.patient_id, {})
        claim.patient_name = info.get("name", "")
        claim.patient_mrn = info.get("mrn", "")
    return rows


@list_filters("status", "insurer", "invoice")
class ClaimViewSet(TenantReadOnlyViewSet):
    """Claims to insurers. Billing officers make and send them and record the answers; finance
    and the administrator look."""

    model = Claim
    policy_resource = "billing.claim"
    policy_actions = {
        "submit": Action.UPDATE,
        "approve": Action.UPDATE,
        "reject": Action.UPDATE,
        "settle": Action.UPDATE,
        "ageing": Action.VIEW,
    }
    serializer_class = s.ClaimSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset().select_related("insurer", "invoice")
        params = self.request.query_params
        if params.get("status"):
            queryset = queryset.filter(status__in=params["status"].split(","))
        if params.get("insurer"):
            queryset = queryset.filter(insurer_id=params["insurer"])
        if params.get("invoice"):
            queryset = queryset.filter(invoice_id=params["invoice"])
        return queryset

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        return self.get_paginated_response(s.ClaimSerializer(_named(page), many=True).data)

    def retrieve(self, request, *args, **kwargs):
        return Response(s.ClaimSerializer(_named([self.get_object()])[0]).data)

    def _respond(self, claim, status=200):
        return Response(s.ClaimSerializer(_named([claim])[0]).data, status=status)

    @extend_schema(request=s.CreateClaimSerializer, responses={201: s.ClaimSerializer})
    def create(self, request):
        data = s.CreateClaimSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            claim = claims.create_claim(data.validated_data["invoice"])
            self.audit_write(Action.CREATE, claim, ["invoice"])
        return self._respond(claim, 201)

    @extend_schema(request=s.SubmitClaimSerializer, responses=s.ClaimSerializer)
    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        claim = self.get_object()
        data = s.SubmitClaimSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            claim = claims.submit(claim, insurer_reference=data.validated_data["insurer_reference"])
            self.audit_write(Action.UPDATE, claim, ["status"])
        return self._respond(claim)

    @extend_schema(request=s.ApproveClaimSerializer, responses=s.ClaimSerializer)
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        claim = self.get_object()
        data = s.ApproveClaimSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            claim = claims.approve(
                claim,
                approved_minor=data.validated_data["approved_minor"],
                note=data.validated_data["note"],
            )
            self.audit_write(Action.UPDATE, claim, ["status", "approved_minor"])
        return self._respond(claim)

    @extend_schema(request=s.RejectClaimSerializer, responses=s.ClaimSerializer)
    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        claim = self.get_object()
        data = s.RejectClaimSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            claim = claims.reject(claim, reason=data.validated_data["reason"])
            self.audit_write(Action.UPDATE, claim, ["status"])
        return self._respond(claim)

    @extend_schema(request=s.SettleClaimSerializer, responses=s.ClaimSerializer)
    @action(detail=True, methods=["post"])
    def settle(self, request, pk=None):
        claim = self.get_object()
        data = s.SettleClaimSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            claim = claims.settle(
                claim,
                amount_minor=data.validated_data["amount_minor"],
                reference=data.validated_data["reference"],
            )
            self.audit_write(Action.UPDATE, claim, ["status", "received_minor"])
        return self._respond(claim)

    @extend_schema(responses=s.AgeingBandSerializer(many=True))
    @action(detail=False, methods=["get"], pagination_class=None)
    def ageing(self, request):
        """What insurers still owe, by how long ago the claim was sent."""
        return Response(claims.ageing())
