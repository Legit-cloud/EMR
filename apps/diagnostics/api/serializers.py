from rest_framework import serializers

from apps.core.api.fields import TenantPrimaryKeyRelatedField
from apps.core.api.serializers import CleanModelSerializer

from ..models import DiagnosticOrder, DiagnosticResult, Flag, Investigation, Priority


class InvestigationSerializer(CleanModelSerializer):
    class Meta:
        model = Investigation
        fields = [
            "id",
            "kind",
            "name",
            "code",
            "unit",
            "reference_range",
            "price_minor",
            "currency",
            "active",
        ]
        read_only_fields = ["id"]


class ResultSerializer(serializers.ModelSerializer):
    reported_by_name = serializers.SerializerMethodField()
    is_reviewed = serializers.BooleanField(read_only=True)

    class Meta:
        model = DiagnosticResult
        fields = [
            "id",
            "order",
            "version",
            "superseded",
            "value",
            "unit",
            "reference_range",
            "flag",
            "report",
            "reported_by_name",
            "reported_at",
            "correction_reason",
            "is_reviewed",
            "reviewed_at",
        ]
        read_only_fields = fields

    def get_reported_by_name(self, result) -> str:
        user = result.reported_by
        return user.get_full_name() or user.get_username()


class OrderSerializer(serializers.ModelSerializer):
    investigation_name = serializers.CharField(source="investigation.name", read_only=True)
    kind = serializers.CharField(source="investigation.kind", read_only=True)
    patient_name = serializers.CharField(read_only=True, default="")
    patient_mrn = serializers.CharField(read_only=True, default="")
    ordered_by_name = serializers.SerializerMethodField()
    current_result = serializers.SerializerMethodField()

    class Meta:
        model = DiagnosticOrder
        fields = [
            "id",
            "patient",
            "patient_name",
            "patient_mrn",
            "investigation",
            "investigation_name",
            "kind",
            "reason",
            "priority",
            "status",
            "encounter_id",
            "unit_price_minor",
            "currency",
            "ordered_by_name",
            "created_at",
            "collected_at",
            "cancelled_reason",
            "current_result",
        ]
        read_only_fields = fields

    def get_ordered_by_name(self, order) -> str:
        user = order.ordered_by
        return user.get_full_name() or user.get_username()

    def get_current_result(self, order) -> ResultSerializer | None:
        result = next((r for r in order.results.all() if not r.superseded), None)
        return ResultSerializer(result).data if result else None


class PlaceOrderSerializer(serializers.Serializer):
    patient = serializers.UUIDField()
    investigation = TenantPrimaryKeyRelatedField(Investigation)
    reason = serializers.CharField(max_length=300)
    priority = serializers.ChoiceField(choices=Priority.choices, default=Priority.ROUTINE)
    encounter_id = serializers.UUIDField(required=False, allow_null=True, default=None)


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300)


class RecordResultSerializer(serializers.Serializer):
    order = TenantPrimaryKeyRelatedField(DiagnosticOrder)
    value = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    report = serializers.CharField(max_length=5000, required=False, allow_blank=True, default="")
    flag = serializers.ChoiceField(choices=Flag.choices, default=Flag.NORMAL)


class CorrectResultSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300)
    value = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    report = serializers.CharField(max_length=5000, required=False, allow_blank=True, default="")
    flag = serializers.ChoiceField(choices=Flag.choices)
