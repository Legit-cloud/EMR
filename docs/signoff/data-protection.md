# Data-protection sign-off

Reviewers: the data-protection lead and counsel, named here: ____________________

This is not legal advice. Do not rely on section numbers quoted from memory; counsel confirms each point
against the current Nigeria Data Protection Act 2023 and Commission guidance.

## What was fixed (ADR 0024)

- Removed three consent switches that did nothing. One real choice remains: email reminders, held on
  the patient record and honoured by every reminder.
- Patients can make access, correction, erasure, restriction, objection and portability requests in
  the portal; compliance sees late ones first and answers with a written reason; each step is audited.
- Patients can download what the portal holds about them, and read a privacy notice.
- Deceased patients lose portal access (already done).

## Decisions for you

### 1. Lawful bases
**Recommendation.** Care: provision of health care. Billing: contract and legal duty. Security and audit:
legitimate interest and legal duty. Reminders: legitimate interest with an easy opt-out. Do not use
consent for care. Research needs explicit consent and is not built.
- [ ] Approved  Signed: ____________  Date: ________

### 2. Retention
**Recommendation.** Keep medical records for at least 10 years after last contact (children: until
well after adulthood), billing records as the tax authority requires, audit logs as long as the records they
describe. The setting is `RECORD_RETENTION_YEARS` (default 10). Counsel must confirm against Nigerian
medical-council and tax rules. Nothing is deleted automatically.
- [ ] Approved  Signed: ____________  Date: ________

### 3. Answering patient requests
**Recommendation.** Answer within 30 days (`DSR_RESPONSE_DAYS`; confirm the legal limit). Check identity
before releasing a record. Erasure of medical records inside the retention period is refused with the reason
given to the patient. Appoint one person to answer.
- [ ] Approved  Signed: ____________  Date: ________

### 4. Registration and officers
**Recommendation.** Ask counsel whether the hospital must register with the Commission as a data
controller of major importance, appoint a data-protection officer, and file annual audits. Assume yes for a
hospital until told otherwise.
- [ ] Confirmed by counsel  Signed: ____________  Date: ________

### 5. Where data is kept (DG-06)
**Recommendation.** Railway has no African region. Ask counsel whether health data may be kept outside
Nigeria and on what terms (transfer agreement, safeguards). If not, choose a Nigerian host or an enterprise
install on the client's own servers. Decide before real patients are entered. Encrypt backups and keep a
copy outside the platform (SEC-08).
- [ ] Decided  Signed: ____________  Date: ________

### 6. Impact assessment and records
**Recommendation.** Complete the data-protection impact assessment before go-live and keep the record of
processing up to date. Drafts are in `docs/data-protection/`.
- [ ] Done  Signed: ____________  Date: ________

### 7. Breach response
**Recommendation.** Adopt `docs/runbooks/breach-response.md`. Notify the Commission within 72 hours of
becoming aware of a breach likely to harm people (confirm the period with counsel), and tell affected patients
promptly when the risk is high. Run one drill a year.
- [ ] Adopted  Signed: ____________  Date: ________

### 8. Children and representatives
Records of children, and patients who cannot act for themselves, need a guardian route. It is not built;
until it is, such requests are handled by staff on paper.

## Not verified by software

Legal basis, retention periods, residency and registration cannot be confirmed by tests.
