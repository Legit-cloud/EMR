# Frontend guide

The staff app and the patient portal live in `frontend/`: Next.js, React, TypeScript, Tailwind
and TanStack Query. The look and the rules are in `docs/DESIGN.md`; this page is how to work in
the code.

## Run it

Node runs in containers, so the host needs only Docker.

| Task | Command |
| --- | --- |
| Whole stack (API, worker, web app, edge) | `docker compose up -d --build`, then http://localhost:8080 |
| Lint, format check and unit tests (`pnpm check`) | `docker compose --profile tools run --rm frontend-tools` |
| One command inside the tools container | `docker compose --profile tools run --rm frontend-tools pnpm exec vitest run src/components/stock` |
| Browser tests against a fresh synthetic tenant | `make e2e` |
| Only the smoke tests (below) | Start and seed as `make e2e` does (`docker compose --profile e2e up -d --build web worker frontend edge`, then `docker compose exec -T web python manage.py seed_e2e`), then `docker compose --profile e2e run --rm playwright sh -c "corepack enable && pnpm install --frozen-lockfile >/dev/null && pnpm e2e:smoke"` |
| Regenerate the API client after a backend change | `make openapi` |

On a small host, run `pnpm exec vitest run --maxWorkers=3`: with every core busy a few
timing-sensitive tests fail at random, and pass alone.

With `pnpm` on the host the same scripts work directly: `pnpm dev`, `pnpm check`, `pnpm e2e`,
`pnpm e2e:smoke`.

## The mock switch

`NEXT_PUBLIC_USE_MOCKS=true` makes the browser answer API calls from `src/mocks` instead of the
backend, so a screen can be built or demonstrated without one. It is development only: a
production build forces it off, so no mock code or `msw` is bundled, and the Dockerfile removes
the worker script from the image (`src/lib/mocks.ts`).

The same handlers serve the unit tests. Mock rules copy the server's rules, so a test fails the
way the real API would.

Two screens have no backend yet: **inpatient** and the **patient portal**. They call
`src/lib/planned-api.ts` and run against `src/mocks/inpatient.ts` and `src/mocks/portal.ts`,
which state the contract (`docs/adr/0020`). With mocks off they show "not available yet".

## Folder map

```
frontend/
  src/app/              routes. (app)/ is the staff app inside the sidebar shell; portal/ is
                        the patient portal with its own shell; login/, design/ stand alone
  src/components/ui/    the shared components (Button, DataTable, Modal, Drawer, Tabs, ...),
                        each with a sample on /design
  src/components/<x>/   one folder per screen: billing, stock, staff, audit, inpatient, portal,
                        patients, chart, appointments, queue, prescribing, dashboard, auth
  src/components/layout the shell: sidebar, top bar, and nav-config.ts (who sees which item)
  src/lib/              logic with no markup: one file per area (billing.ts, stock.ts, ...),
                        plus api.ts (typed client), money.ts, status-map.ts, permissions.ts
  src/mocks/            MSW handlers and seed data, one file per API area
  src/styles/           tokens.css (the only place colour values live) and theme.css
  e2e/                  Playwright specs; global-setup.ts signs in each seeded role
  openapi.yaml          generated from the backend; src/lib/schema.d.ts is generated from it
```

`legacy-ui.tsx` and a few pages (`manage`, `compliance`, `registrations`, `pharmacy`,
`pharmacy/formulary`, `billing/insurers`) are first-release screens still on the older
components. They have loading, no-access and error states but not the new look; move them onto
`components/ui` when they are next touched.

## Rules that are tested

- **No raw colours.** `no-raw-hex.test.ts` fails on any hex value outside `tokens.css`. Use the
  tokens and `status-map.ts`; status colours are defined only there. Text uses the text-safe
  shades (`contrast.test.ts` checks them).
- **Money is integers.** All parsing, formatting and arithmetic goes through `src/lib/money.ts`
  (BigInt, no floating point). Amounts are minor units plus a currency.
- **Access comes from the API.** A 403 shows a no-access message. The client never hides data
  as a security measure; the navigation only shows what a role can use.
- **Every list screen has the four states:** a loading skeleton, an empty message with an action,
  an error with "Try again", and a no-permission message (`states.test.tsx`,
  `legacy-states.test.tsx`).

## Add a screen

1. **API.** If the backend has it, run `make openapi` and use `api.GET/POST` with the generated
   types. If it does not, write the contract in an ADR, add a mock in `src/mocks`, register it
   in `handlers.ts`, and call `planned` instead.
2. **Logic first.** Put types, hooks and pure rules in `src/lib/<area>.ts` and test them.
3. **Component.** Build in `src/components/<area>/` from `components/ui`. A new shared component
   goes in `components/ui` with a sample on `/design` and a test. Use `DataTable` for lists, a
   `Drawer` for one record, a `Modal` for a short form or wizard.
4. **Route.** Add `src/app/(app)/<area>/page.tsx` (client component). Anything that reads
   `useSearchParams` needs a `Suspense` around it.
5. **Navigation.** Add the item to `components/layout/nav-config.ts` with the roles that may see
   it, and update `nav-config.test.ts`.
6. **States.** Handle loading, empty, error and no permission; add the screen to
   `states.test.tsx`.
7. **Browser test.** Add a spec in `e2e/`. Tag the one flow that proves the screen works
   `@smoke` only if it belongs in the quick run.
8. Run `pnpm check`. Write an ADR for any rule you decided (`docs/adr/`).

## Smoke tests

`pnpm e2e:smoke` runs the six flows that must work before anything ships (tag `@smoke`):
sign in with the emailed code, register a patient, book an appointment, open a chart, sign a
prescription through an allergy alert with an override reason, and record a payment. They are
the same specs as the full suite, so they are written to run against a freshly seeded tenant.

## Layout check at the design widths

`frontend/scripts/layout-check.mjs` opens every staff and portal screen at 1440, 1280, 1024 and
390 px with the mock layer, fails if a page scrolls sideways, and saves screenshots to
`frontend/test-results/layout/`. It needs the dev server and a browser, so run it in the
Playwright image with nothing else heavy running:

```
docker compose --profile e2e run --rm --no-deps -e NEXT_PUBLIC_USE_MOCKS=true playwright \
  sh -c "corepack enable && pnpm install --frozen-lockfile >/dev/null && (pnpm dev >/tmp/dev.log 2>&1 &) && node scripts/layout-check.mjs"
```

Next rewrites `frontend/tsconfig.json` when `pnpm dev` first runs; `git checkout frontend/tsconfig.json`
afterwards. The script has not yet been run to completion (see the F15 report).
