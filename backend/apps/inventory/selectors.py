"""Read-only queries other modules and the dashboard may use."""

from django.db.models import F, Sum

from .models import Item


def low_stock():
    return Item.objects.filter(active=True, on_hand__lte=F("reorder_level"))


def summary(currency: str = "NGN") -> dict:
    items = Item.objects.filter(active=True, currency=currency)
    value = sum(
        i["on_hand"] * i["unit_cost_minor"] for i in items.values("on_hand", "unit_cost_minor")
    )
    return {
        "items": items.count(),
        "out": items.filter(on_hand=0).count(),
        "low": items.filter(on_hand__gt=0, on_hand__lte=F("reorder_level")).count(),
        "value_minor": value,
        "units": items.aggregate(t=Sum("on_hand"))["t"] or 0,
        "currency": currency,
    }
