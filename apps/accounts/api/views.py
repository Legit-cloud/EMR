from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django_otp.plugins.otp_totp.models import TOTPDevice
from rest_framework import permissions, serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.api.mixins import TenantModelViewSet, TenantReadOnlyViewSet
from apps.core.api.permissions import TenantUserPermission
from apps.core.policy import Action
from apps.core.tenancy import get_current_tenant_id

from .. import selectors, services
from ..models import BreakGlassGrant, RoleAssignment, User
from . import serializers as s


class AuthThrottleMixin:
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class LoginView(AuthThrottleMixin, APIView):
    """Sign in with password and, when set up, a one-time code. Session or bearer token."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        data = s.LoginSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user, raw_token = services.sign_in(request, **data.validated_data)
        body = {
            "user_id": str(user.pk),
            "mfa_enrolment_required": services.mfa_enrolment_required(user),
        }
        if raw_token:
            body["token"] = raw_token
        return Response(body)


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        services.sign_out(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        context = {
            "roles": selectors.roles_of(user.pk) if get_current_tenant_id() else set(),
            "mfa_enabled": selectors.confirmed_totp_device(user) is not None,
        }
        return Response(s.MeSerializer(user, context=context).data)


class TOTPEnrolView(APIView):
    """Start authenticator-app enrolment. Allowed before MFA is set up."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        device: TOTPDevice = services.start_totp_enrolment(request)
        return Response({"config_url": device.config_url}, status=status.HTTP_201_CREATED)


class TOTPConfirmView(AuthThrottleMixin, APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        data = s.OTPTokenSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        services.confirm_totp_enrolment(request, data.validated_data["token"])
        return Response({"mfa_enabled": True})


class PasswordResetRequestView(AuthThrottleMixin, APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        data = s.PasswordResetRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        services.request_password_reset(request, data.validated_data["email"])
        return Response(status=status.HTTP_202_ACCEPTED)


class PasswordResetConfirmView(AuthThrottleMixin, APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        data = s.PasswordResetConfirmSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            services.reset_password(request, **data.validated_data)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": exc.messages}) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class BreakGlassRequestView(APIView):
    """A clinician opens one record outside their scope by giving a reason."""

    permission_classes = [TenantUserPermission]

    def post(self, request):
        data = s.BreakGlassRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        grant = services.request_break_glass(
            request,
            resource_name=data.validated_data["resource"],
            object_id=str(data.validated_data["object_id"]),
            reason=data.validated_data["reason"],
        )
        return Response(s.BreakGlassGrantSerializer(grant).data, status=status.HTTP_201_CREATED)


class BreakGlassGrantViewSet(TenantReadOnlyViewSet):
    """Compliance review queue for break-glass access."""

    model = BreakGlassGrant
    policy_resource = "accounts.breakglassgrant"
    policy_actions = {"review": Action.UPDATE}
    serializer_class = s.BreakGlassGrantSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        review_status = self.request.query_params.get("review_status")
        return queryset.filter(review_status=review_status) if review_status else queryset

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        grant = self.get_object()
        data = s.BreakGlassReviewSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        services.review_break_glass(request, grant, **data.validated_data)
        return Response(s.BreakGlassGrantSerializer(grant).data)


class UserViewSet(TenantModelViewSet):
    """Tenant admins manage the users of their organisation. Users are deactivated, not deleted."""

    model = User
    policy_resource = "accounts.user"
    policy_actions = {"deactivate": Action.UPDATE}
    serializer_class = s.UserSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_base_queryset(self):
        return User.objects.filter(tenant_id=get_current_tenant_id()).order_by("username")

    def perform_create(self, serializer):
        with transaction.atomic():
            user = serializer.save(tenant_id=get_current_tenant_id())
            user.set_unusable_password()
            user.save(update_fields=["password"])
            self.audit_write(Action.CREATE, user, sorted(serializer.validated_data))
            transaction.on_commit(lambda: services.invite_user(user))

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        user = self.get_object()
        services.deactivate_user(user)
        self.audit_write(Action.UPDATE, user, ["is_active"])
        return Response(s.UserSerializer(user).data)


class RoleAssignmentViewSet(TenantModelViewSet):
    model = RoleAssignment
    policy_resource = "accounts.roleassignment"
    serializer_class = s.RoleAssignmentSerializer
    http_method_names = ["get", "post", "delete", "head", "options"]

    def perform_create(self, serializer):
        try:
            super().perform_create(serializer)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict) from exc
