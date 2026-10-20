"use client";

import { Play, Stop } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { api, apiError, type Schemas, unwrap } from "@/lib/api";
import { useOpenEncounter, useRefreshChart } from "@/lib/chart-queries";
import { formatDateTime, humanise } from "@/lib/format";

const CLASSES: { value: Schemas["EncounterClassEnum"]; label: string }[] = [
  { value: "outpatient", label: "Outpatient" },
  { value: "emergency", label: "Emergency" },
  { value: "inpatient", label: "Inpatient" },
  { value: "virtual", label: "Virtual" },
];

type Props = { patientId: string; canStart: boolean };

/** The current visit: start one, or finish the one in progress. */
export function VisitCard({ patientId, canStart }: Props) {
  const toast = useToast();
  const refresh = useRefreshChart(patientId);
  const { loaded, encounter } = useOpenEncounter(patientId);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const finish = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/clinical/encounters/{id}/status/", {
          params: { path: { id: encounter!.id } },
          body: { status: "finished" },
        }),
      ),
    meta: { quietErrors: true },
  });

  async function finishVisit() {
    setProblem(null);
    try {
      await finish.mutateAsync();
    } catch (failure) {
      return setProblem(apiError(failure).message);
    }
    toast({ title: "Visit finished", tone: "success" });
    await refresh();
  }

  if (!loaded) return null;
  return (
    <Card
      title="Visit"
      as="h3"
      action={
        encounter ? (
          canStart && (
            <Button variant="outline" icon={Stop} loading={finish.isPending} onClick={finishVisit}>
              Finish visit
            </Button>
          )
        ) : canStart ? (
          <Button icon={Play} onClick={() => setStarting(true)}>
            Start visit
          </Button>
        ) : undefined
      }
    >
      {problem && <Banner tone="danger" live title={problem} />}
      {encounter ? (
        <p className="text-body text-ink-900" data-testid="current-visit">
          {humanise(encounter.encounter_class)} visit in progress since{" "}
          {formatDateTime(encounter.started_at)}
          {encounter.reason ? ` — ${encounter.reason}` : ""}.
        </p>
      ) : (
        <p className="text-small text-ink-600">
          No visit in progress. Start one to record vitals, diagnoses or notes, or to prescribe.
        </p>
      )}
      <StartVisitModal open={starting} onOpenChange={setStarting} patientId={patientId} />
    </Card>
  );
}

const FORM_ID = "start-visit-form";

function StartVisitModal({
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
  const [encounterClass, setEncounterClass] = useState<Schemas["EncounterClassEnum"]>("outpatient");
  const [facility, setFacility] = useState("");
  // Until the user picks one, the first department is used: a visit with none is outside
  // the scope of a doctor who works in a department.
  const [department, setDepartment] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const facilities = useQuery({
    queryKey: ["facilities"],
    queryFn: async () => (await unwrap(api.GET("/api/tenants/facilities/"))).results,
    enabled: open,
    staleTime: 5 * 60_000,
  });
  // Until the user picks one, the first facility is used.
  const facilityId = facility || facilities.data?.[0]?.id || "";
  const departments = useQuery({
    queryKey: ["departments", facilityId],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/tenants/departments/", { params: { query: { facility: facilityId } } }),
        )
      ).results,
    enabled: open && facilityId !== "",
    staleTime: 5 * 60_000,
  });

  const departmentId = department ?? departments.data?.[0]?.id ?? "none";

  const start = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/clinical/encounters/", {
          body: {
            patient: patientId,
            encounter_class: encounterClass,
            facility: facilityId,
            department: departmentId === "none" ? null : departmentId,
            reason,
          },
        }),
      ),
    meta: { quietErrors: true },
  });

  function close(next: boolean) {
    if (!next) {
      setReason("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await start.mutateAsync();
    } catch (failure) {
      return setError(apiError(failure).message);
    }
    toast({ title: "Visit started", tone: "success" });
    await refresh();
    close(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title="Start visit"
      size="confirm"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={FORM_ID} loading={start.isPending} disabled={!facilityId}>
              Start visit
            </Button>
          }
        />
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4">
        {error && <Banner tone="danger" live title={error} />}
        <Select
          label="Type of visit"
          value={encounterClass}
          onValueChange={(v) => setEncounterClass(v as Schemas["EncounterClassEnum"])}
          options={CLASSES}
        />
        <Select
          label="Facility"
          value={facilityId}
          onValueChange={(v) => {
            setFacility(v);
            setDepartment(null);
          }}
          options={(facilities.data ?? []).map((f) => ({ value: f.id, label: f.name }))}
        />
        <Select
          label="Department"
          value={departmentId}
          onValueChange={setDepartment}
          options={[
            { value: "none", label: "None" },
            ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
        <Textarea
          label="Reason for the visit"
          rows={2}
          maxLength={500}
          showCount
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </form>
    </Modal>
  );
}
