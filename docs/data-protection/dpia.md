# Data-protection impact assessment (draft)

Status: draft. Complete and sign before real patient data (DG-07).

## Why it is needed
Large-scale processing of health data in a new system.

## Risks and controls

| Risk | Control in the system | Open |
| --- | --- | --- |
| Staff view charts they should not | role and attribute checks on every request; audit of every read; break-glass with reason and review | quarterly access review |
| One tenant sees another's data | tenant filter in the data layer, tested | none |
| Stolen account | emailed one-time code for every user; sign-in rate limit | mailbox security is the user's |
| Records altered or hidden | no hard delete; audit log append-only; signed prescriptions | none |
| Data leaks in logs or errors | log filter, error monitoring scrubbing | periodic check |
| Files exposed | private storage, short signed links | none |
| Loss of data | backups, restore drill (SEC-08) | off-platform copy, monthly restore |
| Data kept abroad | none in software | residency decision |
| Patient cannot exercise rights | portal requests, compliance queue, 30-day target | guardian route |
| Wrong reminder or disclosure by email | opt-out, no clinical detail in emails | wording review |

## Conclusion
Residual risk acceptable only after the open items close and the data-protection lead signs.

Signed: ____________  Date: ________
