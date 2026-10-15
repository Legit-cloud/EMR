from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("encounters", views.EncounterViewSet, basename="encounter")
router.register("vitals", views.VitalSignsViewSet, basename="vital-signs")
router.register("diagnoses", views.DiagnosisViewSet, basename="diagnosis")
router.register("notes", views.ConsultationNoteViewSet, basename="consultation-note")

urlpatterns = [
    path("codes/loinc/", views.LoincCodeList.as_view(), name="codes-loinc"),
    path("codes/icd10/", views.Icd10CodeList.as_view(), name="codes-icd10"),
    *router.urls,
]
