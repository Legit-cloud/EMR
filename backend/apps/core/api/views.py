import logging

import redis
from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

logger = logging.getLogger(__name__)


def _database_ok() -> bool:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        logger.exception("Health check: database unavailable")
        return False
    return True


def _redis_ok() -> bool:
    try:
        client = redis.Redis.from_url(
            settings.REDIS_URL, socket_timeout=2, socket_connect_timeout=2
        )
        client.ping()
    except Exception:
        logger.exception("Health check: redis unavailable")
        return False
    return True


@never_cache
@require_GET
def healthz(request):
    """Return 200 only when both the database and Redis respond."""
    checks = {"database": _database_ok(), "redis": _redis_ok()}
    healthy = all(checks.values())
    body = {"status": "ok" if healthy else "unavailable", "checks": checks}
    return JsonResponse(body, status=200 if healthy else 503)
