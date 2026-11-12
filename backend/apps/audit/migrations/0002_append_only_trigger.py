from django.db import migrations

# SEC-03: the database itself refuses to change or remove audit rows, whatever the code does.
FORWARD = """
CREATE OR REPLACE FUNCTION audit_entry_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_auditentry is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_entry_no_update_or_delete
    BEFORE UPDATE OR DELETE ON audit_auditentry
    FOR EACH ROW EXECUTE FUNCTION audit_entry_append_only();
"""

REVERSE = """
DROP TRIGGER IF EXISTS audit_entry_no_update_or_delete ON audit_auditentry;
DROP FUNCTION IF EXISTS audit_entry_append_only();
"""


class Migration(migrations.Migration):
    dependencies = [("audit", "0001_initial")]

    operations = [migrations.RunSQL(FORWARD, REVERSE)]
