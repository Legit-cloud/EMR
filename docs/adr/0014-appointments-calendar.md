# 14. Appointments calendar and rescheduling

Date: 2026-10-20
Status: Accepted (the Finish rule is not yet enforced by the server)

## Context

F9 builds the appointments screen: a day calendar with a column per physician, a week view for
one physician, a list, and a log of past appointments. Staff book from an empty slot and move
an appointment by dragging it. ADR 0006 had said an appointment's time changes by cancelling
and booking again, which cannot support dragging: it would leave a cancelled record, and a
cancellation reason, for every move.

## Decision

- **Rescheduling is a service.** `scheduling.services.reschedule` and
  `POST /api/scheduling/appointments/{id}/reschedule/` move a booked or confirmed appointment
  to a new start, end and, optionally, physician. It follows the booking rules, so a double
  booking is refused with 409 `slot_taken`. Reminders are cleared and sent again for the new
  time, and the patient is told it "has moved". Checked-in and later appointments cannot move.
  This replaces the cancel-and-rebook rule of ADR 0006 for time changes; cancellation keeps
  its reason.
- **Calendar listing.** The appointment list takes `from` and `to`, a comma-separated `status`
  and `page_size` (at most 100), and returns the patient's name and MRN. Availability takes the
  same range. All times on the screen are Lagos time.
- **Dragging is for mouse and pen.** Touch and keyboard users move an appointment from its
  drawer ("Reschedule"). A refusal is shown next to the calendar in words, and nothing moves.
- **Finish rule.** In the drawer, Finish stays disabled until the visit has vitals and a
  clinical record (a diagnosis or a note). This is a screen rule only: the API will still
  complete an appointment without them. **Decision for the clinical lead:** enforce it in
  `scheduling.services` as well?

## Left out

- **Break Time** blocks: there is no model for breaks. Time outside availability is hatched.
- **"Waiting payment" strips**: an appointment is not linked to an invoice.
- **Send Reminder**: there is no API to send one on demand.
- Recurrence in the booking wizard, and an edit icon on the drawer's details.
- Booking for a patient who is not registered: the clerk registers them first.

## Consequences

- Only these roles see move controls: front desk, doctor and nurse. The server decides.
- The week view always shows one physician; with "All doctors" it shows the first.
