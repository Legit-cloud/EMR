from django.conf import settings
from django.db import models

from apps.core.models import TenantModel


class PortalAccount(TenantModel):
    """Ties one sign-in to one patient record. Everything a portal user sees comes from this link.

    The consent fields are what the patient has agreed to (NDPA 2023, DG-02). They are changed by
    the patient only, and each change is written to the audit log.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    patient = models.OneToOneField("patients.Patient", on_delete=models.PROTECT, related_name="+")
    active = models.BooleanField(default=True)
    invited_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=100, blank=True)

    sms_reminders = models.BooleanField(default=True)
    email_reminders = models.BooleanField(default=False)
    share_in_facility = models.BooleanField(default=True)
    research = models.BooleanField(default=False)
    consents_updated_at = models.DateTimeField(null=True, blank=True)

    CONSENT_FIELDS = ("sms_reminders", "email_reminders", "share_in_facility", "research")

    def __str__(self) -> str:
        return f"Portal account of patient {self.patient_id}"
