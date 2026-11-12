from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("patients", views.PatientViewSet, basename="patient")
router.register("allergies", views.AllergyViewSet, basename="allergy")
router.register("attachments", views.AttachmentViewSet, basename="attachment")
router.register("duplicate-reviews", views.DuplicateReviewViewSet, basename="duplicate-review")

urlpatterns = router.urls
