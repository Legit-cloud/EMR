# Incident and breach response (DG-06)

A draft for the compliance officer and the data protection officer to complete. Legal
duties under the NDPA 2023 must be confirmed by counsel; the timings below are the
working assumptions to verify.

## Severity

| Level | Examples |
| --- | --- |
| Critical | PHI exposed outside a tenant; cross-tenant access; credentials or signing key leaked; audit log tampered |
| High | Service down for clinical users; failed backups; prescription signatures failing to verify |
| Medium | Degraded performance; a single module unavailable |

## First hour

1. Open an incident record (time, reporter, what is known). One person leads.
2. Contain: revoke sessions and tokens of affected accounts (deactivate the user; tokens
   are revoked automatically), rotate exposed secrets in Railway variables, block the
   offending client, or roll back (see `deploy.md`).
3. Preserve evidence: do not delete logs or data. Export relevant audit entries
   (`/api/audit/entries/?actor_id=...`) and run `manage.py verify_audit_chain`.
4. If the prescription signing key may be exposed: generate a new key, move the old public
   key to `PRESCRIPTION_RETIRED_PUBLIC_KEYS`, deploy, and review prescriptions signed
   since the suspected exposure.

## Personal data breach

- Assess whether personal data was affected, whose, how much, and the likely harm.
- Notify the Nigeria Data Protection Commission without undue delay (working assumption:
  within 72 hours of becoming aware) with the facts known so far; update as facts emerge.
- Notify affected data subjects when the breach is likely to result in high risk to them.
- Notify affected customers (tenants) under their contracts.
- Record every breach, notified or not, with the reasoning.

## After the incident

Write a short review within five working days: timeline, cause, what worked, actions with
owners. Add a regression test for the cause where one is possible.

## Contacts (to fill in)

| Role | Name | Phone | Backup |
| --- | --- | --- | --- |
| Incident lead | | | |
| Data protection officer | | | |
| Compliance officer | | | |
| Railway account owner | | | |
