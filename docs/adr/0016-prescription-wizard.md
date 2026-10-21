# 16. Prescription wizard and safety overrides

Date: 2026-10-20
Status: Accepted (override reasons and amendment rule pending clinical sign-off)

## Context

F11 replaces the single prescription form with a two-step wizard: the medicines, then a review
beside the patient's allergies and current medicines. The server already runs the drug
interaction and allergy check before signing, refuses to sign past a blocking alert without a
reason of at least 15 characters, and never lets a signed prescription change (ADR 0007).
The screen had to decide how a clinician picks a reason, what happens to a half-written
prescription, and what "amend" means for a signed one.

## Decision

- **Prescribing is a wizard on the chart**, opened from the quick-action bar or the
  Prescriptions tab, for doctors with a visit open. `/prescriptions/new?encounter=` still
  works: it finds the patient of the visit and opens the chart with the wizard.
- **The safety check runs before Sign.** Moving to the review step saves the draft and calls
  `POST .../check/`. Warnings show in amber; blocking alerts show in pink with a list of
  override reasons. Sign stays disabled until every blocking alert has a chosen reason and a
  ticked confirmation. "Other" asks for the clinician's own words, at least 15 characters.
  The reason is sent as `overrides[<alert key>]`, which the server records with the signature
  and in the audit log. If signing finds alerts the preview did not, the new alerts are shown
  and nothing is signed.
- **The list of reasons** is in `frontend/src/lib/prescribing.ts`: benefit outweighs the
  risk with monitoring; taken before without a reaction; no suitable alternative; dose adjusted
  to lower the risk; other. **The clinical lead must approve the wording and the list.**
- **Drafts are kept.** The check needs a saved prescription, so closing the wizard after
  Next leaves a draft. The Prescriptions tab shows it as Draft with "Continue draft".
  Nothing is deleted.
- **A signed prescription is never edited.** The tab offers "Create amended prescription",
  which opens the wizard with the same medicines. Signing the amendment cancels the earlier
  prescription ("Replaced by an amended prescription"). If the earlier one has been dispensed
  (the server refuses the cancellation) it stays active, and the screen says so. **The clinical
  lead should confirm that replacing, not adding, is the right rule.**
- The `check` action's OpenAPI response is a plain list (it is no longer described as
  paginated), so the generated client types it correctly.

## Left out

- Strength and unit conversions, dose calculators and drug monographs.
- Printing a prescription, and e-prescribing to an outside pharmacy (Release 3).
- Several encounters at once: a prescription belongs to the visit that is open.
