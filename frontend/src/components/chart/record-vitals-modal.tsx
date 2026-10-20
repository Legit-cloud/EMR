"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { api, apiError, unwrap } from "@/lib/api";
import { useRefreshChart } from "@/lib/chart-queries";
import { formatReading } from "@/lib/vitals";

const FORM_ID = "record-vitals-form";
const WEIGHT = "29463-7"; // LOINC body weight
const HEIGHT = "8302-2"; // LOINC body height

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  encounterId: string;
};

// The order a nurse takes them in, not alphabetical: pressure, pulse, breathing, temperature,
// oxygen, then size. Anything else the server adds goes last.
const FORM_ORDER = [
  "8480-6",
  "8462-4",
  "8867-4",
  "9279-1",
  "8310-5",
  "59408-5",
  "29463-7",
  "8302-2",
  "9843-4",
];
const rank = (code: string) => {
  const at = FORM_ORDER.indexOf(code);
  return at === -1 ? FORM_ORDER.length : at;
};

/** The BMI the server will calculate, shown while weight and height are typed. */
export function previewBmi(weightKg: string, heightCm: string): number | null {
  const weight = Number(weightKg);
  const height = Number(heightCm) / 100;
  if (!weightKg.trim() || !heightCm.trim() || !(weight > 0) || !(height > 0)) return null;
  return weight / (height * height);
}

/**
 * Record vital signs against the open visit. Each field is named with its LOINC display and
 * UCUM unit; BMI is never typed, the server calculates it from weight and height.
 */
export function RecordVitalsModal({ open, onOpenChange, patientId, encounterId }: Props) {
  const toast = useToast();
  const refresh = useRefreshChart(patientId);
  const [values, setValues] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<string[]>([]);

  const codes = useQuery({
    queryKey: ["loinc-codes"],
    queryFn: () => unwrap(api.GET("/api/clinical/codes/loinc/")),
    enabled: open,
    staleTime: 60 * 60_000,
  });
  const inputs = (codes.data ?? [])
    .filter((c) => !c.derived)
    .sort((a, b) => rank(a.code) - rank(b.code));

  const save = useMutation({
    mutationFn: (readings: { code: string; value: string }[]) =>
      unwrap(api.POST("/api/clinical/vitals/", { body: { encounter: encounterId, readings } })),
    meta: { quietErrors: true },
  });

  function close(next: boolean) {
    if (!next) {
      setValues({});
      setProblems([]);
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const readings = Object.entries(values)
      .filter(([, value]) => value.trim() !== "")
      .map(([code, value]) => ({ code, value: value.trim() }));
    try {
      await save.mutateAsync(readings);
    } catch (failure) {
      const problem = apiError(failure);
      const detail = problem.details.readings;
      setProblems(Array.isArray(detail) ? detail.map(String) : [problem.message]);
      return;
    }
    toast({ title: "Vital signs recorded", tone: "success" });
    await refresh();
    close(false);
  }

  const bmi = previewBmi(values[WEIGHT] ?? "", values[HEIGHT] ?? "");
  const anyValue = Object.values(values).some((v) => v.trim());

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title="Record vital signs"
      description="Fill in what was measured. BMI is calculated from weight and height."
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={FORM_ID} loading={save.isPending} disabled={!anyValue}>
              Save readings
            </Button>
          }
        />
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4">
        {problems.length > 0 && (
          <Banner tone="danger" live title="Some readings were not accepted">
            <ul className="list-disc pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Banner>
        )}
        {codes.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {inputs.map((code) => (
              <Input
                key={code.code}
                label={`${code.display} (${code.unit})`}
                inputMode="decimal"
                autoComplete="off"
                value={values[code.code] ?? ""}
                onChange={(e) => setValues({ ...values, [code.code]: e.target.value })}
              />
            ))}
          </div>
        )}
        {bmi !== null && (
          <p className="text-small text-ink-600" aria-live="polite">
            BMI will be recorded as{" "}
            <strong className="text-ink-900 tnum">{formatReading(bmi, 1)} kg/m²</strong>, calculated
            from weight and height.
          </p>
        )}
      </form>
    </Modal>
  );
}
