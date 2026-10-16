"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { Card, Loading, NoAccess } from "@/components/ui";
import { api, type Schemas } from "@/lib/api";
import { formatDateTime, formatMoney, humanise } from "@/lib/format";

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [invoice, setInvoice] = useState<Schemas["Invoice"] | "forbidden" | null>(null);

  useEffect(() => {
    api.GET("/api/billing/invoices/{id}/", { params: { path: { id } } }).then(({ data, response }) =>
      setInvoice(response.ok && data ? data : "forbidden"),
    );
  }, [id]);

  if (invoice === null) return <Loading />;
  if (invoice === "forbidden") return <NoAccess />;
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const paid = invoice.patient_paid_minor + invoice.insurer_paid_minor;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Invoice</h1>
        <span data-testid="payment-status" className="rounded bg-slate-100 px-2 py-1 text-sm font-semibold">
          {humanise(invoice.payment_status)}
        </span>
        <Link href={`/patients/${invoice.patient}`} className="ml-auto text-teal-800 underline">
          Patient chart
        </Link>
      </div>

      <Card title="Charges">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Charges on this invoice</caption>
            <thead className="text-slate-700">
              <tr>
                <th scope="col" className="p-2">Description</th>
                <th scope="col" className="p-2 text-right">Qty</th>
                <th scope="col" className="p-2 text-right">Unit price</th>
                <th scope="col" className="p-2 text-right">Amount</th>
                <th scope="col" className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className={`border-t border-slate-100 ${line.status === "void" ? "text-slate-400 line-through" : ""}`}>
                  <td className="p-2">{line.description}</td>
                  <td className="p-2 text-right">{line.quantity}</td>
                  <td className="p-2 text-right">{money(line.unit_price_minor)}</td>
                  <td className="p-2 text-right">{money(line.amount_minor)}</td>
                  <td className="p-2">{line.status === "pending" ? "Not yet delivered" : humanise(line.status ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Totals">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt>Total</dt>
            <dd className="text-right font-medium" data-testid="total">{money(invoice.total_minor)}</dd>
            {invoice.insurer_coverage_bp > 0 && (
              <>
                <dt>Insurer share ({invoice.insurer_coverage_bp / 100}%)</dt>
                <dd className="text-right">{money(invoice.insurer_due_minor)}</dd>
              </>
            )}
            <dt>Patient share</dt>
            <dd className="text-right">{money(invoice.patient_due_minor)}</dd>
            <dt>Paid</dt>
            <dd className="text-right" data-testid="paid">{money(paid)}</dd>
            <dt className="font-semibold">Still due</dt>
            <dd className="text-right font-semibold" data-testid="net-due">{money(invoice.net_due_minor)}</dd>
          </dl>
        </Card>
        <Card title="Payments">
          {invoice.payments.length === 0 ? (
            <p className="text-slate-600">No payments yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {invoice.payments.map((p) => (
                <li key={p.id}>
                  {formatDateTime(p.received_at)}: {money(p.amount_minor)} by {humanise(p.payer)} ({humanise(p.method)})
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
