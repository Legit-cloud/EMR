from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Exists, OuterRef, Prefetch, Q
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle

from apps.audit import services as audit
from apps.core import policy
from apps.core.api.exceptions import error_body
from apps.core.api.mixins import TenantModelViewSet, TenantReadOnlyViewSet
from apps.core.api.pagination import PageSizePagination
from apps.core.api.schema import list_filters
from apps.core.api.serializers import EnteredInErrorSerializer
from apps.core.models import RecordState
from apps.core.policy import Action
from apps.scheduling import selectors as scheduling

from .. import duplicates, services
from ..models import Allergy, Attachment, DuplicateReview, Patient, PatientStatus, ReviewStatus
from ..normalize import name_key
from . import serializers as s


def audit_new_allergies(request, patient, view_action: str) -> None:
    """Allergies saved with a registration are writes to the allergy record: log each."""
    for allergy in Allergy.objects.filter(patient=patient):
        audit.record(
            action=audit.AuditAction.CREATE,
            request=request,
            resource="patients.allergy",
            object_id=allergy.pk,
            details={
                "fields": ["substance", "category", "reaction", "severity"],
                "view_action": view_action,
            },
        )


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


# Sort fields the register offers; a leading "-" reverses. Names sort on the folded keys.
PATIENT_ORDERING = {
    "name": ("last_name_key", "first_name_key"),
    "mrn": ("mrn",),
    "date_of_birth": ("date_of_birth",),
    "created_at": ("created_at",),
}


def _ordering(value: str | None) -> list[str]:
    value = value or "-created_at"
    fields = PATIENT_ORDERING.get(value.lstrip("-"), PATIENT_ORDERING["created_at"])
    return [f"-{f}" if value.startswith("-") else f for f in fields] + ["pk"]


@list_filters("q", "history", "status", "allergy", "ordering", "page_size")
class PatientViewSet(ChartViewSetMixin, TenantModelViewSet):
    """Patient register. Registration may be held for duplicate review (409)."""

    model = Patient
    policy_resource = "patients.patient"
    policy_actions = {
        **ChartViewSetMixin.policy_actions,
        "set_status": Action.UPDATE,
        # Checking for duplicates is part of registering: it needs the right to register.
        "check_duplicates": Action.CREATE,
    }
    pagination_class = PageSizePagination
    # Set per action (check_duplicates); DRF only accepts action overrides for attributes
    # the class already declares.
    throttle_scope = None

    def get_serializer_class(self):
        return {
            "create": s.PatientRegistrationSerializer,
            "list": s.PatientListSerializer,
            "check_duplicates": s.DuplicateCheckSerializer,
        }.get(self.action, s.PatientSerializer)

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        if self.action != "list":
            return queryset
        params = self.request.query_params
        query = params.get("q", "").strip()[:100]
        if query:
            key = name_key(query)
            queryset = queryset.filter(
                Q(mrn__iexact=query)
                | Q(phone=query)
                | Q(first_name_key__icontains=key)
                | Q(last_name_key__icontains=key)
            )
        if params.get("status") in PatientStatus.values:
            queryset = queryset.filter(status=params["status"])
        active_allergies = Allergy.objects.filter(record_state=RecordState.ACTIVE)
        if params.get("allergy") == "true":
            queryset = queryset.filter(Exists(active_allergies.filter(patient=OuterRef("pk"))))
        return queryset.order_by(*_ordering(params.get("ordering"))).prefetch_related(
            Prefetch("allergies", queryset=active_allergies, to_attr="active_allergies")
        )

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        rows = list(queryset if page is None else page)
        context = {**self.get_serializer_context(), "last_visits": self._last_visits(rows)}
        data = self.get_serializer(rows, many=True, context=context).data
        return Response(data) if page is None else self.get_paginated_response(data)

    def _last_visits(self, patients) -> dict:
        """Last attended visit per patient, from the appointments this user may view."""
        scope = policy.visible_q(
            self.policy_subject(), policy.get_resource("scheduling.appointment"), Action.VIEW
        )
        if scope is None:
            return {}
        return scheduling.last_visits([p.pk for p in patients], scope)

    @extend_schema(
        request=s.DuplicateCheckSerializer, responses=s.DuplicateMatchSerializer(many=True)
    )
    @action(
        detail=False,
        methods=["post"],
        url_path="check-duplicates",
        pagination_class=None,
        throttle_classes=[UserRateThrottle, ScopedRateThrottle],
        throttle_scope="duplicate_check",
    )
    def check_duplicates(self, request):
        """Possible matches for the person being registered, for the form to show as the
        clerk types. Nothing is saved; matches above the hold threshold say so."""
        data = s.DuplicateCheckSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        matches = duplicates.find_probable_duplicates(
            **data.validated_data, threshold=settings.PATIENT_DUPLICATE_HINT_THRESHOLD
        )
        people = {
            str(p.pk): p for p in Patient.objects.filter(pk__in=[m["patient_id"] for m in matches])
        }
        rows = [
            {
                "patient_id": m["patient_id"],
                "mrn": m["mrn"],
                "first_name": people[m["patient_id"]].first_name,
                "last_name": people[m["patient_id"]].last_name,
                "date_of_birth": people[m["patient_id"]].date_of_birth,
                "sex": people[m["patient_id"]].sex,
                "score": m["score"],
                "would_hold": duplicates.is_probable_duplicate(m["score"]),
            }
            for m in matches
            if m["patient_id"] in people
        ]
        if rows:
            # Names and dates of birth of other patients were shown: that is a read.
            audit.record(
                action=audit.AuditAction.READ,
                request=request,
                resource=self.policy_resource,
                details={
                    "view_action": self.action,
                    "object_ids": [r["patient_id"] for r in rows],
                    "count": len(rows),
                },
            )
        return Response(s.DuplicateMatchSerializer(rows, many=True).data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data.get("allergies") and not policy.can(
            self.policy_subject(), policy.get_resource("patients.allergy"), Action.CREATE
        ):
            raise PermissionDenied(
                "Your role cannot record allergies. Remove them, or ask a clinician to add them."
            )
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
                audit_new_allergies(request, outcome, "create")
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

    @extend_schema(request=s.PatientStatusChangeSerializer, responses=s.PatientSerializer)
    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        patient = self.get_object()
        data = s.PatientStatusChangeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            try:
                patient = services.change_status(patient, **data.validated_data)
            except DjangoValidationError as exc:
                raise _validation_error(exc) from exc
            self.audit_write(Action.UPDATE, patient, ["status", "deceased_at"])
        return Response(self.get_serializer(patient).data)


@list_filters("patient", "history")
class AllergyViewSet(ChartViewSetMixin, TenantModelViewSet):
    model = Allergy
    policy_resource = "patients.allergy"
    serializer_class = s.AllergySerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        patient = self.request.query_params.get("patient")
        return queryset.filter(patient_id=patient) if patient else queryset


@list_filters("patient", "history")
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

    @extend_schema(responses=s.AttachmentDownloadSerializer)
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


@list_filters("status")
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

    @extend_schema(request=s.ResolveReviewSerializer)
    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        review = self.get_object()
        data = s.ResolveReviewSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        decision = data.validated_data["decision"]
        registration = None
        if decision == ReviewStatus.CREATED_NEW:
            payload = s.PatientRegistrationSerializer(data=review.payload)
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
                audit_new_allergies(self.request, review.created_patient, "resolve")
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
