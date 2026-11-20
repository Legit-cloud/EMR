from rest_framework import serializers

from apps.core.api.serializers import CleanModelSerializer

from ..models import LeaveRequest, LeaveType, LicenceVerification, Shift, StaffProfile


class StaffProfileSerializer(CleanModelSerializer):
    display_name = serializers.CharField(source="__str__", read_only=True)
    on_duty = serializers.SerializerMethodField()

    class Meta:
        model = StaffProfile
        fields = [
            "id",
            "user",
            "display_name",
            "staff_type",
            "title",
            "specialty",
            "licensing_body",
            "licence_number",
            "licence_expires_on",
            "licence_verification",
            "licence_verified_at",
            "licence_verification_reference",
            "licence_flag",
            "consultation_fee_minor",
            "consultation_fee_currency",
            "on_duty",
        ]
        read_only_fields = [
            "id",
            "licence_verification",
            "licence_verified_at",
            "licence_verification_reference",
            "licence_flag",
        ]

    def get_on_duty(self, profile) -> bool:
        return any(s.ended_at is None for s in profile.shifts.all())

    def validate(self, attrs):
        if self.instance is not None and "user" in attrs and attrs["user"] != self.instance.user:
            raise serializers.ValidationError({"user": "A profile keeps its user."})
        return attrs


class LicenceVerificationSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(
        choices=[LicenceVerification.VERIFIED, LicenceVerification.REJECTED]
    )
    reference = serializers.CharField(max_length=200)


class ShiftSerializer(serializers.ModelSerializer):
    class Meta:
        model = Shift
        fields = ["id", "staff", "started_at", "ended_at"]
        read_only_fields = fields


class StaffSummarySerializer(serializers.Serializer):
    doctors = serializers.IntegerField()
    general = serializers.IntegerField()
    licences_expiring = serializers.IntegerField()
    licences_expired = serializers.IntegerField()


class LeaveSerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source="staff.user.get_full_name", read_only=True)
    days = serializers.IntegerField(read_only=True)
    is_mine = serializers.SerializerMethodField()

    def get_is_mine(self, leave) -> bool:
        request = self.context.get("request")
        return bool(request) and leave.staff.user_id == request.user.pk

    class Meta:
        model = LeaveRequest
        fields = [
            "id",
            "staff",
            "staff_name",
            "leave_type",
            "start_date",
            "end_date",
            "days",
            "note",
            "status",
            "decided_at",
            "decision_note",
            "is_mine",
        ]
        read_only_fields = fields


class LeaveRequestSerializer(serializers.Serializer):
    leave_type = serializers.ChoiceField(choices=LeaveType.choices)
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class LeaveDecisionSerializer(serializers.Serializer):
    approve = serializers.BooleanField()
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
