from django.db import transaction
from django.db.models import Prefetch, Q
from drf_spectacular.utils import extend_schema
from rest_framework import generics
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.mixins import TenantModelViewSet
from apps.core.api.permissions import TenantUserPermission
from apps.core.api.schema import list_filters
from apps.core.api.serializers import EnteredInErrorSerializer
from apps.core.models import RecordState
from apps.core.policy import Action

from .. import services
from ..models import (
    ConsultationNote,
    Diagnosis,
    Encounter,
    Icd10Code,
    LoincCode,
    Observation,
)
from ..models import VitalSigns as VitalSignsModel
from . import serializers as s


class ChartViewSetMixin:
    """Lists show the active chart; ``?history=true`` adds Entered-in-Error rows.

    Nothing is deleted: Entered-in-Error hides a row with a reason, and history keeps it.
    """

    http_method_names = ["get", "post", "patch", "head", "options"]
    policy_actions = {"entered_in_error": Action.DELETE}

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        params = self.request.query_params
        if self.action == "list":
            if params.get("history") != "true":
                queryset = queryset.filter(record_state=RecordState.ACTIVE)
            for name in ("patient", "encounter"):
                if params.get(name):
                    queryset = queryset.filter(**{f"{name}_id": params[name]})
        return queryset

    @extend_schema(request=EnteredInErrorSerializer)
    @action(detail=True, methods=["post"], url_path="entered-in-error")
    def entered_in_error(self, request, pk=None):
        record = self.get_object()
        data = EnteredInErrorSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            services.mark_entered_in_error(record, data.validated_data["reason"])
            self.audit_write(Action.DELETE, record, ["record_state"])
        return Response(self.get_serializer(record).data)


@list_filters("patient", "encounter", "history")
class EncounterViewSet(ChartViewSetMixin, TenantModelViewSet):
    model = Encounter
    policy_resource = "clinical.encounter"
    policy_actions = {
        **ChartViewSetMixin.policy_actions,
        "set_status": Action.UPDATE,
        "rank_diagnoses": Action.UPDATE,
    }
    serializer_class = s.EncounterSerializer

    def perform_create(self, serializer):
        services.check_patient_can_have_encounter(serializer.validated_data["patient"].pk)
        if "practitioner" not in serializer.validated_data:
            serializer.validated_data["practitioner"] = self.request.user
        super().perform_create(serializer)

    @extend_schema(request=s.EncounterStatusSerializer, responses=s.EncounterSerializer)
    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        encounter = self.get_object()
        data = s.EncounterStatusSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            encounter = services.change_encounter_status(encounter, data.validated_data["status"])
            self.audit_write(Action.UPDATE, encounter, ["status"])
        return Response(self.get_serializer(encounter).data)

    @extend_schema(request=s.RankSerializer, responses=s.DiagnosisSerializer(many=True))
    @action(detail=True, methods=["post"], url_path="rank-diagnoses")
    def rank_diagnoses(self, request, pk=None):
        encounter = self.get_object()
        data = s.RankSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            ranked = services.rank_diagnoses(encounter, data.validated_data["diagnosis_ids"])
            self.audit_write(Action.UPDATE, encounter, ["diagnosis_rank"])
        return Response(s.DiagnosisSerializer(ranked, many=True).data)


@list_filters("patient", "encounter", "history")
class VitalSignsViewSet(ChartViewSetMixin, TenantModelViewSet):
    model = VitalSignsModel
    policy_resource = "clinical.vitalsigns"
    serializer_class = s.VitalSignsSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_base_queryset(self):
        observations = Prefetch(
            "observations", queryset=Observation.objects.select_related("code").order_by("code")
        )
        return super().get_base_queryset().prefetch_related(observations)

    def perform_create(self, serializer):
        data = serializer.validated_data
        with transaction.atomic():
            vitals = services.record_vital_signs(
                encounter=data["encounter"],
                readings=data["readings"],
                recorded_at=data.get("recorded_at"),
                note=data.get("note", ""),
            )
            serializer.instance = vitals
            self._require_in_scope(vitals, Action.CREATE)
            codes = sorted(o.code_id for o in vitals.observations.all())
            self.audit_write(Action.CREATE, vitals, codes)


@list_filters("patient", "encounter", "history", "current")
class DiagnosisViewSet(ChartViewSetMixin, TenantModelViewSet):
    model = Diagnosis
    policy_resource = "clinical.diagnosis"
    serializer_class = s.DiagnosisSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        if self.action == "list" and self.request.query_params.get("current") == "true":
            queryset = queryset.filter(
                Q(clinical_status__in=["active", "recurrence"]) & ~Q(verification_status="refuted")
            )
        return queryset

    def perform_create(self, serializer):
        if "rank" not in serializer.validated_data:
            serializer.validated_data["rank"] = services.next_rank(
                serializer.validated_data["encounter"].pk
            )
        serializer.validated_data["patient_id"] = serializer.validated_data["encounter"].patient_id
        super().perform_create(serializer)


@list_filters("patient", "encounter", "history")
class ConsultationNoteViewSet(ChartViewSetMixin, TenantModelViewSet):
    model = ConsultationNote
    policy_resource = "clinical.consultationnote"
    policy_actions = {**ChartViewSetMixin.policy_actions, "close": Action.UPDATE}
    serializer_class = s.ConsultationNoteSerializer

    def perform_create(self, serializer):
        serializer.validated_data["patient_id"] = serializer.validated_data["encounter"].patient_id
        super().perform_create(serializer)

    def perform_update(self, serializer):
        services.check_note_editable(serializer.instance)
        super().perform_update(serializer)

    @extend_schema(request=None, responses=s.ConsultationNoteSerializer)
    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        note = self.get_object()
        with transaction.atomic():
            note = services.close_note(note)
            self.audit_write(Action.UPDATE, note, ["status"])
        return Response(self.get_serializer(note).data)


class LoincCodeList(generics.ListAPIView):
    """Reference data: LOINC vital-sign codes with UCUM units. No tenant data."""

    permission_classes = [TenantUserPermission]
    serializer_class = s.LoincCodeSerializer
    queryset = LoincCode.objects.all()
    pagination_class = None


class Icd10CodeList(generics.ListAPIView):
    """Reference data: ICD-10 code search (``?q=``). No tenant data."""

    permission_classes = [TenantUserPermission]
    serializer_class = s.Icd10CodeSerializer

    def get_queryset(self):
        query = self.request.query_params.get("q", "").strip()
        queryset = Icd10Code.objects.all()
        if query:
            queryset = queryset.filter(Q(code__istartswith=query) | Q(display__icontains=query))
        return queryset
