from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.mixins import TenantModelViewSet, TenantReadOnlyViewSet
from apps.core.api.schema import list_filters
from apps.core.policy import Action

from .. import selectors, services
from ..models import Admission, Bed, Ward
from . import serializers as s


class WardViewSet(TenantModelViewSet):
    """``GET`` is the ward board (every ward, its beds and who is in them); the administrator
    sets wards up with POST and PATCH."""

    model = Ward
    policy_resource = "inpatient.ward"
    http_method_names = ["get", "post", "patch", "head", "options"]
    pagination_class = None

    def get_serializer_class(self):
        return s.WardSerializer if self.action != "list" else s.BoardWardSerializer

    @extend_schema(responses=s.BoardWardSerializer(many=True))
    def list(self, request, *args, **kwargs):
        wards, occupants = selectors.board()
        data = s.BoardWardSerializer(wards, many=True, context={"occupants": occupants}).data
        return Response(data)


class BedViewSet(TenantModelViewSet):
    """Beds are created by the administrator; a nurse marks a cleaned bed ready, or a vacant
    bed out of service."""

    model = Bed
    policy_resource = "inpatient.bed"
    policy_actions = {
        "ready": Action.UPDATE,
        "out_of_service": Action.UPDATE,
        "in_service": Action.UPDATE,
    }
    serializer_class = s.BedSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_base_queryset(self):
        return super().get_base_queryset().select_related("ward")

    @extend_schema(request=None, responses=s.BedSerializer)
    @action(detail=True, methods=["post"])
    def ready(self, request, pk=None):
        bed = self.get_object()
        with transaction.atomic():
            bed = services.mark_ready(bed)
            self.audit_write(Action.UPDATE, bed, ["status"])
        return Response(self.get_serializer(bed).data)

    @extend_schema(request=None, responses=s.BedSerializer)
    @action(detail=True, methods=["post"], url_path="out-of-service")
    def out_of_service(self, request, pk=None):
        bed = self.get_object()
        with transaction.atomic():
            bed = services.set_out_of_service(bed, True)
            self.audit_write(Action.UPDATE, bed, ["status"])
        return Response(self.get_serializer(bed).data)

    @extend_schema(request=None, responses=s.BedSerializer)
    @action(detail=True, methods=["post"], url_path="in-service")
    def in_service(self, request, pk=None):
        bed = self.get_object()
        with transaction.atomic():
            bed = services.set_out_of_service(bed, False)
            self.audit_write(Action.UPDATE, bed, ["status"])
        return Response(self.get_serializer(bed).data)


def _occupant(admission: Admission):
    """The admission with the patient's name and MRN, as the board shows it."""
    ward_board_names = selectors.names_for([admission.patient_id])
    info = ward_board_names.get(admission.patient_id, {})
    admission.patient_name = info.get("name", "")
    admission.patient_mrn = info.get("mrn", "")
    return s.OccupantSerializer(admission).data


@list_filters("patient", "open")
class AdmissionViewSet(TenantReadOnlyViewSet):
    """Stays. Admit, transfer and discharge are actions; nothing edits a stay."""

    model = Admission
    policy_resource = "inpatient.admission"
    policy_actions = {"transfer": Action.UPDATE, "discharge": Action.UPDATE}
    serializer_class = s.AdmissionSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        params = self.request.query_params
        if params.get("patient"):
            queryset = queryset.filter(patient_id=params["patient"])
        if params.get("open") == "true":
            queryset = queryset.filter(discharged_at__isnull=True)
        return queryset

    @extend_schema(request=s.AdmitSerializer, responses={201: s.OccupantSerializer})
    def create(self, request):
        """Admit a patient to a vacant bed."""
        data = s.AdmitSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            admission = services.admit(
                patient_id=data.validated_data["patient"],
                bed=data.validated_data["bed"],
                reason=data.validated_data["reason"],
            )
            self.audit_write(Action.CREATE, admission, ["bed", "status"])
        return Response(_occupant(admission), status=201)

    @extend_schema(request=s.TransferSerializer, responses=s.OccupantSerializer)
    @action(detail=True, methods=["post"])
    def transfer(self, request, pk=None):
        admission = self.get_object()
        data = s.TransferSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            admission = services.transfer(
                admission,
                bed=data.validated_data["bed"],
                reason=data.validated_data["reason"],
            )
            self.audit_write(Action.UPDATE, admission, ["bed"])
        return Response(_occupant(admission))

    @extend_schema(request=s.DischargeSerializer, responses=s.DischargeResultSerializer)
    @action(detail=True, methods=["post"])
    def discharge(self, request, pk=None):
        admission = self.get_object()
        data = s.DischargeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            admission = services.discharge(
                admission,
                status=data.validated_data["status"],
                note=data.validated_data["note"],
            )
            self.audit_write(Action.UPDATE, admission, ["discharged_at", "discharge_status"])
        return Response({"status": admission.discharge_status})
