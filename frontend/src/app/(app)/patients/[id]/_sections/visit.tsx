"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, Dialog, Notice, Select, TextArea } from "@/components/ui";
import { api, apiError, type Schemas } from "@/lib/api";
import { formatDateTime, humanise } from "@/lib/format";

type Encounter = Schemas["Encounter"];

/** The current visit: start one, or finish the one in progress. */
export function VisitPanel({
  patientId,
  openEncounter,
  onChange,
}: {
  patientId: string;
  openEncounter: Encounter | undefined;
  onChange: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    if (!openEncounter) return;
    const { error: failure } = await api.POST("/api/clinical/encounters/{id}/status/", {
      params: { path: { id: openEncounter.id } },
      body: { status: "finished" },
    });
    if (failure) return setError(apiError(failure).message);
    onChange();
  }

  return (
    <Card
      title="Visit"
      actions={
        openEncounter ? (
          <Button variant="secondary" onClick={finish}>
            Finish visit
          </Button>
        ) : (
          <Button onClick={() => setStarting(true)}>Start visit</Button>
        )
      }
    >
      {error && <Notice tone="error" title={error} />}
      {openEncounter ? (
        <p className="text-sm text-slate-700" data-testid="current-visit">
          {humanise(openEncounter.encounter_class)} visit in progress since{" "}
          {formatDateTime(openEncounter.started_at)}
          {openEncounter.reason ? ` — ${openEncounter.reason}` : ""}.
        </p>
      ) : (
        <p className="text-sm text-slate-700">No visit in progress. Start one to record vitals, diagnoses, notes or prescriptions.</p>
      )}
      <StartVisitDialog
        open={starting}
        patientId={patientId}
        onClose={() => setStarting(false)}
        onStarted={() => {
          setStarting(false);
          onChange();
        }}
      />
    </Card>
  );
}

function StartVisitDialog({
  open,
  patientId,
  onClose,
  onStarted,
}: {
  open: boolean;
  patientId: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [facilities, setFacilities] = useState<Schemas["Facility"][]>([]);
  const [departments, setDepartments] = useState<Schemas["Department"][]>([]);
  const [form, setForm] = useState({ encounter_class: "outpatient", facility: "", department: "", reason: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api.GET("/api/tenants/facilities/").then(({ data }) => {
      const list = data?.results ?? [];
      setFacilities(list);
      setForm((f) => ({ ...f, facility: f.facility || list[0]?.id || "" }));
    });
  }, [open]);

  useEffect(() => {
    if (!form.facility) return;
    api.GET("/api/tenants/departments/", { params: { query: { facility: form.facility } } }).then(({ data }) => {
      const list = data?.results ?? [];
      setDepartments(list);
      setForm((f) => ({ ...f, department: list.some((d) => d.id === f.department) ? f.department : (list[0]?.id ?? "") }));
    });
  }, [form.facility]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { error: failure } = await api.POST("/api/clinical/encounters/", {
      body: {
        patient: patientId,
        encounter_class: form.encounter_class as Schemas["EncounterClassEnum"],
        facility: form.facility,
        department: form.department || null,
        reason: form.reason,
      },
    });
    if (failure) return setError(apiError(failure).message);
    onStarted();
  }

  return (
    <Dialog open={open} title="Start visit" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice tone="error" title={error} />}
        <Select label="Type of visit" value={form.encounter_class} onChange={(e) => setForm({ ...form, encounter_class: e.target.value })}>
          <option value="outpatient">Outpatient</option>
          <option value="emergency">Emergency</option>
          <option value="inpatient">Inpatient</option>
          <option value="virtual">Virtual</option>
        </Select>
        <Select label="Facility" value={form.facility} onChange={(e) => setForm({ ...form, facility: e.target.value })}>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        <Select label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
          <option value="">None</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <TextArea label="Reason for the visit" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!form.facility}>
            Start visit
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
