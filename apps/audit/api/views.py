from apps.core.api.mixins import TenantReadOnlyViewSet
from apps.core.tenancy import get_current_tenant_id

from ..models import AuditEntry
from .serializers import AuditEntrySerializer

FILTERS = ("actor_id", "action", "outcome", "resource", "object_id")


class AuditEntryViewSet(TenantReadOnlyViewSet):
    """Read-only audit log of the current tenant for compliance review."""

    model = AuditEntry
    policy_resource = "audit.auditentry"
    serializer_class = AuditEntrySerializer

    def get_base_queryset(self):
        queryset = AuditEntry.objects.filter(tenant_id=get_current_tenant_id()).order_by(
            "-sequence"
        )
        filters = {
            f: self.request.query_params[f] for f in FILTERS if f in self.request.query_params
        }
        return queryset.filter(**filters)
