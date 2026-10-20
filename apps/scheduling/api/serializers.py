from django.conf import settings
from rest_framework import serializers

from apps.core.api.serializers import CleanModelSerializer
from apps.patients import selectors as patients

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
    patient_name = serializers.SerializerMethodField(
        help_text="The patient's name, for calendars and lists."
    )
    patient_mrn = serializers.SerializerMethodField()

    class Meta:
        model = Appointment
        fields = [
            "id",
            "patient",
            "patient_name",
            "patient_mrn",
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

    def _patient(self, appointment) -> dict:
        # Lists fill ``patients`` in one query; a single appointment looks itself up.
        known = self.context.get("patients")
        if known is None:
            known = patients.summaries([appointment.patient_id])
        return known.get(appointment.patient_id, {})

    def get_patient_name(self, appointment) -> str:
        return self._patient(appointment).get("name", "")

    def get_patient_mrn(self, appointment) -> str:
        return self._patient(appointment).get("mrn", "")


class AppointmentUpdateSerializer(serializers.ModelSerializer):
    """Only the visit reason can be edited; times move by cancelling and rebooking."""

    class Meta:
        model = Appointment
        fields = ["reason"]


class RescheduleSerializer(serializers.Serializer):
    start_at = serializers.DateTimeField()
    # Left out, the appointment keeps its length.
    end_at = serializers.DateTimeField(required=False)
    # Left out, the appointment stays with its physician.
    physician = serializers.UUIDField(required=False)

    def validate(self, attrs):
        end = attrs.get("end_at")
        if end is not None and end <= attrs["start_at"]:
            raise serializers.ValidationError({"end_at": "The end must be after the start."})
        return attrs


class AppointmentStatusChangeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=AppointmentStatus.choices)
    # Blank is fine for every change but cancelling; the service requires a reason then.
    cancellation_reason = serializers.CharField(
        max_length=500, required=False, allow_blank=True, default=""
    )
    triage_priority = serializers.IntegerField(min_value=1, max_value=5, required=False)


class TriageSerializer(serializers.Serializer):
    triage_priority = serializers.IntegerField(min_value=1, max_value=5)


class QueueEntrySerializer(serializers.Serializer):
    appointment_id = serializers.UUIDField()
    patient_id = serializers.UUIDField()
    patient_name = serializers.CharField()
    mrn = serializers.CharField()
    appointment_type = serializers.CharField()
    triage_priority = serializers.IntegerField(allow_null=True)
    checked_in_at = serializers.DateTimeField()
    start_at = serializers.DateTimeField()


class FreeSlotSerializer(serializers.Serializer):
    start_at = serializers.DateTimeField()
    end_at = serializers.DateTimeField()
    facility = serializers.UUIDField()


class FreeSlotsQuerySerializer(serializers.Serializer):
    physician = serializers.UUIDField()
    date = serializers.DateField()
