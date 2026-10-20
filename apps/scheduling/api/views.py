from django.db import transaction
from django.utils.dateparse import parse_datetime
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.core import policy
from apps.core.api.mixins import TenantModelViewSet
from apps.core.api.pagination import PageSizePagination
from apps.core.api.schema import list_filters, query
from apps.core.policy import Action
from apps.patients import selectors as patients

from .. import services
from ..models import Appointment, AvailabilityWindow
from . import serializers as s


def _time_param(request, name):
    """A query parameter that must be an ISO 8601 date and time with a zone, or absent."""
    raw = request.query_params.get(name)
    if not raw:
        return None
    value = parse_datetime(raw)
    if value is None or value.tzinfo is None:
        raise serializers.ValidationError({name: "Use an ISO 8601 date and time with a zone."})
    return value


@list_filters("physician", "from", "to", "page_size")
class AvailabilityWindowViewSet(TenantModelViewSet):
    model = AvailabilityWindow
    policy_resource = "scheduling.availabilitywindow"
    serializer_class = s.AvailabilityWindowSerializer
    pagination_class = PageSizePagination

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        physician = self.request.query_params.get("physician")
        if physician:
            queryset = queryset.filter(physician_id=physician)
        # Windows that overlap [from, to).
        if start := _time_param(self.request, "from"):
            queryset = queryset.filter(end_at__gt=start)
        if end := _time_param(self.request, "to"):
            queryset = queryset.filter(start_at__lt=end)
        return queryset


@list_filters("patient", "physician", "status", "date", "series_id", "from", "to", "page_size")
class AppointmentViewSet(TenantModelViewSet):
    """Booking, the appointment lifecycle and the physician queue."""

    model = Appointment
    policy_resource = "scheduling.appointment"
    policy_actions = {
        "set_status": Action.UPDATE,
        "triage": Action.UPDATE,
        "queue": Action.VIEW,
        "free_slots": Action.VIEW,
        "reschedule": Action.UPDATE,
    }
    http_method_names = ["get", "post", "patch", "head", "options"]
    pagination_class = PageSizePagination

    def get_serializer_class(self):
        if self.action == "partial_update":
            return s.AppointmentUpdateSerializer
        return s.AppointmentSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        params = self.request.query_params
        for name in ("patient", "physician", "series_id"):
            if params.get(name):
                field = "series_id" if name == "series_id" else f"{name}_id"
                queryset = queryset.filter(**{field: params[name]})
        if params.get("status"):
            # One status, or several separated by commas ("completed,no_show,cancelled").
            queryset = queryset.filter(status__in=params["status"].split(","))
        if params.get("date"):
            queryset = queryset.filter(start_at__date=params["date"])
        if start := _time_param(self.request, "from"):
            queryset = queryset.filter(start_at__gte=start)
        if end := _time_param(self.request, "to"):
            queryset = queryset.filter(start_at__lt=end)
        return queryset

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        rows = list(queryset if page is None else page)
        # Names for the whole page in one query, so a busy calendar is not one query per card.
        context = {
            **self.get_serializer_context(),
            "patients": patients.summaries({row.patient_id for row in rows}),
        }
        data = self.get_serializer(rows, many=True, context=context).data
        return Response(data) if page is None else self.get_paginated_response(data)

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

    @extend_schema(request=s.RescheduleSerializer, responses=s.AppointmentSerializer)
    @action(detail=True, methods=["post"])
    def reschedule(self, request, pk=None):
        """Move an appointment that has not started to another time or physician."""
        appointment = self.get_object()
        data = s.RescheduleSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        with transaction.atomic():
            appointment = services.reschedule(
                appointment,
                values["start_at"],
                end_at=values.get("end_at"),
                physician_id=values.get("physician"),
            )
            # A move to another physician must still be inside the caller's own scope.
            self._require_in_scope(appointment, Action.UPDATE)
            self.audit_write(Action.UPDATE, appointment, sorted(values))
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
