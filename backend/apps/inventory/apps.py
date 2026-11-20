from django.apps import AppConfig


class InventoryConfig(AppConfig):
    name = "apps.inventory"
    label = "inventory"

    def ready(self):
        from apps.core import policy
        from apps.core.policy import Action
        from apps.core.roles import Role

        from .models import Item, StockMovement

        view, create, update = Action.VIEW, Action.CREATE, Action.UPDATE
        users = {Role.NURSE, Role.DOCTOR, Role.PHARMACIST, Role.FINANCE, Role.TENANT_ADMIN}
        # General supplies (gloves, syringes, linen), not drugs: drugs stay in pharmacy.
        policy.register(
            "inventory.item",
            model=Item,
            grants=[
                policy.grant(users, {view}),
                policy.grant({Role.PHARMACIST, Role.TENANT_ADMIN}, {create, update}),
            ],
            phi=False,
        )
        # Every receipt, issue and count correction. Nurses take supplies out; the pharmacist
        # receives deliveries and corrects counts. The tenant admin only looks (ADR 0010).
        policy.register(
            "inventory.stockmovement",
            model=StockMovement,
            grants=[
                policy.grant(users, {view}),
                policy.grant({Role.NURSE, Role.PHARMACIST}, {create}),
            ],
            phi=False,
        )
