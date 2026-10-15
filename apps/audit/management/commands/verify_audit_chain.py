from django.core.management.base import BaseCommand, CommandError

from apps.audit.models import AuditEntry
from apps.audit.services import verify_chain


class Command(BaseCommand):
    help = "Check every audit chain (one per tenant, plus the platform) for tampering."

    def handle(self, *args, **options):
        tenant_ids = AuditEntry.objects.values_list("tenant_id", flat=True).distinct()
        failures = 0
        for tenant_id in tenant_ids:
            problems = verify_chain(tenant_id)
            label = tenant_id or "platform"
            if problems:
                failures += 1
                for problem in problems:
                    self.stderr.write(f"{label}: {problem}")
            else:
                self.stdout.write(f"{label}: intact")
        if failures:
            raise CommandError(f"{failures} audit chain(s) failed verification.")
