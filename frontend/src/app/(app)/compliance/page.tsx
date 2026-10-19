"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import {
  Button,
  Dialog,
  Loading,
  NoAccess,
  Notice,
  Select,
  TextArea,
} from "@/components/legacy-ui";
import { api, apiError, type Schemas } from "@/lib/api";
import { formatDateTime, humanise } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";

type Grant = Schemas["BreakGlassGrant"];

/**
 * Break-glass review: every time a clinician opened a record outside their normal scope,
 * the compliance role records whether it was appropriate.
 */
export default function CompliancePage() {
  // Tenant admins see the queue for oversight; only the compliance role records reviews.
  const canReview = usePermissions().hasRole("compliance_officer");
  const [status, setStatus] = useState<"pending" | "appropriate" | "inappropriate">("pending");
  const [grants, setGrants] = useState<Grant[] | "forbidden" | null>(null);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<Grant | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setGrants(null);
    const { data, response } = await api.GET("/api/accounts/break-glass/grants/");
    if (response.status === 403) return setGrants("forbidden");
    setGrants((data?.results ?? []).filter((g) => g.review_status === status));
  }

  useEffect(() => {
    load();
  }, [status]);

  useEffect(() => {
    // Names are a convenience: compliance may not have user directory access.
    api
      .GET("/api/accounts/users/")
      .then(({ data }) =>
        setUsers(
          Object.fromEntries(
            (data?.results ?? []).map((u) => [
              u.id,
              [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username,
            ]),
          ),
        ),
      );
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Break-glass review</h1>
        <Link href="/compliance/audit" className="text-teal-800 underline">
          Audit log
        </Link>
      </div>
      <div className="max-w-xs">
        <Select
          label="Show"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="pending">Waiting for review</option>
          <option value="appropriate">Reviewed: appropriate</option>
          <option value="inappropriate">Reviewed: inappropriate</option>
        </Select>
      </div>
      <div aria-live="polite">{message && <Notice tone="success" title={message} />}</div>
      {grants === null ? (
        <Loading />
      ) : grants === "forbidden" ? (
        <NoAccess />
      ) : grants.length === 0 ? (
        <p className="text-slate-600">Nothing here.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {grants.map((g) => (
            <li
              key={g.id}
              data-testid="grant"
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <p className="font-medium">
                {users[g.user] ?? "A clinician"} opened a{" "}
                {humanise(g.resource.split(".").pop() ?? "record")} record
              </p>
              <p className="text-sm text-slate-700">“{g.reason}”</p>
              <p className="text-sm text-slate-600">
                {formatDateTime(g.created_at)} · record {g.object_id.slice(0, 8)} · access until{" "}
                {formatDateTime(g.expires_at)}
              </p>
              {g.review_status === "pending" ? (
                canReview ? (
                  <Button className="mt-2" onClick={() => setReviewing(g)}>
                    Review
                  </Button>
                ) : (
                  <p className="mt-1 text-sm">Awaiting review</p>
                )
              ) : (
                <p className="mt-1 text-sm">
                  {humanise(g.review_status)}{" "}
                  {g.reviewed_at ? `on ${formatDateTime(g.reviewed_at)}` : ""}
                  {g.review_note ? `: ${g.review_note}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <ReviewDialog
        grant={reviewing}
        onClose={() => setReviewing(null)}
        onDone={(outcome) => {
          setReviewing(null);
          setMessage(`Recorded as ${outcome}.`);
          load();
        }}
      />
    </div>
  );
}

function ReviewDialog({
  grant,
  onClose,
  onDone,
}: {
  grant: Grant | null;
  onClose: () => void;
  onDone: (outcome: string) => void;
}) {
  const [outcome, setOutcome] = useState<"appropriate" | "inappropriate">("appropriate");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOutcome("appropriate");
    setNote("");
    setError(null);
  }, [grant]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!grant) return;
    const { error: failure } = await api.POST("/api/accounts/break-glass/grants/{id}/review/", {
      params: { path: { id: grant.id } },
      body: { outcome, note },
    });
    if (failure) return setError(apiError(failure).message);
    onDone(outcome);
  }

  return (
    <Dialog open={grant !== null} title="Review break-glass access" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {error && <Notice tone="error" title={error} />}
        <p className="text-sm text-slate-700">Reason given: “{grant?.reason}”</p>
        <Select
          label="Outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as typeof outcome)}
        >
          <option value="appropriate">Appropriate</option>
          <option value="inappropriate">Inappropriate</option>
        </Select>
        <TextArea
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          hint="For example what you checked, or the follow-up agreed."
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Record review</Button>
        </div>
      </form>
    </Dialog>
  );
}
