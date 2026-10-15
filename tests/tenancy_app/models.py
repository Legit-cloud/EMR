from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import SoftStateModel, TenantModel


class Folder(TenantModel):
    name = models.CharField(max_length=100)

    def __str__(self) -> str:
        return self.name


class Record(SoftStateModel):
    """Stands in for a clinical record: facility, department and care team attributes."""

    title = models.CharField(max_length=100)
    folder = models.ForeignKey(Folder, on_delete=models.PROTECT, null=True, blank=True)
    facility = models.ForeignKey(
        "tenants.Facility", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    department = models.ForeignKey(
        "tenants.Department", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    care_team = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="+")

    def __str__(self) -> str:
        return self.title

    @classmethod
    def care_team_q(cls, user_id) -> Q:
        members = cls.care_team.through.objects.filter(user_id=user_id)
        return Q(pk__in=members.values("record_id"))
