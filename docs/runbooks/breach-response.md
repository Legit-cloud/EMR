# Breach response

A breach is any loss, leak, alteration or unauthorised access to personal data, confirmed or suspected.

## First hour
1. Whoever notices tells the incident lead (name: ________) at once. Do not wait to be sure.
2. Contain: disable the affected accounts, rotate keys (Paystack, storage, secret key) held in environment variables, take the affected service offline if needed.
3. Preserve evidence. Do not delete logs. The audit log is append-only; export the relevant period.

## Within a day
4. Establish what happened from the audit log: who, which patients, which data, when, from where.
5. Decide the risk to the people affected (low, or likely harm).

## Notify
6. Likely harm: tell the Nigeria Data Protection Commission within 72 hours of becoming aware (counsel to confirm the period), and tell affected patients promptly in plain words: what happened, what data, what they can do, whom to contact (`PRIVACY_CONTACT_EMAIL`).
7. Payment data: tell Paystack if keys or webhooks were involved.

## After
8. Write up cause, effect, and fixes; update the impact assessment. Run a drill once a year.
