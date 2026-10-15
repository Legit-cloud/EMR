from django.db import models

from apps.core.models import SoftStateModel, TenantModel


class Folder(TenantModel):
    name = models.CharField(max_length=100)

    def __str__(self) -> str:
        return self.name


class Record(SoftStateModel):
    title = models.CharField(max_length=100)
    folder = models.ForeignKey(Folder, on_delete=models.PROTECT, null=True, blank=True)

    def __str__(self) -> str:
        return self.title
