from django.db import transaction
from django.db.models import Prefetch
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.api.mixins import TenantModelViewSet, TenantReadOnlyViewSet
from apps.core.api.permissions import TenantUserPermission
from apps.core.policy import Action

from .. import services
from ..models import Shift, StaffProfile
from . import serializers as s


class StaffProfileViewSet(TenantModelViewSet):
    """Staff directory and licence records. HR and tenant admins maintain them."""

    model = StaffProfile
    policy_resource = "staff.staffprofile"
    policy_actions = {"verify_licence": Action.UPDATE}
    serializer_class = s.StaffProfileSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_base_queryset(self):
        open_shifts = Prefetch("shifts", queryset=Shift.objects.filter(ended_at__isnull=True))
        queryset = super().get_base_queryset().select_related("user").prefetch_related(open_shifts)
        params = self.request.query_params
        if params.get("staff_type"):
            queryset = queryset.filter(staff_type=params["staff_type"])
        if params.get("licence_flag"):
            queryset = queryset.filter(licence_flag=params["licence_flag"])
        return queryset

    @action(detail=True, methods=["post"], url_path="verify-licence")
    def verify_licence(self, request, pk=None):
        profile = self.get_object()
        data = s.LicenceVerificationSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            profile = services.record_licence_verification(
                profile, verified_by=request.user, **data.validated_data
            )
            self.audit_write(Action.UPDATE, profile, ["licence_verification"])
        return Response(self.get_serializer(profile).data)


class ShiftViewSet(TenantReadOnlyViewSet):
    model = Shift
    policy_resource = "staff.shift"
    serializer_class = s.ShiftSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        if self.request.query_params.get("open") == "true":
            queryset = queryset.filter(ended_at__isnull=True)
        return queryset


class ClockInView(APIView):
    """The caller starts their own shift (On-Duty)."""

    permission_classes = [TenantUserPermission]

    def post(self, request):
        shift = services.clock_in(request.user)
        return Response(s.ShiftSerializer(shift).data, status=status.HTTP_201_CREATED)


class ClockOutView(APIView):
    """The caller ends their own shift (Off-Duty)."""

    permission_classes = [TenantUserPermission]

    def post(self, request):
        return Response(s.ShiftSerializer(services.clock_out(request.user)).data)
