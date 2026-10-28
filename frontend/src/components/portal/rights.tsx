"use client";

import { DownloadSimple } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { formatDay } from "@/lib/format";
import {
  downloadMyInformation,
  type PortalRequest,
  REQUEST_KINDS,
  type RequestKind,
  refusalMessage,
  useRequests,
  useSubmitRequest,
} from "@/lib/portal";

import { PortalButton, PortalCard, PortalHeading, QueryState } from "./shared";

const STATUS_WORDS: Record<PortalRequest["status"], string> = {
  open: "We are working on it",
  completed: "Answered",
  refused: "Answered: we could not do this",
};

/** Your rights: what to ask for, the requests so far and their answers, and a download. */
export function PortalRights() {
  const requests = useRequests();
  return (
    <>
      <PortalHeading
        title="Your rights"
        lead="See, correct or ask us to delete your information. We answer every request."
      />
      <div className="flex flex-col gap-4">
        <Download />
        <NewRequest />
        <QueryState
          query={requests}
          what="requests"
          empty="You have not made any requests."
          isEmpty={(rows) => rows.length === 0}
        >
          {(rows) => (
            <PortalCard title="Your requests">
              <ul className="flex flex-col gap-4">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="border-line flex flex-col gap-1 border-t pt-3 first:border-t-0 first:pt-0"
                  >
                    <p className="text-body text-ink-900 font-semibold">{r.kind_label}</p>
                    <p className="text-small text-ink-600">
                      Asked {formatDay(r.created_at)} · {STATUS_WORDS[r.status]}
                      {r.status === "open" ? ` · we will answer by ${formatDay(r.due_on)}` : ""}
                    </p>
                    {r.details && <p className="text-body text-ink-900">{r.details}</p>}
                    {r.response_note && (
                      <p className="text-body text-ink-900">
                        <span className="font-semibold">Our answer: </span>
                        {r.response_note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </PortalCard>
          )}
        </QueryState>
      </div>
    </>
  );
}

function Download() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <PortalCard title="Download my information">
      <p className="text-body text-ink-900">
        Save what this portal shows about you (your details, visits, medicines, bills and requests)
        as a file. For a full copy of your medical record, make a request below.
      </p>
      <div>
        <PortalButton
          variant="outline"
          icon={DownloadSimple}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await downloadMyInformation();
              toast({
                title: "Saved to your device",
                description: "my-information.json",
                tone: "success",
              });
            } catch {
              toast({ title: "Your information could not be downloaded", tone: "error" });
            } finally {
              setBusy(false);
            }
          }}
        >
          Download my information
        </PortalButton>
      </div>
    </PortalCard>
  );
}

function NewRequest() {
  const toast = useToast();
  const submit = useSubmitRequest();
  const [kind, setKind] = useState<RequestKind>("access");
  const [details, setDetails] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const chosen = REQUEST_KINDS.find((k) => k.value === kind)!;
  const missing = chosen.needsDetails && details.trim().length < 5;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    setProblem(null);
    if (missing) return;
    try {
      await submit.mutateAsync({ kind, details: details.trim() });
    } catch (failure) {
      return setProblem(refusalMessage(failure));
    }
    toast({
      title: "Request sent",
      description: "We will email you to confirm it.",
      tone: "success",
    });
    setDetails("");
    setTried(false);
  }

  return (
    <PortalCard title="Make a request">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {problem && <Banner tone="danger" live title={problem} />}
        <Select
          label="What would you like?"
          value={kind}
          onValueChange={(value) => setKind(value as RequestKind)}
          options={REQUEST_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          hint={chosen.help}
        />
        <Input
          label="Tell us more"
          optional={!chosen.needsDetails}
          maxLength={1000}
          value={details}
          error={tried && missing ? "Tell us what you would like changed, and why." : undefined}
          onChange={(e) => setDetails(e.target.value)}
        />
        <div>
          <PortalButton type="submit" loading={submit.isPending}>
            Send request
          </PortalButton>
        </div>
      </form>
    </PortalCard>
  );
}
