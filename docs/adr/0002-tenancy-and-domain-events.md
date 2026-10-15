# 2. Row-level tenancy, fail-closed managers and after-commit domain events

Date: 2026-10-15
Status: Accepted

## Context

SaaS customers share one PostgreSQL database (CLAUDE.md Section 3). A query that forgets
its tenant filter must not leak another organisation's patients (SEC-07). Modules react to
each other through events without making the clinician's request wait.

## Decision

**Tenancy**

- Tenant-owned models extend `apps.core.models.TenantModel` (or `SoftStateModel` for
  clinical records that are hidden with Entered-in-Error and never hard-deleted).
- The current tenant and actor live in context variables (`apps.core.tenancy`). They are set
  by `TenantMiddleware` for session users and by `TenantScopedAPIMixin` after DRF
  authentication (token clients). Celery handlers set them from the event envelope.
- `objects` returns only the current tenant's rows and **returns nothing when no tenant is
  active** (fail closed). `all_tenants` is the explicit, greppable escape hatch.
- Saves stamp the tenant, refuse rows of another tenant, and refuse foreign keys that point
  at another tenant's rows. `bulk_create` is checked too.
- A user's tenant wins; a host name selects the tenant only for anonymous requests. A user
  on another tenant's host, or of an inactive tenant, is refused with 403. Platform users
  without a tenant get no tenant context.
- Tenant viewsets set `model`, not `queryset`: a class-level queryset is built at import
  time, before any tenant is active. The base class refuses `queryset`.

**Events**

- `apps.core.events` wraps Django signals. `publish` sends after the transaction commits;
  receivers only enqueue Celery tasks. Envelopes carry `event_id`, tenant, actor and a
  JSON payload so handlers can run under the right tenant and be idempotent.

## Consequences

- Raw SQL, `all_tenants` and `QuerySet.update()` on `all_tenants` bypass the guard; review
  every use.
- Queries in code that runs outside a request (management commands, beat jobs) return
  nothing until the code sets a tenant with `tenant_context`.
- Event delivery is at-most-once if Redis is unavailable at commit time: the commit stands
  but the task is not enqueued (the failure is logged). If billing or stock reactions need a
  delivery guarantee, add a transactional outbox table before Release 1 goes live.
- Schema-per-tenant remains the fallback for a customer that needs stronger isolation.
