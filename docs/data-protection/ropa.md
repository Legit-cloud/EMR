# Record of processing activities

Draft for the data-protection lead and counsel. Bases are recommendations (see `docs/signoff/data-protection.md`).

| Activity | Data | Who sees it | Basis (proposed) | Kept |
| --- | --- | --- | --- | --- |
| Registration | name, birth date, phone, email, national ID (optional), address | front desk, clinicians, billing | provision of care | retention period |
| Clinical care | vitals, diagnoses, notes, allergies, prescriptions, attachments | care team; tenant admin read-only; break-glass with reason | provision of care | retention period |
| Scheduling and reminders | appointments, email | front desk, clinicians | care; reminders on legitimate interest, opt-out | retention period |
| Billing and payments | invoices, payments, Paystack reference (no card data held) | billing, finance | contract and legal duty | tax rules |
| Patient portal | portal account, requests, sign-in codes | patient, compliance | care and contract | while account active |
| Audit log | who did what, when, from where | compliance, tenant admin | legal duty, security | as long as the records |
| Error monitoring | technical errors with personal data removed | engineers | legitimate interest | 90 days |

Processors: hosting (Railway, region to be decided), object storage, Paystack (payments), the email provider, Sentry.
Each needs a written agreement; counsel to confirm transfers outside Nigeria.
