from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("items", views.ItemViewSet, basename="inventory-item")
router.register("movements", views.StockMovementViewSet, basename="inventory-movement")

urlpatterns = router.urls
