"""Helpers that describe list filters and custom actions in the OpenAPI schema."""

from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view

DESCRIPTIONS = {
    "patient": "Only rows of this patient (id).",
    "encounter": "Only rows of this encounter (id).",
    "history": "true to include Entered-in-Error rows.",
    "q": "Search text.",
    "status": "Only rows with this status.",
    "ordering": "Sort field, with a leading - for descending.",
    "allergy": "true for only patients with a recorded allergy.",
    "page_size": "Rows per page (10, 25, 50 or 100).",
}


def query(name: str, required: bool = False) -> OpenApiParameter:
    return OpenApiParameter(
        name, str, OpenApiParameter.QUERY, required=required, description=DESCRIPTIONS.get(name, "")
    )


def list_filters(*names: str):
    """Declare a viewset's list query parameters: ``@list_filters("patient", "history")``."""
    return extend_schema_view(list=extend_schema(parameters=[query(n) for n in names]))
