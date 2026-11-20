from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel
from apps.core.money import CURRENCY_EXPONENTS, Money


class Item(TenantModel):
    """A supply the facility keeps in stock. ``on_hand`` is changed only by ``services``,
    in the same transaction as the movement that explains the change."""

    sku = models.CharField(max_length=40)
    name = models.CharField(max_length=150)
    category = models.CharField(max_length=60, blank=True)
    unit = models.CharField(max_length=20, default="each")
    on_hand = models.PositiveIntegerField(default=0)
    reorder_level = models.PositiveIntegerField(default=0)
    unit_cost_minor = models.PositiveBigIntegerField(default=0)
    currency = models.CharField(max_length=3, default="NGN")
    active = models.BooleanField(default=True)

    class Meta(TenantModel.Meta):
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "sku"], name="item_sku_per_tenant")
        ]

    def __str__(self) -> str:
        return f"{self.sku} {self.name}"

    @property
    def unit_cost(self) -> Money:
        return Money(self.unit_cost_minor, self.currency)

    @property
    def is_low(self) -> bool:
        return self.on_hand <= self.reorder_level

    def clean(self):
        super().clean()
        if self.currency not in CURRENCY_EXPONENTS:
            raise ValidationError({"currency": "Unsupported currency."})


class MovementKind(models.TextChoices):
    RECEIVE = "receive", "Received"
    ISSUE = "issue", "Issued"
    ADJUST = "adjust", "Count correction"


class StockMovement(TenantModel):
    """Append-only history. ``quantity`` is the change: positive in, negative out."""

    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name="movements")
    kind = models.CharField(max_length=8, choices=MovementKind.choices)
    quantity = models.IntegerField()
    balance_after = models.PositiveIntegerField()
    department = models.ForeignKey(
        "tenants.Department", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    reason = models.CharField(max_length=300, blank=True)

    class Meta(TenantModel.Meta):
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=~Q(quantity=0), name="movement_not_zero"),
            models.CheckConstraint(
                condition=(Q(kind="receive", quantity__gt=0))
                | (Q(kind="issue", quantity__lt=0))
                | Q(kind="adjust"),
                name="movement_sign_matches_kind",
            ),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("Stock movements cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Stock movements cannot be deleted.")
