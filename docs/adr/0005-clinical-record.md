# 5. Clinical record: encounters, vital signs, diagnoses and notes

Date: 2026-10-15
Status: Accepted (clinical lead to confirm transitions, plausibility ranges and role grants)

## Decision

- **Encounter** is owned by `clinical`. Every vital-sign set, diagnosis and note belongs to
  one encounter and takes its patient from it. Its facility and department are what the
  policy layer scopes clinical data by (`encounter__department`). Scheduling will set
  `appointment_id` when an appointment starts an encounter.
- **Vital signs** are a set of coded readings (`Observation`) with LOINC codes and UCUM
  units from the `LoincCode` table, which also holds a plausibility range per code. BMI is
  never entered: it is computed from the set's weight and height, or the latest height
  from the past 12 months.
- **Diagnoses** are ICD-10 (validated against the `Icd10Code` table) or SNOMED CT (concept
  id plus display, not validated: no SNOMED licence is assumed). Clinical status and
  verification status follow explicit transition tables in `apps/clinical/models.py`;
  Resolved needs an abatement date (also a database constraint). Ranks are unique per
  encounter among active diagnoses; rank 1 is principal.
- **Notes** are SOAP notes. Only the author edits an open note; closing signs it off and
  locks it; corrections are addenda to a closed note.
- **Entered-in-Error** hides any of these from lists (the active chart); `?history=true`
  shows them, and nothing is ever deleted.
- **Reference codes** ship as a small starter subset in `apps/clinical/data/codes.json`,
  loaded by a data migration and `manage.py load_clinical_codes --file …` for licensed
  full sets later.

## Consequences

- Grants: doctors work in their department; nurses record vitals and view diagnoses and
  notes in their department; pharmacists view vitals and diagnoses tenant-wide. All
  clinical resources allow break-glass. Nurse grants do not yet use care-team or shift
  scopes because neither source exists until scheduling and staff are built.
