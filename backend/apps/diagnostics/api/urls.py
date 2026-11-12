from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("investigations", views.InvestigationViewSet, basename="investigation")
router.register("orders", views.OrderViewSet, basename="diagnostic-order")
router.register("results", views.ResultViewSet, basename="diagnostic-result")

urlpatterns = router.urls
