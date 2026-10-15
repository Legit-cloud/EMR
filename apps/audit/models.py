import uuid

from django.db import models


class AuditImmutable(Exception):
    """Audit entries are append-only (SEC-03)."""


class AuditAction(models.TextChoices):
    READ = "read", "Read"
    CREATE = "create", "Create"
    UPDATE = "update", "Update"
    DELETE = "delete", "Delete"
    ACCESS = "access", "Access"
    LOGIN = "login", "Login"
    LOGIN_FAILED = "login_failed", "Login failed"
    LOGOUT = "logout", "Logout"
    MFA_ENROL = "mfa_enrol", "MFA enrolment started"
    MFA_CONFIRM = "mfa_confirm", "MFA device confirmed"
    PASSWORD_RESET_REQUEST = "password_reset_request", "Password reset requested"
    PASSWORD_RESET = "password_reset", "Password reset"
    BREAK_GLASS = "break_glass", "Break-glass access"
    BREAK_GLASS_REVIEW = "break_glass_review", "Break-glass review"


class AuditOutcome(models.TextChoices):
    ALLOWED = "allowed", "Allowed"
    DENIED = "denied", "Denied"
    NOT_FOUND = "not_found", "Not found"
    FAILED = "failed", "Failed"


class AuditQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise AuditImmutable("Audit entries cannot be updated.")

    def delete(self):
        raise AuditImmutable("Audit entries cannot be deleted.")

    def bulk_update(self, *args, **kwargs):
        raise AuditImmutable("Audit entries cannot be updated.")


class AuditEntry(models.Model):
    """One append-only, hash-chained audit record.

    Actor, tenant and object are stored as plain values, not foreign keys, so deleting a
    user or tenant never cascades into the log. Each tenant (and the platform, with no
    tenant) has its own chain: ``entry_hash`` covers the entry and the previous hash, so
    editing or removing a row breaks verification. A database trigger refuses UPDATE and
    DELETE on this table.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_id = models.UUIDField(null=True, blank=True, db_index=True)
    sequence = models.PositiveBigIntegerField()
    occurred_at = models.DateTimeField(db_index=True)
    actor_id = models.UUIDField(null=True, blank=True, db_index=True)
    actor_label = models.CharField(max_length=150, blank=True)
    action = models.CharField(max_length=32, choices=AuditAction.choices)
    outcome = models.CharField(max_length=16, choices=AuditOutcome.choices)
    resource = models.CharField(max_length=100, blank=True, db_index=True)
    object_id = models.CharField(max_length=64, blank=True, db_index=True)
    reason = models.TextField(blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    method = models.CharField(max_length=10, blank=True)
    path = models.CharField(max_length=500, blank=True)
    details = models.JSONField(default=dict, blank=True)
    previous_hash = models.CharField(max_length=64)
    entry_hash = models.CharField(max_length=64, unique=True)

    objects = AuditQuerySet.as_manager()

    class Meta:
        ordering = ["occurred_at", "sequence"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "sequence"],
                name="audit_unique_sequence_per_chain",
                nulls_distinct=False,
            )
        ]
        verbose_name_plural = "audit entries"

    def __str__(self) -> str:
        return f"{self.occurred_at:%Y-%m-%d %H:%M:%S} {self.actor_label} {self.action}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise AuditImmutable("Audit entries cannot be updated.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AuditImmutable("Audit entries cannot be deleted.")
