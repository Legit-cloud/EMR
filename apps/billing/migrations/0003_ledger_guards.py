from django.db import migrations

# The general ledger is enforced by the database itself:
# - every journal entry balances (debits = credits), checked when the transaction commits;
# - posted entries and lines are append-only: corrections are reversing entries.
FORWARD = """
CREATE OR REPLACE FUNCTION billing_journal_entry_balanced() RETURNS trigger AS $$
DECLARE
    entry uuid := NEW.entry_id;
    debits bigint;
    credits bigint;
BEGIN
    SELECT COALESCE(SUM(debit_minor), 0), COALESCE(SUM(credit_minor), 0)
      INTO debits, credits
      FROM billing_journalline WHERE entry_id = entry;
    IF debits <> credits THEN
        RAISE EXCEPTION 'journal entry % does not balance: debits %, credits %',
            entry, debits, credits USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_entry_balanced
    AFTER INSERT ON billing_journalline
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION billing_journal_entry_balanced();

CREATE OR REPLACE FUNCTION billing_ledger_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_append_only BEFORE UPDATE OR DELETE ON billing_journalentry
    FOR EACH ROW EXECUTE FUNCTION billing_ledger_append_only();
CREATE TRIGGER journal_line_append_only BEFORE UPDATE OR DELETE ON billing_journalline
    FOR EACH ROW EXECUTE FUNCTION billing_ledger_append_only();
"""

REVERSE = """
DROP TRIGGER IF EXISTS journal_line_append_only ON billing_journalline;
DROP TRIGGER IF EXISTS journal_entry_append_only ON billing_journalentry;
DROP FUNCTION IF EXISTS billing_ledger_append_only();
DROP TRIGGER IF EXISTS journal_entry_balanced ON billing_journalline;
DROP FUNCTION IF EXISTS billing_journal_entry_balanced();
"""


class Migration(migrations.Migration):
    dependencies = [("billing", "0002_account_insurer_journalentry_journalline_payment_and_more")]

    operations = [migrations.RunSQL(FORWARD, REVERSE)]
