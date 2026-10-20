# 13. Patient chart

Date: 2026-10-20
Status: Accepted (reference ranges pending clinical sign-off)

## Context

F8 rebuilds the patient chart: a sticky banner, ten tabs, vital signs as KPI tiles with change
and abnormal colouring, an encounter timeline, problem, medicine and allergy cards, "Entered
in error" with an undo, and a floating quick-action bar. Several parts have no backend yet,
and two need clinical judgement the code cannot supply.

## Decision

- **Tabs built:** Overview, Vitals, Diagnoses, Notes, Prescriptions, Billing, Documents and
  Audit. **Orders** and **Results** are left out until diagnostics exist (Release 2), and the
  banner has no **primary physician** because the patient record has none. Nothing is shown
  as if it worked. Documents lists and opens files but does not upload yet.
- **Abnormal vital signs.** A reading is flagged (icon, word and colour) when it is below the
  low limit or at or above the high limit of an adult reference range kept in one place,
  `frontend/src/lib/vitals.ts`: systolic 90-139, diastolic 60-89, heart rate 60-100,
  temperature 35.5-37.4, oxygen saturation 95 and over, BMI 18.5-29.9. These are screening
  aids, not diagnostic criteria, and **the clinical lead must approve them before release**.
  Nothing is flagged for patients under 18, because ranges change with age; the chart says so.
- **Entered in error with undo.** The API has no way to take back "entered in error", and
  requires a reason. So the reason is asked first, the item is hidden at once with an Undo
  toast, and the request is sent after six seconds unless undone. Anything still waiting is
  sent when the chart is left. The safe failure is a record that stays visible a little longer,
  never one hidden that should not be. (`lib/use-undoable.ts`.)
- **Visit tools** (start and finish a visit, record vitals, add diagnosis, write note,
  prescribe) show only to doctors and nurses, and only while a visit is open. This is a
  convenience: the API decides who may do what.
- **Diagnosis status** is changed with two selects. The server enforces which changes are
  allowed and says why when one is refused; the screen only checks that a resolved diagnosis
  has a date, as the rule requires.
- **Record access** (Audit tab) shows who read or changed the patient record itself, to the
  roles that may read the audit log. Access to individual clinical records is in the audit log
  proper.

## Consequences

The ranges are the main open risk: set too tight they flag healthy adults, too loose they
miss concern. They live in one file with tests, so changing them after review is a small edit.
The undo window means a closed tab within six seconds can leave a correction unsent; the
record then simply stays visible.
