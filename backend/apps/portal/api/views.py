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

from django.conf import settings
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
from apps.billing import services as billing_services
from apps.core.api.mixins import TenantModelViewSet, TenantReadOnlyViewSet, TenantScopedAPIMixin
from apps.core.api.permissions import require_verified_tenant_user
from apps.core.policy import Action
from apps.diagnostics import services as diagnostics
from apps.patients import selectors as patients
from apps.pharmacy import selectors as pharmacy
from apps.scheduling import selectors as scheduling_selectors
from apps.scheduling import services as scheduling
from apps.tenants.selectors import tenant_name

from .. import selectors, services
from ..models import DataSubjectRequest, PortalAccount
from ..services import PortalAccountError
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
        if not diagnostics.mark_seen(pk, patient_id=self.patient_id):
            raise Http404
        self.record(audit.AuditAction.UPDATE, {"result": str(pk), "seen": True})
        row = next(r for r in selectors.released_results(self.patient_id) if r["id"] == pk)
        return Response(s.PortalResultSerializer(row).data)


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
    return dict(patients.portal_profile(account.patient_id))


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
        fields = [k for k in ("phone", "email", "email_reminders") if k in body]
        if fields:
            services.update_contact(
                self.account,
                phone=body.get("phone"),
                email=body.get("email"),
                email_reminders=body.get("email_reminders"),
            )
            # What changed, and the reminders choice itself, since that is a choice of the patient.
            self.record(
                audit.AuditAction.UPDATE,
                {
                    "changed": fields,
                    **(
                        {"email_reminders": body["email_reminders"]}
                        if "email_reminders" in body
                        else {}
                    ),
                },
            )
        return Response(s.PortalProfileSerializer(_profile(self.account)).data)


class InvoicePayView(PortalView):
    """Start paying part or all of one of the patient's own bills at Paystack's page."""

    audit_name = "payment"

    @extend_schema(request=s.PayRequestSerializer, responses={201: s.PayStartSerializer})
    def post(self, request, pk):
        data = s.PayRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if not settings.PORTAL_URL:
            raise PortalAccountError("Online payment is not available yet.")
        profile = patients.portal_profile(self.patient_id)
        # The address Paystack sends the patient back to is ours, never the client's.
        intent = billing_services.start_online_payment(
            patient_id=self.patient_id,
            invoice_id=pk,
            amount_minor=data.validated_data["amount_minor"],
            email=profile["email"],
            callback_url=f"{settings.PORTAL_URL.rstrip('/')}/portal/invoices",
        )
        self.record(audit.AuditAction.CREATE, {"payment_reference": intent.reference})
        return Response(
            s.PayStartSerializer(
                {
                    "reference": intent.reference,
                    "authorization_url": intent.authorization_url,
                    "amount_minor": intent.amount_minor,
                    "currency": intent.currency,
                }
            ).data,
            status=201,
        )


_PATIENT_STATUS = {
    "pending": "pending",
    "succeeded": "succeeded",
    "failed": "failed",
    "flagged": "review",
}


class PaymentVerifyView(PortalView):
    """Called when the patient comes back from the payment page: ask Paystack, then say what
    happened. The browser's word is never taken for it."""

    audit_name = "payment"

    @extend_schema(request=None, responses=s.PaymentResultSerializer)
    def post(self, request, reference):
        intent = billing_services.verify_online_payment(reference, patient_id=self.patient_id)
        self.record(
            audit.AuditAction.UPDATE, {"payment_reference": reference, "result": intent.status}
        )
        return Response(
            s.PaymentResultSerializer(
                {
                    "reference": intent.reference,
                    "status": _PATIENT_STATUS[intent.status],
                    "amount_minor": intent.amount_minor,
                }
            ).data
        )


# -- the patient's rights (NDPA 2023, ADR 0024) ------------------------------------------------


class RequestsView(PortalView):
    """The patient's own data-protection requests: list them, make a new one."""

    audit_name = "request"

    @extend_schema(responses=s.PortalRequestSerializer(many=True))
    def get(self, request):
        self.read()
        rows = DataSubjectRequest.objects.filter(patient_id=self.patient_id).order_by("-created_at")
        return Response(s.PortalRequestSerializer(rows, many=True).data)

    @extend_schema(request=s.RequestCreateSerializer, responses={201: s.PortalRequestSerializer})
    def post(self, request):
        data = s.RequestCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        made = services.submit_request(
            self.patient_id,
            kind=data.validated_data["kind"],
            details=data.validated_data["details"],
        )
        self.record(audit.AuditAction.CREATE, {"request": str(made.pk), "kind": made.kind})
        return Response(s.PortalRequestSerializer(made).data, status=201)


class PrivacyNoticeView(PortalView):
    """Who is responsible for the patient's information, how to reach them, and for how long it is
    kept. The wording of the notice itself is in the web app and is versioned with this."""

    audit_name = "privacy"

    @extend_schema(responses=s.PrivacyNoticeSerializer)
    def get(self, request):
        return Response(
            s.PrivacyNoticeSerializer(
                {
                    "version": settings.PRIVACY_NOTICE_VERSION,
                    "controller_name": settings.PRIVACY_CONTROLLER_NAME
                    or tenant_name(self.account.tenant_id),
                    "contact_email": settings.PRIVACY_CONTACT_EMAIL,
                    "retention_years": settings.RECORD_RETENTION_YEARS,
                    "response_days": settings.DSR_RESPONSE_DAYS,
                }
            ).data
        )


class MyInformationView(PortalView):
    """Everything the portal holds about the patient, as one file they can keep. This is not a
    copy of the medical record: for that the patient makes an "access" request, which staff
    answer."""

    audit_name = "export"

    @extend_schema(responses=s.MyInformationSerializer)
    def get(self, request):
        self.read({"export": True})
        data = s.MyInformationSerializer(
            {
                "generated_at": timezone.now(),
                "notice_version": settings.PRIVACY_NOTICE_VERSION,
                "profile": _profile(self.account),
                "appointments": scheduling_selectors.patient_appointments(self.patient_id),
                "prescriptions": pharmacy.patient_prescriptions(self.patient_id),
                "invoices": billing.patient_invoices(self.patient_id),
                "requests": DataSubjectRequest.objects.filter(patient_id=self.patient_id),
            }
        ).data
        response = Response(data)
        response["Content-Disposition"] = 'attachment; filename="my-information.json"'
        return response


class RequestViewSet(TenantReadOnlyViewSet):
    """Compliance answers patients' data-protection requests. The most overdue come first."""

    model = DataSubjectRequest
    policy_resource = "portal.request"
    policy_actions = {"respond": Action.UPDATE}
    serializer_class = s.StaffRequestSerializer

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        params = self.request.query_params
        if params.get("status"):
            queryset = queryset.filter(status=params["status"])
        if params.get("overdue") == "true":
            queryset = queryset.filter(status="open", due_on__lt=services.today())
        return queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        # Names come from the patients module once for the page, not once per row.
        queryset = self.filter_queryset(self.get_queryset())
        context["people"] = patients.summaries({r.patient_id for r in queryset[:200]})
        return context

    @extend_schema(request=s.RespondSerializer, responses=s.StaffRequestSerializer)
    @action(detail=True, methods=["post"])
    def respond(self, request, pk=None):
        data = s.RespondSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        answered = services.respond_to_request(
            self.get_object(),
            status=data.validated_data["status"],
            note=data.validated_data["note"],
        )
        self.audit_write(Action.UPDATE, answered, ["status", "response_note"])
        return Response(self.get_serializer(answered).data)
