"use client";

import { type FormEvent, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { formatDay } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/ids";
import { currencySymbol, formatMoney, toMajorText, toMinor } from "@/lib/money";
import {
  checkPayment,
  type PortalInvoice,
  refusalMessage,
  useInvoices,
  usePay,
} from "@/lib/portal";
import { PAYMENT_STATUS } from "@/lib/status-map";

import { PortalButton, PortalCard, PortalHeading, QueryState } from "./shared";

/** Bills: what each was for, what is paid and owing, and a way to pay any part of it. */
export function PortalInvoices() {
  const invoices = useInvoices();
  const [paying, setPaying] = useState<PortalInvoice | null>(null);
  return (
    <>
      <PortalHeading title="Invoices" lead="Your bills and what you owe." />
      <QueryState query={invoices} what="invoices" empty="You have no bills.">
        {(rows) => (
          <ul className="flex flex-col gap-4">
            {rows.map((i) => (
              <li key={i.id}>
                <PortalCard
                  title={`Bill ${i.reference}`}
                  action={<StatusPill status={PAYMENT_STATUS[i.status]} />}
                >
                  <p className="text-small text-ink-600">Issued {formatDay(i.created_at)}</p>
                  <ul aria-label={`What bill ${i.reference} was for`} className="flex flex-col">
                    {i.lines.map((line, n) => (
                      <li
                        key={n}
                        className="border-line flex justify-between gap-3 border-t py-2 first:border-t-0"
                      >
                        <span className="text-body text-ink-900">{line.description}</span>
                        <span className="text-body tnum">
                          {formatMoney(line.amount_minor, i.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <dl className="border-line grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3">
                    <dt className="text-body text-ink-600">Total</dt>
                    <dd className="text-body tnum text-right">
                      {formatMoney(i.total_minor, i.currency)}
                    </dd>
                    <dt className="text-body text-ink-600">You have paid</dt>
                    <dd className="text-body tnum text-right">
                      {formatMoney(i.paid_minor, i.currency)}
                    </dd>
                    <dt className="text-body text-ink-900 font-bold">Still to pay</dt>
                    <dd
                      aria-label={`Still to pay on ${i.reference}`}
                      className="text-card-title text-ink-900 tnum text-right"
                    >
                      {formatMoney(i.due_minor, i.currency)}
                    </dd>
                  </dl>
                  {i.due_minor > 0 && (
                    <div>
                      <PortalButton
                        aria-label={`Pay bill ${i.reference}`}
                        onClick={() => setPaying(i)}
                      >
                        Pay now
                      </PortalButton>
                    </div>
                  )}
                </PortalCard>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <PayDialog invoice={paying} onClose={() => setPaying(null)} />
    </>
  );
}

function PayDialog({ invoice, onClose }: { invoice: PortalInvoice | null; onClose: () => void }) {
  // A fresh form, and a fresh retry key, for each bill.
  return <PayForm key={invoice?.id ?? "none"} invoice={invoice} onClose={onClose} />;
}

function PayForm({ invoice, onClose }: { invoice: PortalInvoice | null; onClose: () => void }) {
  const toast = useToast();
  const pay = usePay(invoice?.id ?? "none");
  const currency = invoice?.currency ?? "NGN";
  const [amount, setAmount] = useState(invoice ? toMajorText(invoice.due_minor, currency) : "");
  const [method, setMethod] = useState<"card" | "transfer">("card");
  // The same key on every retry of this form, so a timeout can never take a payment twice.
  const [key] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!invoice) return;
    setProblem(null);
    const check = checkPayment(toMinor(amount, currency), invoice.due_minor);
    if ("error" in check) return setError(check.error);
    setError(undefined);
    try {
      await pay.mutateAsync({ amount_minor: check.minor, method, key });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({
      title: "Payment received",
      description: formatMoney(check.minor, currency),
      tone: "success",
    });
    onClose();
  }

  return (
    <Modal
      open={invoice !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Pay your bill"
      description={
        invoice
          ? `${invoice.reference}, ${formatMoney(invoice.due_minor, currency)} to pay`
          : undefined
      }
      size="confirm"
      footer={
        <ModalFooter
          start={
            <PortalButton variant="ghost" onClick={onClose}>
              Cancel
            </PortalButton>
          }
          end={
            <PortalButton type="submit" form="portal-pay" loading={pay.isPending}>
              Pay
            </PortalButton>
          }
        />
      }
    >
      <form id="portal-pay" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Input
          label={`Amount (${currencySymbol(currency).trim()})`}
          inputMode="decimal"
          value={amount}
          error={error}
          hint="You can pay part of the bill now and the rest later."
          className="tnum"
          onChange={(e) => {
            setAmount(e.target.value);
            setError(undefined);
          }}
        />
        <Select
          label="How do you want to pay?"
          value={method}
          onValueChange={(value) => setMethod(value as "card" | "transfer")}
          options={[
            { value: "card", label: "Card" },
            { value: "transfer", label: "Bank transfer" },
          ]}
        />
      </form>
    </Modal>
  );
}
