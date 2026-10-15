# 3. Access control (RBAC + ABAC, MFA, break-glass) and the audit log

Date: 2026-10-15
Status: Accepted

## Context

Every request must be authorised on the server by role and attributes (SEC-02), PHI access
and changes must be recorded in an immutable log (SEC-03), and a denied request must still
be recorded. Clinicians sometimes need a record outside their normal scope in an emergency.

## Decision

**Policy layer (`apps.core.policy`)**

- Each module registers its resources with grants: roles × actions × scope
  (tenant, facility, department, care team), optionally only while on duty.
- Role assignments (`accounts.RoleAssignment`) carry the facility and department.
  Care team membership comes from the model (`care_team_q`); shift status from a provider
  the staff module will register (until then nobody counts as on duty).
- `PolicyViewSetMixin` (with `PolicyPermission`) is the base for every API view over
  tenant data. Lists are filtered to the user's scope; detail views check the object, so
  an out-of-scope row gives 403 (cross-tenant rows still give 404). After a create or
  update the row must still be in scope, or the write is rolled back.
- `tests/test_permission_coverage.py` fails if an API view is not policy-checked and not
  on a short, justified exception list.
- `core` imports `accounts.selectors` and `audit.services`. This is the only place the
  shared kernel depends on domain modules, and only through their public interfaces.

**Authentication and MFA**

- Sessions for the web app; bearer tokens for API clients. Tokens are random, stored as
  SHA-256 hashes, expire (`API_TOKEN_TTL_MINUTES`) and are revoked on sign-out, password
  reset and deactivation.
- TOTP through django-otp. MFA is enforced for roles in `MFA_REQUIRED_ROLES` (default:
  all staff roles) and for anyone who has enrolled a device. A user who still has to enrol
  can sign in but reaches only the enrolment endpoints.
- Sign-in, MFA confirmation and password reset are throttled (`AUTH_THROTTLE_RATE`).

**Break-glass**

- Roles in `BREAK_GLASS_ROLES` may open one record of a break-glass resource for
  `BREAK_GLASS_MINUTES`, view only, with a reason. The grant and every read under it are
  audited, and the compliance role reviews each grant; nobody reviews their own.

**Audit log (`apps.audit`)**

- `AuditEntry` is append-only: the model and queryset refuse updates and deletes, and a
  PostgreSQL trigger refuses UPDATE and DELETE on the table.
- Entries form a SHA-256 hash chain per tenant (and one for the platform), serialised by a
  transaction-level advisory lock. `manage.py verify_audit_chain` detects altered or
  removed rows.
- Actor, tenant and object are stored as plain values, so deleting users or tenants never
  touches the log. Details hold identifiers, not clinical content.
- The viewset base records PHI reads (list and detail), every write with the changed
  field names, and every 401/403 (and 404 on detail routes). The tenant middleware and
  the auth endpoints record their own events.

## Consequences

- The trigger stops the application, not the table owner: an owner can disable triggers
  or TRUNCATE. In production the application should connect as a role that does not own
  the audit table, and the hash chain plus an off-platform copy covers the rest. This is
  an infrastructure step to do before go-live (SEC-03, SEC-10).
- Writes audited inside a transaction roll back with it; denials and reads are written
  immediately.
- One extra query per tenant-scoped request loads role assignments.
