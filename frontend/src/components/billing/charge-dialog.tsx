"use client";

import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import type { Schemas } from "@/lib/api";
import { type Invoice, refusalMessage, useAddCharge } from "@/lib/billing";
import { humanise } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/ids";
import { currencySymbol, toMinor } from "@/lib/money";

const FORM_ID = "charge-form";

type Category = Schemas["RevenueCategoryEnum"];
const CATEGORIES: Category[] = [
  "consultation",
  "pharmacy",
  "laboratory",
  "imaging",
  "procedure",
  "ward",
  "other",
];

type Props = { invoice: Invoice; open: boolean; onOpenChange: (open: boolean) => void };

/** A manual charge for a service already given, such as a registration card. */
export function ChargeDialog(props: Props) {
  return <Form key={props.open ? "open" : "closed"} {...props} />;
}

function Form({ invoice, open, onOpenChange }: Props) {
  const toast = useToast();
  const add = useAddCharge(invoice.id);
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<Category>("other");
  const [key] = useState(newIdempotencyKey);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const unit = toMinor(price, invoice.currency);
    const count = /^\d+$/.test(quantity) ? Number(quantity) : 0;
    if (!description.trim()) return setProblem("Describe the charge.");
    if (unit === null || count < 1) {
      return setProblem("Enter a quantity and a price such as 2000 or 2000.50.");
    }
    setProblem(null);
    try {
      await add.mutateAsync({
        description: description.trim(),
        quantity: count,
        unit_price_minor: unit,
        revenue_category: category,
        // Charges added here are for services already given, so they post to the ledger now.
        delivered: true,
        idempotency_key: key,
      });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: "Charge added", description: description.trim(), tone: "success" });
    onOpenChange(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add charge"
      description="For a service that has already been given."
      size="confirm"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={FORM_ID} loading={add.isPending}>
              Add charge
            </Button>
          }
        />
      }
    >
      <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Input
          label="Description"
          maxLength={255}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Quantity"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="tnum"
          />
          <Input
            label={`Unit price (${currencySymbol(invoice.currency).trim()})`}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="tnum"
          />
        </div>
        <Select
          label="Category"
          value={category}
          onValueChange={(value) => setCategory(value as Category)}
          options={CATEGORIES.map((value) => ({ value, label: humanise(value) }))}
        />
      </form>
    </Modal>
  );
}
