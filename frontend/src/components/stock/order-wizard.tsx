"use client";

import { ClipboardText, Package, Plus, Storefront, Trash } from "@phosphor-icons/react";
import { useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button, IconButton } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/money";
import { drugLabel, useFormulary } from "@/lib/prescribing";
import {
  checkQuantity,
  checkUnitCost,
  type DraftItem,
  lineTotal,
  orderTotal,
  refusalMessage,
  useAddVendor,
  usePlaceOrder,
  useVendors,
} from "@/lib/stock";
import { useDebounced } from "@/lib/use-debounced";

const STEPS = [
  { label: "Vendor", icon: Storefront },
  { label: "Items", icon: Package },
  { label: "Review", icon: ClipboardText },
];
const CURRENCY = "NGN";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A drug to start the item row on, from a low-stock link. */
  initialDrug?: string | null;
};

/** Order stock in three steps: pick the vendor, add items, review. Placing emails the vendor. */
export function OrderWizard(props: Props) {
  // A fresh draft each time the wizard opens.
  return <Wizard key={props.open ? `open-${props.initialDrug ?? ""}` : "closed"} {...props} />;
}

function Wizard({ open, onOpenChange, initialDrug }: Props) {
  const toast = useToast();
  const vendors = useVendors();
  const place = usePlaceOrder();
  const addVendor = useAddVendor();

  const [step, setStep] = useState(0);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [vendorDraft, setVendorDraft] = useState({ name: "", email: "", phone: "" });
  const [vendorError, setVendorError] = useState<string | undefined>();
  const [items, setItems] = useState<DraftItem[]>([]);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  // The item row being filled in.
  const [term, setTerm] = useState("");
  const [drugId, setDrugId] = useState<string | null>(initialDrug ?? null);
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [rowErrors, setRowErrors] = useState<{ drug?: string; quantity?: string; cost?: string }>(
    {},
  );
  const formulary = useFormulary(useDebounced(term, 250));

  const vendor = vendors.data?.find((v) => v.id === vendorId) ?? null;
  const activeVendors = (vendors.data ?? []).filter((v) => v.active);
  const known = new Map((formulary.data ?? []).map((d) => [d.id, d]));
  const options = [...known.values()]
    .filter((d) => !items.some((item) => item.drug === d.id))
    .map((d) => ({ value: d.id, label: drugLabel(d) }));
  const total = orderTotal(items);

  async function saveVendor() {
    setVendorError(undefined);
    if (!vendorDraft.name.trim()) return setVendorError("Enter the vendor's name.");
    try {
      const created = await addVendor.mutateAsync({
        name: vendorDraft.name.trim(),
        email: vendorDraft.email.trim(),
        phone: vendorDraft.phone.trim(),
      });
      setVendorId(created.id);
      setAdding(false);
      setVendorDraft({ name: "", email: "", phone: "" });
    } catch (failure) {
      setVendorError(refusalMessage(failure));
    }
  }

  function addItem() {
    const errors: typeof rowErrors = {};
    const drug = drugId ? known.get(drugId) : undefined;
    if (!drug) errors.drug = "Choose a drug.";
    const qty = checkQuantity(quantity);
    if ("error" in qty) errors.quantity = qty.error;
    const unit = checkUnitCost(cost, CURRENCY);
    if ("error" in unit) errors.cost = unit.error;
    setRowErrors(errors);
    if (!drug || "error" in qty || "error" in unit) return;
    setItems([
      ...items,
      { drug: drug.id, name: drugLabel(drug), quantity: qty.quantity, unitCostMinor: unit.minor },
    ]);
    setDrugId(null);
    setQuantity("");
    setCost("");
  }

  function next() {
    setProblem(null);
    if (step === 0 && !vendor) return setProblem("Choose a vendor, or add one.");
    if (step === 1 && items.length === 0) return setProblem("Add at least one item.");
    setStep(step + 1);
  }

  async function submit() {
    if (!vendor) return;
    setProblem(null);
    try {
      const order = await place.mutateAsync({
        vendor: vendor.id,
        note: note.trim(),
        lines: items.map((item) => ({
          drug: item.drug,
          quantity: item.quantity,
          unit_cost_minor: item.unitCostMinor,
        })),
      });
      toast({
        title: "Order placed",
        description: order.email_sent_at
          ? `${order.reference} was emailed to ${vendor.name}`
          : `${order.reference} for ${vendor.name} (no email on file)`,
        tone: "success",
      });
      onOpenChange(false);
    } catch (failure) {
      setProblem(refusalMessage(failure));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Order stock"
      description="Choose a vendor, add what you need, then place the order."
      header={<Stepper steps={STEPS} current={step} />}
      footer={
        <ModalFooter
          start={
            step === 0 ? (
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )
          }
          end={
            step < 2 ? (
              <Button onClick={next}>Next</Button>
            ) : (
              <Button loading={place.isPending} onClick={submit}>
                Place order
              </Button>
            )
          }
        />
      }
    >
      <div className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}

        {step === 0 && (
          <>
            {!adding && (
              <Select
                label="Vendor"
                placeholder={vendors.isLoading ? "Loading vendors…" : "Choose a vendor"}
                value={vendorId ?? undefined}
                onValueChange={setVendorId}
                options={activeVendors.map((v) => ({ value: v.id, label: v.name }))}
              />
            )}
            {vendor && !adding && (
              <p className="text-small text-ink-600">
                {vendor.email
                  ? `The order will be emailed to ${vendor.email}.`
                  : "This vendor has no email address, so the order will not be emailed."}
              </p>
            )}
            {adding ? (
              <fieldset className="flex flex-col gap-3">
                <legend className="text-body text-ink-900 mb-1 font-semibold">New vendor</legend>
                <Input
                  label="Vendor name"
                  value={vendorDraft.name}
                  maxLength={200}
                  error={vendorError}
                  onChange={(e) => setVendorDraft({ ...vendorDraft, name: e.target.value })}
                />
                <Input
                  label="Vendor email"
                  type="email"
                  optional
                  hint="The order is sent here."
                  value={vendorDraft.email}
                  onChange={(e) => setVendorDraft({ ...vendorDraft, email: e.target.value })}
                />
                <Input
                  label="Vendor phone"
                  optional
                  value={vendorDraft.phone}
                  onChange={(e) => setVendorDraft({ ...vendorDraft, phone: e.target.value })}
                />
                <div className="flex gap-3">
                  <Button loading={addVendor.isPending} onClick={saveVendor}>
                    Save vendor
                  </Button>
                  <Button variant="ghost" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                </div>
              </fieldset>
            ) : (
              <div>
                <Button variant="dashed" icon={Plus} onClick={() => setAdding(true)}>
                  Add a vendor
                </Button>
              </div>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <fieldset className="flex flex-col gap-3">
              <legend className="text-body text-ink-900 mb-1 font-semibold">Add an item</legend>
              <Combobox
                label="Drug"
                value={drugId}
                options={options}
                onValueChange={setDrugId}
                onQueryChange={setTerm}
                searching={formulary.isFetching}
                placeholder="Search the formulary"
                error={rowErrors.drug}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Quantity"
                  inputMode="numeric"
                  value={quantity}
                  error={rowErrors.quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="tnum"
                />
                <Input
                  label="Unit cost (₦)"
                  inputMode="decimal"
                  value={cost}
                  error={rowErrors.cost}
                  hint="What the vendor charges for one unit."
                  onChange={(e) => setCost(e.target.value)}
                  className="tnum"
                />
              </div>
              <div>
                <Button variant="outline" icon={Plus} onClick={addItem}>
                  Add item
                </Button>
              </div>
            </fieldset>
            {items.length > 0 && (
              <ul aria-label="Items on this order" className="flex flex-col">
                {items.map((item) => (
                  <li
                    key={item.drug}
                    className="border-line flex items-center gap-3 border-t py-2.5 first:border-t-0"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body text-ink-900 truncate">{item.name}</span>
                      <span className="text-small text-ink-600 tnum">
                        {item.quantity} × {formatMoney(item.unitCostMinor, CURRENCY)}
                      </span>
                    </span>
                    <span className="text-body tnum text-ink-900 font-semibold">
                      {formatMoney(lineTotal(item.quantity, item.unitCostMinor), CURRENCY)}
                    </span>
                    <IconButton
                      icon={Trash}
                      label={`Remove ${item.name}`}
                      variant="ghost"
                      onClick={() => setItems(items.filter((i) => i.drug !== item.drug))}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {step === 2 && vendor && (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="text-small text-ink-600">Vendor</dt>
              <dd className="text-body text-ink-900 font-semibold">{vendor.name}</dd>
              <dt className="text-small text-ink-600">Emailed to</dt>
              <dd className="text-body text-ink-900">{vendor.email || "No email on file"}</dd>
            </dl>
            <ul aria-label="Order summary" className="flex flex-col">
              {items.map((item) => (
                <li
                  key={item.drug}
                  className="border-line flex items-center justify-between gap-3 border-t py-2.5 first:border-t-0"
                >
                  <span className="text-body text-ink-900">
                    {item.name}
                    <span className="text-small text-ink-600 tnum"> · {item.quantity} units</span>
                  </span>
                  <span className="text-body tnum">
                    {formatMoney(lineTotal(item.quantity, item.unitCostMinor), CURRENCY)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-body text-ink-900 flex justify-between font-bold">
              <span>Order total</span>
              <span data-testid="order-total" className="tnum">
                {formatMoney(total, CURRENCY)}
              </span>
            </p>
            <Input
              label="Note to the vendor"
              optional
              maxLength={500}
              showCount
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
