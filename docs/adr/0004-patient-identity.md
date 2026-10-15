# 4. Patient identity: MRNs, duplicate detection and the Deceased cascade

Date: 2026-10-15
Status: Accepted (clinical lead to confirm the matching weights and role rules)

## Decision

**MRN.** `YYYY-NNNNNN`: the registration year in `MRN_TIME_ZONE` (Africa/Lagos) plus a
per-tenant, per-year counter. The counter is one `INSERT … ON CONFLICT DO UPDATE …
RETURNING` inside the transaction that saves the patient, so concurrent registrations queue
on the counter row and never share a number. A rolled-back registration never issued its
number, so the next patient gets it; patients are never hard-deleted, so an issued MRN is
never reused. The model refuses supplied or changed MRNs.

**Duplicate detection.** Registrations take a per-tenant advisory lock, so two clerks
cannot both miss the same duplicate. Candidates come from PostgreSQL trigram indexes on
accent- and case-folded names, date of birth or national ID. Each name's similarity is the
better of trigram similarity and a Damerau-Levenshtein ratio (trigrams under-score short
transpositions such as Okonkwo / Okonkow). Score = 0.6 × names + 0.4 × birth date
(1, 0.75 for one differing part or swapped day and month, else 0). An exact national ID
match scores 1. A score **above** 0.85 holds the registration as a `DuplicateReview`
(HTTP 409) instead of creating a patient. A person resolves it: new patient, duplicate of
an existing patient, or rejected. Entered-in-Error patients are not candidates.

**Deceased.** Only roles in `PATIENT_DECEASED_ROLES` (default doctor) record a death,
with a date between birth and today. A deceased patient cannot be reactivated through a
status change. The change publishes `patient.deceased` after commit; scheduling, billing
and accounts subscribe. Their handlers are stubs until appointments, invoices and portal
accounts exist, and already run under the publishing tenant.

**Attachments.** PDF, JPEG and PNG only, checked by content signature, up to
`PATIENT_ATTACHMENT_MAX_BYTES`. Storage keys never contain the uploaded file name. Files
are read only through signed URLs (SigV4, `S3_SIGNED_URL_SECONDS`), and each download is an
audited read.

## Consequences

- Registration throughput per tenant is serialised; fine for clinic and hospital volumes.
- Weights and the 0.85 threshold need sign-off from the clinical lead; they are constants
  in `apps/patients/duplicates.py` and the threshold is a setting.
- Merging two existing patient records is not supported yet.
