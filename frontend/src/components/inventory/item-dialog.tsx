"use client";

import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { checkUnitCost, checkUnits, refusalMessage, useCreateSupply } from "@/lib/inventory";

const FORM_ID = "supply-form";

/** Add a supply to the list. Its count starts at zero; stock arrives as a received movement. */
export function ItemDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add supply"
      description="The count starts at zero. Receive stock to add units."
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={FORM_ID}>
              Add supply
            </Button>
          }
        />
      }
    >
      {open && <ItemForm onDone={() => onOpenChange(false)} />}
    </Modal>
  );
}

function ItemForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const create = useCreateSupply();
  const [form, setForm] = useState({
    name: "",
    sku: "",
    category: "",
    unit: "each",
    reorder: "0",
    cost: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const found: Record<string, string> = {};
    if (!form.name.trim()) found.name = "Enter the name.";
    if (!form.sku.trim()) found.sku = "Enter a code for this supply.";
    const reorder = checkUnits(form.reorder, { min: 0 });
    if ("error" in reorder) found.reorder = reorder.error;
    const cost = checkUnitCost(form.cost, "NGN");
    if (cost === null) found.cost = "Enter a price such as 150.00.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await create.mutateAsync({
        name: form.name.trim(),
        sku: form.sku.trim(),
        category: form.category.trim(),
        unit: form.unit.trim() || "each",
        reorder_level: "units" in reorder ? reorder.units : 0,
        unit_cost_minor: cost ?? 0,
        currency: "NGN",
      });
      toast({ title: "Supply added", description: form.name.trim(), tone: "success" });
      onDone();
    } catch (failure) {
      setProblem(refusalMessage(failure));
    }
  }

  return (
    <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-4">
      {problem && <Banner tone="danger" live title={problem} />}
      <Input
        label="Name"
        value={form.name}
        error={errors.name}
        maxLength={150}
        onChange={(e) => set({ name: e.target.value })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Code"
          value={form.sku}
          error={errors.sku}
          maxLength={40}
          onChange={(e) => set({ sku: e.target.value })}
        />
        <Input
          label="Category"
          optional
          value={form.category}
          maxLength={60}
          onChange={(e) => set({ category: e.target.value })}
        />
        <Input
          label="Unit"
          value={form.unit}
          hint="For example box, pack, each"
          maxLength={20}
          onChange={(e) => set({ unit: e.target.value })}
        />
        <Input
          label="Reorder at"
          inputMode="numeric"
          value={form.reorder}
          error={errors.reorder}
          hint="Flag as low at or below this"
          onChange={(e) => set({ reorder: e.target.value })}
        />
        <Input
          label="Cost per unit"
          optional
          inputMode="decimal"
          value={form.cost}
          error={errors.cost}
          onChange={(e) => set({ cost: e.target.value })}
        />
      </div>
    </form>
  );
}
