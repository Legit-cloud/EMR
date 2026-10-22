"use client";

import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  checkReceipt,
  type Order,
  outstanding,
  type ReceiptEntry,
  refusalMessage,
  useOrder,
  useReceiveOrder,
} from "@/lib/stock";

const FORM_ID = "receive-form";

type Props = {
  orderId: string | null;
  onOpenChange: (open: boolean) => void;
};

/**
 * Book a delivery against an order. Every line starts on everything still expected; lower a
 * quantity (or clear it) when only part arrived. Units become a stock batch, and the order
 * shows Partially received until the last unit is in.
 */
export function ReceiveDialog({ orderId, onOpenChange }: Props) {
  const order = useOrder(orderId);
  return (
    <Modal
      open={orderId !== null}
      onOpenChange={onOpenChange}
      title="Receive stock"
      description={
        order.data ? `${order.data.reference} from ${order.data.vendor_name}` : undefined
      }
      size="wide"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={FORM_ID} disabled={!order.data}>
              Receive stock
            </Button>
          }
        />
      }
    >
      {order.isError ? (
        <Banner tone="danger" live title="This order could not be loaded." />
      ) : order.data ? (
        // A fresh form each time an order opens.
        <ReceiveForm key={order.data.id} order={order.data} onDone={() => onOpenChange(false)} />
      ) : (
        <p role="status" className="text-body text-ink-600">
          Loading the order…
        </p>
      )}
    </Modal>
  );
}

const today = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

function ReceiveForm({ order, onDone }: { order: Order; onDone: () => void }) {
  const toast = useToast();
  const receive = useReceiveOrder(order.id);
  const lines = order.lines.filter((line) => outstanding(line) > 0);
  const [entries, setEntries] = useState<Record<string, ReceiptEntry>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.id,
        { quantity: String(outstanding(line)), batch: "", expiry: "" },
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, { field: string; error: string }>>({});
  const [problem, setProblem] = useState<string | null>(null);

  function change(id: string, patch: Partial<ReceiptEntry>) {
    setEntries((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const found: typeof errors = {};
    const receipts = [];
    for (const line of lines) {
      const check = checkReceipt(entries[line.id], outstanding(line), today());
      if ("skip" in check) continue;
      if ("error" in check) found[line.id] = { field: check.field, error: check.error };
      else {
        receipts.push({
          line: line.id,
          quantity: check.quantity,
          batch_number: check.batch,
          expiry_date: check.expiry,
        });
      }
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (receipts.length === 0)
      return setProblem("Enter the quantity received for at least one item.");
    try {
      const updated = await receive.mutateAsync({ receipts });
      toast({
        title: updated.status === "complete" ? "Order complete" : "Stock received",
        description: `${updated.reference}: ${updated.units_received} of ${updated.units_ordered} units in`,
        tone: "success",
      });
      onDone();
    } catch (failure) {
      setProblem(refusalMessage(failure));
    }
  }

  return (
    <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-5">
      {problem && <Banner tone="danger" live title={problem} />}
      <p className="text-small text-ink-600">
        Enter what arrived. Leave a quantity empty for items that did not come; they stay on the
        order.
      </p>
      <ul className="flex flex-col gap-5">
        {lines.map((line) => {
          const entry = entries[line.id];
          const wrong = errors[line.id];
          return (
            <li
              key={line.id}
              aria-label={line.drug_name}
              className="border-line flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body text-ink-900 font-semibold">{line.drug_name}</span>
                <span className="text-small text-ink-600 tnum">
                  {line.quantity_received} of {line.quantity_ordered} received
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  label={`Quantity received, ${line.drug_name}`}
                  inputMode="numeric"
                  value={entry.quantity}
                  hint={`${outstanding(line)} still expected`}
                  error={wrong?.field === "quantity" ? wrong.error : undefined}
                  onChange={(e) => change(line.id, { quantity: e.target.value })}
                  className="tnum"
                />
                <Input
                  label={`Batch number, ${line.drug_name}`}
                  maxLength={50}
                  value={entry.batch}
                  error={wrong?.field === "batch" ? wrong.error : undefined}
                  onChange={(e) => change(line.id, { batch: e.target.value })}
                />
                <Input
                  label={`Expiry date, ${line.drug_name}`}
                  type="date"
                  value={entry.expiry}
                  error={wrong?.field === "expiry" ? wrong.error : undefined}
                  onChange={(e) => change(line.id, { expiry: e.target.value })}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </form>
  );
}
