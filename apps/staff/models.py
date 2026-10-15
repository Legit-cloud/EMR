from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel
from apps.core.money import CURRENCY_EXPONENTS, Money


class StaffType(models.TextChoices):
    PHYSICIAN = "physician", "Physician"
    NURSE = "nurse", "Nurse / midwife"
    PHARMACIST = "pharmacist", "Pharmacist"
    LAB_SCIENTIST = "lab_scientist", "Medical laboratory scientist"
    RADIOGRAPHER = "radiographer", "Radiographer"
    OTHER_CLINICAL = "other_clinical", "Other clinical"
    NON_CLINICAL = "non_clinical", "Non-clinical"


class LicensingBody(models.TextChoices):
    MDCN = "mdcn", "Medical and Dental Council of Nigeria"
    NMCN = "nmcn", "Nursing and Midwifery Council of Nigeria"
    PCN = "pcn", "Pharmacists Council of Nigeria"
    MLSCN = "mlscn", "Medical Laboratory Science Council of Nigeria"
    RRBN = "rrbn", "Radiographers Registration Board of Nigeria"
    OTHER = "other", "Other"


class LicenceVerification(models.TextChoices):
    UNVERIFIED = "unverified", "Not yet verified"
    VERIFIED = "verified", "Verified against the register"
    REJECTED = "rejected", "Not found on the register"


class LicenceFlag(models.TextChoices):
    OK = "ok", "Valid"
    EXPIRING = "expiring", "Expires soon"
    EXPIRED = "expired", "Expired"


class StaffProfile(TenantModel):
    """Employment and professional details of a staff member (physicians included)."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="staff_profile"
    )
    staff_type = models.CharField(max_length=16, choices=StaffType.choices)
    title = models.CharField(max_length=20, blank=True, help_text="For example Dr.")
    specialty = models.CharField(max_length=100, blank=True)
    licensing_body = models.CharField(max_length=8, choices=LicensingBody.choices, blank=True)
    licence_number = models.CharField(max_length=50, blank=True)
    licence_expires_on = models.DateField(null=True, blank=True)
    licence_verification = models.CharField(
        max_length=12, choices=LicenceVerification.choices, default=LicenceVerification.UNVERIFIED
    )
    licence_verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    licence_verified_at = models.DateTimeField(null=True, blank=True)
    licence_verification_reference = models.CharField(max_length=200, blank=True)
    licence_flag = models.CharField(
        max_length=10, choices=LicenceFlag.choices, default=LicenceFlag.OK, editable=False
    )
    licence_flagged_at = models.DateTimeField(null=True, blank=True, editable=False)
    consultation_fee_minor = models.PositiveBigIntegerField(default=0)
    consultation_fee_currency = models.CharField(max_length=3, default="NGN")

    class Meta(TenantModel.Meta):
        ordering = ["user__last_name", "user__first_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "licensing_body", "licence_number"],
                condition=~Q(licence_number=""),
                name="licence_unique_per_tenant",
            )
        ]

    def __str__(self) -> str:
        return f"{self.title} {self.user.get_full_name() or self.user.username}".strip()

    @property
    def consultation_fee(self) -> Money:
        return Money(self.consultation_fee_minor, self.consultation_fee_currency)

    @property
    def is_clinical(self) -> bool:
        return self.staff_type != StaffType.NON_CLINICAL

    def clean(self):
        super().clean()
        if self.consultation_fee_currency not in CURRENCY_EXPONENTS:
            raise ValidationError({"consultation_fee_currency": "Unsupported currency."})
        if self.user_id and self.user.tenant_id != self.tenant_id:
            raise ValidationError({"user": "The user belongs to a different organisation."})
        if self.is_clinical:
            missing = [
                name
                for name in ("licensing_body", "licence_number", "licence_expires_on")
                if not getattr(self, name)
            ]
            if missing:
                raise ValidationError(dict.fromkeys(missing, "Required for clinical staff."))


class Shift(TenantModel):
    """One period on duty. A staff member is On-Duty while a shift is open."""

    staff = models.ForeignKey(StaffProfile, on_delete=models.PROTECT, related_name="shifts")
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantModel.Meta):
        ordering = ["-started_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["staff"], condition=Q(ended_at__isnull=True), name="one_open_shift"
            )
        ]

    def __str__(self) -> str:
        return f"{self.staff} from {self.started_at:%Y-%m-%d %H:%M}"
