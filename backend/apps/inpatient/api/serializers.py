from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.core.api.fields import TenantPrimaryKeyRelatedField
from apps.core.api.serializers import CleanModelSerializer

from ..models import Admission, Bed, BedStatus, DischargeStatus, Ward


class OccupantSerializer(serializers.Serializer):
    """Who is in a bed. Built from an admission with the patient's name and MRN attached."""

    admission = serializers.UUIDField(source="pk")
    patient = serializers.UUIDField(source="patient_id")
    patient_name = serializers.CharField()
    patient_mrn = serializers.CharField()
    admitted_at = serializers.DateTimeField()
    reason = serializers.CharField()


class BoardBedSerializer(serializers.Serializer):
    id = serializers.UUIDField(source="pk")
    label = serializers.CharField()
    status = serializers.ChoiceField(choices=BedStatus.choices)
    occupant = serializers.SerializerMethodField()

    @extend_schema_field(OccupantSerializer(allow_null=True))
    def get_occupant(self, bed):
        admission = self.context["occupants"].get(bed.pk)
        return OccupantSerializer(admission).data if admission else None


class BoardWardSerializer(serializers.Serializer):
    id = serializers.UUIDField(source="pk")
    name = serializers.CharField()
    beds = BoardBedSerializer(many=True, source="board_beds")


class WardSerializer(CleanModelSerializer):
    class Meta:
        model = Ward
        fields = [
            "id",
            "facility",
            "department",
            "name",
            "daily_charge_minor",
            "currency",
            "active",
        ]
        read_only_fields = ["id"]


class BedSerializer(CleanModelSerializer):
    class Meta:
        model = Bed
        fields = ["id", "ward", "label", "status"]
        read_only_fields = ["id", "status"]


class AdmitSerializer(serializers.Serializer):
    patient = serializers.UUIDField()
    bed = TenantPrimaryKeyRelatedField(Bed)
    reason = serializers.CharField(max_length=300)


class TransferSerializer(serializers.Serializer):
    bed = TenantPrimaryKeyRelatedField(Bed)
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class DischargeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=DischargeStatus.choices)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class DischargeResultSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=DischargeStatus.choices)


class AdmissionSerializer(serializers.ModelSerializer):
    """The record of a stay, for history and audit."""

    class Meta:
        model = Admission
        fields = [
            "id",
            "patient",
            "bed",
            "reason",
            "admitted_at",
            "discharged_at",
            "discharge_status",
            "discharge_note",
        ]
        read_only_fields = fields
