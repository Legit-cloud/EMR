from django.db import models

from apps.core.models import TenantModel, TimestampedModel


class Signup(TimestampedModel):
    """A request to open an account, waiting for the emailed code. Not tenant-owned: no
    organisation exists until the email address is proved. Holds a password hash and a code
    hash, never the plain values, and is deleted once verified."""

    email = models.EmailField()
    first_name = models.CharField(max_length=80)
    last_name = models.CharField(max_length=80)
    organisation_name = models.CharField(max_length=200)
    password_hash = models.CharField(max_length=256)
    code_hash = models.CharField(max_length=256)
    code_expires_at = models.DateTimeField()
    code_sent_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    terms_accepted_at = models.DateTimeField()

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["email"])]


class FacilityType(models.TextChoices):
    CLINIC = "clinic", "Clinic"
    HOSPITAL = "hospital", "Hospital"
    SPECIALIST = "specialist_centre", "Specialist centre"
    GROUP = "group", "Group of facilities"


class SizeBand(models.TextChoices):
    XS = "1-10", "1 to 10"
    S = "11-50", "11 to 50"
    M = "51-200", "51 to 200"
    L = "200+", "More than 200"


class BedBand(models.TextChoices):
    NONE = "none", "No inpatient beds"
    S = "1-20", "1 to 20"
    M = "21-100", "21 to 100"
    L = "100+", "More than 100"


class OnboardingProfile(TenantModel):
    """What the first administrator told us about the organisation. One row per tenant, made
    when the account is verified. Completing it sets up the facility and departments."""

    facility_name = models.CharField(max_length=200, blank=True)
    facility_type = models.CharField(max_length=20, choices=FacilityType.choices, blank=True)
    country = models.CharField(max_length=2, default="NG")
    city = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    staff_band = models.CharField(max_length=8, choices=SizeBand.choices, blank=True)
    bed_band = models.CharField(max_length=8, choices=BedBand.choices, blank=True)
    departments = models.JSONField(default=list, blank=True)
    modules = models.JSONField(default=list, blank=True)
    heard_from = models.CharField(max_length=100, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["tenant"], name="one_onboarding_profile_per_tenant")
        ]
