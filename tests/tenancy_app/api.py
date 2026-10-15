from rest_framework import serializers

from apps.core.api.mixins import TenantModelViewSet

from .models import Folder, Record


class FolderSerializer(serializers.ModelSerializer):
    class Meta:
        model = Folder
        fields = ["id", "name", "tenant"]
        read_only_fields = ["id", "tenant"]


class RecordSerializer(serializers.ModelSerializer):
    folder = serializers.PrimaryKeyRelatedField(
        queryset=Folder.all_tenants.all(), required=False, allow_null=True
    )

    class Meta:
        model = Record
        fields = ["id", "title", "folder", "facility", "department"]


class FolderViewSet(TenantModelViewSet):
    model = Folder
    policy_resource = "tenancy_app.folder"
    serializer_class = FolderSerializer


class RecordViewSet(TenantModelViewSet):
    model = Record
    policy_resource = "tenancy_app.record"
    serializer_class = RecordSerializer
