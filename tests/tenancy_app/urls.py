from django.urls import include, path
from rest_framework.routers import DefaultRouter

from config.urls import urlpatterns as project_urlpatterns

from .api import FolderViewSet, RecordViewSet

router = DefaultRouter()
router.register("folders", FolderViewSet, basename="folder")
router.register("records", RecordViewSet, basename="record")

urlpatterns = [*project_urlpatterns, path("test-api/", include(router.urls))]
