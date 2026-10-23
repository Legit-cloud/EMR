"use client";

import { SlidersHorizontal } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  type Claim,
  claimAction,
  refusalMessage,
  useAgeing,
  useApproveClaim,
  useClaims,
  useRejectClaim,
  useSettleClaim,
  useSubmitClaim,
} from "@/lib/claims";
import { formatDay } from "@/lib/format";
import { formatMoney, toMajorText, toMinor } from "@/lib/money";
import { useMe } from "@/lib/session";
import { CLAIM_STATUS } from "@/lib/status-map";

type Step = { kind: "send" | "answer" | "pay" | "resend"; claim: Claim };

const BUTTON: Record<Step["kind"], string> = {
  send: "Send to insurer",
  answer: "Record the answer",
  pay: "Record a payment",
  resend: "Send again",
};

/**
 * Claims to insurers and HMOs. A billing officer makes a claim from an invoice, sends it, records
 * the insurer's answer (approved in full or in part, or rejected with a reason) and the money as it
 * arrives. Finance and the administrator can look. Money received is recorded on the invoice.
 */
export function ClaimsScreen() {
  const me = useMe();
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [step, setStep] = useState<Step | null>(null);
  const list = useClaims({
    status: status === "open" ? "draft,submitted,approved,rejected" : status,
    page,
    pageSize,
  });
  const ageing = useAgeing();
  const canWork = me.roles.includes("billing_officer");
  const filters = status !== "open" ? 1 : 0;

  const columns: Column<Claim>[] = [
    {
      id: "patient",
      header: "Patient",
      cell: (c) => (
        <span className="flex items-center gap-3">
          <Avatar name={c.patient_name || "Patient"} />
          <span className="flex min-w-0 flex-col">
            <span className="text-ink-900 truncate font-semibold">{c.patient_name || "—"}</span>
            <span className="text-small text-ink-500">
              {c.reference} · {c.invoice_reference}
            </span>
          </span>
        </span>
      ),
    },
    {
      id: "insurer",
      header: "Insurer",
      cell: (c) => (
        <span className="flex flex-col">
          <span className="text-ink-900">{c.insurer_name}</span>
          {c.insurer_reference && (
            <span className="text-small text-ink-500">Their number {c.insurer_reference}</span>
          )}
        </span>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      cell: (c) => (
        <span className="flex flex-col">
          <span className="text-ink-900 tnum">
            Claimed {formatMoney(c.claimed_minor, c.currency)}
          </span>
          {c.approved_minor !== null && (
            <span className="text-small text-ink-600 tnum">
              Approved {formatMoney(c.approved_minor, c.currency)} · received{" "}
              {formatMoney(c.received_minor, c.currency)}
            </span>
          )}
        </span>
      ),
    },
    {
      id: "sent",
      header: "Sent",
      cell: (c) => (
        <span className="text-ink-900 tnum whitespace-nowrap">
          {c.submitted_at ? formatDay(c.submitted_at) : "Not sent"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (c) => (
        <span className="flex min-w-0 flex-col gap-1">
          <span>
            <StatusPill status={CLAIM_STATUS[c.status]} />
          </span>
          {c.status === "rejected" && c.decision_note && (
            <span className="text-small text-ink-600">{c.decision_note}</span>
          )}
        </span>
      ),
    },
    {
      id: "act",
      header: "",
      className: "w-px",
      cell: (c) => {
        const kind = claimAction(c);
        return canWork && kind ? (
          <Button
            variant="outline"
            aria-label={`${BUTTON[kind]}: ${c.patient_name}`}
            onClick={() => setStep({ kind, claim: c })}
          >
            {BUTTON[kind]}
          </Button>
        ) : null;
      },
    },
  ];

  if (list.error instanceof ApiRequestError && list.error.status === 403) {
    return <NoAccess what="insurer claims" asPage />;
  }
  const total = list.data?.count ?? 0;

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Insurer claims</h1>
      </header>
      <p className="text-body text-ink-600">
        What each insurer or HMO has been asked to pay for its patients. Make a claim from an
        invoice that has an insurer.
      </p>
      {ageing.data && (
        <section
          aria-label="What insurers owe"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {ageing.data.map((band) => (
            <Card key={band.band} title={`${band.band} days`}>
              <p className="text-kpi-sm text-ink-900 tnum">
                {formatMoney(band.outstanding_minor, "NGN")}
              </p>
              <p className="text-small text-ink-600">
                {band.claims} {band.claims === 1 ? "claim" : "claims"}
              </p>
            </Card>
          ))}
        </section>
      )}
      <section
        aria-label="Claims"
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
            <Select
              label="Status"
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={[
                { value: "open", label: "Not yet paid" },
                { value: "draft", label: "Draft" },
                { value: "submitted", label: "Sent" },
                { value: "approved", label: "Approved" },
                { value: "rejected", label: "Rejected" },
                { value: "paid", label: "Paid" },
                { value: "all", label: "All" },
              ]}
            />
          </Popover>
        </div>
        <DataTable
          caption="Claims"
          columns={columns}
          rows={list.data?.results}
          rowId={(c) => c.id}
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
          empty={<EmptyState title="No claims match." />}
        />
      </section>
      <SendDialog
        key={`send-${step?.claim.id}`}
        claim={step?.kind === "send" || step?.kind === "resend" ? step.claim : null}
        again={step?.kind === "resend"}
        onClose={() => setStep(null)}
      />
      <AnswerDialog
        key={`answer-${step?.claim.id}`}
        claim={step?.kind === "answer" ? step.claim : null}
        onClose={() => setStep(null)}
      />
      <PayDialog
        key={`pay-${step?.claim.id}`}
        claim={step?.kind === "pay" ? step.claim : null}
        onClose={() => setStep(null)}
      />
    </>
  );
}

function SendDialog({
  claim,
  again,
  onClose,
}: {
  claim: Claim | null;
  again: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const send = useSubmitClaim(claim?.id ?? "none");
  const [number, setNumber] = useState(claim?.insurer_reference ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    try {
      await send.mutateAsync(number.trim());
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({
      title: again ? "Sent again" : "Claim sent",
      description: claim?.reference,
      tone: "success",
    });
    onClose();
  }

  return (
    <Modal
      open={claim !== null}
      onOpenChange={(open) => !open && onClose()}
      title={again ? "Send this claim again" : "Send this claim"}
      description={claim ? `${claim.patient_name} · ${claim.insurer_name}` : undefined}
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form="send-claim" loading={send.isPending}>
              {again ? "Send again" : "Send"}
            </Button>
          }
        />
      }
    >
      <form id="send-claim" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        {claim && (
          <p className="text-body text-ink-900">
            {again ? "It will claim what the insurer still owes on the invoice: " : "Claiming "}
            <span className="font-semibold">
              {formatMoney(claim.claimed_minor, claim.currency)}
            </span>
            {again ? "." : " from the insurer."}
          </p>
        )}
        {claim?.status === "rejected" && claim.decision_note && (
          <Banner tone="warning" title="Why it was rejected">
            {claim.decision_note}
          </Banner>
        )}
        <Input
          label="Insurer's claim number"
          optional
          hint="If they have given you one."
          value={number}
          maxLength={64}
          onChange={(e) => setNumber(e.target.value)}
        />
      </form>
    </Modal>
  );
}

function AnswerDialog({ claim, onClose }: { claim: Claim | null; onClose: () => void }) {
  const toast = useToast();
  const approve = useApproveClaim(claim?.id ?? "none");
  const reject = useRejectClaim(claim?.id ?? "none");
  const [outcome, setOutcome] = useState<"approved" | "rejected">("approved");
  const [amount, setAmount] = useState(claim ? toMajorText(claim.claimed_minor) : "");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const minor = toMinor(amount);
  const partial = claim !== null && minor !== null && minor < claim.claimed_minor;
  const badAmount = outcome === "approved" && (minor === null || minor < 1);
  const badNote =
    outcome === "rejected" ? note.trim().length < 10 : partial && note.trim().length < 5;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    setProblem(null);
    if (!claim || badAmount || badNote) return;
    try {
      if (outcome === "approved") {
        await approve.mutateAsync({ approved_minor: minor!, note: note.trim() });
      } else {
        await reject.mutateAsync(note.trim());
      }
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({ title: "Answer recorded", description: claim.reference, tone: "success" });
    onClose();
  }

  return (
    <Modal
      open={claim !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Record the insurer's answer"
      description={claim ? `${claim.patient_name} · ${claim.insurer_name}` : undefined}
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
              form="answer-claim"
              loading={approve.isPending || reject.isPending}
            >
              Save answer
            </Button>
          }
        />
      }
    >
      <form id="answer-claim" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Select
          label="What the insurer decided"
          value={outcome}
          onValueChange={(value) => setOutcome(value as "approved" | "rejected")}
          options={[
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
          ]}
        />
        {outcome === "approved" && (
          <Input
            label="Amount approved (naira)"
            inputMode="decimal"
            hint={claim ? `Claimed ${formatMoney(claim.claimed_minor, claim.currency)}` : undefined}
            value={amount}
            error={
              tried && badAmount ? "Enter the amount approved, for example 8000.00." : undefined
            }
            onChange={(e) => setAmount(e.target.value)}
          />
        )}
        <Input
          label={outcome === "rejected" ? "Reason they gave" : "Note"}
          optional={outcome === "approved" && !partial}
          value={note}
          maxLength={500}
          error={
            tried && badNote
              ? outcome === "rejected"
                ? "Write the reason the insurer gave."
                : "Say why they approved less."
              : undefined
          }
          onChange={(e) => setNote(e.target.value)}
        />
      </form>
    </Modal>
  );
}

function PayDialog({ claim, onClose }: { claim: Claim | null; onClose: () => void }) {
  const toast = useToast();
  const settle = useSettleClaim(claim?.id ?? "none");
  const [amount, setAmount] = useState(claim ? toMajorText(claim.outstanding_minor) : "");
  const [reference, setReference] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const minor = toMinor(amount);
  const badAmount = minor === null || minor < 1;
  const noReference = !reference.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    setProblem(null);
    if (!claim || badAmount || noReference) return;
    try {
      await settle.mutateAsync({ amount_minor: minor!, reference: reference.trim() });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({
      title: "Payment recorded",
      description: `${formatMoney(minor!, claim.currency)} from ${claim.insurer_name}`,
      tone: "success",
    });
    onClose();
  }

  return (
    <Modal
      open={claim !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Record a payment from the insurer"
      description={claim ? `${claim.patient_name} · ${claim.insurer_name}` : undefined}
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form="pay-claim" loading={settle.isPending}>
              Record payment
            </Button>
          }
        />
      }
    >
      <form id="pay-claim" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Input
          label="Amount received (naira)"
          inputMode="decimal"
          hint={
            claim ? `Still owed ${formatMoney(claim.outstanding_minor, claim.currency)}` : undefined
          }
          value={amount}
          error={tried && badAmount ? "Enter the amount received." : undefined}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          label="Insurer's payment reference"
          hint="Entering the same reference again will not record it twice."
          value={reference}
          maxLength={64}
          error={tried && noReference ? "Enter the payment reference." : undefined}
          onChange={(e) => setReference(e.target.value)}
        />
      </form>
    </Modal>
  );
}
