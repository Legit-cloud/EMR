from django.core.management.base import BaseCommand, CommandError

from apps.billing.services import reconcile
from apps.core.tenancy import tenant_context
from apps.tenants.selectors import active_tenant_ids


class Command(BaseCommand):
    help = "Check that invoices, payments and the ledger agree, in every tenant."

    def add_arguments(self, parser):
        parser.add_argument("--currency", default="NGN")

    def handle(self, *args, currency, **options):
        failures = 0
        for tenant_id in active_tenant_ids():
            with tenant_context(tenant_id):
                problems = reconcile(currency)
            if problems:
                failures += 1
                for problem in problems:
                    self.stderr.write(f"{tenant_id}: {problem}")
            else:
                self.stdout.write(f"{tenant_id}: reconciled")
        if failures:
            raise CommandError(f"{failures} tenant(s) do not reconcile.")
