from rest_framework import serializers

from apps.core.api.fields import TenantPrimaryKeyRelatedField

from ..models import Claim, ClaimStatus, Invoice


class ClaimSerializer(serializers.ModelSerializer):
    insurer_name = serializers.CharField(source="insurer.name", read_only=True)
    invoice_reference = serializers.SerializerMethodField()
    patient_name = serializers.CharField(read_only=True, default="")
    patient_mrn = serializers.CharField(read_only=True, default="")
    outstanding_minor = serializers.IntegerField(read_only=True)
    status = serializers.ChoiceField(choices=ClaimStatus.choices, read_only=True)

    class Meta:
        model = Claim
        fields = [
            "id",
            "reference",
            "insurer_reference",
            "invoice",
            "invoice_reference",
            "patient_name",
            "patient_mrn",
            "insurer",
            "insurer_name",
            "status",
            "currency",
            "claimed_minor",
            "approved_minor",
            "received_minor",
            "outstanding_minor",
            "attempt",
            "submitted_at",
            "decided_at",
            "settled_at",
            "decision_note",
            "created_at",
        ]
        read_only_fields = fields

    def get_invoice_reference(self, claim) -> str:
        return f"INV-{str(claim.invoice_id)[:8].upper()}"


class CreateClaimSerializer(serializers.Serializer):
    invoice = TenantPrimaryKeyRelatedField(Invoice)


class SubmitClaimSerializer(serializers.Serializer):
    insurer_reference = serializers.CharField(
        max_length=64, required=False, allow_blank=True, default=""
    )


class ApproveClaimSerializer(serializers.Serializer):
    approved_minor = serializers.IntegerField(min_value=1)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class RejectClaimSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)


class SettleClaimSerializer(serializers.Serializer):
    amount_minor = serializers.IntegerField(min_value=1)
    reference = serializers.CharField(max_length=64)


class AgeingBandSerializer(serializers.Serializer):
    band = serializers.CharField()
    claims = serializers.IntegerField()
    outstanding_minor = serializers.IntegerField()
