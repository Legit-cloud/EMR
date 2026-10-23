from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel


class PortalAccount(TenantModel):
    """Ties one sign-in to one patient record. Everything a portal user sees comes from this link.

    There are no consent switches here on purpose. Care is given because the hospital provides
    health care, not because the patient consented, and a switch that changed nothing would
    mislead them. What the patient can choose (email reminders) lives on their patient record,
    where every module that sends reminders already looks (ADR 0024).
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    patient = models.OneToOneField("patients.Patient", on_delete=models.PROTECT, related_name="+")
    active = models.BooleanField(default=True)
    invited_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=100, blank=True)

    def __str__(self) -> str:
        return f"Portal account of patient {self.patient_id}"


class RequestKind(models.TextChoices):
    ACCESS = "access", "A copy of my records"
    CORRECTION = "correction", "Correct something wrong"
    ERASURE = "erasure", "Delete my information"
    RESTRICTION = "restriction", "Limit how my information is used"
    OBJECTION = "objection", "I object to how my information is used"
    PORTABILITY = "portability", "Move my information elsewhere"


class RequestStatus(models.TextChoices):
    OPEN = "open", "Open"
    COMPLETED = "completed", "Completed"
    REFUSED = "refused", "Refused, with a reason"


class DataSubjectRequest(TenantModel):
    """A patient exercising a data-protection right (NDPA 2023, DG-03).

    The hospital must answer within ``DSR_RESPONSE_DAYS``; ``due_on`` is set when it is made. A
    refusal needs a reason, for example that clinical records must be kept by law.
    """

    patient = models.ForeignKey("patients.Patient", on_delete=models.PROTECT, related_name="+")
    kind = models.CharField(max_length=12, choices=RequestKind.choices)
    details = models.CharField(max_length=1000, blank=True)
    status = models.CharField(
        max_length=10, choices=RequestStatus.choices, default=RequestStatus.OPEN
    )
    due_on = models.DateField()
    response_note = models.CharField(max_length=1000, blank=True)
    handled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    handled_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantModel.Meta):
        ordering = ["due_on", "created_at"]
        constraints = [
            # One open request of each kind at a time, so a patient cannot flood the queue.
            models.UniqueConstraint(
                fields=["patient", "kind"],
                condition=Q(status="open"),
                name="one_open_request_per_kind",
            ),
            models.CheckConstraint(
                condition=Q(status="open") | ~Q(response_note=""),
                name="answered_request_has_a_response",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.get_kind_display()} ({self.status})"
