from django.db import models

from apps.core.models import TimestampedModel


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
