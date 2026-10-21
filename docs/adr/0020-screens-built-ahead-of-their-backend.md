# 20. Screens built ahead of their backend: inpatient and the patient portal

Date: 2026-10-21
Status: Accepted (pending clinical and product review)

## Context

F14 asks for a ward and bed board and a patient portal. CLAUDE.md puts inpatient (Release 2)
and the portal after the clinical core, and neither has a backend module yet. The design pack
still wants the screens built and shown from mocks, so the interface can be reviewed before the
API exists.

## Decision

- The screens are built against a mock API that states the contract. The mocks live in
  `frontend/src/mocks` (`inpatient.ts`, `portal.ts`) and answer only when
  `NEXT_PUBLIC_USE_MOCKS=true` and in unit tests.
- These screens do not use the typed client, because the generated schema has no such paths.
  They call `src/lib/planned-api.ts`, a thin wrapper with the same cookies, CSRF header and
  error type. When a module's API exists: regenerate the schema, swap `planned.get/post` for
  `api.GET/POST`, delete the wrapper call sites. The screens and tests do not change shape.
- With mocks off, the request returns 404 and the screen shows "not available yet" rather than
  an empty or broken page. No data is invented.
- The mock enforces the rules the real module must keep, so the screen is built around them:
  - **Inpatient** (CLAUDE.md Section 5): admitting needs a vacant bed and makes it Occupied in
    one step; a patient occupies one bed; a transfer frees the old bed to Cleaning; a discharge
    ends as Discharged, LAMA or Transferred, needs a note unless it is a plain discharge, and
    sends the bed to Cleaning until someone marks it ready.
  - Nurses and doctors admit, transfer and discharge. The tenant admin views only (ADR 0010).
    The server must enforce this; the screen hiding buttons is a convenience.

## Inpatient contract (for the backend to build)

| Call | Body | Result |
| --- | --- | --- |
| `GET /api/inpatient/wards/` | | wards, each with beds and their occupant |
| `POST /api/inpatient/admissions/` | patient, bed, reason | occupant; 409 if the bed is not vacant or the patient is admitted |
| `POST /api/inpatient/admissions/{id}/transfer/` | bed, reason | occupant; 409 if the bed is not vacant |
| `POST /api/inpatient/admissions/{id}/discharge/` | status, note | status; 400 if a LAMA or transfer has no note |
| `POST /api/inpatient/beds/{id}/ready/` | | bed; 409 unless the bed is being cleaned |

The 00:00 ward charge (CLAUDE.md Section 5) is a backend job and has no screen yet.

## Consequences

- Nothing on these screens has been tested against a real server, so the contract may change
  when the backend is designed. The mock is the one place to update, and the tests with it.
- Both screens are visible in the navigation to the roles above. With mocks off a user sees
  "not available yet". Hide the entries until the backend ships if that is too confusing.
- Clinical review is needed before the backend is built: discharge statuses, who may discharge,
  and what is recorded on a transfer.
