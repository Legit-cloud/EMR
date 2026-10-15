"""Production and staging settings. Every value comes from environment variables (SEC-04)."""

from .base import *  # noqa: F403
from .base import env

DEBUG = False

# SEC-01: HTTPS only. TLS terminates at the Railway edge, which sets X-Forwarded-Proto.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
# The platform health check calls the container over plain HTTP.
SECURE_REDIRECT_EXEMPT = [r"^healthz$"]
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=31536000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# SEC-05: private bucket, short-lived signed URLs only.
STORAGES = {
    "default": {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "endpoint_url": env("S3_ENDPOINT_URL", default=None),
            "bucket_name": env("S3_BUCKET_NAME", default=""),
            "access_key": env("S3_ACCESS_KEY_ID", default=""),
            "secret_key": env("S3_SECRET_ACCESS_KEY", default=""),
            "region_name": env("S3_REGION", default=None),
            "default_acl": None,
            "querystring_auth": True,
            "querystring_expire": env.int("S3_SIGNED_URL_SECONDS", default=300),
            "file_overwrite": False,
        },
    },
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

SENTRY_DSN = env("SENTRY_DSN", default="")
if SENTRY_DSN:
    import sentry_sdk

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=env("SENTRY_ENVIRONMENT", default="production"),
        send_default_pii=False,
        traces_sample_rate=env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.0),
    )
