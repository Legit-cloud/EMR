# 6. Staff, scheduling and notifications

Date: 2026-10-15
Status: Accepted (clinical lead and operations to confirm the grants and timings)

## Decision

**No double-booking is a database rule.** `Appointment` has a PostgreSQL exclusion
constraint: two appointments of one physician that hold time (booked, confirmed, checked
in, in consultation) cannot overlap. Emergency appointments are outside the constraint
and may overbook. Model validation gives a friendly message first, but only the
constraint is safe under concurrency: with it removed, six simultaneous bookings of one
slot all succeed in the test; with it, exactly one does. Needs the `btree_gist` extension.

**Seven states** with an explicit transition table. Cancelled needs a reason (also a
database check). Check-in records the clerk, time and triage priority (emergency 1,
otherwise 3 unless given). Starting the consultation opens a clinical encounter
(`clinical.services`); completing finishes it. No-show only after the start time.
Recurring bookings are a series, booked all or nothing.

**Queue.** Checked-in patients, most urgent first, then by arrival, over HTTP and over
the WebSocket `ws/queue/<physician_id>/`. A change sends only a signal to the
physician's group; each connection reloads the queue under its own policy scope, so a
viewer never receives a patient outside their scope. Connections need a session with
MFA satisfied; connects and refusals are audited.

**Messages.** Booking queues an SMS and an email with an ICS invitation; reminders go
at `APPOINTMENT_REMINDER_OFFSETS_HOURS` (24 h and 2 h) from a Celery beat job every
10 minutes, recorded per offset so each is sent once. Delivery runs in Celery through
`apps.notifications`; the SMS provider is an adapter (`SMS_BACKEND`, console by default)
until the provider decision is made. The delivery log stores a masked recipient and the
purpose, never the message text.

**Staff.** Clinical staff need a licence (council, number, expiry). Verification against
the council register is recorded by a person (who, when, register reference) because no
council API is available. The licence watcher (beat, 06:00 Lagos) flags licences
expiring within `LICENCE_EXPIRY_WARNING_DAYS` (60) or expired, audits the change and
emails HR and tenant admins once per change. Clock-in and clock-out set On-Duty and
Off-Duty, which feeds grants marked `on_duty` in the policy layer.

## Consequences

- Celery beat runs in `Africa/Lagos` time (`CELERY_TIMEZONE`).
- Times move by cancelling and rebooking; PATCH only edits the visit reason.
- WebSocket clients authenticate with the session cookie; bearer tokens are not
  accepted there yet.
