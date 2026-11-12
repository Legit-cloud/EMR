import csv
from datetime import date

from django.db.models import Count, Q
from django.http import HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.mixins import TenantReadOnlyViewSet
from apps.core.api.pagination import PageSizePagination
from apps.core.api.schema import list_filters, query
from apps.core.policy import Action
from apps.core.tenancy import get_current_tenant_id

from ..models import AuditAction, AuditEntry, AuditOutcome
from .serializers import AuditEntrySerializer

FILTERS = ("actor_id", "action", "outcome", "resource", "object_id")
EXPORT_LIMIT = 5000
FILTER_PARAMS = [query(name) for name in (*FILTERS, "q", "date_from", "date_to")]
EXPORT_COLUMNS = [
    "occurred_at",
    "sequence",
    "actor",
    "action",
    "outcome",
    "resource",
    "object_id",
    "reason",
    "ip_address",
    "method",
    "path",
]


class AuditSummarySerializer(serializers.Serializer):
    total = serializers.IntegerField()
    denied = serializers.IntegerField()
    break_glass = serializers.IntegerField()
    reviewed = serializers.IntegerField()


def _day(text: str | None) -> date | None:
    try:
        return date.fromisoformat(text) if text else None
    except ValueError:
        return None


def _cell(value) -> str:
    """A spreadsheet reads a leading = + - or @ as a formula; prefix it so it stays text."""
    text = "" if value is None else str(value)
    return f"'{text}" if text[:1] in ("=", "+", "-", "@") else text


@list_filters(
    "actor_id",
    "action",
    "outcome",
    "resource",
    "object_id",
    "q",
    "date_from",
    "date_to",
    "page_size",
)
class AuditEntryViewSet(TenantReadOnlyViewSet):
    """Read-only audit log of the current tenant for compliance review."""

    model = AuditEntry
    policy_resource = "audit.auditentry"
    policy_actions = {"summary": Action.VIEW, "export": Action.VIEW}
    serializer_class = AuditEntrySerializer
    pagination_class = PageSizePagination

    def get_base_queryset(self):
        queryset = AuditEntry.objects.filter(tenant_id=get_current_tenant_id()).order_by(
            "-sequence"
        )
        params = self.request.query_params
        filters = {f: params[f] for f in FILTERS if f in params}
        queryset = queryset.filter(**filters)
        if start := _day(params.get("date_from")):
            queryset = queryset.filter(occurred_at__date__gte=start)
        if end := _day(params.get("date_to")):
            queryset = queryset.filter(occurred_at__date__lte=end)
        text = params.get("q", "").strip()[:100]
        if text:
            queryset = queryset.filter(
                Q(actor_label__icontains=text)
                | Q(resource__icontains=text)
                | Q(path__icontains=text)
                | Q(object_id__icontains=text)
                | Q(reason__icontains=text)
            )
        return queryset

    @extend_schema(parameters=FILTER_PARAMS, responses=AuditSummarySerializer)
    @action(detail=False, methods=["get"], pagination_class=None)
    def summary(self, request):
        """Counts for the same filters as the list: all, denied, break-glass, and reviews."""
        counts = self.get_queryset().aggregate(
            total=Count("pk"),
            denied=Count("pk", filter=Q(outcome=AuditOutcome.DENIED)),
            break_glass=Count("pk", filter=Q(action=AuditAction.BREAK_GLASS)),
            reviewed=Count("pk", filter=Q(action=AuditAction.BREAK_GLASS_REVIEW)),
        )
        return Response(counts)

    @extend_schema(parameters=FILTER_PARAMS, responses={(200, "text/csv"): bytes})
    @action(detail=False, methods=["get"], pagination_class=None)
    def export(self, request):
        """The filtered log as a CSV, newest first, up to 5000 rows. The export is audited."""
        rows = self.get_queryset()[:EXPORT_LIMIT]
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="audit-log.csv"'
        writer = csv.writer(response)
        writer.writerow(EXPORT_COLUMNS)
        for entry in rows:
            writer.writerow(
                [
                    entry.occurred_at.isoformat(),
                    entry.sequence,
                    _cell(entry.actor_label),
                    entry.action,
                    entry.outcome,
                    _cell(entry.resource),
                    _cell(entry.object_id),
                    _cell(entry.reason),
                    entry.ip_address or "",
                    entry.method,
                    _cell(entry.path),
                ]
            )
        return response
