# 22. The patient portal API

Date: 2026-10-22
Status: Accepted (pending clinical, data-protection and finance review)

## Context

ADR 0020 wrote down what the portal screens needed. This is the module behind them
(`apps/portal`). The hard part is not the endpoints but one rule: a patient must only ever reach
their own record.

## Decision

**A portal account links one sign-in to one patient.** `PortalAccount` holds a one-to-one link to
a user and to a patient, an active flag, and the patient's consent choices. A user who is not
linked, or whose account is switched off, or whose patient has died, is refused (403) and the
refusal is audited.

**The patient comes from the session, never from the request.** Patient-facing views take the
patient from the signed-in user's account. No endpoint has a patient id in its path, query or
body, so there is nothing to tamper with; a `?patient=` parameter is ignored. Every query below
those views is made for that one patient. Tests cover two patients with data side by side, a
patient trying to cancel another's visit (404), and staff being refused. These views do not use
the staff policy layer (they have no role grants to evaluate), so they are listed as an exception
in `test_permission_coverage.py`, and a test asserts every `portal-*` route uses
`PortalPermission`.

**Invitations.** Front desk and the tenant admin invite a patient from the patient's record
(`POST /api/portal/accounts/`). The patient must have an email address on file and no existing
account, must not be deceased, and the address must not already belong to an account. The system
creates a sign-in with the Patient role and no password, and emails a link to set one; from then
on the patient signs in with the emailed code like everyone else (ADR 0017). Staff can switch
access off at any time, and a patient's death switches it off automatically (the handler that
used to be a stub in `accounts` now lives here).

**What the portal offers.**
- Home, appointments (list, free slots, book, cancel), prescriptions, invoices, profile.
- Booking takes a slot that is still free in a physician's availability, within
  `PORTAL_BOOKING_DAYS` (14) and at most `PORTAL_MAX_UPCOMING_VISITS` (3) at once. A patient may
  cancel a booked or confirmed visit more than `PORTAL_CANCEL_MIN_HOURS` (2) before it starts,
  with a reason.
- Bills show the patient's own share, not the insurer's. Lines at nil to the patient and void
  lines are left out.
- A patient may correct their phone number and email; their name, date of birth and ID are
  corrected by staff. The four consent choices (text reminders, email reminders, sharing within
  the facility, research without their name) are saved by the patient and each change is written
  to the audit log with what changed (DG-02).
- Every read, booking, cancellation and profile change is audited under the patient's id.

**Not built, on purpose.**
- **Paying.** The portal cannot record a payment. With no payment gateway chosen (open decision
  9), a button that marks a bill paid would let a patient clear their own debt without paying. The
  page says how to pay at the hospital, and balances update when staff record the payment.
- **Results.** The diagnostics module (lab and imaging) does not exist, so there is nothing to
  release. `GET /api/portal/results/` returns an empty list through one selector that will read
  diagnostics later and return only results a clinician has released.

## Consequences

- The consent wording and the four choices are placeholders for the legal text and need the
  data-protection lead's approval before launch.
- The "share my record in the facility" choice is stored but nothing reads it yet. Until it does,
  it is a record of the patient's wish, not an access control.
- A patient and a family member cannot share one email address: invitations are refused if the
  address is taken. Children and dependants are not modelled.
- There is no portal self-registration. Every account starts with staff, who can check identity.
- The portal reuses the staff password-reset link; its address and wording are generic.
