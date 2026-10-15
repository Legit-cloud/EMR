"""Settings for the pytest run. Uses the same PostgreSQL engine as production."""

import os

os.environ.setdefault("SECRET_KEY", "test-only-not-a-secret")
os.environ.setdefault("DATABASE_URL", "postgres://emr:emr@localhost:5432/emr")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

from .base import *  # noqa: E402, F403

DEBUG = False
ALLOWED_HOSTS = [".example.test"]  # tenant host names used in tests
# Static files are not collected for tests, so WhiteNoise has nothing to serve.
MIDDLEWARE = [m for m in MIDDLEWARE if not m.startswith("whitenoise")]  # noqa: F405
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

# A test-only app with tenant-owned models and an API, used to prove isolation (SEC-07).
INSTALLED_APPS = [*INSTALLED_APPS, "tests.tenancy_app"]  # noqa: F405
ROOT_URLCONF = "tests.tenancy_app.urls"

# django-otp delays retries after a wrong code. Tests submit codes back to back.
OTP_TOTP_THROTTLE_FACTOR = 0
SMS_BACKEND = "apps.notifications.backends.LocmemSmsBackend"
# A fixed, test-only Ed25519 private key (32 bytes). Never used outside tests.
PRESCRIPTION_SIGNING_KEY = "dGVzdC1vbmx5LXByZXNjcmlwdGlvbi1zaWduaW5nLWs="
