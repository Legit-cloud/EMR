import { describe, expect, it } from "vitest";

import {
  canTakePayment,
  checkAmount,
  defaultPayer,
  fullAmountText,
  type Invoice,
  invoiceHref,
  owedBy,
  percentText,
  percentToBasisPoints,
  reminderBlock,
  toOrdering,
} from "./billing";
import { PAYMENT_SERIES } from "./chart-colours";
import { formatMoney } from "./money";
import { LINE_SOURCE, PAYMENT_STATUS, TONES } from "./status-map";

/** An invoice for ₦10,300.00, optionally insured and optionally partly paid. */
function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "1a5e2f8c-0000-4000-8000-000000000701",
    reference: "INV-1A5E2F8C",
    patient: "p",
    patient_name: "Tolu Okafor",
    patient_mrn: "MRN-1",
    currency: "NGN",
    insurer: null,
    insurer_coverage_bp: 0,
    payment_status: "unpaid",
    total_minor: 1_030_000,
    insurer_due_minor: 0,
    patient_due_minor: 1_030_000,
    insurer_paid_minor: 0,
    patient_paid_minor: 0,
    net_due_minor: 1_030_000,
    paid_at: null,
    estate_review: false,
    last_reminder_at: null,
    lines: [],
    payments: [],
    created_at: "2026-10-20T09:00:00Z",
    ...overrides,
  };
}

describe("what each payer still owes", () => {
  it("is the share less what they have paid, never below zero", () => {
    expect(owedBy(invoice(), "patient")).toBe(1_030_000);
    expect(owedBy(invoice({ patient_paid_minor: 500_000 }), "patient")).toBe(530_000);
    expect(owedBy(invoice({ patient_paid_minor: 2_000_000 }), "patient")).toBe(0);
    expect(owedBy(invoice(), "insurer")).toBe(0);
  });

  it("starts with the patient, and the insurer only when the patient has paid up", () => {
    expect(defaultPayer(invoice())).toBe("patient");
    const insured = invoice({
      insurer: "hmo",
      insurer_due_minor: 800_000,
      patient_due_minor: 200_000,
      patient_paid_minor: 200_000,
    });
    expect(defaultPayer(insured)).toBe("insurer");
  });

  it("opens the payment dialog on everything owed", () => {
    expect(fullAmountText(invoice(), "patient")).toBe("10300.00");
    expect(fullAmountText(invoice({ patient_paid_minor: 500_000 }), "patient")).toBe("5300.00");
  });

  it("takes payment only while something is due", () => {
    expect(canTakePayment(invoice())).toBe(true);
    expect(canTakePayment(invoice({ payment_status: "partially_paid" }))).toBe(true);
    expect(canTakePayment(invoice({ payment_status: "paid", net_due_minor: 0 }))).toBe(false);
  });
});

describe("partial payments", () => {
  const owed = 1_030_000;

  it("allows any amount up to what is owed, down to one kobo", () => {
    expect(checkAmount("5000", owed, "patient", "NGN")).toEqual({ minor: 500_000 });
    expect(checkAmount("5,000.50", owed, "patient", "NGN")).toEqual({ minor: 500_050 });
    expect(checkAmount("0.01", owed, "patient", "NGN")).toEqual({ minor: 1 });
    expect(checkAmount("10300.00", owed, "patient", "NGN")).toEqual({ minor: owed });
  });

  it("leaves exactly the rest after a part payment", () => {
    const first = checkAmount("5000", owed, "patient", "NGN");
    expect("minor" in first && owed - first.minor).toBe(530_000);
    expect(formatMoney(530_000, "NGN")).toBe("₦5,300.00");
  });

  it("refuses more than is owed, with the amount in the message", () => {
    expect(checkAmount("10300.01", owed, "patient", "NGN")).toEqual({
      error: "The patient owes ₦10,300.00. Refunds are handled separately.",
    });
    expect(checkAmount("1", 0, "insurer", "NGN")).toEqual({
      error: "The insurer owes ₦0.00. Refunds are handled separately.",
    });
  });

  it("refuses nothing, negatives and text", () => {
    expect(checkAmount("0", owed, "patient", "NGN")).toEqual({
      error: "The amount must be more than zero.",
    });
    for (const text of ["", "abc", "-5", "1.005"]) {
      expect(checkAmount(text, owed, "patient", "NGN")).toEqual({
        error: "Enter an amount such as 1500.00.",
      });
    }
  });
});

describe("the insurer's share", () => {
  it("reads basis points as an exact percentage", () => {
    expect(percentText(8_000)).toBe("80%");
    expect(percentText(8_250)).toBe("82.5%");
    expect(percentText(8_205)).toBe("82.05%");
    expect(percentText(10_000)).toBe("100%");
    expect(percentText(5)).toBe("0.05%");
    expect(percentText(0)).toBe("0%");
  });

  it("turns a typed percentage into basis points", () => {
    expect(percentToBasisPoints("80")).toBe(8_000);
    expect(percentToBasisPoints("82.5")).toBe(8_250);
    expect(percentToBasisPoints("100")).toBe(10_000);
    expect(percentToBasisPoints("100.01")).toBeNull();
    expect(percentToBasisPoints("101")).toBeNull();
    expect(percentToBasisPoints("abc")).toBeNull();
  });
});

describe("reminders, ordering and links", () => {
  it("explains why a reminder would be pointless", () => {
    expect(reminderBlock({ payment_status: "paid", estate_review: false })).toMatch(
      /Nothing is due/,
    );
    expect(reminderBlock({ payment_status: "unpaid", estate_review: true })).toMatch(
      /estate review/,
    );
    expect(reminderBlock({ payment_status: "partially_paid", estate_review: false })).toBeNull();
  });

  it("maps table sorting to the API's names", () => {
    expect(toOrdering(null)).toBeUndefined();
    expect(toOrdering({ key: "total", direction: "asc" })).toBe("total");
    expect(toOrdering({ key: "due", direction: "desc" })).toBe("-due");
    expect(toOrdering({ key: "patient", direction: "asc" })).toBeUndefined();
  });

  it("opens an invoice in the billing screen", () => {
    expect(invoiceHref("abc")).toBe("/billing?invoice=abc");
  });
});

describe("colours come from the status map", () => {
  it("gives every charge category a source tag", () => {
    expect(LINE_SOURCE.pharmacy.label).toBe("Prescription");
    expect(LINE_SOURCE.laboratory.label).toBe("Lab");
    expect(LINE_SOURCE.imaging.label).toBe("Imaging");
    expect(LINE_SOURCE.ward.label).toBe("Ward");
    for (const category of ["consultation", "procedure", "other"] as const) {
      expect(LINE_SOURCE[category].label).toBe("Service");
    }
  });

  it("paints the header bar in the same colours as the status pills", () => {
    expect(PAYMENT_SERIES.paid).toBe(TONES[PAYMENT_STATUS.paid.tone].dot);
    expect(PAYMENT_SERIES.partial).toBe(TONES[PAYMENT_STATUS.partially_paid.tone].dot);
    expect(PAYMENT_SERIES.unpaid).toBe(TONES[PAYMENT_STATUS.unpaid.tone].dot);
  });
});
