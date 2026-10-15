# Release 1 readiness report

Date: 2026-10-15. Branch `hardening/release-1` (stacked on the Release 1 branches).
Status key: **PASS** verified by automated tests or a recorded run; **PARTIAL** done with a
named gap; **FAIL** checked and not met; **NOT YET VERIFIABLE** needs a human, real
infrastructure or a decision.

## Summary

The Release 1 backend is functionally complete and every rule in CLAUDE.md Section 5 that
belongs to Release 1 has automated tests (454 tests, `make check` green: ruff and pytest
only). It is **not ready for real patient data** until the items marked NOT YET VERIFIABLE
or FAIL are closed. The most important are: human clinical and finance review, backups and
a restore test on Railway, the recovery-point gap, a database role that does not own the
audit and ledger tables, a performance measurement on staging with the ASGI/WSGI decision,
and the NDPA items (DPIA, residency, breach plan).

## CLAUDE.md Section 8: definition of done

| # | Item | Status | Evidence / gap |
| --- | --- | --- | --- |
| 1 | Every requirement implemented has tests; all pass; `make check` green (ruff + pytest only) | **PASS** | 454 tests. SEC IDs referenced by tests: SEC-01 (2), SEC-02 (35), SEC-03 (15), SEC-04 (2), SEC-05 (2), SEC-06 (6), SEC-07 (25), SEC-09 (7). SEC-08 and SEC-10 are infrastructure and process (below). FR/AC IDs are **not mapped**: `docs/PRD.pdf` is not in the repository. |
| 2 | Module-boundary test and migration-drift test in the suite | **PASS** | `tests/test_module_boundaries.py`, `tests/test_migrations.py`. |
| 3 | Authorisation and tenant-isolation tests for every endpoint | **PASS** | `tests/test_permission_matrix.py` checks every policy endpoint against every role (GET and POST) and anonymous callers, generated from the URL configuration and the policy registry; `tests/test_permission_coverage.py` fails for any endpoint outside the policy layer that is not on a justified list. Tenant isolation is proven at the base layer (`tests/test_tenant_isolation.py`, including that every tenant model defaults to the scoped manager) and per module (patients, clinical, scheduling, billing, accounts). Not every endpoint has its own cross-tenant test; they all share the tested base. |
| 4 | Migrations reversible where possible; never edited after merge | **PASS** | Schema migrations are Django-reversible; trigger migrations have reverse SQL; reference-data seeds reverse as no-ops. Nothing is merged yet, so no merged migration has been edited. |
| 5 | Clinical, pharmacy and billing logic reviewed by a human with clinical or finance responsibility | **NOT YET VERIFIABLE** | Review list: ADR 0004 (duplicate weights, deceased rule), 0005 (status transitions, plausibility ranges, clinical grants), 0006 (scheduling grants, triage defaults), 0007 (blocking alerts, override rule, synthetic interaction rules), 0008 (posting rules, per-payment posting). |
| 6a | Automation: MRN | **PASS** | Concurrency test: 8 simultaneous registrations, unique sequential MRNs; fails with a naive generator. |
| 6b | Automation: duplicates | **PASS** | 85% boundary tests; near-duplicates held for review; simultaneous identical registrations create one patient. |
| 6c | Automation: status cascade (Deceased) | **PASS** | One event; appointments (including recurring) cancelled; invoices flagged for estate review. Portal revocation is a stub: the portal is Release 2. |
| 6d | Automation: licence watcher | **PASS** | Expiring and expired flagged once per change, HR and tenant admins emailed, audited, all tenants covered. |
| 6e | Automation: ward charges | **NOT APPLICABLE TO R1** | Inpatient is Release 2. `billing.services.add_line` and the Lagos-time beat schedule are ready for it. |
| 6f | Automation: ledger sync | **PASS** | Delivered charge: Dr AR / Cr Revenue; payment: Dr Cash/Bank / Cr AR; database refuses unbalanced entries; replayed events change nothing. |
| 7 | Audit log complete and immutable | **PARTIAL** | Immutable: model, queryset and database trigger refuse changes; hash chains detect edits and removals (`verify_audit_chain`). Complete: every API read of PHI, every write, every denial (HTTP and WebSocket) and sign-in events. **Gaps:** (a) the Django admin is not audited (it now requires MFA, and tenant users are not staff); (b) system handlers (stock reservation, invoice lines) write without their own audit entry, though their trigger events are audited; (c) the table owner can disable triggers, so production must use a non-owner database role (below). |
| 8 | Billing and ledger reconcile against test data | **PASS** | Seeded dataset with insurer splits, partial payments, voids and pending items reconciles; tampering is detected; `manage.py reconcile_billing`. |
| 9 | Backups restored successfully once | **NOT YET VERIFIABLE** | Needs Railway. Procedure and log: `docs/runbooks/backup-restore.md`. |
| 10 | No critical or high security findings open | **NOT YET VERIFIABLE** | No external penetration test yet. Internal findings are listed below; the open ones need infrastructure work. |

## Security requirements (Section 6)

| ID | Status | Notes |
| --- | --- | --- |
| SEC-01 HTTPS, encryption at rest | **PARTIAL** | HTTPS redirect, HSTS, secure cookies and `check --deploy` pass in tests. Encryption at rest depends on Railway volumes and the object store: confirm with the providers. |
| SEC-02 RBAC + ABAC on every request | **PASS** | Policy layer, generated permission matrix, break-glass with review. |
| SEC-03 Immutable audit | **PARTIAL** | See item 7. |
| SEC-04 Secrets in environment only | **PASS** | Production refuses to start without `SECRET_KEY` or `PRESCRIPTION_SIGNING_KEY`; no secrets in the repository. Enable GitHub secret scanning (a setting). |
| SEC-05 Private storage, signed URLs | **PASS** | Private ACL, SigV4 signed URLs with 300 s expiry, tested offline. Bucket policy itself must be checked on R2/S3. |
| SEC-06 Rate limits, validation, headers, CSRF | **PASS** | Anonymous and user throttles, tighter sign-in limits, CSP, Permissions-Policy, `no-store` on API responses, CSRF on session sign-in, UUID-only lookups, upload type sniffing. |
| SEC-07 Tenant isolation proven | **PASS** | See item 3. |
| SEC-08 Backups and monthly restore | **NOT YET VERIFIABLE** | Recovery point of 15 minutes needs point-in-time recovery; daily dumps give 24 hours. **Gap to decide.** |
| SEC-09 Tamper-evident signatures | **PASS** | Ed25519, verification rebuilds the payload; tampering blocks dispensing; key rotation tested. |
| SEC-10 Production access and deploys | **NOT YET VERIFIABLE** | Protect `staging`, require review, 2FA for named engineers on GitHub and Railway: human settings. |

## NDPA frame (DG-01..10)

All **NOT YET VERIFIABLE** by code; they need the data protection officer and counsel.
What the code provides: data minimisation in logs and error reports (redaction tested),
an access log for data-subject access requests, Entered-in-Error instead of deletion,
licence verification records (DG-08), and signed, audited records supporting evidential
standing (DG-10). Still needed: DPIA (DG-07), Railway region and residency decision
(DG-05), retention schedule (DG-04), consent and lawful-basis wording (DG-02), the
breach plan in `docs/runbooks/incident-response.md` completed (DG-06).

## Performance (Section 6 targets)

**NOT YET VERIFIABLE.** Single-client latency is within target (chart 393 ms, booking
213 ms p95). Under 20 concurrent clients on a development laptop the targets were missed;
the laptop cannot separate the app from the load generator. Three real problems found and
fixed: database connection exhaustion (connection pool), audit-lock contention (sharded
chains), and query count (9 to 5 per request). Decision needed: serve HTTP through WSGI
gthread workers with a separate ASGI service for WebSockets, or keep ASGI and scale.
Details: `docs/runbooks/load-test.md`.

## Findings from this hardening pass

Fixed:

1. The OpenAPI schema was readable without signing in (now signed-in users only).
2. Session sign-in did not check CSRF (login CSRF); now enforced, with a CSRF endpoint.
3. Malformed ids could reach the database; lookups now only accept UUIDs (404 otherwise).
4. Search terms (names) in query strings reached access logs; all handlers now redact
   query strings, emails and phone numbers. Sentry events drop bodies, cookies, headers,
   local variables and user details other than the id.
5. The Django admin needed only a password; it now requires MFA.
6. Connection exhaustion and audit-lock contention under load (see Performance).
7. API responses could be cached by browsers or proxies; now `Cache-Control: no-store`.

Open (need infrastructure or a decision):

1. **Database role.** The app should connect as a role that does not own the audit and
   ledger tables, so it cannot disable their triggers or truncate them.
2. **Event delivery.** Domain events are enqueued after commit; if Redis is unavailable at
   that moment the event is lost (logged). Add a transactional outbox before go-live.
3. **Admin auditing** (item 7a) and **system-handler audit entries** (7b).
4. **WebSockets** accept session sign-in only, not bearer tokens.
5. **Recovery point** (SEC-08) and **ASGI/WSGI** (Performance).

## Open decisions (CLAUDE.md Section 12)

All ten remain open. The ones blocking go-live: 2 (interaction knowledge base: the current
rules are synthetic examples), 3 (SMS and email providers), 4 (object storage and backup
destination), 5 (Railway region and residency). FR/AC mapping needs `docs/PRD.pdf`.
