"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState, type FormEvent } from "react";

import { PatientName } from "@/components/PatientName";
import { Button, Card, Dialog, Field, Loading, NoAccess, Notice, Select } from "@/components/ui";
import { api, apiError, type Schemas } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/ids";
import { formatDateTime, formatMoney, humanise, toMajorText, toMinor } from "@/lib/format";

type Invoice = Schemas["Invoice"];

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [invoice, setInvoice] = useState<Invoice | "forbidden" | null>(null);
  const [dialog, setDialog] = useState<"pay" | "coverage" | "charge" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, response } = await api.GET("/api/billing/invoices/{id}/", { params: { path: { id } } });
    setInvoice(response.ok && data ? data : "forbidden");
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (invoice === null) return <Loading />;
  if (invoice === "forbidden") return <NoAccess />;
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const paid = invoice.patient_paid_minor + invoice.insurer_paid_minor;
  const done = (text: string) => {
    setDialog(null);
    setMessage(text);
    load();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Invoice</h1>
        <span data-testid="payment-status" className="rounded bg-slate-100 px-2 py-1 text-sm font-semibold">
          {humanise(invoice.payment_status)}
        </span>
        {invoice.estate_review && (
          <span className="rounded bg-amber-100 px-2 py-1 text-sm font-semibold text-amber-900">Estate review</span>
        )}
        <span className="ml-auto">
          <PatientName id={invoice.patient} />
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {invoice.net_due_minor > 0 && <Button onClick={() => setDialog("pay")}>Take payment</Button>}
        <Button variant="secondary" onClick={() => setDialog("coverage")}>Insurer coverage</Button>
        {invoice.payment_status !== "paid" && (
          <Button variant="secondary" onClick={() => setDialog("charge")}>Add charge</Button>
        )}
      </div>
      <div aria-live="polite">{message && <Notice tone="success" title={message} />}</div>

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
                {invoice.insurer_coverage_bp > 0 && <th scope="col" className="p-2 text-right">Insurer pays</th>}
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
                  {invoice.insurer_coverage_bp > 0 && <td className="p-2 text-right">{money(line.insurer_amount_minor ?? 0)}</td>}
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
                <dd className="text-right" data-testid="insurer-due">{money(invoice.insurer_due_minor)}</dd>
              </>
            )}
            <dt>Patient share</dt>
            <dd className="text-right" data-testid="patient-due">{money(invoice.patient_due_minor)}</dd>
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
                  {p.reference ? `, ref ${p.reference}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <PaymentDialog open={dialog === "pay"} invoice={invoice} onClose={() => setDialog(null)} onDone={() => done("Payment recorded.")} />
      <CoverageDialog open={dialog === "coverage"} invoice={invoice} onClose={() => setDialog(null)} onDone={() => done("Coverage updated.")} />
      <ChargeDialog open={dialog === "charge"} invoice={invoice} onClose={() => setDialog(null)} onDone={() => done("Charge added.")} />
      <p className="text-sm">
        <Link href="/billing" className="text-teal-800 underline">All invoices</Link>
      </p>
    </div>
  );
}

function PaymentDialog({ open, invoice, onClose, onDone }: { open: boolean; invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const [payer, setPayer] = useState<"patient" | "insurer">("patient");
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const owed = (who: "patient" | "insurer") =>
    who === "insurer"
      ? invoice.insurer_due_minor - invoice.insurer_paid_minor
      : invoice.patient_due_minor - invoice.patient_paid_minor;

  useEffect(() => {
    if (!open) return;
    // One key per payment attempt: a retried or double-clicked submit is recorded once.
    setKey(newIdempotencyKey());
    setPayer("patient");
    setMethod("cash");
    setAmount(toMajorText(Math.max(owed("patient"), 0), invoice.currency));
    setReference("");
    setError(null);
  }, [open]);

  function choosePayer(who: "patient" | "insurer") {
    setPayer(who);
    setMethod(who === "insurer" ? "insurer_remittance" : "cash");
    setAmount(toMajorText(Math.max(owed(who), 0), invoice.currency));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const minor = toMinor(amount, invoice.currency);
    if (minor === null || minor <= 0) return setError("Enter an amount such as 5300 or 5300.50.");
    const { error: failure } = await api.POST("/api/billing/invoices/{id}/pay/", {
      params: { path: { id: invoice.id } },
      body: {
        payer,
        method: method as Schemas["PaymentMethodEnum"],
        amount_minor: minor,
        reference,
        idempotency_key: key,
      },
    });
    if (failure) return setError(apiError(failure).message);
    onDone();
  }

  return (
    <Dialog open={open} title="Take payment" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice tone="error" title={error} />}
        <Select label="Paid by" value={payer} onChange={(e) => choosePayer(e.target.value as "patient" | "insurer")}>
          <option value="patient">Patient (owes {formatMoney(Math.max(owed("patient"), 0), invoice.currency)})</option>
          {invoice.insurer && <option value="insurer">Insurer (owes {formatMoney(Math.max(owed("insurer"), 0), invoice.currency)})</option>}
        </Select>
        <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)} disabled={payer === "insurer"}>
          {payer === "insurer" ? (
            <option value="insurer_remittance">Insurer remittance</option>
          ) : (
            <>
              <option value="cash">Cash</option>
              <option value="card">Card / POS</option>
              <option value="transfer">Bank transfer</option>
            </>
          )}
        </Select>
        <Field label="Amount (₦)" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Field label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} hint="Receipt, POS or transfer reference" />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Record payment</Button>
        </div>
      </form>
    </Dialog>
  );
}

function CoverageDialog({ open, invoice, onClose, onDone }: { open: boolean; invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const [insurers, setInsurers] = useState<Schemas["Insurer"][]>([]);
  const [insurer, setInsurer] = useState("");
  const [percent, setPercent] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setInsurer(invoice.insurer ?? "");
    setPercent(String(invoice.insurer_coverage_bp / 100));
    api.GET("/api/billing/insurers/").then(({ data }) => setInsurers(data?.results ?? []));
  }, [open, invoice]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // A percentage with up to two decimals is exactly basis points (80.5% = 8050).
    const bp = toMinor(percent);
    if (bp === null || bp > 10_000) return setError("Enter a percentage between 0 and 100 (up to two decimals).");
    const { error: failure } = await api.POST("/api/billing/invoices/{id}/coverage/", {
      params: { path: { id: invoice.id } },
      body: { insurer: bp ? insurer || null : null, coverage_bp: bp },
    });
    if (failure) return setError(apiError(failure).message);
    onDone();
  }

  return (
    <Dialog open={open} title="Insurer coverage" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice tone="error" title={error} />}
        <p className="text-sm text-slate-700">Coverage can be changed until a charge is delivered or a payment is made.</p>
        <Select label="Insurer" value={insurer} onChange={(e) => setInsurer(e.target.value)}>
          <option value="">No insurer</option>
          {insurers.map((i) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </Select>
        <Field label="Insurer pays (%)" inputMode="decimal" required value={percent} onChange={(e) => setPercent(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save coverage</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ChargeDialog({ open, invoice, onClose, onDone }: { open: boolean; invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ description: "", quantity: "1", price: "", category: "other" });
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKey(newIdempotencyKey());
    setForm({ description: "", quantity: "1", price: "", category: "other" });
    setError(null);
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const price = toMinor(form.price, invoice.currency);
    const quantity = Number.parseInt(form.quantity, 10);
    if (price === null || !(quantity >= 1)) return setError("Enter a quantity and a price such as 2000 or 2000.50.");
    const { error: failure } = await api.POST("/api/billing/invoices/{id}/charge/", {
      params: { path: { id: invoice.id } },
      body: {
        description: form.description,
        quantity,
        unit_price_minor: price,
        revenue_category: form.category as Schemas["RevenueCategoryEnum"],
        // Charges added here are for services already given, so they post to the ledger now.
        delivered: true,
        idempotency_key: key,
      },
    });
    if (failure) return setError(apiError(failure).message);
    onDone();
  }

  return (
    <Dialog open={open} title="Add charge" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice tone="error" title={error} />}
        <Field label="Description" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <Field label="Quantity" type="number" min={1} required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        <Field label="Unit price (₦)" inputMode="decimal" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {["consultation", "pharmacy", "laboratory", "imaging", "procedure", "ward", "other"].map((c) => (
            <option key={c} value={c}>{humanise(c)}</option>
          ))}
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Add charge</Button>
        </div>
      </form>
    </Dialog>
  );
}
