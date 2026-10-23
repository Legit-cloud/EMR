# 25. Diagnostics, insurer claims, dashboard figures and departments

Date: 2026-10-23
Status: Accepted (pending clinical and finance review; see `docs/signoff/`)

## Context

Release 2 listed four things still missing after inpatient and the portal: laboratory and imaging,
insurer and HMO claims, dashboards for the new work, and departments. CLAUDE.md Section 5 says
finalised results are saved to the chart and appended to the invoice, and the clinical sign-off
asked that a result reach the patient only after a clinician has looked at it.

## Decisions

**Diagnostics (`apps/diagnostics`)**
- `Investigation` is the catalogue (kind lab or imaging, optional LOINC code, UCUM unit, usual range,
  price). The administrator maintains it. `DiagnosticOrder` is one request for one patient; its price is
  copied from the catalogue when it is ordered, so a later price change does not alter it.
  `DiagnosticResult` is never edited: a correction is a new version, the old one is kept and marked
  superseded, and the new one needs review again.
- Roles: doctors order; doctors and technicians cancel an order that has no result; technicians take
  the sample, record and correct results; a doctor reviews (a new policy action, `APPROVE`, so the person
  who entered a result is never the one who releases it). The tenant admin looks, read-only.
- Billing follows the prescription pattern, through events and Celery handlers, never in the request:
  `diagnostics.ordered` adds a pending invoice line (laboratory or imaging revenue), `diagnostics.resulted`
  makes it final, `diagnostics.cancelled` voids it. Replaying an event changes nothing.
- A result marked critical emails the ordering doctor at once. The email names the test and the MRN, not
  the value.
- A deceased patient cannot have tests ordered.
- The patient portal shows only current, reviewed results. A corrected result disappears from the portal
  until a doctor reviews the new version. (This replaces the empty stub in ADR 0022.)
- The chart has a "Tests and scans" tab for the care team.

**Insurer claims (`apps/billing`, `claims.py`)**
- A claim follows one invoice that has an insurer: Draft, Sent, then Approved (all or part) or Rejected
  with a reason, then Paid. A rejected claim is sent again for what the insurer still owes. One live claim
  per invoice (database constraint). A claim cannot be made while any charge is undelivered.
- Money received is recorded as an insurer payment on the invoice (`record_payment`), so the invoice and
  ledger stay the single record. The remittance reference is required and makes recording idempotent.
- Ageing buckets (0-30, 31-60, 61-90, over 90 days since sending) show what insurers owe.
- Billing officers work claims; finance and the administrator look.

**Dashboard**: wards (beds by state, admitted), tests (waiting, to review), claims (owed by age), and
"results to review" in a doctor's tasks. Each follows the existing rule: shown only to roles that can see
the underlying data across the whole tenant.

**Departments**: the API already existed. Added a screen for facilities and departments, and an optional
department on a ward (it must belong to the ward's facility).

## What this does not do

- No external laboratory or PACS integration, no DICOM images, no specimen labelling or barcodes
  (Release 3).
- No test panels or reflex tests, and no per-test reference ranges by age or sex: the range is one text
  on the catalogue entry.
- A rejected claim that is never paid has no write-off. Finance must decide the policy
  (`docs/signoff/finance.md`).
- If the insurer approves less than claimed, the difference stays owed by the insurer on the invoice;
  moving it to the patient is a finance decision and is not built.
- No electronic claim submission to an HMO: staff send the claim themselves and record the answer.
- Staff cannot yet order tests from inside a consultation; they use Tests and scans.
