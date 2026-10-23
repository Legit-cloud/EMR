from rest_framework import serializers

from apps.core.api.serializers import CleanModelSerializer

from ..models import PortalAccount

STATUSES = [
    "booked",
    "confirmed",
    "checked_in",
    "in_consultation",
    "completed",
    "no_show",
    "cancelled",
]


class PortalAccountSerializer(CleanModelSerializer):
    """What staff see of a patient's portal access."""

    class Meta:
        model = PortalAccount
        fields = ["id", "patient", "active", "invited_at", "revoked_at", "revoked_reason"]
        read_only_fields = fields


class InviteSerializer(serializers.Serializer):
    patient = serializers.UUIDField()


# -- what the patient sees -----------------------------------------------------------------


class PortalAppointmentSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    doctor_name = serializers.CharField()
    specialty = serializers.CharField(allow_blank=True)
    location = serializers.CharField()
    start_at = serializers.DateTimeField()
    end_at = serializers.DateTimeField()
    status = serializers.ChoiceField(choices=STATUSES)
    reason = serializers.CharField(allow_blank=True)
    can_cancel = serializers.BooleanField()


class PortalSlotSerializer(serializers.Serializer):
    id = serializers.CharField()
    doctor_name = serializers.CharField()
    specialty = serializers.CharField(allow_blank=True)
    start_at = serializers.DateTimeField()
    end_at = serializers.DateTimeField()


class BookSerializer(serializers.Serializer):
    slot = serializers.CharField(max_length=80)
    reason = serializers.CharField(max_length=200)


class PortalCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=200)


class PortalResultSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=["lab", "imaging"])
    name = serializers.CharField()
    taken_at = serializers.DateTimeField()
    ordered_by = serializers.CharField()
    seen = serializers.BooleanField()
    flag = serializers.ChoiceField(choices=["normal", "low", "high", "abnormal"])
    value = serializers.CharField(allow_blank=True)
    unit = serializers.CharField(allow_blank=True)
    low = serializers.FloatField(allow_null=True)
    high = serializers.FloatField(allow_null=True)
    note = serializers.CharField(allow_blank=True)


class PortalPrescriptionItemSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    drug_name = serializers.CharField()
    dose = serializers.CharField()
    frequency = serializers.CharField()
    route = serializers.CharField(allow_blank=True)
    duration_days = serializers.IntegerField()
    quantity = serializers.IntegerField()
    instructions = serializers.CharField(allow_blank=True)


class PortalPrescriptionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    prescribed_at = serializers.DateTimeField()
    doctor_name = serializers.CharField()
    active = serializers.BooleanField()
    items = PortalPrescriptionItemSerializer(many=True)


class PortalInvoiceLineSerializer(serializers.Serializer):
    description = serializers.CharField()
    amount_minor = serializers.IntegerField()


class PortalInvoiceSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    reference = serializers.CharField()
    created_at = serializers.DateTimeField()
    currency = serializers.CharField()
    total_minor = serializers.IntegerField()
    paid_minor = serializers.IntegerField()
    due_minor = serializers.IntegerField()
    status = serializers.ChoiceField(choices=["unpaid", "partially_paid", "paid"])
    lines = PortalInvoiceLineSerializer(many=True)


class ConsentsSerializer(serializers.Serializer):
    email_reminders = serializers.BooleanField()
    share_in_facility = serializers.BooleanField()
    research = serializers.BooleanField()


class PortalProfileSerializer(serializers.Serializer):
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    mrn = serializers.CharField()
    date_of_birth = serializers.DateField()
    phone = serializers.CharField(allow_blank=True)
    email = serializers.CharField(allow_blank=True)
    consents = ConsentsSerializer()


class ProfileUpdateSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=16, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    consents = ConsentsSerializer(required=False)


class PortalHomeSerializer(serializers.Serializer):
    first_name = serializers.CharField()
    next_appointment = PortalAppointmentSerializer(allow_null=True)
    new_results = serializers.IntegerField()
    balance_minor = serializers.IntegerField()
    currency = serializers.CharField()
