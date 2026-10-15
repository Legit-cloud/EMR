import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Platform user.

    Defined at project start so the user table never has to be swapped later.
    Roles, MFA and ABAC attributes are added in the accounts build step.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Staff and patients belong to one tenant. Platform staff have none.
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="users",
    )
