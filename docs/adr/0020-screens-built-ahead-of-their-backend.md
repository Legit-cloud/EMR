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

## Patient portal contract (for the backend to build)

Everything is for the signed-in patient only. The server takes the patient from the session and
never from an id in the request; a staff account gets 403. Roles are checked by the API, not by
the portal's layout, which only shows a friendlier message.

| Call | Notes |
| --- | --- |
| `GET /api/portal/home/` | first name, next appointment, number of unseen results, balance |
| `GET /api/portal/appointments/`, `GET /api/portal/appointment-slots/` | the patient's visits; free slots |
| `POST /api/portal/appointments/` | `{slot, reason}`; 409 if the slot has been taken |
| `POST /api/portal/appointments/{id}/cancel/` | `{reason}`; refused once the visit is not booked or confirmed or is too close |
| `GET /api/portal/results/`, `POST .../results/{id}/seen/` | only results a clinician has released; opening marks them seen |
| `GET /api/portal/prescriptions/` | signed prescriptions |
| `GET /api/portal/invoices/`, `POST .../invoices/{id}/pay/` | `{amount_minor, method, key}`; any amount up to what is due; the key makes a retry safe |
| `GET /api/portal/profile/`, `PATCH /api/portal/profile/` | phone, email and consent choices only; name and date of birth are changed at the desk |

Notes for the people who build it:

- **Plain language.** The wording lives in `src/lib/plain-language.ts` and is a starting list. A
  clinician must review it, and the server should send results already marked as released to the
  patient. The screen never says what a result "means" beyond where it sits against the usual
  range.
- **Payment.** The portal records an amount and a method. Taking money through a payment
  gateway is out of scope (CLAUDE.md Section 4), so "Pay now" is a recording step until a
  gateway is chosen (open decision 9).
- **Consent.** The four choices (text reminders, email reminders, sharing within the facility,
  research with the name removed) are placeholders for the legal text, which the data-protection
  lead must approve before launch (DG-02).
- **Deceased patients** lose portal access (CLAUDE.md Section 5), enforced by the API.

## Update 2026-10-22

The inpatient module now exists (ADR 0021) and the ward board calls the real API through the
generated client. The inpatient contract above is what was built. The patient portal is still
a mock.
