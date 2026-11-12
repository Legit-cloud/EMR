from unittest import mock

import pytest

pytestmark = pytest.mark.django_db


def _redis():
    return mock.patch("apps.core.api.views.redis.Redis.from_url")


def test_healthz_returns_200_when_database_and_redis_respond(client):
    with _redis() as from_url:
        from_url.return_value.ping.return_value = True
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": {"database": True, "redis": True}}


def test_healthz_returns_503_when_redis_is_down(client):
    with _redis() as from_url:
        from_url.return_value.ping.side_effect = ConnectionError("down")
        response = client.get("/healthz")
    assert response.status_code == 503
    assert response.json()["checks"] == {"database": True, "redis": False}


def test_healthz_returns_503_when_database_is_down(client):
    with (
        _redis() as from_url,
        mock.patch("apps.core.api.views.connection.cursor", side_effect=RuntimeError("down")),
    ):
        from_url.return_value.ping.return_value = True
        response = client.get("/healthz")
    assert response.status_code == 503
    assert response.json()["checks"] == {"database": False, "redis": True}


def test_healthz_rejects_writes(client):
    assert client.post("/healthz").status_code == 405
