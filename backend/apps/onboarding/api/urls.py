from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("profile", views.ProfileViewSet, basename="onboarding-profile")

urlpatterns = [
    path("signup/", views.SignupView.as_view(), name="onboarding-signup"),
    path("signup/resend/", views.ResendView.as_view(), name="onboarding-resend"),
    path("signup/verify/", views.VerifyView.as_view(), name="onboarding-verify"),
    *router.urls,
]
