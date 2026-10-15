"""Request-scoped tenant and actor context.

The current tenant and user are held in context variables so they follow the request
through sync code, async code and Celery tasks without being passed around. Tenant-owned
models read them to scope queries and to stamp new rows (SEC-07).
"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

_current_tenant_id: ContextVar[uuid.UUID | None] = ContextVar("current_tenant_id", default=None)
_current_user_id: ContextVar[uuid.UUID | None] = ContextVar("current_user_id", default=None)


def get_current_tenant_id() -> uuid.UUID | None:
    return _current_tenant_id.get()


def get_current_user_id() -> uuid.UUID | None:
    return _current_user_id.get()


def activate(tenant_id, user_id=None) -> tuple:
    """Set the context and return tokens for ``deactivate``. Prefer ``tenant_context``."""
    return (_current_tenant_id.set(_as_uuid(tenant_id)), _current_user_id.set(_as_uuid(user_id)))


def deactivate(tokens: tuple) -> None:
    tenant_token, user_token = tokens
    _current_user_id.reset(user_token)
    _current_tenant_id.reset(tenant_token)


@contextmanager
def tenant_context(tenant_id: uuid.UUID | None, user_id: uuid.UUID | None = None) -> Iterator[None]:
    """Run a block as ``tenant_id`` (and optionally ``user_id``), restoring the previous context.

    Use in Celery tasks and management commands. Requests get it from the tenant middleware.
    """
    tokens = activate(tenant_id, user_id)
    try:
        yield
    finally:
        deactivate(tokens)


def _as_uuid(value) -> uuid.UUID | None:
    if value is None or isinstance(value, uuid.UUID):
        return value
    return uuid.UUID(str(value))
