import uuid

from apps.core.tenancy import get_current_tenant_id, get_current_user_id, tenant_context


def test_context_is_empty_by_default():
    assert get_current_tenant_id() is None
    assert get_current_user_id() is None


def test_nested_contexts_restore_the_outer_one():
    outer, inner = uuid.uuid4(), uuid.uuid4()
    with tenant_context(outer):
        with tenant_context(inner):
            assert get_current_tenant_id() == inner
        assert get_current_tenant_id() == outer
    assert get_current_tenant_id() is None


def test_context_accepts_string_ids_from_task_payloads():
    tenant_id, user_id = uuid.uuid4(), uuid.uuid4()
    with tenant_context(str(tenant_id), str(user_id)):
        assert get_current_tenant_id() == tenant_id
        assert get_current_user_id() == user_id


def test_context_is_restored_after_an_exception():
    try:
        with tenant_context(uuid.uuid4()):
            raise RuntimeError
    except RuntimeError:
        pass
    assert get_current_tenant_id() is None
