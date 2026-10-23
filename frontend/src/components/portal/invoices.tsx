"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDay } from "@/lib/format";
import { currencySymbol, formatMoney, toMajorText } from "@/lib/money";
import {
  checkPaymentAmount,
  PAYMENT_OUTCOME,
  type PortalInvoice,
  refusalMessage,
  useInvoices,
  usePayOnline,
  useVerifyPayment,
} from "@/lib/portal";
import { redirectTo } from "@/lib/redirect";
import { PAYMENT_STATUS } from "@/lib/status-map";

import { PortalButton, PortalCard, PortalHeading, QueryState } from "./shared";

/**
 * Bills: what each was for, what is paid and what is owed, and a way to pay any part of it at
 * Paystack's page. Coming back from that page, the server is asked what happened: the browser's
 * return alone never changes a bill.
 */
export function PortalInvoices() {
  const invoices = useInvoices();
  const [paying, setPaying] = useState<PortalInvoice | null>(null);
  return (
    <>
      <PortalHeading title="Invoices" lead="Your bills and what you owe." />
      <ReturnFromPayment />
      <QueryState query={invoices} what="invoices" empty="You have no bills.">
        {(rows) => (
          <div className="flex flex-col gap-4">
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
                      <div className="flex flex-col gap-2">
                        <div>
                          <PortalButton
                            aria-label={`Pay bill ${i.reference}`}
                            onClick={() => setPaying(i)}
                          >
                            Pay now
                          </PortalButton>
                        </div>
                        <p className="text-small text-ink-600">
                          You can also pay at the cashier or by bank transfer, quoting {i.reference}
                          .
                        </p>
                      </div>
                    )}
                  </PortalCard>
                </li>
              ))}
            </ul>
          </div>
        )}
      </QueryState>
      <PayDialog invoice={paying} onClose={() => setPaying(null)} />
    </>
  );
}

/** Paystack sends the patient back with ?reference=...; ask the server what became of it. */
function ReturnFromPayment() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const verify = useVerifyPayment();
  const reference = params.get("reference") ?? params.get("trxref");
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!reference || asked.current === reference) return;
    asked.current = reference;
    verify.mutate(reference);
    // Take the reference out of the address so a refresh does not ask again.
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference]);

  if (verify.isPending) {
    return (
      <div className="mb-4" role="status">
        <Banner tone="info" title="Checking your payment…" />
      </div>
    );
  }
  if (verify.isError) {
    return (
      <div className="mb-4">
        <Banner tone="danger" live title={refusalMessage(verify.error)} />
      </div>
    );
  }
  if (verify.data) {
    const outcome = PAYMENT_OUTCOME[verify.data.status];
    return (
      <div className="mb-4">
        <Banner tone={outcome.tone} live title={outcome.title} />
      </div>
    );
  }
  return null;
}

function PayDialog({ invoice, onClose }: { invoice: PortalInvoice | null; onClose: () => void }) {
  // A fresh form for each bill.
  return <PayForm key={invoice?.id ?? "none"} invoice={invoice} onClose={onClose} />;
}

function PayForm({ invoice, onClose }: { invoice: PortalInvoice | null; onClose: () => void }) {
  const pay = usePayOnline(invoice?.id ?? "none");
  const currency = invoice?.currency ?? "NGN";
  const [amount, setAmount] = useState(invoice ? toMajorText(invoice.due_minor, currency) : "");
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!invoice) return;
    setProblem(null);
    const check = checkPaymentAmount(amount, invoice.due_minor, currency);
    if ("error" in check) return setError(check.error);
    setError(undefined);
    try {
      const started = await pay.mutateAsync({ amount_minor: check.minor });
      redirectTo(started.authorization_url);
    } catch (failure) {
      setProblem(refusalMessage(failure));
    }
  }

  return (
    <Modal
      open={invoice !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Pay your bill"
      description={
        invoice
          ? `${invoice.reference}, ${formatMoney(invoice.due_minor, currency)} still to pay`
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
              Continue to payment
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
        <p className="text-small text-ink-600">
          You will pay on Paystack&apos;s secure page, using the payment options it offers. We never
          see your card details. Your bill updates once Paystack confirms the payment.
        </p>
      </form>
    </Modal>
  );
}
