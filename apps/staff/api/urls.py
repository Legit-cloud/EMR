from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("profiles", views.StaffProfileViewSet, basename="staff-profile")
router.register("shifts", views.ShiftViewSet, basename="shift")

urlpatterns = [
    path("shifts/clock-in/", views.ClockInView.as_view(), name="shift-clock-in"),
    path("shifts/clock-out/", views.ClockOutView.as_view(), name="shift-clock-out"),
    *router.urls,
]
