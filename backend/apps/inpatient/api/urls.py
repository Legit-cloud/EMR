from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("wards", views.WardViewSet, basename="ward")
router.register("beds", views.BedViewSet, basename="bed")
router.register("admissions", views.AdmissionViewSet, basename="admission")

urlpatterns = router.urls
