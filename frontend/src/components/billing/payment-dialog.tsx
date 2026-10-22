"use client";

import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  checkAmount,
  defaultPayer,
  fullAmountText,
  type Invoice,
  METHOD_LABEL,
  owedBy,
  type Payer,
  type PaymentMethod,
  refusalMessage,
  usePayInvoice,
} from "@/lib/billing";
import { newIdempotencyKey } from "@/lib/ids";
import { currencySymbol, formatMoney } from "@/lib/money";

const FORM_ID = "payment-form";

/** The server only accepts an insurer remittance from the insurer, and never for the patient. */
const METHODS: Record<Payer, PaymentMethod[]> = {
  patient: ["cash", "card", "transfer"],
  insurer: ["insurer_remittance"],
};

type Props = { invoice: Invoice; open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Take a payment against what one payer still owes. The amount starts as everything owed, and
 * any smaller amount is a part payment: the invoice shows Partially paid until the rest comes.
 */
export function PaymentDialog(props: Props) {
  // A fresh form, and a fresh retry key, each time the dialog opens.
  return <Form key={props.open ? "open" : "closed"} {...props} />;
}

function Form({ invoice, open, onOpenChange }: Props) {
  const toast = useToast();
  const pay = usePayInvoice(invoice.id);
  const first = defaultPayer(invoice);
  const [payer, setPayer] = useState<Payer>(first);
  const [method, setMethod] = useState<PaymentMethod>(METHODS[first][0]);
  const [amount, setAmount] = useState(fullAmountText(invoice, first));
  const [reference, setReference] = useState("");
  // The same key on every retry of this form, so a timeout can never record a payment twice.
  const [key] = useState(newIdempotencyKey);
  const [problem, setProblem] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | undefined>();

  const owed = owedBy(invoice, payer);
  const hasInsurer = invoice.insurer !== null;

  function choosePayer(value: string) {
    const next = value as Payer;
    setPayer(next);
    setMethod(METHODS[next][0]);
    setAmount(fullAmountText(invoice, next));
    setAmountError(undefined);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const check = checkAmount(amount, owed, payer, invoice.currency);
    if ("error" in check) return setAmountError(check.error);
    setAmountError(undefined);
    try {
      await pay.mutateAsync({
        payer,
        method,
        amount_minor: check.minor,
        reference: reference.trim(),
        idempotency_key: key,
      });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({
      title: "Payment recorded",
      description: `${formatMoney(check.minor, invoice.currency)} by ${METHOD_LABEL[method].toLowerCase()}`,
      tone: "success",
    });
    onOpenChange(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Take payment"
      description={`${invoice.patient_name}, ${invoice.reference}`}
      size="confirm"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={FORM_ID} loading={pay.isPending}>
              Record payment
            </Button>
          }
        />
      }
    >
      <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        {hasInsurer && (
          <Select
            label="Paid by"
            value={payer}
            onValueChange={choosePayer}
            options={[
              { value: "patient", label: "Patient" },
              { value: "insurer", label: "Insurer" },
            ]}
          />
        )}
        <Select
          label="Method"
          value={method}
          onValueChange={(value) => setMethod(value as PaymentMethod)}
          options={METHODS[payer].map((value) => ({ value, label: METHOD_LABEL[value] }))}
        />
        <Input
          label={`Amount (${currencySymbol(invoice.currency).trim()})`}
          inputMode="decimal"
          value={amount}
          error={amountError}
          hint={`The ${payer} still owes ${formatMoney(owed, invoice.currency)}. You can take part of it now.`}
          onChange={(e) => {
            setAmount(e.target.value);
            setAmountError(undefined);
          }}
          className="tnum"
        />
        <Input
          label="Reference"
          optional
          maxLength={100}
          hint="For example the POS slip or transfer number."
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </form>
    </Modal>
  );
}
