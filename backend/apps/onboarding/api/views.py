from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import permissions
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.core.api.mixins import TenantReadOnlyViewSet
from apps.core.policy import Action

from .. import selectors, services
from ..models import OnboardingProfile
from . import serializers as s


class SignupThrottle:
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class _Anonymous(SignupThrottle, APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def check_csrf(self, request):
        # The verify step sets a session cookie, so the whole flow carries the CSRF token.
        SessionAuthentication().enforce_csrf(request._request)


class SignupView(_Anonymous):
    """Ask to open an account. Emails a code; the answer never says whether the address is
    already registered."""

    @extend_schema(request=s.SignupSerializer, responses={202: s.AcceptedSerializer})
    def post(self, request):
        self.check_csrf(request)
        data = s.SignupSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        services.start_signup(**data.validated_data)
        return Response({"email": data.validated_data["email"].strip().lower()}, status=202)


class ResendView(_Anonymous):
    @extend_schema(request=s.ResendSerializer, responses={202: s.AcceptedSerializer})
    def post(self, request):
        self.check_csrf(request)
        data = s.ResendSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        services.resend_code(email=data.validated_data["email"])
        return Response({"email": data.validated_data["email"].strip().lower()}, status=202)


class VerifyView(_Anonymous):
    """Enter the emailed code. Creates the organisation and its administrator and signs them in."""

    @extend_schema(request=s.VerifySerializer, responses=s.VerifiedSerializer)
    def post(self, request):
        self.check_csrf(request)
        data = s.VerifySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = services.verify_signup(request, **data.validated_data)
        return Response({"user_id": str(user.pk)})


class ProfileViewSet(TenantReadOnlyViewSet):
    """The organisation's onboarding answers. Only its administrator sees or changes them."""

    model = OnboardingProfile
    policy_resource = "onboarding.profile"
    policy_actions = {"current": Action.VIEW, "save": Action.UPDATE, "finish": Action.UPDATE}
    serializer_class = s.ProfileSerializer
    pagination_class = None

    def _profile(self):
        profile = selectors.current_profile()
        if profile is None:
            from rest_framework.exceptions import NotFound

            raise NotFound("This organisation has no onboarding to complete.")
        return profile

    @extend_schema(responses=s.ProfileSerializer)
    @action(detail=False, methods=["get"])
    def current(self, request):
        return Response(s.ProfileSerializer(self._profile()).data)

    @extend_schema(request=s.AnswersSerializer, responses=s.ProfileSerializer)
    @action(detail=False, methods=["post"])
    def save(self, request):
        data = s.AnswersSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            profile = services.save_answers(self._profile(), data.validated_data)
            self.audit_write(Action.UPDATE, profile, list(data.validated_data))
        return Response(s.ProfileSerializer(profile).data)

    @extend_schema(request=None, responses=s.ProfileSerializer)
    @action(detail=False, methods=["post"])
    def finish(self, request):
        with transaction.atomic():
            profile = services.complete(self._profile())
            self.audit_write(Action.UPDATE, profile, ["completed_at"])
        return Response(s.ProfileSerializer(profile).data)
