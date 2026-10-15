from rest_framework import serializers

from apps.core.roles import Role

from ..models import BreakGlassGrant, BreakGlassReview, RoleAssignment, User


class LoginResultSerializer(serializers.Serializer):
    user_id = serializers.UUIDField()
    mfa_enrolment_required = serializers.BooleanField()
    token = serializers.CharField(required=False)


class EnrolResultSerializer(serializers.Serializer):
    config_url = serializers.CharField()


class MfaEnabledSerializer(serializers.Serializer):
    mfa_enabled = serializers.BooleanField()


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128, trim_whitespace=False)
    otp_token = serializers.CharField(max_length=12, required=False, allow_blank=True)
    mode = serializers.ChoiceField(choices=["session", "token"], default="session")


class OTPTokenSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=12)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=64)
    token = serializers.CharField(max_length=128)
    new_password = serializers.CharField(max_length=128, trim_whitespace=False)


class MeSerializer(serializers.ModelSerializer):
    roles = serializers.SerializerMethodField()
    mfa_enabled = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "tenant", "roles"]
        fields += ["mfa_enabled"]

    def get_roles(self, user) -> list[str]:
        return sorted(self.context["roles"])

    def get_mfa_enabled(self, user) -> bool:
        return self.context["mfa_enabled"]


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "is_active"]
        read_only_fields = ["id", "is_active"]


class RoleAssignmentSerializer(serializers.ModelSerializer):
    role = serializers.ChoiceField(choices=Role.choices)

    class Meta:
        model = RoleAssignment
        fields = ["id", "user", "role", "facility", "department"]


class BreakGlassRequestSerializer(serializers.Serializer):
    resource = serializers.CharField(max_length=100)
    object_id = serializers.UUIDField()
    reason = serializers.CharField(max_length=2000)


class BreakGlassGrantSerializer(serializers.ModelSerializer):
    class Meta:
        model = BreakGlassGrant
        fields = [
            "id",
            "user",
            "resource",
            "object_id",
            "reason",
            "created_at",
            "expires_at",
            "review_status",
            "reviewed_by",
            "reviewed_at",
            "review_note",
        ]
        read_only_fields = fields


class BreakGlassReviewSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(
        choices=[BreakGlassReview.APPROPRIATE, BreakGlassReview.INAPPROPRIATE]
    )
    note = serializers.CharField(max_length=2000, allow_blank=True, default="")
