from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("drugs", views.DrugViewSet, basename="drug")
router.register("stock", views.StockBatchViewSet, basename="stock-batch")
router.register("vendors", views.VendorViewSet, basename="vendor")
router.register("orders", views.PurchaseOrderViewSet, basename="order")
router.register("prescriptions", views.PrescriptionViewSet, basename="prescription")

urlpatterns = router.urls
