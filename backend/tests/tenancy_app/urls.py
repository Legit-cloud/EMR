from django.urls import include, path
from rest_framework.routers import SimpleRouter

from config.urls import urlpatterns as project_urlpatterns

from .api import FolderViewSet, RecordViewSet

router = SimpleRouter()
router.register("folders", FolderViewSet, basename="folder")
router.register("records", RecordViewSet, basename="record")

urlpatterns = [*project_urlpatterns, path("test-api/", include(router.urls))]
