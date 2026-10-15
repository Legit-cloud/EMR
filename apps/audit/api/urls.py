from rest_framework.routers import SimpleRouter

from .views import AuditEntryViewSet

router = SimpleRouter()
router.register("entries", AuditEntryViewSet, basename="audit-entry")

urlpatterns = router.urls
