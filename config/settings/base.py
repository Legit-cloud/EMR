"""Settings shared by every environment. Values come from environment variables."""

from pathlib import Path

import environ
from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()

SECRET_KEY = env("SECRET_KEY")
DEBUG = env.bool("DEBUG", default=False)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[])
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
]
THIRD_PARTY_APPS = [
    "rest_framework",
    "drf_spectacular",
    "django_otp",
    "django_otp.plugins.otp_totp",
]
LOCAL_APPS = [
    "apps.core",
    "apps.tenants",
    "apps.accounts",
    "apps.audit",
    "apps.patients",
    "apps.clinical",
    "apps.scheduling",
    "apps.pharmacy",
    "apps.staff",
    "apps.billing",
    "apps.notifications",
]
INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "apps.core.security.SecurityHeadersMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django_otp.middleware.OTPMiddleware",
    "apps.tenants.middleware.TenantMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Paths the tenant middleware skips: they never read tenant data.
TENANT_EXEMPT_PATHS = ("/healthz",)

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {"default": env.db("DATABASE_URL")}
# Under ASGI, sync views run in a thread pool, so per-thread persistent connections pile
# up until PostgreSQL refuses clients (seen in the load test). A bounded pool per process
# is Django's supported answer; persistent connections must then be off.
DATABASES["default"]["CONN_MAX_AGE"] = 0
DATABASES["default"].setdefault("OPTIONS", {})["pool"] = {
    "min_size": env.int("DB_POOL_MIN_SIZE", default=1),
    "max_size": env.int("DB_POOL_MAX_SIZE", default=10),
    "timeout": env.int("DB_POOL_TIMEOUT_SECONDS", default=10),
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REDIS_URL = env("REDIS_URL")
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-gb"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

EMAIL_CONFIG = env.email("EMAIL_URL", default="consolemail://")
vars().update(EMAIL_CONFIG)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="no-reply@example.com")

REST_FRAMEWORK = {
    # Bearer first, so unauthenticated API calls get 401 with a WWW-Authenticate header.
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.ApiTokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.api.exceptions.api_exception_handler",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    # SEC-06: every API client is rate limited; sign-in has a tighter scoped limit.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "auth": env("AUTH_THROTTLE_RATE", default="10/min"),
        "anon": env("ANON_THROTTLE_RATE", default="60/min"),
        "user": env("USER_THROTTLE_RATE", default="600/min"),
    },
    # Proxies in front of the app, so throttling sees the real client address.
    "NUM_PROXIES": env.int("NUM_PROXIES", default=0),
}
SPECTACULAR_SETTINGS = {
    "TITLE": "EMR API",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    # The API description is not public.
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAuthenticated"],
    # Separate request and response components, so clients never have to send read-only
    # fields (the frontend's typed client relies on this).
    "COMPONENT_SPLIT_REQUEST": True,
    # Stable names for the many "status" choice sets, so generated clients stay readable.
    "ENUM_NAME_OVERRIDES": {
        "PatientStatusEnum": "apps.patients.models.PatientStatus",
        "DuplicateReviewStatusEnum": "apps.patients.models.ReviewStatus",
        "EncounterStatusEnum": "apps.clinical.models.EncounterStatus",
        "NoteStatusEnum": "apps.clinical.models.NoteStatus",
        "AppointmentStatusEnum": "apps.scheduling.models.AppointmentStatus",
        "PrescriptionStatusEnum": "apps.pharmacy.models.PrescriptionStatus",
        "InvoiceLineStatusEnum": "apps.billing.models.LineStatus",
        "PaymentStatusEnum": "apps.billing.models.PaymentStatus",
        "DosageFormEnum": "apps.pharmacy.models.DosageForm",
    },
}

# Patients (CLAUDE.md Section 5)
MRN_TIME_ZONE = env("MRN_TIME_ZONE", default="Africa/Lagos")
MRN_SEQUENCE_DIGITS = 6
PATIENT_DUPLICATE_THRESHOLD = 0.85
DEFAULT_PHONE_COUNTRY_CODE = env("DEFAULT_PHONE_COUNTRY_CODE", default="234")
PATIENT_DECEASED_ROLES = env.list("PATIENT_DECEASED_ROLES", default=["doctor"])
PATIENT_ATTACHMENT_MAX_BYTES = env.int("PATIENT_ATTACHMENT_MAX_BYTES", default=20 * 1024 * 1024)
# Kept equal to the signed URL lifetime of the storage backend.
PATIENT_ATTACHMENT_URL_SECONDS = env.int("S3_SIGNED_URL_SECONDS", default=300)
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

# Pharmacy (CLAUDE.md Section 5, SEC-09)
PHARMACY_INTERACTION_CHECKER = env(
    "PHARMACY_INTERACTION_CHECKER", default="apps.pharmacy.interactions.LocalRulesChecker"
)
PRESCRIPTION_MIN_OVERRIDE_REASON = 15
# Base64 Ed25519 private key (32 bytes), one per environment. Never commit it.
PRESCRIPTION_SIGNING_KEY = env("PRESCRIPTION_SIGNING_KEY", default="")
# Public keys of rotated signing keys, so older prescriptions still verify.
PRESCRIPTION_RETIRED_PUBLIC_KEYS = env.list("PRESCRIPTION_RETIRED_PUBLIC_KEYS", default=[])

# Staff and scheduling
LICENCE_EXPIRY_WARNING_DAYS = env.int("LICENCE_EXPIRY_WARNING_DAYS", default=60)
APPOINTMENT_SLOT_MINUTES = env.int("APPOINTMENT_SLOT_MINUTES", default=15)
APPOINTMENT_REMINDER_OFFSETS_HOURS = [
    int(h) for h in env.list("APPOINTMENT_REMINDER_OFFSETS_HOURS", default=["24", "2"])
]
APPOINTMENT_MAX_RECURRENCE = 12
APPOINTMENT_DEFAULT_TRIAGE_PRIORITY = 3
ICS_PRODUCT_ID = "EMR//Appointments"
ICS_UID_DOMAIN = env("ICS_UID_DOMAIN", default="emr.local")

# Notifications. The SMS provider is an open decision (CLAUDE.md Section 12).
SMS_BACKEND = env("SMS_BACKEND", default="apps.notifications.backends.ConsoleSmsBackend")
SMS_SENDER_ID = env("SMS_SENDER_ID", default="EMR")

# Accounts and access control (CLAUDE.md Section 7)
API_TOKEN_TTL_MINUTES = env.int("API_TOKEN_TTL_MINUTES", default=12 * 60)
OTP_TOTP_ISSUER = env("OTP_TOTP_ISSUER", default="EMR")
# Roles that must use MFA. Users of other roles need it once they enrol a device.
MFA_REQUIRED_ROLES = env.list(
    "MFA_REQUIRED_ROLES",
    default=[
        "tenant_admin",
        "doctor",
        "nurse",
        "pharmacist",
        "lab_technician",
        "front_desk",
        "billing_officer",
        "finance",
        "hr",
        "compliance_officer",
    ],
)
BREAK_GLASS_ROLES = env.list("BREAK_GLASS_ROLES", default=["doctor", "nurse"])
BREAK_GLASS_MINUTES = env.int("BREAK_GLASS_MINUTES", default=60)
BREAK_GLASS_MIN_REASON_LENGTH = 15
PASSWORD_RESET_URL = env(
    "PASSWORD_RESET_URL", default="http://localhost:3000/reset-password?uid={uid}&token={token}"
)
PASSWORD_RESET_TIMEOUT = env.int("PASSWORD_RESET_TIMEOUT", default=60 * 60 * 24)
# Independent hash chains per tenant, so concurrent PHI reads do not queue on one lock.
# Changing it later is safe: existing entries keep the chain they were written to.
AUDIT_CHAIN_SHARDS = env.int("AUDIT_CHAIN_SHARDS", default=16)
# Trust the first X-Forwarded-For address for audit records only behind a trusted proxy.
AUDIT_TRUST_X_FORWARDED_FOR = env.bool("AUDIT_TRUST_X_FORWARDED_FOR", default=False)

CELERY_BROKER_URL = REDIS_URL
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
# Beat schedules run in local time (for example ward charges at 00:00).
CELERY_TIMEZONE = env("CELERY_TIMEZONE", default="Africa/Lagos")
CELERY_BEAT_SCHEDULE = {
    "licence-watcher": {
        "task": "apps.staff.tasks.run_licence_watcher",
        "schedule": crontab(hour=6, minute=0),
    },
    "appointment-reminders": {
        "task": "apps.scheduling.tasks.send_appointment_reminders",
        "schedule": crontab(minute="*/10"),
    },
}

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [REDIS_URL]},
    }
}

# Every handler redacts PHI (query strings, emails, phone numbers) before writing.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"redact_phi": {"()": "apps.core.redaction.PhiRedactingFilter"}},
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "plain",
            "filters": ["redact_phi"],
        }
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
    "loggers": {
        # Access logs include query strings; route them through the redacting handler.
        "uvicorn.access": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "uvicorn.error": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "gunicorn.access": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "gunicorn.error": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "celery": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}
# Celery would otherwise replace the logging configuration with its own handlers.
CELERY_WORKER_HIJACK_ROOT_LOGGER = False

# SEC-06: headers beyond Django's defaults (see apps.core.security).
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; "
    "form-action 'self'"
)
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
