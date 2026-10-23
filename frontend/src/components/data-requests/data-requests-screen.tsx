"use client";

import { CheckCircle, Clock, Prohibit, SlidersHorizontal } from "@phosphor-icons/react";
import { type FormEvent, useMemo, useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Popover } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import {
  dueText,
  refusalMessage,
  type StaffRequest,
  useDataRequests,
  useRespond,
} from "@/lib/data-requests";
import { formatDay } from "@/lib/format";
import { type StatusSpec } from "@/lib/status-map";

const STATUS: Record<StaffRequest["status"], StatusSpec> = {
  open: { label: "Open", tone: "amber", icon: Clock },
  completed: { label: "Answered", tone: "green", icon: CheckCircle },
  refused: { label: "Refused", tone: "grey", icon: Prohibit },
};
const LATE: StatusSpec = { label: "Overdue", tone: "pink", icon: Clock };

/**
 * Patients' data-protection requests (access, correction, deletion and so on). Each has a date it
 * must be answered by; the late ones are marked and listed first. Answering a request needs a
 * written reason, and a refusal is recorded as one.
 */
export function DataRequestsScreen() {
  const [status, setStatus] = useState("open");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [answering, setAnswering] = useState<StaffRequest | null>(null);
  const list = useDataRequests({ status, overdueOnly, page, pageSize });
  const filters = (status !== "open" ? 1 : 0) + (overdueOnly ? 1 : 0);

  const columns: Column<StaffRequest>[] = useMemo(
    () => [
      {
        id: "patient",
        header: "Patient",
        cell: (r) => (
          <span className="flex items-center gap-3">
            <Avatar name={r.patient_name || "Patient"} />
            <span className="flex min-w-0 flex-col">
              <span className="text-ink-900 truncate font-semibold">{r.patient_name || "—"}</span>
              <span className="text-small text-ink-500 font-mono">{r.patient_mrn}</span>
            </span>
          </span>
        ),
      },
      {
        id: "request",
        header: "Request",
        cell: (r) => (
          <span className="flex min-w-0 flex-col">
            <span className="text-ink-900">{r.kind_label}</span>
            {r.details && <span className="text-small text-ink-600 truncate">{r.details}</span>}
          </span>
        ),
      },
      {
        id: "due",
        header: "Answer by",
        cell: (r) => (
          <span className="flex flex-col">
            <span className="text-ink-900 tnum whitespace-nowrap">{formatDay(r.due_on)}</span>
            {r.status === "open" && (
              <span className="text-small text-ink-500 whitespace-nowrap">{dueText(r.due_on)}</span>
            )}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: (r) => (
          <span className="flex flex-wrap gap-1.5">
            <StatusPill status={STATUS[r.status]} />
            {r.overdue && <StatusPill status={LATE} />}
          </span>
        ),
      },
      {
        id: "act",
        header: "",
        className: "w-28",
        cell: (r) =>
          r.status === "open" ? (
            <Button
              variant="outline"
              aria-label={`Answer the request from ${r.patient_name}`}
              onClick={() => setAnswering(r)}
            >
              Answer
            </Button>
          ) : null,
      },
    ],
    [],
  );

  if (list.error instanceof ApiRequestError && list.error.status === 403) {
    return <NoAccess what="data requests" asPage />;
  }
  const total = list.data?.count ?? 0;

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Data requests</h1>
        {list.data && (
          <span className="text-small text-ink-600 bg-pill-grey tnum rounded-pill px-2.5 py-0.5 font-semibold">
            {total} {total === 1 ? "request" : "requests"}
          </span>
        )}
      </header>
      <p className="text-body text-ink-600">
        Patients asking to see, correct or delete their information. Each has a date by which we
        must answer.
      </p>
      <section
        aria-label="Requests"
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
                  { value: "open", label: "Open" },
                  { value: "completed", label: "Answered" },
                  { value: "refused", label: "Refused" },
                  { value: "all", label: "All" },
                ]}
              />
              <label className="text-body text-ink-900 flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={overdueOnly}
                  onChange={(e) => {
                    setOverdueOnly(e.target.checked);
                    setPage(1);
                  }}
                  className="size-4 accent-blue-600"
                />
                Only overdue requests
              </label>
            </div>
          </Popover>
        </div>
        <DataTable
          caption="Requests"
          columns={columns}
          rows={list.data?.results}
          rowId={(r) => r.id}
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
          empty={<EmptyState title="No requests match." />}
        />
      </section>
      <AnswerDialog request={answering} onClose={() => setAnswering(null)} />
    </>
  );
}

function AnswerDialog({ request, onClose }: { request: StaffRequest | null; onClose: () => void }) {
  // A fresh form for each request.
  return <AnswerForm key={request?.id ?? "none"} request={request} onClose={onClose} />;
}

function AnswerForm({ request, onClose }: { request: StaffRequest | null; onClose: () => void }) {
  const toast = useToast();
  const respond = useRespond(request?.id ?? "none");
  const [outcome, setOutcome] = useState<"completed" | "refused">("completed");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const short = note.trim().length < 10;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    setProblem(null);
    if (short) return;
    try {
      await respond.mutateAsync({ status: outcome, note: note.trim() });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: "Request answered", description: request?.patient_name, tone: "success" });
    onClose();
  }

  return (
    <Modal
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Answer this request"
      description={request ? `${request.patient_name}: ${request.kind_label}` : undefined}
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form="answer-request" loading={respond.isPending}>
              Send answer
            </Button>
          }
        />
      }
    >
      <form id="answer-request" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        {request?.details && (
          <p className="text-body text-ink-900">
            <span className="font-semibold">They wrote: </span>
            {request.details}
          </p>
        )}
        <Select
          label="Outcome"
          value={outcome}
          onValueChange={(value) => setOutcome(value as "completed" | "refused")}
          options={[
            { value: "completed", label: "Done" },
            { value: "refused", label: "Refused, with a reason" },
          ]}
        />
        <Input
          label={outcome === "refused" ? "Reason for refusing" : "What was done"}
          hint="The patient reads this in the portal. Do not include other people's information."
          maxLength={1000}
          value={note}
          error={tried && short ? "Write at least a sentence." : undefined}
          onChange={(e) => setNote(e.target.value)}
        />
      </form>
    </Modal>
  );
}
