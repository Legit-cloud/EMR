from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.core import policy
from apps.core.api.mixins import TenantModelViewSet
from apps.core.api.schema import list_filters, query
from apps.core.policy import Action

from .. import services
from ..models import Appointment, AvailabilityWindow
from . import serializers as s


@list_filters("physician")
class AvailabilityWindowViewSet(TenantModelViewSet):
    model = AvailabilityWindow
    policy_resource = "scheduling.availabilitywindow"
    serializer_class = s.AvailabilityWindowSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        physician = self.request.query_params.get("physician")
        return queryset.filter(physician_id=physician) if physician else queryset


@list_filters("patient", "physician", "status", "date", "series_id")
class AppointmentViewSet(TenantModelViewSet):
    """Booking, the appointment lifecycle and the physician queue."""

    model = Appointment
    policy_resource = "scheduling.appointment"
    policy_actions = {
        "set_status": Action.UPDATE,
        "triage": Action.UPDATE,
        "queue": Action.VIEW,
        "free_slots": Action.VIEW,
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_serializer_class(self):
        if self.action == "partial_update":
            return s.AppointmentUpdateSerializer
        return s.AppointmentSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        params = self.request.query_params
        for name in ("patient", "physician", "status", "series_id"):
            if params.get(name):
                field = name if name in ("status", "series_id") else f"{name}_id"
                queryset = queryset.filter(**{field: params[name]})
        if params.get("date"):
            queryset = queryset.filter(start_at__date=params["date"])
        return queryset

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        recurrence = data.pop("recurrence", None)
        with transaction.atomic():
            booked = services.book(data, recurrence=recurrence)
            for appointment in booked:
                self._require_in_scope(appointment, Action.CREATE)
                self.audit_write(Action.CREATE, appointment, sorted(serializer.validated_data))
        body = s.AppointmentSerializer(booked, many=True).data
        return Response(body if recurrence else body[0], status=status.HTTP_201_CREATED)

    @extend_schema(request=s.AppointmentStatusChangeSerializer, responses=s.AppointmentSerializer)
    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        appointment = self.get_object()
        data = s.AppointmentStatusChangeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            appointment = services.change_status(appointment, **data.validated_data)
            self.audit_write(Action.UPDATE, appointment, ["status"])
        return Response(s.AppointmentSerializer(appointment).data)

    @extend_schema(request=s.TriageSerializer, responses=s.AppointmentSerializer)
    @action(detail=True, methods=["post"])
    def triage(self, request, pk=None):
        appointment = self.get_object()
        data = s.TriageSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            appointment = services.set_triage_priority(
                appointment, data.validated_data["triage_priority"]
            )
            self.audit_write(Action.UPDATE, appointment, ["triage_priority"])
        return Response(s.AppointmentSerializer(appointment).data)

    @extend_schema(
        parameters=[query("physician", required=True)], responses=s.QueueEntrySerializer(many=True)
    )
    @action(detail=False, methods=["get"], pagination_class=None)
    def queue(self, request):
        """The physician's waiting queue (``?physician=``), as the WebSocket sends it."""
        physician = request.query_params.get("physician")
        if not physician:
            raise PermissionDenied("Choose a physician.")
        resource = self.get_policy_resource()
        q = policy.scope_q(self.policy_subject(), resource, Action.VIEW)
        return Response(services.queue_for(physician, None if q is None else q))

    @extend_schema(
        parameters=[query("physician", required=True), query("date", required=True)],
        responses=s.FreeSlotSerializer(many=True),
    )
    @action(detail=False, methods=["get"], url_path="free-slots", pagination_class=None)
    def free_slots(self, request):
        data = s.FreeSlotsQuerySerializer(data=request.query_params)
        data.is_valid(raise_exception=True)
        slots = services.free_slots(data.validated_data["physician"], data.validated_data["date"])
        return Response(
            [
                {
                    "start_at": slot["start_at"].isoformat(),
                    "end_at": slot["end_at"].isoformat(),
                    "facility": str(slot["facility"]),
                }
                for slot in slots
            ]
        )
