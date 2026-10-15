"""Local development settings (docker compose)."""

from .base import *  # noqa: F403
from .base import env

DEBUG = env.bool("DEBUG", default=True)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1", "0.0.0.0"])

if not PRESCRIPTION_SIGNING_KEY:  # noqa: F405
    # Development only: a key derived from SECRET_KEY so signing works out of the box.
    import base64
    import hashlib

    PRESCRIPTION_SIGNING_KEY = base64.b64encode(
        hashlib.sha256(f"dev-signing:{SECRET_KEY}".encode()).digest()  # noqa: F405
    ).decode()
