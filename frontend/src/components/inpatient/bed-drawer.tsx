"use client";

import { Bed as BedIcon, ArrowsLeftRight, SignOut, User, UserPlus } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Drawer, type DrawerSection } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { MiniTiles } from "@/components/ui/mini-tile";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { usePatientSearch } from "@/lib/appointments";
import { formatDay } from "@/lib/format";
import {
  type Bed,
  DISCHARGE_STATUS,
  type DischargeStatus,
  dischargeNoteError,
  refusalMessage,
  stayDay,
  transferTargets,
  useAdmit,
  useDischarge,
  useMarkReady,
  useTransfer,
  type Ward,
} from "@/lib/inpatient";
import { BED_STATUS } from "@/lib/status-map";
import { useDebounced } from "@/lib/use-debounced";

type Props = {
  bed: Bed | null;
  ward: Ward | null;
  wards: Ward[];
  /** Nurses and doctors change beds; the tenant admin only looks. */
  canChange: boolean;
  onClose: () => void;
};

/** Right drawer for one bed: admit to a vacant bed, or see, transfer and discharge the patient. */
export function BedDrawer(props: Props) {
  // A fresh drawer, with empty forms, for each bed.
  return <Body key={props.bed?.id ?? "none"} {...props} />;
}

function Body({ bed, ward, wards, canChange, onClose }: Props) {
  const [section, setSection] = useState<string | undefined>(undefined);
  if (!bed || !ward) {
    return (
      <Drawer
        open={false}
        onOpenChange={onClose}
        title="Bed"
        sections={[{ value: "bed", label: "Bed", icon: BedIcon, content: null }]}
      />
    );
  }
  const title = `${ward.name}, ${bed.label}`;
  const sections: DrawerSection[] = [];

  if (bed.status === "occupied" && bed.occupant) {
    const who = bed.occupant;
    sections.push({
      value: "patient",
      label: "Patient",
      icon: User,
      content: (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-card-title text-ink-900">{who.patient_name}</p>
            <p className="text-small text-ink-500 font-mono">{who.patient_mrn}</p>
          </div>
          <MiniTiles
            items={[
              { label: "Admitted", value: formatDay(who.admitted_at), tone: "sky" },
              { label: "Stay", value: `Day ${stayDay(who.admitted_at)}`, tone: "blue" },
            ]}
          />
          <section aria-label="Reason for admission">
            <h3 className="text-small text-ink-600 mb-1 font-semibold">Reason for admission</h3>
            <p className="text-body text-ink-900">{who.reason || "Not recorded"}</p>
          </section>
        </div>
      ),
    });
    if (canChange) {
      sections.push(
        {
          value: "transfer",
          label: "Transfer",
          icon: ArrowsLeftRight,
          content: (
            <TransferForm admission={who.admission} from={bed.id} wards={wards} onDone={onClose} />
          ),
        },
        {
          value: "discharge",
          label: "Discharge",
          icon: SignOut,
          content: <DischargeForm admission={who.admission} onDone={onClose} />,
        },
      );
    }
  } else if (bed.status === "vacant") {
    sections.push({
      value: "admit",
      label: "Admit",
      icon: UserPlus,
      content: canChange ? (
        <AdmitForm bed={bed} onDone={onClose} />
      ) : (
        <p className="text-body text-ink-600">
          This bed is free. Nursing staff admit patients; your role can look but not change beds.
        </p>
      ),
    });
  } else {
    sections.push({
      value: "bed",
      label: "Bed",
      icon: BedIcon,
      content:
        bed.status === "cleaning" ? (
          <CleaningPanel bed={bed} canChange={canChange} onDone={onClose} />
        ) : (
          <p className="text-body text-ink-600">
            This bed is out of service and cannot be used until maintenance puts it back.
          </p>
        ),
    });
  }

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      heading={
        <span className="flex flex-wrap items-center gap-3">
          <span className="text-base font-bold">{title}</span>
          <StatusPill status={BED_STATUS[bed.status]} />
        </span>
      }
      sections={sections}
      section={section ?? sections[0].value}
      onSectionChange={setSection}
    />
  );
}

function AdmitForm({ bed, onDone }: { bed: Bed; onDone: () => void }) {
  const toast = useToast();
  const admit = useAdmit();
  const [search, setSearch] = useState("");
  const [patient, setPatient] = useState<{ id: string; label: string } | null>(null);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const matches = usePatientSearch(useDebounced(search.trim(), 250));

  const options = [
    ...(patient ? [{ value: patient.id, label: patient.label }] : []),
    ...(matches.data ?? [])
      .filter((p) => p.id !== patient?.id)
      .map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name} (${p.mrn})` })),
  ];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setProblem(null);
    if (!patient || reason.trim().length < 3) return;
    try {
      await admit.mutateAsync({ patient: patient.id, bed: bed.id, reason: reason.trim() });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: "Patient admitted", description: patient.label, tone: "success" });
    onDone();
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {problem && <Banner tone="danger" live title={problem} />}
      <Combobox
        label="Patient"
        value={patient?.id ?? null}
        options={options}
        placeholder="Search by name or MRN"
        searching={matches.isFetching}
        onQueryChange={setSearch}
        onValueChange={(id) => {
          const found = options.find((o) => o.value === id);
          setPatient(id && found ? { id, label: found.label } : null);
        }}
        error={submitted && !patient ? "Choose the patient." : undefined}
      />
      <Input
        label="Reason for admission"
        value={reason}
        maxLength={300}
        error={
          submitted && reason.trim().length < 3
            ? "Say why the patient is being admitted."
            : undefined
        }
        onChange={(e) => setReason(e.target.value)}
      />
      <div>
        <Button type="submit" loading={admit.isPending}>
          Admit patient
        </Button>
      </div>
    </form>
  );
}

function TransferForm({
  admission,
  from,
  wards,
  onDone,
}: {
  admission: string;
  from: string;
  wards: Ward[];
  onDone: () => void;
}) {
  const toast = useToast();
  const transfer = useTransfer(admission);
  const targets = transferTargets(wards, from);
  const [target, setTarget] = useState<string | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setProblem(null);
    if (!target) return;
    try {
      await transfer.mutateAsync({ bed: target, reason: reason.trim() });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({
      title: "Patient moved",
      description: targets.find((t) => t.value === target)?.label,
      tone: "success",
    });
    onDone();
  }

  if (targets.length === 0) {
    return (
      <p className="text-body text-ink-600">There is no vacant bed to move this patient to.</p>
    );
  }
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {problem && <Banner tone="danger" live title={problem} />}
      <Select
        label="Move to"
        placeholder="Choose a vacant bed"
        value={target}
        onValueChange={setTarget}
        options={targets}
        error={submitted && !target ? "Choose the new bed." : undefined}
      />
      <Input
        label="Reason"
        optional
        value={reason}
        maxLength={300}
        hint="For example: needs oxygen, closer to the nurses' station."
        onChange={(e) => setReason(e.target.value)}
      />
      <div>
        <Button type="submit" loading={transfer.isPending}>
          Transfer patient
        </Button>
      </div>
    </form>
  );
}

function DischargeForm({ admission, onDone }: { admission: string; onDone: () => void }) {
  const toast = useToast();
  const discharge = useDischarge(admission);
  const [status, setStatus] = useState<DischargeStatus>("discharged");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const noteError = dischargeNoteError(status, note);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setProblem(null);
    if (noteError) return;
    try {
      await discharge.mutateAsync({ status, note: note.trim() });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({
      title: "Patient discharged",
      description: DISCHARGE_STATUS[status].label,
      tone: "success",
    });
    onDone();
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {problem && <Banner tone="danger" live title={problem} />}
      <Select
        label="Discharge status"
        value={status}
        onValueChange={(value) => setStatus(value as DischargeStatus)}
        options={(Object.keys(DISCHARGE_STATUS) as DischargeStatus[]).map((value) => ({
          value,
          label: DISCHARGE_STATUS[value].label,
        }))}
        hint={DISCHARGE_STATUS[status].hint}
      />
      <Input
        label={status === "transferred" ? "Transferred to" : "Note"}
        optional={status === "discharged"}
        value={note}
        maxLength={500}
        error={submitted ? (noteError ?? undefined) : undefined}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="text-small text-ink-600">The bed goes to cleaning until it is marked ready.</p>
      <div>
        <Button type="submit" loading={discharge.isPending}>
          Discharge patient
        </Button>
      </div>
    </form>
  );
}

function CleaningPanel({
  bed,
  canChange,
  onDone,
}: {
  bed: Bed;
  canChange: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const ready = useMarkReady();
  const [problem, setProblem] = useState<string | null>(null);

  async function markReady() {
    setProblem(null);
    try {
      await ready.mutateAsync(bed.id);
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: "Bed ready", description: bed.label, tone: "success" });
    onDone();
  }

  return (
    <div className="flex flex-col gap-4">
      {problem && <Banner tone="danger" live title={problem} />}
      <p className="text-body text-ink-600">This bed is being cleaned after a patient left.</p>
      {canChange && (
        <div>
          <Button loading={ready.isPending} onClick={markReady}>
            Mark ready
          </Button>
        </div>
      )}
    </div>
  );
}
