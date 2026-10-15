"""Production settings are loaded in a subprocess so they never leak into the test settings."""

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PROBE = """
import json
import django
django.setup()
from django.conf import settings
options = settings.STORAGES["default"]["OPTIONS"]
print(json.dumps({
    "DEBUG": settings.DEBUG,
    "SECURE_SSL_REDIRECT": settings.SECURE_SSL_REDIRECT,
    "SECURE_HSTS_SECONDS": settings.SECURE_HSTS_SECONDS,
    "SESSION_COOKIE_SECURE": settings.SESSION_COOKIE_SECURE,
    "CSRF_COOKIE_SECURE": settings.CSRF_COOKIE_SECURE,
    "SECURE_PROXY_SSL_HEADER": settings.SECURE_PROXY_SSL_HEADER,
    "SECRET_KEY": settings.SECRET_KEY,
    "querystring_auth": options["querystring_auth"],
    "default_acl": options["default_acl"],
    "signature_version": options["signature_version"],
}))
"""

PRODUCTION_ENV = {
    "DJANGO_SETTINGS_MODULE": "config.settings.production",
    "SECRET_KEY": "from-the-environment",
    "DATABASE_URL": "postgres://user:pass@db:5432/emr",
    "REDIS_URL": "redis://redis:6379/0",
}


def _run(drop=()):
    env = {k: v for k, v in os.environ.items() if k not in PRODUCTION_ENV}
    env.update(PRODUCTION_ENV)
    for key in drop:
        env.pop(key)
    return subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _values():
    result = _run()
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_sec_01_production_enforces_https_secure_cookies_and_hsts():
    values = _values()
    assert values["DEBUG"] is False
    assert values["SECURE_SSL_REDIRECT"] is True
    assert values["SECURE_HSTS_SECONDS"] >= 31536000
    assert values["SESSION_COOKIE_SECURE"] is True
    assert values["CSRF_COOKIE_SECURE"] is True
    assert values["SECURE_PROXY_SSL_HEADER"] == ["HTTP_X_FORWARDED_PROTO", "https"]


def test_sec_04_secret_key_comes_from_the_environment():
    assert _values()["SECRET_KEY"] == "from-the-environment"


def test_sec_04_production_refuses_to_start_without_secret_key():
    result = _run(drop=("SECRET_KEY",))
    assert result.returncode != 0
    assert "SECRET_KEY" in result.stderr


def test_sec_05_file_storage_is_private_with_signed_urls():
    values = _values()
    assert values["querystring_auth"] is True
    assert values["default_acl"] is None
    assert values["signature_version"] == "s3v4"
