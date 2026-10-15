from django.conf import settings
from rest_framework import serializers

from apps.core.api.serializers import CleanModelSerializer

from ..models import Appointment, AppointmentStatus, AvailabilityWindow
from ..services import RECURRENCE_STEP


class AvailabilityWindowSerializer(CleanModelSerializer):
    class Meta:
        model = AvailabilityWindow
        fields = ["id", "physician", "facility", "department", "start_at", "end_at"]
        read_only_fields = ["id"]


class RecurrenceSerializer(serializers.Serializer):
    frequency = serializers.ChoiceField(choices=sorted(RECURRENCE_STEP))
    count = serializers.IntegerField(min_value=2)

    def validate_count(self, value):
        if value > settings.APPOINTMENT_MAX_RECURRENCE:
            raise serializers.ValidationError(
                f"At most {settings.APPOINTMENT_MAX_RECURRENCE} appointments in a series."
            )
        return value


class AppointmentSerializer(serializers.ModelSerializer):
    recurrence = RecurrenceSerializer(write_only=True, required=False)

    class Meta:
        model = Appointment
        fields = [
            "id",
            "patient",
            "physician",
            "facility",
            "department",
            "appointment_type",
            "start_at",
            "end_at",
            "status",
            "reason",
            "cancellation_reason",
            "cancelled_at",
            "triage_priority",
            "checked_in_at",
            "checked_in_by",
            "consultation_started_at",
            "completed_at",
            "encounter_id",
            "series_id",
            "recurrence",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "cancellation_reason",
            "cancelled_at",
            "triage_priority",
            "checked_in_at",
            "checked_in_by",
            "consultation_started_at",
            "completed_at",
            "encounter_id",
            "series_id",
            "created_at",
        ]
        extra_kwargs = {"end_at": {"required": False}}
        # Overlaps are checked by the service and the database constraint.
        validators = []


class AppointmentUpdateSerializer(serializers.ModelSerializer):
    """Only the visit reason can be edited; times move by cancelling and rebooking."""

    class Meta:
        model = Appointment
        fields = ["reason"]


class StatusChangeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=AppointmentStatus.choices)
    cancellation_reason = serializers.CharField(max_length=500, required=False, default="")
    triage_priority = serializers.IntegerField(min_value=1, max_value=5, required=False)


class TriageSerializer(serializers.Serializer):
    triage_priority = serializers.IntegerField(min_value=1, max_value=5)


class FreeSlotsQuerySerializer(serializers.Serializer):
    physician = serializers.UUIDField()
    date = serializers.DateField()
