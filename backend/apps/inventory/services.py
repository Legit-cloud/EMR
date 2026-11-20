"""Stock rules. Every change to ``Item.on_hand`` goes through here, under a row lock, with
a movement recorded in the same transaction, so the count can always be explained."""

from django.db import transaction

from apps.core.errors import DomainError

from .models import Item, MovementKind, StockMovement


class InsufficientStock(DomainError):
    code = "insufficient_stock"
    status_code = 409


class MovementRefused(DomainError):
    code = "movement_refused"
    status_code = 400


def _move(item: Item, kind: str, delta: int, *, department=None, reason: str = "") -> StockMovement:
    locked = Item.objects.select_for_update().get(pk=item.pk)
    if not locked.active:
        raise MovementRefused(f"{locked.name} is no longer stocked.")
    balance = locked.on_hand + delta
    if balance < 0:
        raise InsufficientStock(f"Only {locked.on_hand} {locked.unit} of {locked.name} in stock.")
    locked.on_hand = balance
    locked.save(update_fields=["on_hand", "updated_at"])
    return StockMovement.objects.create(
        item=locked,
        kind=kind,
        quantity=delta,
        balance_after=balance,
        department=department,
        reason=reason.strip(),
    )


@transaction.atomic
def receive(item: Item, quantity: int, *, reason: str = "") -> StockMovement:
    if quantity <= 0:
        raise MovementRefused("Quantity received must be more than zero.")
    return _move(item, MovementKind.RECEIVE, quantity, reason=reason)


@transaction.atomic
def issue(item: Item, quantity: int, *, department=None, reason: str = "") -> StockMovement:
    if quantity <= 0:
        raise MovementRefused("Quantity issued must be more than zero.")
    return _move(item, MovementKind.ISSUE, -quantity, department=department, reason=reason)


@transaction.atomic
def adjust(item: Item, counted: int, *, reason: str) -> StockMovement:
    """Set the count to what was physically counted. A reason is required."""
    if not reason.strip():
        raise MovementRefused("Say why the count is being corrected.")
    current = Item.objects.select_for_update().get(pk=item.pk).on_hand
    if counted < 0 or counted == current:
        raise MovementRefused("The counted quantity must differ from the recorded one.")
    return _move(item, MovementKind.ADJUST, counted - current, reason=reason)
