from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("appointments", views.AppointmentViewSet, basename="appointment")
router.register("availability", views.AvailabilityWindowViewSet, basename="availability-window")

urlpatterns = router.urls
