"use client";

import {
  CalendarBlank,
  Clock,
  Coins,
  EnvelopeSimple,
  FirstAid,
  Info,
  PencilSimple,
  Phone,
  Plus,
  Printer,
  Receipt,
  SlidersHorizontal,
  Stethoscope,
  Trash,
  User,
  Users,
} from "@phosphor-icons/react";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChoiceChips, RadioCards } from "@/components/ui/choice";
import { Combobox } from "@/components/ui/combobox";
import { DonutLegend } from "@/components/ui/donut-legend";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedbackButton } from "@/components/ui/feedback-button";
import { IconTile } from "@/components/ui/icon-tile";
import { Input, Textarea } from "@/components/ui/input";
import { DeltaChip, KpiBlock } from "@/components/ui/kpi";
import { KebabMenu, Menu } from "@/components/ui/menu";
import { MiniTiles } from "@/components/ui/mini-tile";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { ProgressBar, SegmentedStatBar } from "@/components/ui/progress";
import { SearchPill } from "@/components/ui/search-pill";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { RangeSelect, Select } from "@/components/ui/select";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Stepper } from "@/components/ui/stepper";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { Dropzone, FileRow } from "@/components/ui/upload";
import { STOCK_SERIES } from "@/lib/chart-colours";
import { APPOINTMENT_STATUS, PAYMENT_STATUS, TRIAGE_LEVEL } from "@/lib/status-map";

// Synthetic sample data only.
const SERVICES = [
  { value: "checkup", label: "General Checkup" },
  { value: "follow_up", label: "Follow-up" },
  { value: "antenatal", label: "Antenatal visit" },
];
const DRUGS = [
  "Amoxicillin 500 mg capsule",
  "Artemether/Lumefantrine 20/120 mg tablet",
  "Metformin 850 mg tablet",
  "Paracetamol 500 mg tablet",
  "Salbutamol 100 mcg inhaler",
].map((label, i) => ({ value: `d${i}`, label }));
const WIZARD_STEPS = [
  { label: "Visit", icon: CalendarBlank },
  { label: "Patient", icon: User },
  { label: "History", icon: FirstAid },
];

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-label-caps text-ink-500 uppercase">{title}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Buttons() {
  return (
    <Card title="Buttons">
      <Row title="Variants">
        <Button icon={Plus}>Order Stock</Button>
        <Button variant="outline">Receive</Button>
        <Button variant="neutral" icon={SlidersHorizontal}>
          Filters
        </Button>
        <Button variant="ghost">View all</Button>
        <Button variant="dashed" icon={Plus}>
          Add Medical Record
        </Button>
        <Button variant="success">Edit Medical Checkup</Button>
      </Row>
      <Row title="States">
        <Button disabled>Finish</Button>
        <Button variant="outline" disabled>
          Receive
        </Button>
        <Button loading>Saving</Button>
      </Row>
      <Row title="Round icon buttons">
        <IconButton icon={Plus} label="Create new" variant="add" />
        <IconButton icon={Printer} label="Print" />
        <Tooltip content="Edit the appointment">
          <IconButton icon={PencilSimple} label="Edit" />
        </Tooltip>
      </Row>
    </Card>
  );
}

function Controls() {
  const [view, setView] = useState<"day" | "week">("day");
  const [range, setRange] = useState("12m");
  return (
    <Card
      title="Segmented control, range and search"
      action={
        <RangeSelect
          label="Sample period"
          value={range}
          onValueChange={setRange}
          options={[
            { value: "12m", label: "Last 12 months" },
            { value: "month", label: "This month" },
          ]}
        />
      }
    >
      <Row title="Segmented control">
        <SegmentedControl
          label="Calendar view"
          value={view}
          onValueChange={setView}
          options={[
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
          ]}
        />
      </Row>
      <div className="grid gap-3 sm:grid-cols-2">
        <SearchPill label="Search the app" placeholder="Search anything" />
        <SearchPill label="Search stock" placeholder="Search" variant="table" />
      </div>
    </Card>
  );
}

function Inputs() {
  const [drug, setDrug] = useState<string | null>(null);
  const [gender, setGender] = useState("female");
  const [smoker, setSmoker] = useState<string>();
  return (
    <Card title="Inputs">
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Phone" icon={Phone} placeholder="+234 803 000 0000" type="tel" />
        <Input label="Email" icon={EnvelopeSimple} optional placeholder="name@example.com" />
        <Input label="Start time" icon={Clock} defaultValue="09:00" />
        <Input label="Date of birth" icon={CalendarBlank} error="Enter a date in the past." />
        <Select label="Service" options={SERVICES} placeholder="Select a service" />
        <Combobox label="Drug" options={DRUGS} value={drug} onValueChange={setDrug} />
        <Textarea
          label="Quick note"
          optional
          maxLength={200}
          showCount
          placeholder="Reason for visit"
          className="md:col-span-2"
        />
      </div>
      <ChoiceChips
        legend="Gender"
        value={gender}
        onValueChange={setGender}
        options={[
          { value: "female", label: "Female" },
          { value: "male", label: "Male" },
          { value: "other", label: "Other" },
        ]}
      />
      <RadioCards
        legend="Do you smoke?"
        columns={3}
        value={smoker}
        onValueChange={setSmoker}
        options={[
          { value: "never", label: "Never" },
          { value: "former", label: "Former", description: "Stopped over a year ago" },
          { value: "current", label: "Current" },
        ]}
      />
    </Card>
  );
}

function Uploads() {
  const [files, setFiles] = useState([
    { name: "referral-letter.docx", size: 182_000, progress: 100 },
    { name: "chest-xray.png", size: 2_400_000, progress: 64 },
    { name: "lab-results.pdf", size: 420_000, progress: 100 },
  ]);
  return (
    <Card title="Upload">
      <Dropzone
        label="Attachments"
        count={files.length}
        onFiles={(added) =>
          setFiles((list) => [
            ...list,
            ...added.map((f) => ({ name: f.name, size: f.size, progress: 100 })),
          ])
        }
      />
      <div className="flex flex-col gap-2">
        {files.map((file) => (
          <FileRow
            key={file.name}
            {...file}
            onRemove={() => setFiles((list) => list.filter((f) => f.name !== file.name))}
          />
        ))}
      </div>
    </Card>
  );
}

function Display() {
  return (
    <Card title="Tabs, KPIs, pills and avatars">
      <Tabs
        label="Sample tabs"
        items={[
          {
            value: "calendar",
            label: "Calendar",
            content: (
              <div className="grid gap-5 sm:grid-cols-3">
                <KpiBlock
                  label="Total cash"
                  value="₦13,232.00"
                  delta={12.5}
                  icon={{ icon: Coins, tone: "amber" }}
                />
                <KpiBlock label="Patients today" value="48" delta={-4} />
                <KpiBlock
                  label="No-shows"
                  value="3"
                  delta={-25}
                  goodWhen="down"
                  caption="vs last week"
                />
              </div>
            ),
          },
          {
            value: "log",
            label: "Log History",
            count: 12,
            content: <p className="text-body text-ink-600">No changes today.</p>,
          },
        ]}
      />
      <Row title="Delta chips">
        <DeltaChip value={8.2} />
        <DeltaChip value={-3} />
        <DeltaChip value={0} />
      </Row>
      <Row title="Status pills">
        {[
          ...Object.values(APPOINTMENT_STATUS),
          ...Object.values(PAYMENT_STATUS),
          ...Object.values(TRIAGE_LEVEL),
        ].map((status) => (
          <StatusPill key={status.label} status={status} />
        ))}
      </Row>
      <Row title="Avatars and icon tiles">
        <Avatar name="Ada Tester" />
        <Avatar name="Chidi Okeke" size={40} labelled />
        <Avatar name="Ngozi Eze" />
        <Avatar name="Tolu Okafor" size={40} />
        <IconTile icon={Coins} tone="amber" />
        <IconTile icon={Stethoscope} tone="purple" />
        <IconTile icon={Users} tone="teal" size={44} />
      </Row>
    </Card>
  );
}

function Stats() {
  return (
    <Card title="Progress and breakdowns">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <ProgressBar label="Items received" value={2} max={4} />
          <ProgressBar label="Order complete" value={4} max={4} />
          <SegmentedStatBar
            label="Stock levels"
            segments={[
              { label: "In stock", value: 20, fill: STOCK_SERIES.available },
              { label: "Low stock", value: 4, fill: STOCK_SERIES.low },
              { label: "Out of stock", value: 8, fill: STOCK_SERIES.out },
            ]}
          />
        </div>
        <div className="flex flex-col gap-4">
          <DonutLegend
            label="Expenses by category"
            items={[
              { label: "Salaries", value: 42 },
              { label: "Drugs and supplies", value: 23 },
              { label: "Utilities", value: 12 },
              { label: "Maintenance", value: 10 },
              { label: "Transport", value: 8 },
              { label: "Other", value: 5 },
            ]}
          />
          <MiniTiles
            items={[
              { label: "Top expense", value: "Salaries", tone: "purple" },
              { label: "Top income", value: "Consultations", tone: "green" },
              { label: "Unpaid bills", value: "₦84,500.00", tone: "pink" },
              { label: "Low stock", value: "4 items", tone: "amber" },
            ]}
          />
        </div>
      </div>
    </Card>
  );
}

function Feedback() {
  const toast = useToast();
  return (
    <Card title="Banners, stepper, toast and feedback">
      <Banner action={<Button variant="ghost">Extend time</Button>}>
        Time slot available later, you can extend the appointment time.
      </Banner>
      <Banner tone="danger" title="Allergy: Penicillin">
        Severe reaction: anaphylaxis. Recorded 12 Mar 2026.
      </Banner>
      <Stepper steps={WIZARD_STEPS} current={1} />
      <Row title="Toasts">
        <Button
          variant="neutral"
          onClick={() => toast({ title: "Patient saved", description: "MRN 2026-000123" })}
        >
          Show success
        </Button>
        <Button
          variant="neutral"
          onClick={() =>
            toast({
              title: "Could not save",
              description: "Check the connection and try again.",
              tone: "error",
            })
          }
        >
          Show error
        </Button>
        <Button variant="neutral" onClick={() => toast({ title: "Reminder sent", tone: "info" })}>
          Show info
        </Button>
      </Row>
      <Row title="Feedback button (floats bottom right in the app)">
        <FeedbackButton
          floating={false}
          onClick={() => toast({ title: "Thanks for the feedback", tone: "info" })}
        />
      </Row>
    </Card>
  );
}

function Overlays() {
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [step, setStep] = useState(0);
  const last = step === WIZARD_STEPS.length - 1;
  return (
    <Card title="Modal, drawer and menus">
      <Row title="Open">
        <Button
          variant="neutral"
          onClick={() => {
            setStep(0);
            setModal(true);
          }}
        >
          Wizard modal
        </Button>
        <Button variant="neutral" onClick={() => setConfirm(true)}>
          Confirm modal
        </Button>
        <Button variant="neutral" onClick={() => setDrawer(true)}>
          Appointment drawer
        </Button>
        <Menu
          trigger={<Button variant="neutral">Menu</Button>}
          items={[
            { label: "Edit", icon: PencilSimple, onSelect: () => {} },
            { label: "Print", icon: Printer, onSelect: () => {} },
            { label: "Delete", icon: Trash, onSelect: () => {}, danger: true },
          ]}
        />
        <KebabMenu
          label="Actions for #OS12KOS"
          items={[
            { label: "View", icon: Info, onSelect: () => {} },
            { label: "Receive", onSelect: () => {}, disabled: true },
          ]}
        />
      </Row>

      <Modal
        open={modal}
        onOpenChange={setModal}
        title="New appointment"
        header={<Stepper steps={WIZARD_STEPS} current={step} />}
        footer={
          <ModalFooter
            start={
              <Button variant="ghost" onClick={() => setModal(false)}>
                Cancel
              </Button>
            }
            end={
              <>
                <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>
                  Previous
                </Button>
                <Button onClick={() => (last ? setModal(false) : setStep(step + 1))}>
                  {last ? "Save" : "Next"}
                </Button>
              </>
            }
          />
        }
      >
        <div className="flex flex-col gap-4">
          <Select label="Service" options={SERVICES} />
          <Textarea label="Quick note" optional maxLength={200} showCount />
        </div>
      </Modal>

      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        size="confirm"
        title="Cancel this appointment?"
        description="The patient is told by email. This cannot be undone."
        footer={
          <ModalFooter
            start={
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Keep it
              </Button>
            }
            end={<Button onClick={() => setConfirm(false)}>Cancel appointment</Button>}
          />
        }
      >
        <Input label="Cancellation reason" />
      </Modal>

      <Drawer
        open={drawer}
        onOpenChange={setDrawer}
        title="Appointment #APT0011"
        heading={
          <>
            <span className="text-body text-ink-600">Appointment ID</span>
            <span className="text-body text-ink-900 font-bold">#APT0011</span>
            <span className="text-pill rounded-tag bg-pill-grey text-ink-600 px-2 py-1 uppercase">
              Walk-in
            </span>
          </>
        }
        sections={[
          {
            value: "visit",
            label: "Visit",
            icon: CalendarBlank,
            content: (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <Avatar name="Tolu Okafor" size={40} />
                  <span className="text-card-title text-ink-900 flex-1">Tolu Okafor</span>
                  <StatusPill status={APPOINTMENT_STATUS.booked} />
                </div>
                <Banner tone="danger" title="Allergy: Penicillin" />
              </div>
            ),
          },
          {
            value: "clinical",
            label: "Clinical record",
            icon: Stethoscope,
            content: <EmptyState title="No clinical record for this visit yet." />,
          },
          {
            value: "billing",
            label: "Billing",
            icon: Receipt,
            content: (
              <div className="flex items-center justify-between gap-3">
                <span className="text-body text-ink-900">Payment · Bill #10102</span>
                <StatusPill status={PAYMENT_STATUS.unpaid} />
              </div>
            ),
          },
        ]}
        footer={
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-3">
              <Button variant="success">Edit Medical Checkup</Button>
              <Button variant="dashed" icon={Plus}>
                Add Medical Record
              </Button>
              <Button disabled>Finish</Button>
            </div>
            <p className="text-small text-ink-500">
              Please add vitals and a clinical record to finish this visit.
            </p>
          </div>
        }
      />
    </Card>
  );
}

function States() {
  return (
    <Card title="Empty and loading">
      <div className="grid gap-5 md:grid-cols-2">
        <EmptyState
          title="No appointments today."
          action={<Button icon={Plus}>Book appointment</Button>}
        />
        <Loading label="Loading patients">
          <div className="flex flex-col gap-3 py-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
        </Loading>
      </div>
    </Card>
  );
}

/** Every component in src/components/ui with its main states, using synthetic data. */
export function ComponentSamples() {
  return (
    <>
      <Buttons />
      <Controls />
      <Inputs />
      <Uploads />
      <Display />
      <Stats />
      <Feedback />
      <Overlays />
      <States />
    </>
  );
}
