from django.db import models

from apps.core.models import TenantModel, TimestampedModel


class Tenant(TimestampedModel):
    """A customer organisation (clinic or hospital group). Owns every tenant-scoped row."""

    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=63, unique=True)
    # Optional host name that selects this tenant (for example "clinic.example.com").
    # NULL rather than "" so that many tenants can have no domain under the unique rule.
    domain = models.CharField(max_length=253, unique=True, null=True, blank=True)  # noqa: DJ001
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs):
        self.domain = (self.domain or "").strip().lower() or None
        super().save(*args, **kwargs)


class Facility(TenantModel):
    """A site of a tenant (hospital, clinic branch). Narrows access in the policy layer."""

    name = models.CharField(max_length=200)
    code = models.SlugField(max_length=32)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "code"], name="facility_code_per_tenant")
        ]
        verbose_name_plural = "facilities"

    def __str__(self) -> str:
        return self.name


class Department(TenantModel):
    """A department or unit inside a facility."""

    facility = models.ForeignKey(Facility, on_delete=models.PROTECT, related_name="departments")
    name = models.CharField(max_length=200)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["facility", "name"], name="department_name_per_facility"
            )
        ]

    def __str__(self) -> str:
        return f"{self.facility} / {self.name}"
