from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.core.api.exceptions import error_body
from apps.core.api.mixins import TenantModelViewSet, TenantReadOnlyViewSet
from apps.core.models import RecordState
from apps.core.policy import Action

from .. import services
from ..models import Allergy, Attachment, DuplicateReview, Patient, ReviewStatus
from ..normalize import name_key
from . import serializers as s


def _validation_error(exc: DjangoValidationError) -> serializers.ValidationError:
    detail = exc.message_dict if hasattr(exc, "error_dict") else {"non_field_errors": exc.messages}
    return serializers.ValidationError(detail)


class ChartViewSetMixin:
    """Entered-in-Error rows are hidden from lists unless ``?history=true``; never deleted."""

    http_method_names = ["get", "post", "patch", "head", "options"]
    policy_actions = {"entered_in_error": Action.DELETE}

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        if self.action == "list" and self.request.query_params.get("history") != "true":
            queryset = queryset.filter(record_state=RecordState.ACTIVE)
        return queryset

    @action(detail=True, methods=["post"], url_path="entered-in-error")
    def entered_in_error(self, request, pk=None):
        record = self.get_object()
        data = s.EnteredInErrorSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            services.mark_entered_in_error(record, data.validated_data["reason"])
            self.audit_write(Action.DELETE, record, ["record_state"])
        return Response(self.get_serializer(record).data)


class PatientViewSet(ChartViewSetMixin, TenantModelViewSet):
    """Patient register. Registration may be held for duplicate review (409)."""

    model = Patient
    policy_resource = "patients.patient"
    policy_actions = {**ChartViewSetMixin.policy_actions, "set_status": Action.UPDATE}
    serializer_class = s.PatientSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        query = self.request.query_params.get("q", "").strip()
        if self.action == "list" and query:
            key = name_key(query)
            queryset = queryset.filter(
                Q(mrn__iexact=query)
                | Q(phone=query)
                | Q(first_name_key__icontains=key)
                | Q(last_name_key__icontains=key)
            )
        return queryset

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            try:
                outcome = services.register_patient(serializer.validated_data)
            except DjangoValidationError as exc:
                raise _validation_error(exc) from exc
            if isinstance(outcome, DuplicateReview):
                self.audit_write(Action.CREATE, outcome, ["duplicate_review"])
            else:
                self._require_in_scope(outcome, Action.CREATE)
                self.audit_write(Action.CREATE, outcome, sorted(serializer.validated_data))
        if isinstance(outcome, DuplicateReview):
            body = error_body(
                "possible_duplicate",
                "This person may already be registered. The registration is held for review.",
                {
                    "review_id": str(outcome.pk),
                    "candidates": [
                        {k: c[k] for k in ("patient_id", "mrn", "score")}
                        for c in outcome.candidates
                    ],
                },
            )
            return Response(body, status=status.HTTP_409_CONFLICT)
        return Response(self.get_serializer(outcome).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        patient = self.get_object()
        data = s.StatusChangeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            try:
                patient = services.change_status(patient, **data.validated_data)
            except DjangoValidationError as exc:
                raise _validation_error(exc) from exc
            self.audit_write(Action.UPDATE, patient, ["status", "deceased_at"])
        return Response(self.get_serializer(patient).data)


class AllergyViewSet(ChartViewSetMixin, TenantModelViewSet):
    model = Allergy
    policy_resource = "patients.allergy"
    serializer_class = s.AllergySerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        patient = self.request.query_params.get("patient")
        return queryset.filter(patient_id=patient) if patient else queryset


class AttachmentViewSet(ChartViewSetMixin, TenantModelViewSet):
    """Files in private storage. Content is only reachable through a short-lived signed URL."""

    model = Attachment
    policy_resource = "patients.attachment"
    policy_actions = {**ChartViewSetMixin.policy_actions, "download": Action.VIEW}
    serializer_class = s.AttachmentSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ["get", "post", "head", "options"]

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        patient = self.request.query_params.get("patient")
        return queryset.filter(patient_id=patient) if patient else queryset

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        attachment = self.get_object()
        return Response(
            {
                "url": attachment.file.url,
                "expires_in": settings.PATIENT_ATTACHMENT_URL_SECONDS,
                "content_type": attachment.content_type,
                "original_name": attachment.original_name,
            }
        )


class DuplicateReviewViewSet(TenantReadOnlyViewSet):
    """Queue of registrations held as possible duplicates."""

    model = DuplicateReview
    policy_resource = "patients.duplicatereview"
    policy_actions = {"resolve": Action.UPDATE}
    serializer_class = s.DuplicateReviewSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        review_status = self.request.query_params.get("status")
        return queryset.filter(status=review_status) if review_status else queryset

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        review = self.get_object()
        data = s.ResolveReviewSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        decision = data.validated_data["decision"]
        registration = None
        if decision == ReviewStatus.CREATED_NEW:
            payload = s.PatientSerializer(data=review.payload)
            payload.is_valid(raise_exception=True)
            registration = payload.validated_data
        with transaction.atomic():
            try:
                review = services.resolve_duplicate_review(
                    review,
                    decision=decision,
                    note=data.validated_data["note"],
                    matched_patient=data.validated_data.get("matched_patient"),
                    data=registration,
                )
            except DjangoValidationError as exc:
                raise _validation_error(exc) from exc
            self.audit_write(Action.UPDATE, review, ["status"])
            if review.created_patient_id:
                self.audit_write_for(
                    "patients.patient", review.created_patient_id, sorted(registration)
                )
        return Response(self.get_serializer(review).data)

    def audit_write_for(self, resource, object_id, fields):
        from apps.audit import services as audit

        audit.record(
            action=audit.AuditAction.CREATE,
            request=self.request,
            resource=resource,
            object_id=object_id,
            details={"fields": fields, "view_action": self.action},
        )
