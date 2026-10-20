"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KebabMenu } from "@/components/ui/menu";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { api, apiError, fieldErrors, type Schemas, unwrap } from "@/lib/api";
import { useAllergies, useRefreshChart } from "@/lib/chart-queries";
import { ALLERGY_CATEGORIES, ALLERGY_SEVERITIES } from "@/lib/patient-form";
import { ALLERGY_SEVERITY } from "@/lib/status-map";

import { QueryState } from "./query-state";
import { ReasonModal } from "./reason-modal";

type Category = Schemas["AllergyCategoryEnum"];
type Severity = Schemas["AllergySeverityEnum"];

type Props = {
  patientId: string;
  hidden: ReadonlySet<string>;
  schedule: (action: { id: string; message: string; commit: () => Promise<unknown> }) => void;
  /** Whether to offer adding allergies (the API enforces who may). */
  canAdd: boolean;
};

/** Structured allergies, used by the prescription safety check. */
export function AllergyCard({ patientId, hidden, schedule, canAdd }: Props) {
  const allergies = useAllergies(patientId);
  const refresh = useRefreshChart(patientId);
  const [adding, setAdding] = useState(false);
  const [correcting, setCorrecting] = useState<Schemas["Allergy"] | null>(null);

  return (
    <Card
      title="Allergies"
      as="h3"
      action={
        canAdd && allergies.data ? (
          <Button variant="ghost" icon={Plus} onClick={() => setAdding(true)}>
            Add allergy
          </Button>
        ) : undefined
      }
    >
      <QueryState query={allergies} what="allergies" rows={2}>
        {(data) => {
          const rows = data.results.filter((a) => !hidden.has(a.id));
          return rows.length === 0 ? (
            <p className="text-small text-ink-600">No allergy recorded.</p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((a) => (
                <li
                  key={a.id}
                  data-testid="allergy"
                  className="border-line flex items-start gap-3 border-t py-2.5 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body text-ink-900 font-semibold">{a.substance}</span>
                    <span className="text-small text-ink-600">{a.reaction}</span>
                  </span>
                  <StatusPill status={ALLERGY_SEVERITY[a.severity]} />
                  <KebabMenu
                    label={`Actions for the ${a.substance} allergy`}
                    items={[
                      {
                        label: "Entered in error",
                        icon: Trash,
                        danger: true,
                        onSelect: () => setCorrecting(a),
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>

      <AddAllergyModal open={adding} onOpenChange={setAdding} patientId={patientId} />
      <ReasonModal
        open={correcting !== null}
        onOpenChange={(open) => !open && setCorrecting(null)}
        title="Mark allergy as entered in error"
        explanation="The allergy leaves the chart and the prescription safety check, but stays in the record's history."
        onConfirm={(reason) => {
          const allergy = correcting!;
          schedule({
            id: allergy.id,
            message: `${allergy.substance} allergy hidden as entered in error.`,
            commit: async () => {
              await unwrap(
                api.POST("/api/patients/allergies/{id}/entered-in-error/", {
                  params: { path: { id: allergy.id } },
                  body: { reason },
                }),
              );
              await refresh();
            },
          });
        }}
      />
    </Card>
  );
}

const FORM_ID = "add-allergy-form";

function AddAllergyModal({
  open,
  onOpenChange,
  patientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}) {
  const toast = useToast();
  const refresh = useRefreshChart(patientId);
  const [substance, setSubstance] = useState("");
  const [category, setCategory] = useState<Category>("medication");
  const [reaction, setReaction] = useState("");
  const [severity, setSeverity] = useState<Severity>("moderate");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/patients/allergies/", {
          body: {
            patient: patientId,
            substance: substance.trim(),
            category,
            reaction: reaction.trim(),
            severity,
          },
        }),
      ),
    meta: { quietErrors: true },
  });

  function close(next: boolean) {
    if (!next) {
      setSubstance("");
      setCategory("medication");
      setReaction("");
      setSeverity("moderate");
      setSubmitted(false);
      setError(null);
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (!substance.trim() || !reaction.trim()) return;
    try {
      await save.mutateAsync();
    } catch (failure) {
      const problem = apiError(failure);
      return setError(Object.values(fieldErrors(problem))[0] ?? problem.message);
    }
    toast({ title: "Allergy added", tone: "success" });
    await refresh();
    close(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title="Add allergy"
      description="It is checked whenever a medicine is prescribed to this patient."
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={FORM_ID} loading={save.isPending}>
              Add allergy
            </Button>
          }
        />
      }
    >
      <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {error && <Banner tone="danger" live title={error} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Substance"
            value={substance}
            onChange={(e) => setSubstance(e.target.value)}
            error={submitted && !substance.trim() ? "Name the substance." : undefined}
          />
          <Select
            label="Category"
            value={category}
            onValueChange={(v) => setCategory(v as Category)}
            options={[...ALLERGY_CATEGORIES]}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Input
            label="Reaction"
            value={reaction}
            onChange={(e) => setReaction(e.target.value)}
            error={submitted && !reaction.trim() ? "Describe the reaction." : undefined}
          />
          <Select
            label="Severity"
            value={severity}
            onValueChange={(v) => setSeverity(v as Severity)}
            options={[...ALLERGY_SEVERITIES]}
          />
        </div>
      </form>
    </Modal>
  );
}
