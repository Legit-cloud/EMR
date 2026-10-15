from rest_framework import serializers

from ..models import AuditEntry


class AuditEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEntry
        fields = [
            "id",
            "sequence",
            "occurred_at",
            "actor_id",
            "actor_label",
            "action",
            "outcome",
            "resource",
            "object_id",
            "reason",
            "ip_address",
            "user_agent",
            "method",
            "path",
            "details",
            "entry_hash",
        ]
        read_only_fields = fields
