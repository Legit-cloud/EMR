import hashlib
import secrets
import uuid
from datetime import timedelta

from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.core.models import TenantModel, TimestampedModel
from apps.core.roles import Role


class User(AbstractUser):
    """Platform user.

    Staff and patients belong to one tenant. The platform super admin is a superuser with
    no tenant. Roles are granted per tenant through ``RoleAssignment``.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="users",
    )


class RoleAssignment(TenantModel):
    """Gives a user a role, optionally narrowed to one facility or department (ABAC)."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="role_assignments")
    role = models.CharField(max_length=32, choices=Role.choices)
    facility = models.ForeignKey(
        "tenants.Facility", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    department = models.ForeignKey(
        "tenants.Department", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "role", "facility", "department"],
                name="role_assignment_unique",
                nulls_distinct=False,
            )
        ]

    def __str__(self) -> str:
        return f"{self.user} as {self.get_role_display()}"

    def save(self, *args, **kwargs):
        self._assign_tenant()
        if self.user.tenant_id != self.tenant_id:
            raise ValidationError({"user": "The user belongs to a different organisation."})
        if self.department_id and self.facility_id is None:
            self.facility_id = self.department.facility_id
        if self.department_id and self.department.facility_id != self.facility_id:
            raise ValidationError({"department": "The department is in a different facility."})
        super().save(*args, **kwargs)


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


class ApiTokenQuerySet(models.QuerySet):
    def usable(self):
        return self.filter(revoked_at__isnull=True, expires_at__gt=timezone.now())


class ApiToken(TimestampedModel):
    """Bearer token for API clients. Only a SHA-256 hash of the key is stored."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="api_tokens")
    key_hash = models.CharField(max_length=64, unique=True)
    prefix = models.CharField(max_length=8)
    expires_at = models.DateTimeField()
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    mfa_verified = models.BooleanField(default=False)

    objects = ApiTokenQuerySet.as_manager()

    def __str__(self) -> str:
        return f"{self.prefix}… ({self.user})"

    @classmethod
    def issue(cls, user, *, ttl: timedelta, mfa_verified: bool) -> tuple["ApiToken", str]:
        raw_key = secrets.token_urlsafe(32)
        token = cls.objects.create(
            user=user,
            key_hash=_hash_key(raw_key),
            prefix=raw_key[:8],
            expires_at=timezone.now() + ttl,
            mfa_verified=mfa_verified,
        )
        return token, raw_key

    @classmethod
    def find(cls, raw_key: str) -> "ApiToken | None":
        return (
            cls.objects.usable().select_related("user").filter(key_hash=_hash_key(raw_key)).first()
        )


class BreakGlassReview(models.TextChoices):
    PENDING = "pending", "Pending review"
    APPROPRIATE = "appropriate", "Appropriate"
    INAPPROPRIATE = "inappropriate", "Inappropriate"


class BreakGlassGrant(TenantModel):
    """Time-limited access to one record outside the user's normal scope, with a reason.

    Every grant is reviewed by the compliance role.
    """

    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="break_glass_grants")
    resource = models.CharField(max_length=100)
    object_id = models.CharField(max_length=64)
    reason = models.TextField()
    expires_at = models.DateTimeField()
    review_status = models.CharField(
        max_length=16, choices=BreakGlassReview.choices, default=BreakGlassReview.PENDING
    )
    reviewed_by = models.ForeignKey(
        User, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "resource", "object_id"])]

    def __str__(self) -> str:
        return f"{self.user} -> {self.resource}:{self.object_id}"
