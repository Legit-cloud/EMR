from django.db import transaction
from rest_framework import serializers

from apps.core.api.serializers import CleanModelSerializer
from apps.core.money import CURRENCY_EXPONENTS

from ..models import (
    Drug,
    Prescription,
    PrescriptionAlert,
    PrescriptionItem,
    PrescriptionStatus,
    StockBatch,
)


class DrugSerializer(CleanModelSerializer):
    class Meta:
        model = Drug
        fields = [
            "id",
            "name",
            "brand_name",
            "form",
            "strength",
            "ingredients",
            "classes",
            "unit_price_minor",
            "currency",
            "on_formulary",
        ]
        read_only_fields = ["id"]

    def validate_ingredients(self, value):
        if not [v for v in value if v.strip()]:
            raise serializers.ValidationError("List at least one active ingredient.")
        return value

    def validate_currency(self, value):
        if value not in CURRENCY_EXPONENTS:
            raise serializers.ValidationError("Unsupported currency.")
        return value

    def validate_unit_price_minor(self, value):
        if value < 0:
            raise serializers.ValidationError("Cannot be negative.")
        return value


class StockBatchSerializer(CleanModelSerializer):
    available = serializers.IntegerField(read_only=True)

    class Meta:
        model = StockBatch
        fields = [
            "id",
            "drug",
            "batch_number",
            "expiry_date",
            "quantity_on_hand",
            "quantity_reserved",
            "available",
        ]
        read_only_fields = ["id", "quantity_reserved"]


class PrescriptionItemSerializer(serializers.ModelSerializer):
    drug_name = serializers.CharField(source="drug.__str__", read_only=True)

    class Meta:
        model = PrescriptionItem
        fields = [
            "id",
            "drug",
            "drug_name",
            "dose",
            "frequency",
            "route",
            "duration_days",
            "quantity",
            "instructions",
            "quantity_dispensed",
        ]
        read_only_fields = ["id", "quantity_dispensed"]

    def validate_drug(self, drug):
        if not drug.on_formulary:
            raise serializers.ValidationError("This drug is not on the formulary.")
        return drug

    def validate_quantity(self, value):
        if value < 1:
            raise serializers.ValidationError("At least 1.")
        return value


class PrescriptionAlertSerializer(serializers.ModelSerializer):
    class Meta:
        model = PrescriptionAlert
        fields = ["kind", "key", "severity", "blocking", "message", "override_reason"]


class PrescriptionSerializer(serializers.ModelSerializer):
    items = PrescriptionItemSerializer(many=True)
    alerts = PrescriptionAlertSerializer(many=True, read_only=True)

    class Meta:
        model = Prescription
        fields = [
            "id",
            "patient",
            "encounter",
            "prescriber",
            "status",
            "note",
            "items",
            "alerts",
            "authorised_at",
            "signing_key_id",
            "signed_payload_sha256",
            "cancelled_reason",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "patient",
            "prescriber",
            "status",
            "authorised_at",
            "signing_key_id",
            "signed_payload_sha256",
            "cancelled_reason",
            "created_at",
        ]

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError("Add at least one item.")
        return items

    def validate(self, attrs):
        if self.instance is not None:
            if self.instance.status != PrescriptionStatus.DRAFT:
                raise serializers.ValidationError("A signed prescription cannot be changed.")
            if "encounter" in attrs and attrs["encounter"] != self.instance.encounter:
                raise serializers.ValidationError({"encounter": "Cannot be changed."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("items")
        encounter = validated_data["encounter"]
        prescription = Prescription(**validated_data, patient_id=encounter.patient_id)
        prescription._assign_tenant()
        prescription.full_clean(exclude=["created_by", "updated_by"])
        prescription.save()
        for item in items:
            PrescriptionItem.objects.create(prescription=prescription, **item)
        return prescription

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if items is not None:
            for existing in instance.items.all():
                existing.delete()
            for item in items:
                PrescriptionItem.objects.create(prescription=instance, **item)
        return instance


class SafetyAlertSerializer(serializers.Serializer):
    kind = serializers.CharField()
    key = serializers.CharField()
    severity = serializers.CharField()
    blocking = serializers.BooleanField()
    message = serializers.CharField()


class SignatureCheckSerializer(serializers.Serializer):
    signed = serializers.BooleanField()
    valid = serializers.BooleanField()
    signing_key_id = serializers.CharField()


class AuthoriseSerializer(serializers.Serializer):
    overrides = serializers.DictField(
        child=serializers.CharField(max_length=2000, allow_blank=True), required=False, default={}
    )


class DispenseSerializer(serializers.Serializer):
    items = serializers.DictField(child=serializers.IntegerField(min_value=1), allow_empty=False)


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)
