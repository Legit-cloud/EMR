# 12. Patient register and registration wizard

Date: 2026-10-20
Status: Accepted (pending clinical review of the duplicate hint and allergy rules)

## Context

The F7 design is a patients table and a 3-step registration wizard that looks for possible
duplicates while the clerk types, shows a match percentage, and changes the last button to
"Send for review" above 85%. Registration already held likely duplicates (409), but only
after submitting, and the API had no way to preview matches. The design also has an HMO
field and a medical-history step; the patient record has neither.

## Decision

- **Live duplicate check.** `POST /api/patients/patients/check-duplicates/` runs the same
  matcher as registration but from a lower hint threshold (`PATIENT_DUPLICATE_HINT_THRESHOLD`,
  60%), and marks each match `would_hold` when it is above the hold threshold (85%, unchanged).
  It saves nothing. It needs the right to register, is rate limited (`duplicate_check`, 120
  a minute) because the form calls it as the clerk types, and is audited as a read of the
  matched patients because it shows their names and birth dates.
- **Allergies at registration.** The registration body takes an optional `allergies` list,
  saved with the patient in one transaction, and kept in a held registration so it is not lost
  if a person later creates the patient from the review. Roles that cannot record allergies
  (front desk) are refused if they send any, rather than bypassing the allergy permission
  through registration; the wizard shows them a note instead of the allergy rows.
- **The register's list** returns each patient's active allergies and last attended visit.
  Last visit comes from appointments the caller may view (the policy's own filter), so a
  role without appointment access learns nothing about visits. Status and allergy filters,
  sorting on name, MRN and age, and a page size of 10, 25, 50 or 100 are supported.
- **Left out for now:** the HMO field (a patient has no insurer; invoices do) and the
  history step (there is no history model). Neither is shown as if it saved. They come back
  with insurance on the patient (Release 2) and structured history.
- Phone country selector offers a short list of likely markets; any other country is entered
  with a leading "+". The API remains the authority on every rule.

## Consequences

Clerks see a possible duplicate before submitting, and a registration held for review keeps
everything the clerk typed. The 60% hint level is a clinical and operational judgement: too
low shows noise, too high hides near-misses. It is one setting to tune after the pilot.
