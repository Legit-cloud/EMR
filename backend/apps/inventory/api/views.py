from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.mixins import TenantModelViewSet, TenantReadOnlyViewSet
from apps.core.api.schema import list_filters
from apps.core.policy import Action

from .. import selectors, services
from ..models import Item, MovementKind, StockMovement
from . import serializers as s


@list_filters("status", "search")
class ItemViewSet(TenantModelViewSet):
    model = Item
    policy_resource = "inventory.item"
    policy_actions = {"summary": Action.VIEW}
    serializer_class = s.ItemSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        params = self.request.query_params
        if params.get("search"):
            from django.db.models import Q

            term = params["search"]
            queryset = queryset.filter(Q(name__icontains=term) | Q(sku__icontains=term))
        if params.get("status") == "low":
            queryset = queryset.filter(pk__in=selectors.low_stock().values("pk"))
        return queryset

    @extend_schema(responses=s.SummarySerializer)
    @action(detail=False, methods=["get"])
    def summary(self, request):
        return Response(selectors.summary(request.query_params.get("currency", "NGN")))


@list_filters("item")
class StockMovementViewSet(TenantReadOnlyViewSet):
    """History of every receipt, issue and count correction. Movements are only added."""

    model = StockMovement
    policy_resource = "inventory.stockmovement"
    serializer_class = s.MovementSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        item = self.request.query_params.get("item")
        return queryset.filter(item_id=item) if item else queryset

    @extend_schema(request=s.MovementRequestSerializer, responses={201: s.MovementSerializer})
    def create(self, request):
        data = s.MovementRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        with transaction.atomic():
            if v["kind"] == MovementKind.RECEIVE:
                movement = services.receive(v["item"], v["quantity"], reason=v["reason"])
            elif v["kind"] == MovementKind.ISSUE:
                movement = services.issue(
                    v["item"], v["quantity"], department=v.get("department"), reason=v["reason"]
                )
            else:
                movement = services.adjust(v["item"], v["quantity"], reason=v["reason"])
            self.audit_write(Action.CREATE, movement, ["kind", "quantity"])
        return Response(s.MovementSerializer(movement).data, status=201)
