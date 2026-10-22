"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  Button,
  Dialog,
  Loading,
  LoadFailed,
  NoAccess,
  Notice,
  TextArea,
} from "@/components/legacy-ui";
import { PatientName } from "@/components/PatientName";
import { api, apiError, type Schemas } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";

type Review = Schemas["DuplicateReview"];
type Candidate = { patient_id: string; mrn: string; score: number };
type Payload = {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string;
  phone?: string;
  national_id?: string;
};

/**
 * Registrations held as possible duplicates. A person decides: it is a new patient, it is
 * an existing patient, or the registration is rejected.
 */
export default function RegistrationReviewsPage() {
  // Tenant admins see held registrations for oversight; desk staff and doctors decide.
  const canDecide = usePermissions().hasRole("front_desk", "doctor");
  const [reviews, setReviews] = useState<Review[] | "forbidden" | "error" | null>(null);
  const [deciding, setDeciding] = useState<Review | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, response } = await api.GET("/api/patients/duplicate-reviews/", {
      params: { query: { status: "pending" } },
    });
    setReviews(
      response.status === 403 ? "forbidden" : response.ok ? (data?.results ?? []) : "error",
    );
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Registrations to review</h1>
      <div aria-live="polite">{message && <Notice tone="success" title={message} />}</div>
      {reviews === null ? (
        <Loading />
      ) : reviews === "forbidden" ? (
        <NoAccess />
      ) : reviews === "error" ? (
        <LoadFailed what="The registrations" onRetry={load} />
      ) : reviews.length === 0 ? (
        <p className="text-slate-600">No registrations are waiting for review.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => {
            const p = review.payload as Payload;
            return (
              <li
                key={review.id}
                data-testid="review"
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <p className="font-medium">
                  {p.first_name} {p.last_name}, born {formatDate(p.date_of_birth)}
                </p>
                <p className="text-sm text-slate-600">
                  Held {formatDateTime(review.created_at)} · best match{" "}
                  {Math.round(review.top_score * 100)}%
                </p>
                {canDecide && (
                  <Button className="mt-2" onClick={() => setDeciding(review)}>
                    Review
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <DecisionDialog
        review={deciding}
        onClose={() => setDeciding(null)}
        onDecided={(text) => {
          setDeciding(null);
          setMessage(text);
          load();
        }}
      />
    </div>
  );
}

function DecisionDialog({
  review,
  onClose,
  onDecided,
}: {
  review: Review | null;
  onClose: () => void;
  onDecided: (message: string) => void;
}) {
  const [decision, setDecision] = useState<"created_new" | "duplicate" | "rejected" | "">("");
  const [matched, setMatched] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDecision("");
    setMatched("");
    setNote("");
    setError(null);
  }, [review]);

  if (!review)
    return (
      <Dialog open={false} title="" onClose={onClose}>
        {null}
      </Dialog>
    );
  const p = review.payload as Payload;
  const candidates = review.candidates as Candidate[];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!review || !decision) return;
    const { error: failure } = await api.POST("/api/patients/duplicate-reviews/{id}/resolve/", {
      params: { path: { id: review.id } },
      body: { decision, matched_patient: decision === "duplicate" ? matched : null, note },
    });
    if (failure) return setError(apiError(failure).message);
    onDecided(
      decision === "created_new"
        ? "Registered as a new patient."
        : decision === "duplicate"
          ? "Linked to the existing patient; nothing new was created."
          : "Registration rejected.",
    );
  }

  return (
    <Dialog open title={`Review ${p.first_name} ${p.last_name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice tone="error" title={error} />}
        <dl className="grid grid-cols-2 gap-1 text-sm">
          <dt className="font-medium">Date of birth</dt>
          <dd>{formatDate(p.date_of_birth)}</dd>
          <dt className="font-medium">Phone</dt>
          <dd>{p.phone || "—"}</dd>
          <dt className="font-medium">National ID</dt>
          <dd>{p.national_id || "—"}</dd>
        </dl>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">Decision</legend>
          {candidates.map((c) => (
            <label
              key={c.patient_id}
              className="flex min-h-11 items-center gap-2 rounded px-2 hover:bg-slate-50"
            >
              <input
                type="radio"
                name="decision"
                checked={decision === "duplicate" && matched === c.patient_id}
                onChange={() => {
                  setDecision("duplicate");
                  setMatched(c.patient_id);
                }}
              />
              <span>
                Same person as <PatientName id={c.patient_id} link={false} /> (
                {Math.round(c.score * 100)}% match)
              </span>
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-2 rounded px-2 hover:bg-slate-50">
            <input
              type="radio"
              name="decision"
              checked={decision === "created_new"}
              onChange={() => setDecision("created_new")}
            />
            A different person: register as a new patient
          </label>
          <label className="flex min-h-11 items-center gap-2 rounded px-2 hover:bg-slate-50">
            <input
              type="radio"
              name="decision"
              checked={decision === "rejected"}
              onChange={() => setDecision("rejected")}
            />
            Reject the registration
          </label>
        </fieldset>
        <TextArea
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          hint="For example how the identity was checked."
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!decision}>
            Record decision
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
