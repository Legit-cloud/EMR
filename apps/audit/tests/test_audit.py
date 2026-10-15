"""SEC-03: append-only, tamper-evident audit of PHI access and changes, including denials."""

import pytest
from django.core.management import call_command
from django.db import DatabaseError, connection, transaction
from django.test import RequestFactory

from apps.audit import services
from apps.audit.models import AuditEntry, AuditImmutable
from apps.core.roles import Role
from tests.tenancy_app.models import Folder, Record

pytestmark = pytest.mark.django_db


def entry(**kwargs):
    kwargs.setdefault("action", services.AuditAction.READ)
    return services.record(**kwargs)


# -- append-only -------------------------------------------------------------------


def test_sec_03_entries_cannot_be_updated_or_deleted_through_the_orm():
    e = entry(resource="x")
    e.reason = "changed"
    with pytest.raises(AuditImmutable):
        e.save()
    with pytest.raises(AuditImmutable):
        e.delete()
    with pytest.raises(AuditImmutable):
        AuditEntry.objects.filter(pk=e.pk).update(reason="changed")
    with pytest.raises(AuditImmutable):
        AuditEntry.objects.all().delete()


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE audit_auditentry SET reason = 'changed'",
        "DELETE FROM audit_auditentry",
    ],
)
def test_sec_03_database_refuses_update_and_delete(sql):
    entry(resource="x")
    with pytest.raises(DatabaseError, match="append-only"), transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(sql)
    assert AuditEntry.objects.get().reason == ""


# -- tamper evidence ---------------------------------------------------------------


def test_sec_03_entries_form_a_hash_chain_per_tenant(tenant_a, tenant_b):
    a1 = entry(tenant_id=tenant_a.id)
    a2 = entry(tenant_id=tenant_a.id)
    b1 = entry(tenant_id=tenant_b.id)
    platform = entry(tenant_id=None)
    assert (a1.sequence, a2.sequence, b1.sequence, platform.sequence) == (1, 2, 1, 1)
    assert a2.previous_hash == a1.entry_hash
    assert b1.previous_hash == services.GENESIS_HASH
    for tenant_id in (tenant_a.id, tenant_b.id, None):
        assert services.verify_chain(tenant_id) == []


def _bypass_trigger(sql, params):
    """Simulate someone with table-owner rights tampering with the log."""
    with connection.cursor() as cursor:
        cursor.execute(
            "ALTER TABLE audit_auditentry DISABLE TRIGGER audit_entry_no_update_or_delete"
        )
        cursor.execute(sql, params)
        cursor.execute(
            "ALTER TABLE audit_auditentry ENABLE TRIGGER audit_entry_no_update_or_delete"
        )


def test_sec_03_verification_detects_an_altered_entry(tenant_a):
    first = entry(tenant_id=tenant_a.id, reason="original")
    entry(tenant_id=tenant_a.id)
    _bypass_trigger("UPDATE audit_auditentry SET reason = 'edited' WHERE id = %s", [first.id])
    assert services.verify_chain(tenant_a.id) == ["entry 1 was altered"]
    with pytest.raises(Exception, match="failed verification"):
        call_command("verify_audit_chain")


def test_sec_03_verification_detects_a_removed_entry(tenant_a):
    entry(tenant_id=tenant_a.id)
    middle = entry(tenant_id=tenant_a.id)
    entry(tenant_id=tenant_a.id)
    _bypass_trigger("DELETE FROM audit_auditentry WHERE id = %s", [middle.id])
    problems = services.verify_chain(tenant_a.id)
    assert "sequence gap before 3 (expected 2)" in problems
    assert "entry 3 does not link to the previous entry" in problems


# -- request details ---------------------------------------------------------------


def test_client_ip_ignores_forwarded_header_unless_trusted(settings):
    request = RequestFactory().get(
        "/", REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="203.0.113.9, 10.0.0.1"
    )
    settings.AUDIT_TRUST_X_FORWARDED_FOR = False
    assert services.client_ip(request) == "10.0.0.1"
    settings.AUDIT_TRUST_X_FORWARDED_FOR = True
    assert services.client_ip(request) == "203.0.113.9"


def test_entry_records_who_where_and_how(user_a):
    request = RequestFactory().get("/x", REMOTE_ADDR="10.0.0.5", HTTP_USER_AGENT="pytest")
    request.user = user_a
    e = entry(request=request, resource="tenancy_app.record", object_id="abc")
    assert (e.actor_id, e.actor_label, e.tenant_id) == (user_a.pk, "alice", user_a.tenant_id)
    assert (e.ip_address, e.user_agent, e.method, e.path) == ("10.0.0.5", "pytest", "GET", "/x")


# -- recorded automatically by the API ---------------------------------------------


@pytest.fixture
def record(tenant_a, as_tenant):
    with as_tenant(tenant_a):
        return Record.objects.create(title="BP reading")


def test_sec_03_phi_list_and_detail_reads_are_recorded(signed_in, user_a, record):
    client = signed_in(user_a)
    client.get("/test-api/records/")
    client.get(f"/test-api/records/{record.id}/")
    listed, detail = AuditEntry.objects.filter(action="read").order_by("sequence")
    assert listed.details["object_ids"] == [str(record.id)]
    assert listed.actor_id == user_a.pk
    assert detail.object_id == str(record.id)
    assert detail.resource == "tenancy_app.record"


def test_sec_03_writes_are_recorded_with_changed_fields(signed_in, user_a, record):
    client = signed_in(user_a)
    response = client.post("/test-api/records/", {"title": "new"}, format="json")
    client.patch(f"/test-api/records/{record.id}/", {"title": "changed"}, format="json")
    create = AuditEntry.objects.get(action="create")
    update = AuditEntry.objects.get(action="update")
    assert create.object_id == response.json()["id"]
    assert update.details["fields"] == ["title"]


def test_sec_03_non_phi_reads_are_not_logged_but_writes_are(signed_in, user_a):
    client = signed_in(user_a)
    client.post("/test-api/folders/", {"name": "Forms"}, format="json")
    client.get("/test-api/folders/")
    assert AuditEntry.objects.filter(resource="tenancy_app.folder", action="create").exists()
    assert not AuditEntry.objects.filter(resource="tenancy_app.folder", action="read").exists()


def test_sec_03_denied_request_is_recorded(signed_in, make_user, tenant_a, record):
    clerk = make_user("clerk", tenant_a, [Role.FRONT_DESK])
    signed_in(clerk).get(f"/test-api/records/{record.id}/")
    denied = AuditEntry.objects.get(outcome="denied")
    assert (denied.actor_id, denied.resource, denied.object_id) == (
        clerk.pk,
        "tenancy_app.record",
        str(record.id),
    )
    assert denied.reason == "permission_denied"
    assert denied.tenant_id == tenant_a.id


def test_sec_03_anonymous_denial_is_recorded(api_client, record):
    api_client.get("/test-api/records/")
    denied = AuditEntry.objects.get(outcome="denied")
    assert denied.actor_id is None and denied.reason == "not_authenticated"


def test_sec_03_mfa_denial_is_recorded(signed_in, user_a, record):
    signed_in(user_a, mfa=False).get("/test-api/records/")
    assert AuditEntry.objects.get(outcome="denied").reason == "mfa_required"


def test_sec_03_cross_tenant_host_denial_is_recorded(signed_in, user_a, tenant_b):
    signed_in(user_a).get("/test-api/records/", HTTP_HOST="b.example.test")
    denied = AuditEntry.objects.get(outcome="denied")
    assert denied.reason == "cross_tenant_access" and denied.actor_id == user_a.pk


def test_sec_03_probing_another_tenants_ids_is_recorded(signed_in, user_a, tenant_b, as_tenant):
    with as_tenant(tenant_b):
        foreign = Folder.objects.create(name="B")
    signed_in(user_a).get(f"/test-api/folders/{foreign.id}/")
    assert AuditEntry.objects.get(outcome="not_found").object_id == str(foreign.id)


# -- compliance access to the log --------------------------------------------------


def test_compliance_reads_own_tenant_log_and_that_read_is_logged(
    signed_in, make_user, tenant_a, tenant_b
):
    entry(tenant_id=tenant_a.id, resource="visible")
    entry(tenant_id=tenant_b.id, resource="hidden")
    auditor = signed_in(make_user("auditor", tenant_a, [Role.COMPLIANCE_OFFICER]))
    resources = [e["resource"] for e in auditor.get("/api/audit/entries/").json()["results"]]
    assert "visible" in resources and "hidden" not in resources
    assert AuditEntry.objects.filter(action="read", resource="audit.auditentry").exists()


def test_other_roles_cannot_read_the_log(signed_in, user_a):
    assert signed_in(user_a).get("/api/audit/entries/").status_code == 403


def test_the_log_api_is_read_only(signed_in, make_user, tenant_a):
    auditor = signed_in(make_user("auditor", tenant_a, [Role.COMPLIANCE_OFFICER]))
    e = entry(tenant_id=tenant_a.id)
    assert auditor.delete(f"/api/audit/entries/{e.id}/").status_code == 405
    assert auditor.post("/api/audit/entries/", {}, format="json").status_code == 405


def test_sharded_chains_verify_and_detect_tampering(tenant_a, settings):
    settings.AUDIT_CHAIN_SHARDS = 4
    entries = [entry(tenant_id=tenant_a.id, resource=f"r{i}") for i in range(40)]
    chains = {e.chain for e in entries}
    assert len(chains) > 1  # spread over several chains
    for chain in chains:
        in_chain = sorted((e for e in entries if e.chain == chain), key=lambda e: e.sequence)
        assert [e.sequence for e in in_chain] == list(range(1, len(in_chain) + 1))
    assert services.verify_chain(tenant_a.id) == []
    victim = entries[5]
    _bypass_trigger("UPDATE audit_auditentry SET reason = 'edited' WHERE id = %s", [victim.id])
    assert services.verify_chain(tenant_a.id) == [
        f"chain {victim.chain}: entry {victim.sequence} was altered"
    ]


def test_verify_command_checks_each_chain_once(tenant_a, tenant_b):
    import io

    for tenant in (tenant_a, tenant_a, tenant_b, None):
        entry(tenant_id=tenant.id if tenant else None)
    out = io.StringIO()
    call_command("verify_audit_chain", stdout=out)
    lines = out.getvalue().splitlines()
    assert sorted(lines) == sorted(
        [f"{tenant_a.id}: intact", f"{tenant_b.id}: intact", "platform: intact"]
    )
