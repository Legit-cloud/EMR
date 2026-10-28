# 24. Data protection: honest consent, patient rights, and the privacy notice

Date: 2026-10-23
Status: Accepted (pending review by counsel and the data-protection lead; see `docs/signoff/data-protection.md`)

## Context

The first portal offered four "consent" switches (text reminders, email reminders, sharing within the
facility, research). Review found that three did nothing: nothing in the system read them. A switch
that changes nothing is worse than no switch, because it tells a patient they have a control they do
not have. It also muddles the real legal position: a hospital treats a patient because it provides
health care, not because the patient ticked a box, and treating that as "consent" invites the
patient to withdraw it and the hospital to pretend it could comply.

SMS has been dropped (ADR 0017 and the email-only decision), which removed one of the four.

## Decision

**1. Remove consent switches that control nothing.** The portal keeps one real choice: *email me
reminders about my appointments and bills*. It is on unless the patient turns it off. It is stored on
the **patient record** (`Patient.email_reminders`), not on the portal account, so it binds every module
that sends reminders for every patient, including those with no portal login. Appointment reminders
(`scheduling.send_due_reminders`) and payment reminders (`billing.send_payment_reminder`) both honour it.
Booking and rescheduling confirmations are not reminders and are always sent. Changes are audited with
what changed.

**2. State the lawful bases instead of faking consent.** The privacy notice says plainly that care does
not depend on a consent form, and lists each purpose: care, billing, legal duties, security, reminders.
The record of processing activities (`docs/data-protection/ropa.md`) maps each activity to a basis.
Research or any other use that genuinely needs consent will get a consent record **when that feature is
built**, with the wording and version stored, not before.

**3. Patient rights in the portal and a queue for compliance** (NDPA 2023, DG-03).
- `DataSubjectRequest`: access, correction, erasure, restriction, objection, portability. One open request
  of each kind per patient. A due date is set from `DSR_RESPONSE_DAYS` (default 30).
- Compliance and the tenant admin see the queue (`/requests`), late requests first and marked, and answer
  with an outcome (done, or refused with a reason) and a written note of at least ten characters. The
  patient is emailed that an answer exists and reads it in the portal; the email never carries the answer,
  which may refer to their records. Making and answering a request is audited.
- "Download my information" returns what the portal holds as a file (profile, visits, medicines, bills,
  requests). It is not the medical record; a full copy is an "access" request that staff answer.

**4. A privacy notice a patient can read** at `/portal/privacy`: who is responsible (`PRIVACY_CONTROLLER_NAME`,
else the organisation's name), how to reach them (`PRIVACY_CONTACT_EMAIL`), what is held, why, who sees it,
how long it is kept (`RECORD_RETENTION_YEARS`), the rights and the days allowed to answer, and that the patient
may complain to the Nigeria Data Protection Commission. Linked from every portal page and from the profile.

**5. Written procedures and records** under `docs/data-protection/`: the record of processing, a draft
data-protection impact assessment, the retention policy and the procedure for patient requests, and a
breach-response runbook (`docs/runbooks/breach-response.md`).

## What this does not do

- It does not decide the retention period, the lawful bases, whether the hospital must register with the
  Commission, or whether hosting outside Nigeria is acceptable. Those need counsel and are listed with a
  recommendation in `docs/signoff/data-protection.md`.
- Erasure requests cannot be fulfilled for medical records inside the retention period. The system lets
  compliance refuse with a reason; it has no tool to erase or anonymise a record.
- The "access" answer is a manual process. There is no automatic export of the full medical record.
- A patient's guardian or representative acting for a child or an incapacitated adult is not modelled.
- Staff-side data protection (staff records, access reviews) is outside this change.
