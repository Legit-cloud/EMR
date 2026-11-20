from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.core.roles import Role

from ..models import BreakGlassGrant, BreakGlassReview, RoleAssignment, User


class LoginResultSerializer(serializers.Serializer):
    user_id = serializers.UUIDField()
    token = serializers.CharField(required=False)


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128, trim_whitespace=False)
    otp_token = serializers.CharField(max_length=12, required=False, allow_blank=True)
    mode = serializers.ChoiceField(choices=["session", "token"], default="session")


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=64)
    token = serializers.CharField(max_length=128)
    new_password = serializers.CharField(max_length=128, trim_whitespace=False)


class AssignmentSerializer(serializers.Serializer):
    role = serializers.CharField()
    facility = serializers.UUIDField(allow_null=True, source="facility_id")
    department = serializers.UUIDField(allow_null=True, source="department_id")


class MeSerializer(serializers.ModelSerializer):
    """The signed-in user and the attributes the web app uses to tailor menus and buttons.

    These are hints for the interface only; every request is still authorised server-side.
    """

    roles = serializers.SerializerMethodField()
    mfa_enabled = serializers.SerializerMethodField()
    assignments = serializers.SerializerMethodField()
    on_duty = serializers.SerializerMethodField()
    can_break_glass = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "tenant", "roles"]
        fields += ["mfa_enabled", "assignments", "on_duty", "can_break_glass"]

    def get_roles(self, user) -> list[str]:
        return sorted(self.context["subject"].roles)

    def get_mfa_enabled(self, user) -> bool:
        return self.context["mfa_enabled"]

    @extend_schema_field(AssignmentSerializer(many=True))
    def get_assignments(self, user):
        return AssignmentSerializer(self.context["subject"].assignments, many=True).data

    def get_on_duty(self, user) -> bool:
        return self.context["subject"].on_duty()

    def get_can_break_glass(self, user) -> bool:
        return self.context["subject"].can_break_glass()


# Roles an administrator can invite someone as. The patient role comes from the portal.
INVITABLE_ROLE_CHOICES = [(r.value, r.label) for r in Role if r != Role.PATIENT]


class UserSerializer(serializers.ModelSerializer):
    # People sign in with their email address, so a username is optional and defaults to it.
    username = serializers.CharField(max_length=150, required=False)
    email = serializers.EmailField(max_length=254)
    # Who the person is invited as. Write-only: roles are read from role-assignments.
    role = serializers.ChoiceField(choices=INVITABLE_ROLE_CHOICES, write_only=True, required=False)

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "is_active", "role"]
        read_only_fields = ["id", "is_active"]

    def validate(self, attrs):
        email = attrs.get("email", getattr(self.instance, "email", "")).strip().lower()
        if "email" in attrs:
            attrs["email"] = email
        if self.instance is None:
            attrs["username"] = (attrs.get("username") or email).strip()
            if User.objects.filter(username__iexact=attrs["username"]).exists():
                raise serializers.ValidationError({"username": "That username is already taken."})
            if User.objects.filter(email__iexact=email, is_active=True).exists():
                raise serializers.ValidationError(
                    {"email": "That email address already belongs to another account."}
                )
        return attrs


class PermissionLineSerializer(serializers.Serializer):
    resource = serializers.CharField()
    label = serializers.CharField()
    actions = serializers.ListField(child=serializers.CharField())
    limit = serializers.CharField(allow_blank=True)
    on_duty_only = serializers.BooleanField()


class RoleInfoSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=Role.choices)
    label = serializers.CharField()
    description = serializers.CharField()
    permissions = PermissionLineSerializer(many=True)


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


class PatientBreakGlassSerializer(serializers.Serializer):
    """Whether part of a patient's chart is outside the user's access, and any open grant."""

    patient = serializers.UUIDField()
    hidden_records = serializers.BooleanField()
    can_break_glass = serializers.BooleanField()
    grant = BreakGlassGrantSerializer(allow_null=True)
