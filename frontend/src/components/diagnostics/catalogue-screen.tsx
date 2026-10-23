"use client";

import { Plus } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import {
  type Investigation,
  KIND_LABEL,
  refusalMessage,
  useCatalogue,
  useSaveInvestigation,
} from "@/lib/diagnostics";
import { formatMoney, toMajorText, toMinor } from "@/lib/money";
import { useMe } from "@/lib/session";

/** The tests and scans the facility offers, and their prices. The administrator sets them up. */
export function CatalogueScreen() {
  const me = useMe();
  const list = useCatalogue();
  const [editing, setEditing] = useState<Investigation | "new" | null>(null);
  const isAdmin = me.roles.includes("tenant_admin");

  const columns: Column<Investigation>[] = [
    {
      id: "name",
      header: "Name",
      cell: (t) => (
        <span className="flex flex-col">
          <span className="text-ink-900 font-semibold">{t.name}</span>
          <span className="text-small text-ink-500">
            {KIND_LABEL[t.kind] ?? t.kind}
            {t.code ? ` · ${t.code}` : ""}
          </span>
        </span>
      ),
    },
    {
      id: "range",
      header: "Usual range",
      cell: (t) => (
        <span className="text-ink-900">
          {t.reference_range ? `${t.reference_range} ${t.unit}`.trim() : "—"}
        </span>
      ),
    },
    {
      id: "price",
      header: "Price",
      cell: (t) => (
        <span className="text-ink-900 tnum">
          {formatMoney(t.price_minor ?? 0, t.currency ?? "NGN")}
        </span>
      ),
    },
    {
      id: "active",
      header: "Offered",
      cell: (t) => <span className="text-ink-900">{t.active ? "Yes" : "No"}</span>,
    },
    {
      id: "act",
      header: "",
      className: "w-px",
      cell: (t) =>
        isAdmin ? (
          <Button variant="outline" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
            Edit
          </Button>
        ) : null,
    },
  ];

  if (list.error instanceof ApiRequestError && list.error.status === 403) {
    return <NoAccess what="the test catalogue" asPage />;
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Test catalogue</h1>
        {isAdmin && (
          <Button icon={Plus} onClick={() => setEditing("new")} className="ml-auto">
            Add a test or scan
          </Button>
        )}
      </header>
      <p className="text-body text-ink-600">
        What can be ordered, and what it costs. A price change applies to new orders only.
      </p>
      <section
        aria-label="Catalogue"
        className="rounded-card border-line bg-surface shadow-card overflow-hidden border"
      >
        <DataTable
          caption="Catalogue"
          columns={columns}
          rows={list.data}
          rowId={(t) => t.id}
          error={list.isError}
          onRetry={() => list.refetch()}
          empty={<EmptyState title="Nothing has been added yet." />}
        />
      </section>
      <EditDialog
        key={editing === "new" ? "new" : (editing?.id ?? "none")}
        item={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function EditDialog({
  item,
  onClose,
}: {
  item: Investigation | "new" | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const existing = item && item !== "new" ? item : null;
  const save = useSaveInvestigation(existing?.id);
  const [kind, setKind] = useState<string>(existing?.kind ?? "lab");
  const [name, setName] = useState(existing?.name ?? "");
  const [code, setCode] = useState(existing?.code ?? "");
  const [unit, setUnit] = useState(existing?.unit ?? "");
  const [range, setRange] = useState(existing?.reference_range ?? "");
  const [price, setPrice] = useState(existing ? toMajorText(existing.price_minor ?? 0) : "");
  const [active, setActive] = useState(existing?.active ?? true);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const minor = toMinor(price);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    setProblem(null);
    if (!name.trim() || minor === null) return;
    try {
      await save.mutateAsync({
        kind: kind as "lab" | "imaging",
        name: name.trim(),
        code: code.trim(),
        unit: unit.trim(),
        reference_range: range.trim(),
        price_minor: minor,
        currency: "NGN",
        active,
      });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: existing ? "Saved" : "Added", description: name.trim(), tone: "success" });
    onClose();
  }

  return (
    <Modal
      open={item !== null}
      onOpenChange={(open) => !open && onClose()}
      title={existing ? "Edit test or scan" : "Add a test or scan"}
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form="edit-investigation" loading={save.isPending}>
              Save
            </Button>
          }
        />
      }
    >
      <form id="edit-investigation" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Select
          label="Kind"
          value={kind}
          onValueChange={setKind}
          options={[
            { value: "lab", label: "Laboratory" },
            { value: "imaging", label: "Imaging" },
          ]}
        />
        <Input
          label="Name"
          value={name}
          maxLength={150}
          error={tried && !name.trim() ? "Enter the name." : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Price (naira)"
          inputMode="decimal"
          value={price}
          error={tried && minor === null ? "Enter an amount, for example 4500.00." : undefined}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Input
          label="LOINC code"
          optional
          value={code}
          maxLength={20}
          onChange={(e) => setCode(e.target.value)}
        />
        {kind === "lab" && (
          <>
            <Input
              label="Unit"
              optional
              hint="For example g/dL or mmol/L."
              value={unit}
              maxLength={32}
              onChange={(e) => setUnit(e.target.value)}
            />
            <Input
              label="Usual range"
              optional
              hint="For example 12 - 16."
              value={range}
              maxLength={100}
              onChange={(e) => setRange(e.target.value)}
            />
          </>
        )}
        <label className="text-body text-ink-900 flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="size-4 accent-blue-600"
          />
          Offered at the moment
        </label>
      </form>
    </Modal>
  );
}
