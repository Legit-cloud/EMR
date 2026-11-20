from rest_framework import serializers

from apps.core.api.fields import TenantPrimaryKeyRelatedField
from apps.core.api.serializers import CleanModelSerializer

from ..models import Item, MovementKind, StockMovement


class ItemSerializer(CleanModelSerializer):
    is_low = serializers.BooleanField(read_only=True)

    class Meta:
        model = Item
        fields = [
            "id",
            "sku",
            "name",
            "category",
            "unit",
            "on_hand",
            "reorder_level",
            "unit_cost_minor",
            "currency",
            "active",
            "is_low",
        ]
        # The count changes only through stock movements.
        read_only_fields = ["id", "on_hand"]


class SummarySerializer(serializers.Serializer):
    items = serializers.IntegerField()
    out = serializers.IntegerField()
    low = serializers.IntegerField()
    units = serializers.IntegerField()
    value_minor = serializers.IntegerField()
    currency = serializers.CharField()


class MovementSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockMovement
        fields = [
            "id",
            "item",
            "kind",
            "quantity",
            "balance_after",
            "department",
            "reason",
            "created_at",
            "created_by",
        ]
        read_only_fields = fields


class MovementRequestSerializer(serializers.Serializer):
    """``quantity`` is units in or out for receive and issue, and the counted total for adjust."""

    item = TenantPrimaryKeyRelatedField(Item)
    kind = serializers.ChoiceField(choices=MovementKind.choices)
    quantity = serializers.IntegerField(min_value=0)
    department = TenantPrimaryKeyRelatedField(
        StockMovement._meta.get_field("department").related_model, required=False, allow_null=True
    )
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
