from apps.core.api.serializers import CleanModelSerializer

from ..models import Department, Facility


class FacilitySerializer(CleanModelSerializer):
    class Meta:
        model = Facility
        fields = ["id", "name", "code"]
        read_only_fields = ["id"]


class DepartmentSerializer(CleanModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "facility", "name"]
        read_only_fields = ["id"]
