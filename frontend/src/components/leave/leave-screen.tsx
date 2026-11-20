"use client";

import { CalendarPlus } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import {
  canCancel,
  checkLeaveDates,
  LEAVE_TYPES,
  type Leave,
  leaveRange,
  leaveTypeLabel,
  type LeaveType,
  refusalMessage,
  useCancelLeave,
  useDecideLeave,
  useLeave,
  useRequestLeave,
} from "@/lib/leave";
import { usePermissions } from "@/lib/permissions";
import { LEAVE_STATUS } from "@/lib/status-map";

const today = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const FILTERS = [
  { value: "all", label: "All requests" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * Time off. Everyone sees and manages their own requests; HR and the tenant admin see everyone's
 * and HR approves or rejects (rejecting needs a reason). Nobody decides their own request.
 */
export function LeaveScreen() {
  const permissions = usePermissions();
  const isHr = permissions.hasRole("hr");
  const seesAll = permissions.hasRole("hr", "tenant_admin");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const list = useLeave({ status, page });
  const [asking, setAsking] = useState(false);
  const [rejecting, setRejecting] = useState<Leave | null>(null);
  const toast = useToast();
  const decide = useDecideLeave();
  const cancel = useCancelLeave();

  if (list.error instanceof ApiRequestError && list.error.status === 403) {
    return <NoAccess what="leave" asPage />;
  }

  async function run(action: Promise<unknown>, done: string) {
    try {
      await action;
      toast({ title: done, tone: "success" });
    } catch (failure) {
      toast({ title: refusalMessage(failure), tone: "error" });
    }
  }

  const columns: Column<Leave>[] = [
    ...(seesAll
      ? [
          {
            id: "who",
            header: "Staff member",
            cell: (row: Leave) => (
              <span className="text-ink-900 font-semibold">{row.staff_name}</span>
            ),
          },
        ]
      : []),
    {
      id: "type",
      header: "Leave",
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-ink-900 font-semibold">{leaveTypeLabel(row.leave_type)}</span>
          <span className="text-small text-ink-500">{leaveRange(row)}</span>
        </span>
      ),
    },
    {
      id: "note",
      header: "Note",
      className: "hidden md:table-cell",
      cell: (row) => <span className="text-ink-600">{row.decision_note || row.note || "—"}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusPill status={LEAVE_STATUS[row.status]} />,
    },
    {
      id: "actions",
      header: "",
      cell: (row) => (
        <span className="flex justify-end gap-2">
          {isHr && row.status === "pending" && (
            <>
              <Button
                variant="outline"
                aria-label={`Approve ${row.staff_name}'s leave`}
                onClick={() =>
                  run(decide.mutateAsync({ id: row.id, approve: true, note: "" }), "Leave approved")
                }
              >
                Approve
              </Button>
              <Button
                variant="ghost"
                aria-label={`Reject ${row.staff_name}'s leave`}
                onClick={() => setRejecting(row)}
              >
                Reject
              </Button>
            </>
          )}
          {canCancel(row, today()) && (
            <Button
              variant="ghost"
              aria-label={`Cancel ${leaveTypeLabel(row.leave_type)} starting ${row.start_date}`}
              onClick={() => run(cancel.mutateAsync(row.id), "Leave cancelled")}
            >
              Cancel
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Leave</h1>
        <div className="ml-auto flex items-center gap-3">
          <Select
            label="Show"
            hideLabel
            options={FILTERS}
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
          <Button icon={CalendarPlus} onClick={() => setAsking(true)}>
            Request leave
          </Button>
        </div>
      </header>
      <section
        aria-label="Leave requests"
        className="rounded-card border-line bg-surface shadow-card overflow-hidden border"
      >
        <DataTable
          caption="Leave requests"
          columns={columns}
          rows={list.data?.results}
          rowId={(row) => row.id}
          refreshing={list.isPlaceholderData}
          error={list.isError}
          onRetry={() => list.refetch()}
          pagination={{
            page,
            pageSize: 25,
            total: list.data?.count ?? 0,
            onPageChange: setPage,
            onPageSizeChange: () => undefined,
          }}
          empty={<EmptyState title="No leave requests." />}
        />
      </section>
      <RequestDialog open={asking} onOpenChange={setAsking} />
      <RejectDialog leave={rejecting} onOpenChange={(open) => !open && setRejecting(null)} />
    </>
  );
}

function RequestDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Request leave"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form="leave-form">
              Send request
            </Button>
          }
        />
      }
    >
      {open && <RequestForm onDone={() => onOpenChange(false)} />}
    </Modal>
  );
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const request = useRequestLeave();
  const [type, setType] = useState<LeaveType>("annual");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const wrong = checkLeaveDates(start, end, today());
    setError(wrong);
    if (wrong) return;
    try {
      await request.mutateAsync({
        leave_type: type,
        start_date: start,
        end_date: end,
        note: note.trim(),
      });
      toast({
        title: "Leave requested",
        description: "HR has been asked to decide.",
        tone: "success",
      });
      onDone();
    } catch (failure) {
      setProblem(refusalMessage(failure));
    }
  }

  return (
    <form id="leave-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
      {problem && <Banner tone="danger" live title={problem} />}
      <Select
        label="Type of leave"
        options={LEAVE_TYPES}
        value={type}
        onValueChange={(value) => setType(value as LeaveType)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="First day"
          type="date"
          value={start}
          error={error ?? undefined}
          onChange={(e) => setStart(e.target.value)}
        />
        <Input label="Last day" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <Textarea
        label="Note"
        optional
        value={note}
        maxLength={300}
        onChange={(e) => setNote(e.target.value)}
      />
    </form>
  );
}

function RejectDialog({
  leave,
  onOpenChange,
}: {
  leave: Leave | null;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const decide = useDecideLeave();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!leave) return;
    if (!note.trim()) return setError("Say why the request is being rejected.");
    try {
      await decide.mutateAsync({ id: leave.id, approve: false, note: note.trim() });
      toast({ title: "Leave rejected", tone: "success" });
      setNote("");
      onOpenChange(false);
    } catch (failure) {
      setError(refusalMessage(failure));
    }
  }

  return (
    <Modal
      open={leave !== null}
      onOpenChange={onOpenChange}
      title="Reject leave"
      description={leave ? `${leave.staff_name}: ${leaveRange(leave)}` : undefined}
      size="confirm"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form="reject-form">
              Reject request
            </Button>
          }
        />
      }
    >
      <form id="reject-form" noValidate onSubmit={submit}>
        <Textarea
          label="Reason"
          value={note}
          maxLength={300}
          error={error ?? undefined}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
        />
      </form>
    </Modal>
  );
}
