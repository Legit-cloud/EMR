"""Domain events: Django signals that hand work to Celery tasks after the transaction commits.

Publishing module::

    PATIENT_DECEASED = events.define("patient.deceased")
    events.publish(PATIENT_DECEASED, {"patient_id": str(patient.id)})

Reacting module (in ``AppConfig.ready``)::

    events.subscribe(PATIENT_DECEASED, cancel_appointments_task)

    @shared_task
    def cancel_appointments_task(envelope):
        with events.event_context(envelope):
            ...

The request that publishes never waits for handlers: the signal fires only after commit,
and each receiver only enqueues a task. ``event_id`` lets handlers be idempotent.
"""

import json
import logging
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field

from django.db import transaction
from django.dispatch import Signal
from django.utils import timezone

from .tenancy import get_current_tenant_id, get_current_user_id, tenant_context

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EventType:
    name: str
    signal: Signal = field(default_factory=Signal, compare=False, repr=False)


_registry: dict[str, EventType] = {}


def define(name: str) -> EventType:
    """Declare an event once, in the publishing module's ``events.py``."""
    if name in _registry:
        raise ValueError(f"Event {name!r} is already defined")
    event = EventType(name)
    _registry[name] = event
    return event


def get(name: str) -> EventType:
    try:
        return _registry[name]
    except KeyError:
        raise LookupError(f"Unknown event {name!r}") from None


def subscribe(event: EventType | str, task) -> None:
    """Enqueue ``task.delay(envelope)`` every time ``event`` is published and committed."""
    event = get(event) if isinstance(event, str) else event

    def receiver(sender, envelope, **kwargs):
        task.delay(envelope)

    event.signal.connect(receiver, weak=False, dispatch_uid=f"{event.name}->{task.name}")


def publish(event: EventType | str, payload: dict, *, tenant_id=None) -> str:
    """Publish after the current transaction commits. Returns the event id.

    The payload must be JSON-serialisable (ids as strings, Money via ``to_dict``).
    Nothing is delivered if the transaction rolls back.
    """
    event = get(event) if isinstance(event, str) else event
    tenant_id = tenant_id or get_current_tenant_id()
    user_id = get_current_user_id()
    envelope = {
        "event_id": str(uuid.uuid4()),
        "name": event.name,
        "tenant_id": str(tenant_id) if tenant_id else None,
        "actor_id": str(user_id) if user_id else None,
        "occurred_at": timezone.now().isoformat(),
        "payload": payload,
    }
    json.dumps(envelope)  # Fail in the publisher, not later in the worker.

    def send():
        event.signal.send(sender=event.name, envelope=envelope)

    transaction.on_commit(send, robust=True)
    return envelope["event_id"]


@contextmanager
def event_context(envelope: dict) -> Iterator[dict]:
    """Run a handler under the tenant and actor that published the event."""
    with tenant_context(envelope.get("tenant_id"), envelope.get("actor_id")):
        yield envelope["payload"]
