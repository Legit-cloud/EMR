# Clinical sign-off

Reviewer: the clinical lead (a registered doctor), named here: ____________________

Each item gives the recommendation, why, what the system does now, and what you must confirm.
Figures are common practice, not a local protocol: replace them with your facility's own.

## 1. Patient who died in hospital (applied)

**Recommendation.** Record the death on the chart first (status Deceased, which cancels future
appointments, flags bills for estate review and closes portal access). Only then may an admission be
discharged as **Died**. A discharge note is not required for Died, because the death record is the
note. A patient who is not Deceased cannot be discharged as Died.

**Why.** It stops a death being recorded by accident from the bed board, and keeps one source of truth.

**System.** Done (ADR 0021 amendment). **Confirm:** who may record a death (suggest a doctor only), and
whether your facility also needs a death certificate number field (not built).

- [ ] Approved  Signed: ____________  Date: ________

## 2. Vital-sign limits and early-warning (recommendation, not built)

**Recommendation.** Flag out-of-range readings for the nurse, but do not block saving. Use one
early-warning score (NEWS2 is the usual choice) once nursing agrees. Adult flags to start from:
pulse under 40 or over 130, systolic under 90, respiratory rate under 8 or over 25, oxygen saturation
under 92%, temperature under 35.0 or over 39.0 °C. Paediatric ranges differ by age and must come from
the paediatric lead.

**Why.** Blocking a save hides the reading; flagging makes someone act on it.

**System.** Vitals are stored and BMI is computed; no flags. **Confirm:** the ranges, and whether to build
flags in the next release.

- [ ] Approved  Signed: ____________  Date: ________

## 3. Triage priority and waiting

**Recommendation.** Keep the current queue order (arrival time within triage priority). Agree maximum
waits per priority and show an on-screen warning at the limit; never let a lower priority jump a higher one.
Emergency may overbook a slot (already allowed).

**System.** Order done; wait limits not built. **Confirm:** the limits.

- [ ] Approved  Signed: ____________  Date: ________

## 4. Prescribing safety

**Recommendation.**
1. Keep interaction and allergy checks before signing. A blocking alert needs a written override
   reason from the prescriber (done and logged).
2. Replace the small synthetic interaction table with a licensed knowledge base before any real use.
   This is the largest clinical risk in the system today. Until then treat every "no alert" as
   "not checked".
3. A signed prescription is never edited. Amend by cancelling it and issuing a new one (done: the
   signature makes edits detectable).
4. Pharmacists may reject a prescription back to the prescriber with a reason.

**System.** 1 and 3 done. 2 is an open decision (CLAUDE.md Section 12, item 2). 4 not built.
**Confirm:** the knowledge-base choice and who reviews overrides (suggest a pharmacist weekly).

- [ ] Approved  Signed: ____________  Date: ________

## 5. Releasing results

**Recommendation.** A result is visible to the patient in the portal only after a clinician has reviewed
it, and critical results are phoned to the clinician, not just displayed. Sensitive results (HIV, pregnancy
in a minor, cancer) are released by a clinician in person.

**System.** Diagnostics are not built yet (Release 2 later phase). Record this as a requirement.

- [ ] Approved  Signed: ____________  Date: ________

## 6. Discharge and transfer

**Recommendation.** Every discharge carries a note: diagnosis, medicines, follow-up and warning signs.
Transfers name the receiving facility. **LAMA** needs the reason the patient gave and a statement that
risks were explained. Died needs no note (item 1).

**System.** Notes are required for Discharged, LAMA and Transferred. **Confirm:** the wording for LAMA.

- [ ] Approved  Signed: ____________  Date: ________

## 7. Chart access

**Recommendation.** Keep break-glass: any clinician may open a chart with a written reason; compliance
reviews all of them within a week. The tenant admin sees clinical content read-only for oversight.
Review the list of people with access every quarter.

**System.** Done (ADR 0010). **Confirm:** the review period.

- [ ] Approved  Signed: ____________  Date: ________

## Not verified by software

Clinical logic needs a human review before release (CLAUDE.md Section 8): interaction rules, allergy
matching, BMI, ward charges that depend on the clinical stay, and the discharge rules above.
