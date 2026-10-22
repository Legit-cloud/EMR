# 21. The inpatient module: wards, beds, admissions and bed-day charges

Date: 2026-10-22
Status: Accepted (pending clinical and finance review)

## Context

The ward board (F14) was built against a mock, and ADR 0020 wrote down the contract it needed.
This is the real module behind it (Release 2, CLAUDE.md Sections 4 and 5).

## Decision

**Models (`apps/inpatient`).**
- `Ward` (facility, name, daily charge in minor units plus currency), `Bed` (ward, label,
  status: vacant, occupied, cleaning, out of service).
- `Admission`: one stay. Open while `discharged_at` is empty. Database constraints allow one
  open stay per patient and one open stay per bed, and require a discharge status exactly when
  the stay has ended, so the rules hold even if code is wrong.
- `BedMove` records each transfer. `WardCharge` records which dates have been billed.

**Rules (`services.py`).**
- Admitting locks the bed, requires it vacant and in an open ward, refuses a deceased or
  already-admitted patient, creates the stay and sets the bed Occupied in one transaction.
  Admission publishes `inpatient.admitted`.
- Transfer locks both beds in a fixed order, moves the patient, sends the old bed to Cleaning
  and records the move. Discharge ends the stay as Discharged, LAMA or Transferred (the last
  two need a note), sends the bed to Cleaning, and publishes `inpatient.discharged`.
- A nurse marks a cleaned bed ready; a vacant or cleaning bed can be taken out of service and
  put back. An occupied bed cannot.

**Bed-day charges.**
- The first day is billed when the patient is admitted (handler on `inpatient.admitted`), and
  a Celery beat job at 00:00 hospital time (`INPATIENT_TIME_ZONE`, default Africa/Lagos) adds
  the new day for every open stay. Lines go to the patient's bill as pending ward charges
  through `billing.add_line`, with a key per stay and date, so replays and reruns change
  nothing.
- When the stay ends (handler on `inpatient.discharged`) its pending bed-days become final
  revenue through `billing.finalise_line`.
- No bed-day is billed for a closed stay, a deceased patient, or a ward with no daily charge.

**API (`/api/inpatient/`).** `GET wards/` is the board; `POST admissions/`,
`POST admissions/{id}/transfer/`, `POST admissions/{id}/discharge/`, `POST beds/{id}/ready/`
(and `out-of-service/`, `in-service/`) are the actions, matching the contract in ADR 0020.
The administrator creates wards and beds. Doctors and nurses admit, move, discharge and
clean; the tenant admin views only (ADR 0010). All writes are audited. The web app now calls
this API through the generated client.

## Consequences

- **A day is billed per bed-day, counted from the day of admission.** A patient admitted and
  discharged the same day pays one day; one admitted on Monday and discharged on Wednesday pays
  Monday (at admission), Tuesday and Wednesday (at 00:00).
  Finance must confirm this rule against the facility's tariff.
- **A transfer to a ward with a different daily charge changes the price from the next
  midnight**; the day of the move is billed at the ward the patient was in when it was billed.
- **Deceased patients** stop incurring bed-days but their admission is not closed
  automatically: the bed stays occupied until staff discharge it. Clinical must decide which
  discharge status that is, or whether a fourth is needed.
- Access to admissions is by role, tenant-wide. Department and care-team scoping, and
  break-glass, are not applied yet.
- A prescription, lab order or nursing plan is not linked to a stay yet.
- The 00:00 job runs for every active tenant in turn. It is idempotent, so a missed night is
  made up by running it again, but it only bills "today": a night the worker was down is not
  back-filled.
