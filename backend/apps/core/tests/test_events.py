import uuid

import pytest
from celery import shared_task
from django.db import transaction

from apps.core import events
from apps.core.money import Money
from apps.core.tenancy import get_current_tenant_id, get_current_user_id, tenant_context

pytestmark = pytest.mark.django_db

RECEIVED: list[dict] = []
SAMPLE = events.define("test.sample_happened")
OTHER = events.define("test.other_happened")


@shared_task
def record_sample(envelope):
    with events.event_context(envelope) as payload:
        RECEIVED.append(
            {
                "envelope": envelope,
                "payload": payload,
                "tenant_id": get_current_tenant_id(),
                "user_id": get_current_user_id(),
            }
        )


events.subscribe(SAMPLE, record_sample)


@pytest.fixture(autouse=True)
def clear_received():
    RECEIVED.clear()


def test_publish_delivers_to_subscribed_task_after_commit(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        event_id = events.publish(SAMPLE, {"n": 1})
        assert RECEIVED == []  # nothing happens before commit
    assert len(callbacks) == 1
    assert RECEIVED[0]["payload"] == {"n": 1}
    assert RECEIVED[0]["envelope"]["event_id"] == event_id
    assert RECEIVED[0]["envelope"]["name"] == "test.sample_happened"


@pytest.mark.django_db(transaction=True)
def test_rolled_back_transaction_publishes_nothing():
    with pytest.raises(RuntimeError), transaction.atomic():
        events.publish(SAMPLE, {"n": 2})
        raise RuntimeError("rollback")
    assert RECEIVED == []


def test_handler_runs_under_publishers_tenant_and_actor(django_capture_on_commit_callbacks):
    tenant_id, user_id = uuid.uuid4(), uuid.uuid4()
    with tenant_context(tenant_id, user_id), django_capture_on_commit_callbacks(execute=True):
        events.publish(SAMPLE, {})
    assert RECEIVED[0]["tenant_id"] == tenant_id
    assert RECEIVED[0]["user_id"] == user_id
    assert get_current_tenant_id() is None


def test_event_without_subscribers_is_fine(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        events.publish(OTHER, {})
    assert RECEIVED == []


def test_publish_by_name(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        events.publish("test.sample_happened", {"n": 3})
    assert RECEIVED[0]["payload"] == {"n": 3}


def test_payload_must_be_json_serialisable():
    with pytest.raises(TypeError):
        events.publish(SAMPLE, {"amount": Money(100, "NGN")})


def test_each_publish_gets_a_unique_event_id(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        first = events.publish(SAMPLE, {})
        second = events.publish(SAMPLE, {})
    assert first != second


def test_unknown_and_duplicate_event_names_are_errors():
    with pytest.raises(LookupError):
        events.publish("test.never_defined", {})
    with pytest.raises(ValueError):
        events.define("test.sample_happened")


def test_subscribing_twice_delivers_once(django_capture_on_commit_callbacks):
    events.subscribe(SAMPLE, record_sample)
    with django_capture_on_commit_callbacks(execute=True):
        events.publish(SAMPLE, {})
    assert len(RECEIVED) == 1
