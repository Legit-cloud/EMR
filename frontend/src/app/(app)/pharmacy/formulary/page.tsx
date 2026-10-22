"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  Button,
  Card,
  Dialog,
  Field,
  Loading,
  LoadFailed,
  NoAccess,
  Notice,
  Select,
} from "@/components/legacy-ui";
import { api, apiError, fieldErrors, type Schemas } from "@/lib/api";
import { formatDate, formatMoney, humanise, toMinor } from "@/lib/format";

type Drug = Schemas["Drug"];
type Batch = Schemas["StockBatch"];

const FORMS = ["tablet", "capsule", "syrup", "injection", "cream", "inhaler", "drops", "other"];

/** Formulary and stock. Pharmacists maintain them; prescribers can read the formulary. */
export default function FormularyPage() {
  const [drugs, setDrugs] = useState<Drug[] | "forbidden" | "error" | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [addingDrug, setAddingDrug] = useState(false);
  const [receiving, setReceiving] = useState<Drug | null>(null);

  async function load() {
    const [d, b] = await Promise.all([
      api.GET("/api/pharmacy/drugs/"),
      api.GET("/api/pharmacy/stock/"),
    ]);
    setDrugs(
      d.response.status === 403 ? "forbidden" : d.response.ok ? (d.data?.results ?? []) : "error",
    );
    setBatches(b.data?.results ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  if (drugs === null) return <Loading />;
  if (drugs === "forbidden") return <NoAccess />;
  if (drugs === "error") return <LoadFailed what="The formulary" onRetry={load} />;

  const stockOf = (drug: Drug) => batches.filter((b) => b.drug === drug.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Formulary and stock</h1>
        <Button onClick={() => setAddingDrug(true)}>Add medicine</Button>
      </div>
      {drugs.length === 0 && <p className="text-slate-600">The formulary is empty.</p>}
      {drugs.map((drug) => {
        const own = stockOf(drug);
        const available = own.reduce((sum, b) => sum + (b.available ?? 0), 0);
        return (
          <Card
            key={drug.id}
            title={`${drug.name} ${drug.strength} (${humanise(drug.form)})`}
            actions={
              <Button variant="secondary" onClick={() => setReceiving(drug)}>
                Receive stock
              </Button>
            }
          >
            <p className="text-sm text-slate-700" data-testid="drug-summary">
              {formatMoney(drug.unit_price_minor, drug.currency ?? "NGN")} per unit · {available}{" "}
              available
              {drug.on_formulary === false ? " · not on formulary" : ""}
            </p>
            {own.length > 0 && (
              <table className="mt-2 w-full text-left text-sm">
                <caption className="sr-only">Stock batches of {drug.name}</caption>
                <thead className="text-slate-700">
                  <tr>
                    <th scope="col" className="p-1">
                      Batch
                    </th>
                    <th scope="col" className="p-1">
                      Expires
                    </th>
                    <th scope="col" className="p-1 text-right">
                      On hand
                    </th>
                    <th scope="col" className="p-1 text-right">
                      Reserved
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {own.map((b) => (
                    <tr key={b.id} className="border-t border-slate-100">
                      <td className="p-1 font-mono">{b.batch_number}</td>
                      <td className="p-1">{formatDate(b.expiry_date)}</td>
                      <td className="p-1 text-right">{b.quantity_on_hand}</td>
                      <td className="p-1 text-right">{b.quantity_reserved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        );
      })}
      <AddDrugDialog
        open={addingDrug}
        onClose={() => setAddingDrug(false)}
        onAdded={() => {
          setAddingDrug(false);
          load();
        }}
      />
      <ReceiveStockDialog
        drug={receiving}
        onClose={() => setReceiving(null)}
        onReceived={() => {
          setReceiving(null);
          load();
        }}
      />
    </div>
  );
}

const EMPTY = { name: "", strength: "", form: "tablet", ingredients: "", classes: "", price: "" };

function AddDrugDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY);
      setErrors({});
      setFailure(null);
    }
  }, [open]);

  const list = (text: string) =>
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const price = toMinor(form.price);
    if (price === null)
      return setErrors({ unit_price_minor: "Enter a price such as 150 or 150.50." });
    const { error } = await api.POST("/api/pharmacy/drugs/", {
      body: {
        name: form.name,
        strength: form.strength,
        form: form.form as Schemas["DosageFormEnum"],
        ingredients: list(form.ingredients),
        classes: list(form.classes),
        unit_price_minor: price,
      },
    });
    if (error) {
      const problem = apiError(error);
      setErrors(fieldErrors(problem));
      return setFailure(problem.code === "validation_error" ? null : problem.message);
    }
    onAdded();
  }

  return (
    <Dialog open={open} title="Add medicine" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {failure && <Notice tone="error" title={failure} />}
        <Field
          label="Generic name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          error={errors.name}
        />
        <Field
          label="Strength"
          required
          value={form.strength}
          onChange={(e) => setForm({ ...form, strength: e.target.value })}
          error={errors.strength}
          hint="For example 500 mg"
        />
        <Select
          label="Form"
          value={form.form}
          onChange={(e) => setForm({ ...form, form: e.target.value })}
        >
          {FORMS.map((f) => (
            <option key={f} value={f}>
              {humanise(f)}
            </option>
          ))}
        </Select>
        <Field
          label="Active ingredients"
          required
          value={form.ingredients}
          onChange={(e) => setForm({ ...form, ingredients: e.target.value })}
          error={errors.ingredients}
          hint="Comma-separated. Used by the interaction check."
        />
        <Field
          label="Drug classes"
          value={form.classes}
          onChange={(e) => setForm({ ...form, classes: e.target.value })}
          hint="Comma-separated, for example penicillin. Used by the allergy check."
        />
        <Field
          label="Price per unit (₦)"
          inputMode="decimal"
          required
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          error={errors.unit_price_minor}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Add medicine</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReceiveStockDialog({
  drug,
  onClose,
  onReceived,
}: {
  drug: Drug | null;
  onClose: () => void;
  onReceived: () => void;
}) {
  const [form, setForm] = useState({ batch_number: "", expiry_date: "", quantity: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!drug) {
      setForm({ batch_number: "", expiry_date: "", quantity: "" });
      setErrors({});
    }
  }, [drug]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!drug) return;
    const { error } = await api.POST("/api/pharmacy/stock/", {
      body: {
        drug: drug.id,
        batch_number: form.batch_number,
        expiry_date: form.expiry_date,
        quantity_on_hand: Number.parseInt(form.quantity, 10),
      },
    });
    if (error) return setErrors(fieldErrors(apiError(error)));
    onReceived();
  }

  return (
    <Dialog open={drug !== null} title={`Receive ${drug?.name ?? ""}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label="Batch number"
          required
          value={form.batch_number}
          onChange={(e) => setForm({ ...form, batch_number: e.target.value })}
          error={errors.batch_number}
        />
        <Field
          label="Expiry date"
          type="date"
          required
          value={form.expiry_date}
          onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
          error={errors.expiry_date}
        />
        <Field
          label="Quantity received"
          type="number"
          min={1}
          required
          value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          error={errors.quantity_on_hand}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Receive</Button>
        </div>
      </form>
    </Dialog>
  );
}
