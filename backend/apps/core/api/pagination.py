from rest_framework.pagination import PageNumberPagination


class PageSizePagination(PageNumberPagination):
    """Page numbers, with ``?page_size=`` for lists where the user picks rows per page."""

    page_size_query_param = "page_size"
    max_page_size = 100
