"""The patient portal API.

Two kinds of endpoint live here.

* ``AccountViewSet``: staff invite a patient to the portal and switch access off. It uses the
  policy layer like every other staff endpoint.
* ``PortalView`` and its subclasses: the patient's own use. These do **not** take a patient id
  from the request. The patient is the one the signed-in user's portal account points to, and
  every query below is made for that one patient only. A patient cannot name another patient's
  record because there is no parameter to put it in. Each use is written to the audit log, and a
  refused request is logged too.
"""

from django.http import Http404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions
from rest_framework.decorators import action
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.billing import selectors as billing
from apps.core.api.mixins import TenantModelViewSet, TenantScopedAPIMixin
from apps.core.api.permissions import require_verified_tenant_user
from apps.core.policy import Action
from apps.patients import selectors as patients
from apps.pharmacy import selectors as pharmacy
from apps.scheduling import selectors as scheduling_selectors
from apps.scheduling import services as scheduling

from .. import selectors, services
from ..models import PortalAccount
from . import serializers as s


class PortalAccessDenied(exceptions.PermissionDenied):
    default_code = "portal_access_denied"
    default_detail = "You do not have a patient portal account."


class PortalPermission(BasePermission):
    """Signed in, verified, and linked to one patient by an active portal account."""

    def has_permission(self, request, view):
        require_verified_tenant_user(request)
        account = selectors.active_account(request.user.pk)
        if account is None or patients.is_deceased(account.patient_id):
            audit.record(
                action=audit.AuditAction.ACCESS,
                outcome=audit.AuditOutcome.DENIED,
                request=request,
                resource="portal",
                details={"reason": "no_active_portal_account"},
            )
            raise PortalAccessDenied()
        request.portal_account = account
        return True


class PortalView(TenantScopedAPIMixin, APIView):
    """Base for the patient's own endpoints."""

    permission_classes = [PortalPermission]
    audit_name = "portal"

    @property
    def account(self) -> PortalAccount:
        return self.request.portal_account

    @property
    def patient_id(self):
        return self.account.patient_id

    def record(self, action, details: dict | None = None) -> None:
        audit.record(
            action=action,
            request=self.request,
            resource=f"portal.{self.audit_name}",
            object_id=self.patient_id,
            details=details or {},
        )

    def read(self, details: dict | None = None) -> None:
        self.record(audit.AuditAction.READ, details)


# -- staff: invitations ----------------------------------------------------------------


class AccountViewSet(TenantModelViewSet):
    """Staff invite a patient to the portal and switch access off."""

    model = PortalAccount
    policy_resource = "portal.account"
    policy_actions = {"revoke": Action.UPDATE}
    serializer_class = s.PortalAccountSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        patient = self.request.query_params.get("patient")
        return queryset.filter(patient_id=patient) if patient else queryset

    @extend_schema(request=s.InviteSerializer, responses={201: s.PortalAccountSerializer})
    def create(self, request, *args, **kwargs):
        data = s.InviteSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        account = services.invite(data.validated_data["patient"])
        self.audit_write(Action.CREATE, account, ["invited"])
        return Response(self.get_serializer(account).data, status=201)

    @extend_schema(request=None, responses=s.PortalAccountSerializer)
    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        account = services.revoke(self.get_object())
        self.audit_write(Action.UPDATE, account, ["active"])
        return Response(self.get_serializer(account).data)


# -- the patient -----------------------------------------------------------------------


class HomeView(PortalView):
    audit_name = "home"

    @extend_schema(responses=s.PortalHomeSerializer)
    def get(self, request):
        self.read()
        appointments = scheduling_selectors.patient_appointments(self.patient_id)
        now = timezone.now()
        upcoming = [
            a
            for a in appointments
            if a["status"] in ("booked", "confirmed") and a["start_at"] >= now
        ]
        balance, currency = billing.patient_balance(self.patient_id)
        profile = patients.portal_profile(self.patient_id)
        return Response(
            s.PortalHomeSerializer(
                {
                    "first_name": profile["first_name"],
                    "next_appointment": upcoming[0] if upcoming else None,
                    "new_results": sum(
                        1 for r in selectors.released_results(self.patient_id) if not r["seen"]
                    ),
                    "balance_minor": balance,
                    "currency": currency,
                }
            ).data
        )


class AppointmentsView(PortalView):
    audit_name = "appointment"

    @extend_schema(responses=s.PortalAppointmentSerializer(many=True))
    def get(self, request):
        self.read()
        rows = scheduling_selectors.patient_appointments(self.patient_id)
        return Response(s.PortalAppointmentSerializer(rows, many=True).data)

    @extend_schema(request=s.BookSerializer, responses={201: s.PortalAppointmentSerializer})
    def post(self, request):
        data = s.BookSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        appointment = scheduling.book_for_patient(
            self.patient_id, slot=data.validated_data["slot"], reason=data.validated_data["reason"]
        )
        self.record(audit.AuditAction.CREATE, {"appointment": str(appointment.pk)})
        row = next(
            r
            for r in scheduling_selectors.patient_appointments(self.patient_id)
            if r["id"] == appointment.pk
        )
        return Response(s.PortalAppointmentSerializer(row).data, status=201)


class SlotsView(PortalView):
    audit_name = "slot"

    @extend_schema(responses=s.PortalSlotSerializer(many=True))
    def get(self, request):
        return Response(s.PortalSlotSerializer(scheduling.portal_open_slots(), many=True).data)


class AppointmentCancelView(PortalView):
    audit_name = "appointment"

    @extend_schema(
        request=s.PortalCancelSerializer,
        responses=s.PortalAppointmentSerializer,
    )
    def post(self, request, pk):
        data = s.PortalCancelSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        appointment = scheduling.cancel_for_patient(
            pk, self.patient_id, data.validated_data["reason"]
        )
        self.record(
            audit.AuditAction.UPDATE, {"appointment": str(appointment.pk), "cancelled": True}
        )
        row = next(
            r
            for r in scheduling_selectors.patient_appointments(self.patient_id)
            if r["id"] == appointment.pk
        )
        return Response(s.PortalAppointmentSerializer(row).data)


class ResultsView(PortalView):
    audit_name = "result"

    @extend_schema(responses=s.PortalResultSerializer(many=True))
    def get(self, request):
        self.read()
        return Response(
            s.PortalResultSerializer(selectors.released_results(self.patient_id), many=True).data
        )


class ResultSeenView(PortalView):
    audit_name = "result"

    @extend_schema(
        request=None,
        responses=s.PortalResultSerializer,
    )
    def post(self, request, pk):
        # Results are released by the diagnostics module, which is not built yet, so a patient
        # has none to mark as read.
        raise Http404


class PrescriptionsView(PortalView):
    audit_name = "prescription"

    @extend_schema(responses=s.PortalPrescriptionSerializer(many=True))
    def get(self, request):
        self.read()
        rows = pharmacy.patient_prescriptions(self.patient_id)
        return Response(s.PortalPrescriptionSerializer(rows, many=True).data)


class InvoicesView(PortalView):
    audit_name = "invoice"

    @extend_schema(responses=s.PortalInvoiceSerializer(many=True))
    def get(self, request):
        self.read()
        return Response(
            s.PortalInvoiceSerializer(billing.patient_invoices(self.patient_id), many=True).data
        )


def _profile(account: PortalAccount) -> dict:
    row = dict(patients.portal_profile(account.patient_id))
    row["consents"] = {key: getattr(account, key) for key in PortalAccount.CONSENT_FIELDS}
    return row


class ProfileView(PortalView):
    audit_name = "profile"

    @extend_schema(responses=s.PortalProfileSerializer)
    def get(self, request):
        self.read()
        return Response(s.PortalProfileSerializer(_profile(self.account)).data)

    @extend_schema(request=s.ProfileUpdateSerializer, responses=s.PortalProfileSerializer)
    def patch(self, request):
        data = s.ProfileUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        body = data.validated_data
        changed = {}
        if "phone" in body or "email" in body:
            services.update_contact(self.account, phone=body.get("phone"), email=body.get("email"))
            changed["contact"] = [k for k in ("phone", "email") if k in body]
        if "consents" in body:
            consents = services.set_consents(self.account, body["consents"])
            if consents:
                changed["consents"] = consents
        if changed:
            self.record(audit.AuditAction.UPDATE, changed)
        return Response(s.PortalProfileSerializer(_profile(self.account)).data)
