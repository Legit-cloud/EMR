from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import policy
from apps.core.api.permissions import TenantUserPermission

from .. import services
from . import serializers as s


class DashboardView(APIView):
    """Totals for the dashboard cards the user may see (see ``reports.services``)."""

    permission_classes = [TenantUserPermission]

    @extend_schema(parameters=[s.DashboardQuerySerializer], responses=s.DashboardSerializer)
    def get(self, request):
        query = s.DashboardQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        subject = policy.subject_for(request.user, request.tenant_id)
        data = services.dashboard(request.user, subject, query.validated_data["range"])
        return Response(s.DashboardSerializer(data).data)
