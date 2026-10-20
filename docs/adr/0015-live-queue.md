# 15. Live physician queue

Date: 2026-10-20
Status: Accepted (triage mapping and waiting thresholds pending clinical sign-off)

## Context

F10 rebuilds `/queue` on the design system: a table of checked-in patients for one physician,
most urgent first, then by arrival, kept up to date over the Django Channels WebSocket
(`ws/queue/<physician>/`) that already exists. The API stores triage priority as a number from
1 to 5, while the design names four levels, and the waiting-time chip changes colour at
thresholds that are meant to be configurable.

## Decision

- **Triage mapping (a proposal).** 1 is Emergency, 2 Urgent, 3 Routine, 4 and 5 Non-urgent. A
  patient who has not been triaged has no level and shows "Not triaged". The mapping lives in
  `frontend/src/lib/triage.ts`, so it changes in one place. **The clinical lead must approve
  it before release.**
- **Waiting time.** The chip is grey, turns amber after 15 minutes and pink after 30. The
  thresholds are deployment settings (`NEXT_PUBLIC_QUEUE_LONG_WAIT_MINUTES` and
  `NEXT_PUBLIC_QUEUE_VERY_LONG_WAIT_MINUTES`). A per-clinic setting needs a tenant settings API
  that does not exist yet. The chip also carries the minutes and, for the amber and pink
  states, words for screen readers, so colour is never the only signal.
- **Live updates.** The page loads the queue over HTTP, then opens the socket. If the socket
  drops it shows a "Reconnecting" banner, keeps the list on screen, reloads over HTTP and tries
  again after 2, 4, 8 seconds and so on up to 30. A refusal (close codes 4401 and 4403) is not
  retried and says so. The server still sends only patients inside the viewer's access scope.
- **Changes are announced.** New arrivals slide in with a short highlight (none when the user
  prefers reduced motion), and an `aria-live` region says who checked in and how many are
  waiting.
- **Start consultation** moves the appointment to In-Consultation through the existing status
  endpoint, for doctors and nurses; the server still decides. The patient then leaves the
  queue through the socket.
- **Reason for the visit** is now part of each queue entry (`reason`), because the screen
  shows it.
- **Mock socket.** `frontend/src/mocks/queue-socket.ts` stands in for `WebSocket` in tests and
  when developing without a backend.

## Left out

- A per-clinic wait threshold setting and a per-priority target time.
- Calling a patient (no API) and the patient's room or bay (no model).
