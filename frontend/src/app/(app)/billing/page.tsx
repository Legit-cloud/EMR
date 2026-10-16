"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PatientName } from "@/components/PatientName";
import { Loading, NoAccess } from "@/components/ui";
import { api, type Schemas } from "@/lib/api";
import { formatDateTime, formatMoney, humanise } from "@/lib/format";

type Invoice = Schemas["Invoice"];
type Filter = "unpaid" | "partially_paid" | "paid" | "estate_review";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "unpaid", label: "Unpaid" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "estate_review", label: "Estate review" },
];

/** Invoices by payment status, and those flagged for estate settlement. */
export default function BillingPage() {
  const [filter, setFilter] = useState<Filter>("unpaid");
  const [invoices, setInvoices] = useState<Invoice[] | "forbidden" | null>(null);

  useEffect(() => {
    setInvoices(null);
    const query = filter === "estate_review" ? { estate_review: "true" } : { payment_status: filter };
    api.GET("/api/billing/invoices/", { params: { query } }).then(({ data, response }) =>
      setInvoices(response.status === 403 ? "forbidden" : (data?.results ?? [])),
    );
  }, [filter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <Link href="/billing/insurers" className="text-teal-800 underline">
          Insurers
        </Link>
      </div>
      <div role="tablist" aria-label="Invoice status" className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={`min-h-11 rounded-md px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${filter === f.value ? "bg-teal-700 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {invoices === null ? (
          <Loading />
        ) : invoices === "forbidden" ? (
          <NoAccess />
        ) : invoices.length === 0 ? (
          <p className="text-slate-600">No invoices here.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Invoices</caption>
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th scope="col" className="p-3">Patient</th>
                  <th scope="col" className="p-3">Opened</th>
                  <th scope="col" className="p-3">Status</th>
                  <th scope="col" className="p-3 text-right">Total</th>
                  <th scope="col" className="p-3 text-right">Still due</th>
                  <th scope="col" className="p-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} data-testid="invoice-row" className="border-t border-slate-100">
                    <td className="p-3"><PatientName id={inv.patient} link={false} /></td>
                    <td className="p-3">{formatDateTime(inv.created_at)}</td>
                    <td className="p-3">{humanise(inv.payment_status)}{inv.estate_review ? " · estate review" : ""}</td>
                    <td className="p-3 text-right">{formatMoney(inv.total_minor, inv.currency)}</td>
                    <td className="p-3 text-right">{formatMoney(inv.net_due_minor, inv.currency)}</td>
                    <td className="p-3">
                      <Link href={`/invoices/${inv.id}`} className="text-teal-800 underline">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
