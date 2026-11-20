from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("threads", views.ThreadViewSet, basename="thread")

urlpatterns = router.urls
