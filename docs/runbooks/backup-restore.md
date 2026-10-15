# Backup and restore (SEC-08)

Targets (CLAUDE.md Section 6, proposed): recovery point 15 minutes, recovery time 4 hours.

## What must be in place before real patient data (human tasks)

1. **Platform backups.** Enable scheduled backups on the Railway PostgreSQL service in
   `production` (and `staging`). Record the schedule and retention here.
2. **Off-platform encrypted copy.** A daily `pg_dump` to storage outside Railway, encrypted
   before upload. The destination is open decision 4 (R2 or S3). Use the procedure below.
3. **Recovery point.** Daily dumps give a recovery point of up to 24 hours, not 15 minutes.
   Meeting 15 minutes needs continuous WAL archiving / point-in-time recovery. Confirm
   whether the Railway plan offers it; if not, decide between a managed PostgreSQL with
   PITR or accepting a longer recovery point. **This is an open gap.**
4. **Restore test.** Restore once before go-live and then monthly (procedure below); log
   each test in the table at the end.

## Taking an off-platform encrypted backup

Run from a trusted machine or a scheduled job with network access to the database. Never
write an unencrypted dump to shared storage.

```sh
# Variables come from a secret store, never from shell history or the repository.
export DATABASE_URL=...            # production read-only connection is enough
export AGE_RECIPIENT=age1...       # public key; the private key is held offline by two people
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | age --recipient "$AGE_RECIPIENT" > "emr-$STAMP.dump.age"
aws s3 cp "emr-$STAMP.dump.age" "s3://<backup-bucket>/postgres/" --endpoint-url "$S3_ENDPOINT_URL"
rm "emr-$STAMP.dump.age"
```

`age` (https://age-encryption.org) or GPG both work; the point is that the storage provider
never sees plaintext and the private key never lives next to the backups. Set an object
lifecycle rule for retention (for example 35 daily, 12 monthly) in line with the retention
policy (DG-04).

## Restoring

1. Create an empty PostgreSQL database (a new Railway environment or local Docker). Never
   restore over the live database.
2. Decrypt and restore:
   ```sh
   age --decrypt -i key.txt emr-<stamp>.dump.age > emr.dump
   pg_restore --no-owner --no-privileges --dbname "$RESTORE_DATABASE_URL" emr.dump
   shred -u emr.dump
   ```
3. Point a staging copy of the app at it (`DATABASE_URL`) and run:
   ```sh
   python manage.py migrate --check         # schema matches the code
   python manage.py verify_audit_chain      # audit log intact (SEC-03)
   python manage.py reconcile_billing       # invoices, payments and ledger agree
   ```
4. Spot-check: sign in, open three patient charts, one invoice, one signed prescription
   (`GET /api/pharmacy/prescriptions/<id>/verify/` must return `valid: true`).
5. Record the time taken against the 4-hour recovery-time target.

The audit and journal tables carry triggers that refuse UPDATE and DELETE; `pg_restore`
only inserts, so restores are not affected.

## Restore test log

| Date | Backup used | Restored by | Checks passed | Time to usable | Notes |
| --- | --- | --- | --- | --- | --- |
| _not yet done_ | | | | | |
