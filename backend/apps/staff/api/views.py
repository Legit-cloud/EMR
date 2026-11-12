from django.db import transaction
from django.db.models import Count, Prefetch, Q
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.api.mixins import TenantModelViewSet, TenantReadOnlyViewSet
from apps.core.api.pagination import PageSizePagination
from apps.core.api.permissions import TenantUserPermission
from apps.core.api.schema import list_filters
from apps.core.policy import Action

from .. import services
from ..models import LicenceFlag, Shift, StaffProfile, StaffType
from . import serializers as s


@list_filters("staff_type", "licence_flag", "group", "q", "page_size")
class StaffProfileViewSet(TenantModelViewSet):
    """Staff directory and licence records. HR and tenant admins maintain them."""

    model = StaffProfile
    policy_resource = "staff.staffprofile"
    policy_actions = {"verify_licence": Action.UPDATE, "summary": Action.VIEW}
    pagination_class = PageSizePagination
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
        if params.get("group") == "doctors":
            queryset = queryset.filter(staff_type=StaffType.PHYSICIAN)
        elif params.get("group") == "general":
            queryset = queryset.exclude(staff_type=StaffType.PHYSICIAN)
        text = params.get("q", "").strip()[:100]
        if text:
            for word in text.split():
                queryset = queryset.filter(
                    Q(user__first_name__icontains=word)
                    | Q(user__last_name__icontains=word)
                    | Q(specialty__icontains=word)
                    | Q(licence_number__icontains=word)
                )
        return queryset

    @extend_schema(responses=s.StaffSummarySerializer)
    @action(detail=False, methods=["get"], pagination_class=None)
    def summary(self, request):
        """Headcount for the two tabs, and how many licences need attention."""
        rows = self.get_queryset()
        doctors = Q(staff_type=StaffType.PHYSICIAN)
        counts = rows.aggregate(
            doctors=Count("pk", filter=doctors),
            general=Count("pk", filter=~doctors),
            licences_expiring=Count("pk", filter=Q(licence_flag=LicenceFlag.EXPIRING)),
            licences_expired=Count("pk", filter=Q(licence_flag=LicenceFlag.EXPIRED)),
        )
        return Response(counts)

    @extend_schema(request=s.LicenceVerificationSerializer, responses=s.StaffProfileSerializer)
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

    @extend_schema(request=None, responses={201: s.ShiftSerializer})
    def post(self, request):
        shift = services.clock_in(request.user)
        return Response(s.ShiftSerializer(shift).data, status=status.HTTP_201_CREATED)


class ClockOutView(APIView):
    """The caller ends their own shift (Off-Duty)."""

    permission_classes = [TenantUserPermission]

    @extend_schema(request=None, responses=s.ShiftSerializer)
    def post(self, request):
        return Response(s.ShiftSerializer(services.clock_out(request.user)).data)
