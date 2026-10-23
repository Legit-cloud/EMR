# Sign-off pack

Three documents for the people who must approve the system before real patients and real money
touch it: **clinical**, **finance** and **data protection**. Each lists the decisions, what I
recommend and why, what the system already does about it, and what the named reviewer still has to
confirm.

How to read the recommendations: they are written the way an experienced health-sector practitioner
(clinical operations, finance and records) would advise, from widely used standards and common
practice in hospitals. They are **recommendations for your named clinical lead, finance owner and
counsel to approve or change**, not approvals. They do not replace the clinical safety review, the
finance review or the legal advice that CLAUDE.md Section 8 requires. Where a figure or a legal point
should be checked against a current source, it says so.

| Document | For | Decisions |
| --- | --- | --- |
| [`clinical.md`](clinical.md) | Clinical lead (a registered doctor) | vital-sign limits, triage and queue waits, prescribing overrides and amendments, discharge of a patient who died, releasing results, discharge and transfer |
| [`finance.md`](finance.md) | Finance owner | bed-day billing, payment reminders, Paystack operation and reconciliation, refunds, discounts, deposits, tax, controls |
| [`data-protection.md`](data-protection.md) | Data-protection lead and counsel | lawful bases, retention, patient requests, privacy notice, registration, hosting region, breach response |

Each item ends with a tick box. When the owner ticks it and signs the page, commit the change.
