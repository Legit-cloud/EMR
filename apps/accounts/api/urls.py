from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("users", views.UserViewSet, basename="user")
router.register("role-assignments", views.RoleAssignmentViewSet, basename="role-assignment")
router.register("break-glass/grants", views.BreakGlassGrantViewSet, basename="break-glass-grant")

urlpatterns = [
    path("auth/csrf/", views.CsrfView.as_view(), name="auth-csrf"),
    path("auth/login/", views.LoginView.as_view(), name="auth-login"),
    path("auth/logout/", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/me/", views.MeView.as_view(), name="auth-me"),
    path("auth/mfa/totp/enrol/", views.TOTPEnrolView.as_view(), name="auth-totp-enrol"),
    path("auth/mfa/totp/confirm/", views.TOTPConfirmView.as_view(), name="auth-totp-confirm"),
    path(
        "auth/password-reset/",
        views.PasswordResetRequestView.as_view(),
        name="auth-password-reset",
    ),
    path(
        "auth/password-reset/confirm/",
        views.PasswordResetConfirmView.as_view(),
        name="auth-password-reset-confirm",
    ),
    path("break-glass/", views.BreakGlassRequestView.as_view(), name="break-glass-request"),
    *router.urls,
]
