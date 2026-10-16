# 9. Frontend: Next.js, a typed client from the OpenAPI schema, one origin

Date: 2026-10-16
Status: Accepted

## Decision

- **Next.js (App Router), React 19, TypeScript, Tailwind** in `frontend/`. Screens are
  client components that call the API; the server renders only the shell.
- **Typed client.** `make openapi` exports the backend schema (`frontend/openapi.yaml`,
  validated with no warnings) and generates `src/lib/schema.d.ts` with openapi-typescript;
  `openapi-fetch` checks every path, parameter and body at compile time. Building the
  client exposed contract gaps that were fixed in the backend: undeclared list filters,
  custom actions documented with the wrong bodies, read-only fields in request bodies,
  colliding enum names, and two list actions described as paginated when they are not.
- **One origin.** The browser talks to one site: the edge proxy sends `/api`, `/ws`,
  `/admin` and `/static` to Django and everything else to Next.js (`deploy/edge/nginx.conf`
  locally). Session cookies stay first-party, CSRF works unchanged and no CORS is needed.
  On Railway, serve both under one domain (a path-routing proxy service) or put the API on
  a sibling subdomain with the session cookie scoped to the parent domain.
- **Access.** The API decides; a 403 is shown as "no access". The client never hides data
  as a security measure.
- **Accessibility.** Labelled fields with announced errors, native `<dialog>` for modals
  (focus moved in, trapped, Escape closes, focus restored), a skip link, `aria-current`
  navigation, live regions for the queue and notices, 44 px touch targets, reduced-motion
  respected. Tests run at tablet width (820 px).
- **Browser tests.** Playwright (`make e2e`) against the docker compose stack. A
  development-only `seed_e2e` command creates a fresh synthetic tenant per run; global
  setup signs each role in once with a real TOTP code (django-otp rejects reusing a code
  within its window) and the tests reuse those sessions.

## Consequences

- `make check` is unchanged (ruff and pytest). The type-check runs inside `next build`
  and Playwright runs with `make e2e`; neither is an extra gate.
- Regenerate the client (`make openapi`) in the same pull request as any API change.
