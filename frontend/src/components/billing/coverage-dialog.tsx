"use client";

import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  type Invoice,
  percentText,
  percentToBasisPoints,
  refusalMessage,
  useInsurers,
  useSetCoverage,
} from "@/lib/billing";

const FORM_ID = "coverage-form";
/** Radix Select cannot hold an empty value, so "no insurer" has a name of its own. */
const NONE = "none";

type Props = { invoice: Invoice; open: boolean; onOpenChange: (open: boolean) => void };

/** Who pays what share. The server fixes it once a charge is delivered or money is received. */
export function CoverageDialog(props: Props) {
  return <Form key={props.open ? "open" : "closed"} {...props} />;
}

function Form({ invoice, open, onOpenChange }: Props) {
  const toast = useToast();
  const insurers = useInsurers();
  const save = useSetCoverage(invoice.id);
  const [insurer, setInsurer] = useState(invoice.insurer ?? NONE);
  const [percent, setPercent] = useState(
    invoice.insurer_coverage_bp ? percentText(invoice.insurer_coverage_bp).slice(0, -1) : "",
  );
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const basisPoints = percent.trim() === "" ? 0 : percentToBasisPoints(percent);
    if (basisPoints === null) {
      return setProblem("Enter a percentage between 0 and 100 (up to two decimals).");
    }
    if (basisPoints > 0 && insurer === NONE) return setProblem("Choose the insurer.");
    setProblem(null);
    try {
      await save.mutateAsync({
        insurer: basisPoints > 0 ? insurer : null,
        coverage_bp: basisPoints,
      });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: "Coverage saved", tone: "success" });
    onOpenChange(false);
  }

  const choices = (insurers.data ?? []).filter((i) => i.is_active || i.id === invoice.insurer);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Insurer coverage"
      description="Coverage can be changed until a charge is delivered or a payment is made."
      size="confirm"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={FORM_ID} loading={save.isPending}>
              Save coverage
            </Button>
          }
        />
      }
    >
      <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Select
          label="Insurer"
          value={insurer}
          onValueChange={setInsurer}
          options={[
            { value: NONE, label: "No insurer" },
            ...choices.map((i) => ({ value: i.id, label: i.name })),
          ]}
        />
        <Input
          label="Insurer pays (%)"
          inputMode="decimal"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          className="tnum"
        />
      </form>
    </Modal>
  );
}
