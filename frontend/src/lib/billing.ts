import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Sort } from "@/components/ui/data-table";
import { api, apiError, type Schemas, unwrap } from "@/lib/api";
import { formatMoney, toMajorText, toMinor } from "@/lib/money";

export type Invoice = Schemas["Invoice"];
export type InvoiceRow = Schemas["InvoiceList"];
export type InvoiceLine = Schemas["InvoiceLine"];
export type Payer = Schemas["PayerEnum"];
export type PaymentMethod = Schemas["PaymentMethodEnum"];

/** Billing is a Nigerian-naira product for now; invoices carry their own currency. */
export const REPORTING_CURRENCY = "NGN";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card / POS",
  transfer: "Bank transfer",
  insurer_remittance: "Insurer remittance",
};

// -- money still to collect -------------------------------------------------------------------

/** What one payer still owes on an invoice, in minor units. Never negative. */
export function owedBy(invoice: Invoice, payer: Payer): number {
  const owed =
    payer === "insurer"
      ? invoice.insurer_due_minor - invoice.insurer_paid_minor
      : invoice.patient_due_minor - invoice.patient_paid_minor;
  return Math.max(owed, 0);
}

/** Whether anything can still be collected: the invoice is not paid and a payer owes money. */
export function canTakePayment(invoice: Pick<Invoice, "payment_status" | "net_due_minor">) {
  return invoice.payment_status !== "paid" && invoice.net_due_minor > 0;
}

/** The first payer that owes money: the patient, unless only the insurer is left. */
export function defaultPayer(invoice: Invoice): Payer {
  return owedBy(invoice, "patient") > 0 || owedBy(invoice, "insurer") === 0 ? "patient" : "insurer";
}

/** A payment can only be what the chosen payer still owes (the server refuses more). */
export type AmountCheck = { minor: number } | { error: string };

export function checkAmount(
  typed: string,
  owed: number,
  payer: Payer,
  currency: string,
): AmountCheck {
  const minor = toMinor(typed, currency);
  if (minor === null) return { error: "Enter an amount such as 1500.00." };
  if (minor <= 0) return { error: "The amount must be more than zero." };
  if (minor > owed) {
    return {
      error: `The ${payer} owes ${formatMoney(owed, currency)}. Refunds are handled separately.`,
    };
  }
  return { minor };
}

/** The amount shown when the dialog opens: everything the payer owes (partial is allowed). */
export function fullAmountText(invoice: Invoice, payer: Payer): string {
  return toMajorText(owedBy(invoice, payer), invoice.currency);
}

// -- insurer share ----------------------------------------------------------------------------

/** Basis points as a percentage without rounding: 8000 is "80%", 8250 is "82.5%". */
export function percentText(basisPoints: number): string {
  const [whole, fraction = ""] = toMajorText(basisPoints, "NGN").split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}%` : `${whole}%`;
}

/** A typed percentage ("80", "82.5") as basis points, or null when it is not 0 to 100. */
export function percentToBasisPoints(text: string): number | null {
  const basisPoints = toMinor(text, "NGN");
  return basisPoints === null || basisPoints > 10_000 ? null : basisPoints;
}

// -- ordering and links -----------------------------------------------------------------------

/** The table's sort keys and what the API calls them. */
export function toOrdering(sort: Sort | null): string | undefined {
  if (!sort) return undefined;
  const key = { created: "created", total: "total", due: "due", status: "status" }[sort.key];
  return key ? (sort.direction === "desc" ? `-${key}` : key) : undefined;
}

/** The URL that opens an invoice in the billing screen's drawer. */
export function invoiceHref(id: string): string {
  return `/billing?invoice=${id}`;
}

/** Why a reminder would be pointless, or null when one can be sent. The API still decides. */
export function reminderBlock(invoice: Pick<InvoiceRow, "payment_status" | "estate_review">) {
  if (invoice.payment_status === "paid") return "Nothing is due on this invoice.";
  if (invoice.estate_review) return "This invoice is held for estate review.";
  return null;
}

// -- data -------------------------------------------------------------------------------------

export type InvoiceFilters = {
  q: string;
  status: string;
  estateReview: boolean;
  sort: Sort | null;
  page: number;
  pageSize: number;
};

export function useInvoiceList(filters: InvoiceFilters) {
  const { q, status, estateReview, sort, page, pageSize } = filters;
  return useQuery({
    queryKey: ["billing", "list", filters],
    queryFn: () =>
      unwrap(
        api.GET("/api/billing/invoices/", {
          params: {
            query: {
              q: q || undefined,
              payment_status: status === "all" ? undefined : status,
              estate_review: estateReview ? "true" : undefined,
              ordering: toOrdering(sort),
              page,
              page_size: String(pageSize),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });
}

/** Counts and amounts for the header; follows the search but not the status filter. */
export function useInvoiceSummary(q: string) {
  return useQuery({
    queryKey: ["billing", "summary", q],
    queryFn: () =>
      unwrap(
        api.GET("/api/billing/invoices/summary/", {
          params: { query: { q: q || undefined, currency: REPORTING_CURRENCY } },
        }),
      ),
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: string | null) {
  return useQuery({
    queryKey: ["billing", "invoice", id],
    enabled: id !== null,
    queryFn: () =>
      unwrap(api.GET("/api/billing/invoices/{id}/", { params: { path: { id: id! } } })),
    retry: false,
  });
}

export function useInsurers() {
  return useQuery({
    queryKey: ["billing", "insurers"],
    queryFn: async () => (await unwrap(api.GET("/api/billing/insurers/"))).results,
    staleTime: 5 * 60_000,
  });
}

/** Everything the screen shows comes from invoices, so any change refreshes all of it. */
export function useRefreshBilling() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["billing"] });
}

export function usePayInvoice(id: string) {
  const refresh = useRefreshBilling();
  return useMutation({
    mutationFn: (body: Schemas["PaymentRequestRequest"]) =>
      unwrap(api.POST("/api/billing/invoices/{id}/pay/", { params: { path: { id } }, body })),
    onSettled: () => refresh(),
    // The dialog shows a refusal next to the amount, not as a toast.
    meta: { quietErrors: true },
  });
}

export function useSetCoverage(id: string) {
  const refresh = useRefreshBilling();
  return useMutation({
    mutationFn: (body: Schemas["CoverageRequest"]) =>
      unwrap(api.POST("/api/billing/invoices/{id}/coverage/", { params: { path: { id } }, body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useAddCharge(id: string) {
  const refresh = useRefreshBilling();
  return useMutation({
    mutationFn: (body: Schemas["ManualChargeRequest"]) =>
      unwrap(api.POST("/api/billing/invoices/{id}/charge/", { params: { path: { id } }, body })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

export function useSendReminder() {
  const refresh = useRefreshBilling();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/api/billing/invoices/{id}/remind/", { params: { path: { id } } })),
    onSettled: () => refresh(),
    meta: { quietErrors: true },
  });
}

/** A sentence for why the server refused a billing action. */
export function refusalMessage(failure: unknown): string {
  const problem = apiError(failure);
  if (problem.code === "validation_error") {
    const first = Object.values(problem.details)[0];
    return Array.isArray(first) ? String(first[0]) : problem.message;
  }
  return problem.message;
}
