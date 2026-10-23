"use client";

import { Plus, SlidersHorizontal } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Popover } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import { usePatientSearch } from "@/lib/appointments";
import {
  type DiagnosticOrder,
  FLAG_LABEL,
  type Flag,
  KIND_LABEL,
  orderActions,
  PRIORITY_LABEL,
  type Priority,
  refusalMessage,
  useCancelOrder,
  useCatalogue,
  useCollect,
  useCorrectResult,
  useOrders,
  usePlaceOrder,
  useRecordResult,
  useReview,
} from "@/lib/diagnostics";
import { formatDateTime } from "@/lib/format";
import { useMe } from "@/lib/session";
import { DIAGNOSTIC_STATUS, RESULT_FLAG } from "@/lib/status-map";
import { useDebounced } from "@/lib/use-debounced";

const FLAGS = (Object.keys(FLAG_LABEL) as Flag[]).map((value) => ({
  value,
  label: FLAG_LABEL[value],
}));

type Dialog =
  | { kind: "result"; order: DiagnosticOrder }
  | { kind: "correct"; order: DiagnosticOrder }
  | { kind: "cancel"; order: DiagnosticOrder }
  | null;

/**
 * Laboratory and imaging orders. Doctors order; technicians take the sample, record the result
 * and correct it; a doctor reviews a result before the patient can see it. Buttons follow the
 * user's role for convenience: the server decides.
 */
export function OrdersScreen() {
  const me = useMe();
  const toast = useToast();
  const [status, setStatus] = useState("open");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [ordering, setOrdering] = useState(false);
  const list = useOrders({
    status: status === "open" ? "ordered,collected" : status,
    kind,
    page,
    pageSize,
  });
  const collect = useCollect();
  const review = useReview();
  const canOrder = me.roles.includes("doctor");

  async function run(promise: Promise<unknown>, title: string, order: DiagnosticOrder) {
    try {
      await promise;
      toast({
        title,
        description: `${order.investigation_name}, ${order.patient_name}`,
        tone: "success",
      });
    } catch (failure) {
      toast({ title: "That did not work", description: refusalMessage(failure), tone: "error" });
    }
  }

  const columns: Column<DiagnosticOrder>[] = [
    {
      id: "patient",
      header: "Patient",
      cell: (o) => (
        <span className="flex items-center gap-3">
          <Avatar name={o.patient_name || "Patient"} />
          <span className="flex min-w-0 flex-col">
            <span className="text-ink-900 truncate font-semibold">{o.patient_name || "—"}</span>
            <span className="text-small text-ink-500 font-mono">{o.patient_mrn}</span>
          </span>
        </span>
      ),
    },
    {
      id: "test",
      header: "Test or scan",
      cell: (o) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-ink-900">{o.investigation_name}</span>
          <span className="text-small text-ink-600 truncate">
            {KIND_LABEL[o.kind] ?? o.kind} · {PRIORITY_LABEL[o.priority]} · {o.reason}
          </span>
        </span>
      ),
    },
    {
      id: "ordered",
      header: "Ordered",
      cell: (o) => (
        <span className="flex flex-col">
          <span className="text-ink-900 tnum whitespace-nowrap">
            {formatDateTime(o.created_at)}
          </span>
          <span className="text-small text-ink-500">{o.ordered_by_name}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (o) => <StatusPill status={DIAGNOSTIC_STATUS[o.status]} />,
    },
    {
      id: "result",
      header: "Result",
      cell: (o) => <ResultCell order={o} />,
    },
    {
      id: "act",
      header: "",
      className: "w-px",
      cell: (o) => {
        const can = orderActions(o, me.roles);
        return (
          <span className="flex flex-wrap justify-end gap-2">
            {can.collect && (
              <Button
                variant="outline"
                aria-label={`Mark the sample taken for ${o.patient_name}`}
                onClick={() => run(collect.mutateAsync(o.id), "Marked as taken", o)}
              >
                Sample taken
              </Button>
            )}
            {can.record && (
              <Button
                aria-label={`Enter the result for ${o.patient_name}`}
                onClick={() => setDialog({ kind: "result", order: o })}
              >
                Enter result
              </Button>
            )}
            {can.review && (
              <Button
                aria-label={`Review the result for ${o.patient_name}`}
                onClick={() => run(review.mutateAsync(o.current_result!.id), "Result reviewed", o)}
              >
                Review
              </Button>
            )}
            {can.correct && (
              <Button
                variant="outline"
                aria-label={`Correct the result for ${o.patient_name}`}
                onClick={() => setDialog({ kind: "correct", order: o })}
              >
                Correct
              </Button>
            )}
            {can.cancel && (
              <Button
                variant="ghost"
                aria-label={`Cancel the order for ${o.patient_name}`}
                onClick={() => setDialog({ kind: "cancel", order: o })}
              >
                Cancel
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  if (list.error instanceof ApiRequestError && list.error.status === 403) {
    return <NoAccess what="tests and scans" asPage />;
  }
  const total = list.data?.count ?? 0;
  const filters = (status !== "open" ? 1 : 0) + (kind !== "all" ? 1 : 0);

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Tests and scans</h1>
        {canOrder && (
          <Button icon={Plus} onClick={() => setOrdering(true)} className="ml-auto">
            Order a test or scan
          </Button>
        )}
      </header>
      <p className="text-body text-ink-600">
        Laboratory tests and imaging. A result reaches the patient only after a doctor has reviewed
        it.
      </p>
      <section
        aria-label="Orders"
        className="rounded-card border-line bg-surface shadow-card overflow-hidden border"
      >
        <div className="flex flex-wrap items-center gap-3 p-4">
          <Popover
            title="Filters"
            trigger={
              <Button variant="neutral" icon={SlidersHorizontal}>
                {filters > 0 ? `Filters (${filters})` : "Filters"}
              </Button>
            }
          >
            <div className="flex flex-col gap-4">
              <Select
                label="Status"
                value={status}
                onValueChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
                options={[
                  { value: "open", label: "Waiting for a result" },
                  { value: "resulted", label: "Resulted" },
                  { value: "cancelled", label: "Cancelled" },
                  { value: "all", label: "All" },
                ]}
              />
              <Select
                label="Kind"
                value={kind}
                onValueChange={(value) => {
                  setKind(value);
                  setPage(1);
                }}
                options={[
                  { value: "all", label: "Laboratory and imaging" },
                  { value: "lab", label: "Laboratory" },
                  { value: "imaging", label: "Imaging" },
                ]}
              />
            </div>
          </Popover>
        </div>
        <DataTable
          caption="Orders"
          columns={columns}
          rows={list.data?.results}
          rowId={(o) => o.id}
          refreshing={list.isPlaceholderData}
          error={list.isError}
          onRetry={() => list.refetch()}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size);
              setPage(1);
            },
          }}
          empty={<EmptyState title="No tests or scans match." />}
        />
      </section>
      <OrderDialog open={ordering} onClose={() => setOrdering(false)} />
      <ResultDialog
        key={`${dialog?.kind}-${dialog?.order.id}`}
        dialog={dialog?.kind === "result" || dialog?.kind === "correct" ? dialog : null}
        onClose={() => setDialog(null)}
      />
      <CancelDialog
        key={`cancel-${dialog?.order.id}`}
        order={dialog?.kind === "cancel" ? dialog.order : null}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

function ResultCell({ order }: { order: DiagnosticOrder }) {
  const result = order.current_result;
  if (order.status === "cancelled") {
    return <span className="text-small text-ink-600">{order.cancelled_reason}</span>;
  }
  if (!result) return <span className="text-small text-ink-500">Waiting</span>;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="text-ink-900">
        {result.value ? `${result.value} ${result.unit}`.trim() : "Report written"}
        {result.reference_range && (
          <span className="text-small text-ink-500"> (usual {result.reference_range})</span>
        )}
      </span>
      <span className="flex flex-wrap gap-1.5">
        <StatusPill status={RESULT_FLAG[result.flag]} />
        {!result.is_reviewed && (
          <span className="text-small text-ink-600">Waiting for a doctor to review</span>
        )}
        {result.version > 1 && <span className="text-small text-ink-600">Corrected</span>}
      </span>
    </span>
  );
}

function OrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <OrderForm key={String(open)} open={open} onClose={onClose} />;
}

function OrderForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const place = usePlaceOrder();
  const catalogue = useCatalogue();
  const [search, setSearch] = useState("");
  const [patient, setPatient] = useState<{ id: string; label: string } | null>(null);
  const [test, setTest] = useState("");
  const [priority, setPriority] = useState<Priority>("routine");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const matches = usePatientSearch(useDebounced(search.trim(), 250));
  const options = [
    ...(patient ? [{ value: patient.id, label: patient.label }] : []),
    ...(matches.data ?? [])
      .filter((p) => p.id !== patient?.id)
      .map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name} (${p.mrn})` })),
  ];
  const tests = (catalogue.data ?? []).filter((t) => t.active);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    setProblem(null);
    if (!patient || !test || reason.trim().length < 3) return;
    try {
      await place.mutateAsync({
        patient: patient.id,
        investigation: test,
        reason: reason.trim(),
        priority,
      });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: "Order placed", description: patient.label, tone: "success" });
    onClose();
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Order a test or scan"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form="order-test" loading={place.isPending}>
              Place order
            </Button>
          }
        />
      }
    >
      <form id="order-test" noValidate onSubmit={submit} className="flex flex-col gap-4">
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
          error={tried && !patient ? "Choose the patient." : undefined}
        />
        <Select
          label="Test or scan"
          value={test}
          onValueChange={setTest}
          placeholder="Choose"
          options={tests.map((t) => ({
            value: t.id,
            label: `${t.name} (${KIND_LABEL[t.kind] ?? t.kind})`,
          }))}
          error={tried && !test ? "Choose what to order." : undefined}
        />
        <Select
          label="How urgent"
          value={priority}
          onValueChange={(value) => setPriority(value as Priority)}
          options={(Object.keys(PRIORITY_LABEL) as Priority[]).map((value) => ({
            value,
            label: PRIORITY_LABEL[value],
          }))}
        />
        <Input
          label="Reason"
          value={reason}
          maxLength={300}
          error={tried && reason.trim().length < 3 ? "Say why it is needed." : undefined}
          onChange={(e) => setReason(e.target.value)}
        />
      </form>
    </Modal>
  );
}

function ResultDialog({
  dialog,
  onClose,
}: {
  dialog: { kind: "result" | "correct"; order: DiagnosticOrder } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const order = dialog?.order ?? null;
  const record = useRecordResult();
  const correct = useCorrectResult(order?.current_result?.id ?? "none");
  const correcting = dialog?.kind === "correct";
  const imaging = order?.kind === "imaging";
  const [value, setValue] = useState(correcting ? (order?.current_result?.value ?? "") : "");
  const [report, setReport] = useState(correcting ? (order?.current_result?.report ?? "") : "");
  const [flag, setFlag] = useState<Flag>(order?.current_result?.flag ?? "normal");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const missing = imaging ? report.trim().length < 10 : !value.trim();
  const noReason = correcting && reason.trim().length < 5;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    setProblem(null);
    if (!order || missing || noReason) return;
    try {
      if (correcting) {
        await correct.mutateAsync({
          reason: reason.trim(),
          value: value.trim(),
          report: report.trim(),
          flag,
        });
      } else {
        await record.mutateAsync({
          order: order.id,
          value: value.trim(),
          report: report.trim(),
          flag,
        });
      }
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({
      title: correcting ? "Result corrected" : "Result recorded",
      description: `${order.investigation_name}, ${order.patient_name}`,
      tone: "success",
    });
    onClose();
  }

  return (
    <Modal
      open={order !== null}
      onOpenChange={(open) => !open && onClose()}
      title={correcting ? "Correct this result" : "Enter the result"}
      description={order ? `${order.investigation_name} for ${order.patient_name}` : undefined}
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          }
          end={
            <Button
              type="submit"
              form="record-result"
              loading={record.isPending || correct.isPending}
            >
              {correcting ? "Save correction" : "Save result"}
            </Button>
          }
        />
      }
    >
      <form id="record-result" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        {correcting && (
          <Input
            label="What was wrong with the earlier result"
            value={reason}
            maxLength={300}
            error={tried && noReason ? "Say what was wrong." : undefined}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        {imaging ? (
          <Textarea
            label="Findings and impression"
            value={report}
            maxLength={5000}
            error={tried && missing ? "Write the findings and impression." : undefined}
            onChange={(e) => setReport(e.target.value)}
          />
        ) : (
          <Input
            label="Value"
            hint={
              order?.current_result?.reference_range
                ? `Usual range ${order.current_result.reference_range}`
                : undefined
            }
            value={value}
            maxLength={200}
            error={tried && missing ? "Enter the value." : undefined}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <Select
          label="How it reads"
          value={flag}
          onValueChange={(next) => setFlag(next as Flag)}
          options={FLAGS}
          hint="A critical result is sent to the doctor who ordered it straight away."
        />
      </form>
    </Modal>
  );
}

function CancelDialog({ order, onClose }: { order: DiagnosticOrder | null; onClose: () => void }) {
  const toast = useToast();
  const cancel = useCancelOrder(order?.id ?? "none");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    setProblem(null);
    if (reason.trim().length < 3) return;
    try {
      await cancel.mutateAsync(reason.trim());
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: "Order cancelled", description: order?.patient_name, tone: "success" });
    onClose();
  }

  return (
    <Modal
      open={order !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Cancel this order"
      description={order ? `${order.investigation_name} for ${order.patient_name}` : undefined}
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={onClose}>
              Keep it
            </Button>
          }
          end={
            <Button type="submit" form="cancel-order" loading={cancel.isPending}>
              Cancel order
            </Button>
          }
        />
      }
    >
      <form id="cancel-order" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Input
          label="Reason"
          hint="The charge is taken off the bill."
          value={reason}
          maxLength={300}
          error={tried && reason.trim().length < 3 ? "Say why it is cancelled." : undefined}
          onChange={(e) => setReason(e.target.value)}
        />
      </form>
    </Modal>
  );
}
