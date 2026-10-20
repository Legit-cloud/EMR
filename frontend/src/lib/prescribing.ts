"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { api, type Schemas, unwrap } from "./api";
import { humanise } from "./format";

export type Prescription = Schemas["Prescription"];
export type SafetyAlert = Schemas["SafetyAlert"];

/** The server refuses an override reason shorter than this (PRESCRIPTION_MIN_OVERRIDE_REASON). */
export const MIN_OVERRIDE_REASON = 15;

export const ROUTES = [
  "oral",
  "intravenous",
  "intramuscular",
  "subcutaneous",
  "sublingual",
  "topical",
  "inhaled",
  "rectal",
  "ophthalmic",
].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));

/** The usual frequencies. The API stores the words, so these are what the pharmacist reads. */
export const FREQUENCIES = [
  "once daily",
  "twice daily",
  "three times daily",
  "four times daily",
  "every 8 hours",
  "every 12 hours",
  "at night",
  "when needed",
].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));

/**
 * Reasons a clinician can pick when overriding a blocking alert. Each is long enough for the
 * server; "Other" asks for the clinician's own words. The wording needs the clinical lead's
 * approval (ADR 0016).
 */
export const OVERRIDE_REASONS = [
  { value: "benefit", label: "Benefit outweighs the risk; the patient will be monitored" },
  { value: "tolerated", label: "The patient has taken this before without a reaction" },
  { value: "no_alternative", label: "No suitable alternative is available" },
  { value: "dose_adjusted", label: "The dose has been adjusted to lower the risk" },
  { value: "other", label: "Other (write the reason)" },
];
export const OTHER_REASON = "other";

/** One medicine on the form. Numbers are kept as text while they are being typed. */
export type DraftItem = {
  drug: string | null;
  /** What the formulary picker shows for the chosen drug. */
  drugLabel: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
};

export const blankItem = (): DraftItem => ({
  drug: null,
  drugLabel: "",
  dose: "",
  route: "oral",
  frequency: "",
  duration: "5",
  quantity: "",
  instructions: "",
});

export type ItemErrors = Partial<
  Record<"drug" | "dose" | "frequency" | "duration" | "quantity", string>
>;

const wholeNumber = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : null);

export function itemErrors(item: DraftItem): ItemErrors {
  const duration = wholeNumber(item.duration);
  const quantity = wholeNumber(item.quantity);
  return {
    drug: item.drug ? undefined : "Choose the medicine.",
    dose: item.dose.trim() ? undefined : "Enter the dose.",
    frequency: item.frequency.trim() ? undefined : "Choose how often.",
    duration: duration !== null && duration >= 1 ? undefined : "Enter the number of days.",
    quantity: quantity !== null && quantity >= 1 ? undefined : "Enter the quantity to dispense.",
  };
}

export const hasErrors = (errors: ItemErrors) => Object.values(errors).some(Boolean);

export function toPayload(items: DraftItem[]): Schemas["PrescriptionItemRequest"][] {
  return items.map((item) => ({
    drug: item.drug!,
    dose: item.dose.trim(),
    route: item.route,
    frequency: item.frequency.trim(),
    duration_days: Number(item.duration),
    quantity: Number(item.quantity),
    instructions: item.instructions.trim(),
  }));
}

export function fromPrescription(prescription: Prescription): DraftItem[] {
  return prescription.items.map((item) => ({
    drug: item.drug,
    drugLabel: item.drug_name,
    dose: item.dose,
    route: item.route ?? "oral",
    frequency: item.frequency,
    duration: String(item.duration_days),
    quantity: String(item.quantity),
    instructions: item.instructions ?? "",
  }));
}

/** The reason to send for a blocking alert, or "" while the choice is incomplete. */
export function overrideReason(choice: string, other: string): string {
  if (choice === OTHER_REASON) {
    const text = other.trim();
    return text.length >= MIN_OVERRIDE_REASON ? text : "";
  }
  return OVERRIDE_REASONS.find((r) => r.value === choice)?.label ?? "";
}

/** Medicines the patient is on now: signed, not cancelled. */
export function activeMedications(prescriptions: Prescription[]) {
  return prescriptions
    .filter((p) => p.status === "authorised" || p.status === "partially_dispensed")
    .flatMap((p) => p.items.map((item) => ({ ...item, prescribed: p.authorised_at })));
}

/** Formulary medicines matching what the clinician has typed. */
export function useFormulary(term: string) {
  return useQuery({
    queryKey: ["formulary", term],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/pharmacy/drugs/", { params: { query: { q: term, formulary: "true" } } }),
        )
      ).results,
    staleTime: 60_000,
  });
}

export const drugLabel = (drug: Pick<Schemas["Drug"], "name" | "strength" | "form">) =>
  [drug.name, drug.strength].filter(Boolean).join(" ") + ` (${humanise(drug.form)})`;

/** Save the draft (create it, or replace its items) and ask the server what the safety check says. */
export function useSaveAndCheck() {
  return useMutation({
    mutationFn: async ({
      encounter,
      draftId,
      items,
    }: {
      encounter: string;
      draftId: string | null;
      items: DraftItem[];
    }) => {
      const body = { encounter, items: toPayload(items) };
      const draft = draftId
        ? await unwrap(
            api.PATCH("/api/pharmacy/prescriptions/{id}/", {
              params: { path: { id: draftId } },
              body,
            }),
          )
        : await unwrap(api.POST("/api/pharmacy/prescriptions/", { body }));
      const alerts = await unwrap(
        api.POST("/api/pharmacy/prescriptions/{id}/check/", { params: { path: { id: draft.id } } }),
      );
      return { draft, alerts };
    },
    meta: { quietErrors: true },
  });
}

export function useSign() {
  return useMutation({
    mutationFn: ({ id, overrides }: { id: string; overrides: Record<string, string> }) =>
      unwrap(
        api.POST("/api/pharmacy/prescriptions/{id}/authorise/", {
          params: { path: { id } },
          body: { overrides },
        }),
      ),
    meta: { quietErrors: true },
  });
}

export function useCancelPrescription() {
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap(
        api.POST("/api/pharmacy/prescriptions/{id}/cancel/", {
          params: { path: { id } },
          body: { reason },
        }),
      ),
    meta: { quietErrors: true },
  });
}
