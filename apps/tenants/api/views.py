from apps.core.api.mixins import TenantModelViewSet
from apps.core.api.schema import list_filters

from ..models import Department, Facility
from .serializers import DepartmentSerializer, FacilitySerializer


class FacilityViewSet(TenantModelViewSet):
    """Sites of the organisation. Tenant admins maintain them; all staff can list them."""

    model = Facility
    policy_resource = "tenants.facility"
    serializer_class = FacilitySerializer
    http_method_names = ["get", "post", "patch", "head", "options"]


@list_filters("facility")
class DepartmentViewSet(TenantModelViewSet):
    model = Department
    policy_resource = "tenants.department"
    serializer_class = DepartmentSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_base_queryset(self):
        queryset = super().get_base_queryset()
        facility = self.request.query_params.get("facility")
        return queryset.filter(facility_id=facility) if facility else queryset
