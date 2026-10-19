# 10. Tenant admin oversight and patient-level break-glass

Date: 2026-10-19
Status: Accepted (pending clinical and compliance review)

## Context

The tenant admin could manage users, roles, facilities, staff and insurers but saw nothing
else, so a hospital administrator had no view of what was happening in their facility.
Separately, break-glass grants were per record, and out-of-scope records are never listed,
so a clinician had no way to ask for access from the chart.

## Decision

**Tenant admin oversight.** The tenant admin gets view-only, tenant-wide access to the
operational record: patients (demographics), duplicate reviews, appointments and the queue,
invoices, payments, the ledger and journal, the formulary and stock, the audit log and the
break-glass review queue. Clinical content stays with the care team: encounters, vitals,
diagnoses, consultation notes, allergies, attachments and prescriptions. The admin cannot
use break-glass. Every read is audited as for any other role. `tests/test_admin_oversight.py`
pins both lists.

**Patient-level break-glass.** A grant on `patients.patient` opens, for viewing only and for
the grant window, every break-glass record of that patient. It never extends a role to a
resource it has no grant for. Out-of-scope reads by eligible clinicians answer 403
`break_glass_available` naming the patient, and
`GET /api/accounts/break-glass/patients/<id>/` reports hidden records and any open grant.
List reads made visible by a grant carry the grant id in the audit log.

## Consequences

- Administrators can supervise activity without reading clinical notes, in line with data
  minimisation (DG-01). Showing demographics, billing and the audit log to administrators
  must be covered by the DPIA (DG-07) before go-live.
- Patient-level break-glass gives wider access than a single record, so the compliance
  review of grants matters more. Both changes need sign-off from the clinical lead and the
  compliance officer before release.
