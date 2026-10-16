"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, Dialog, Notice, ReasonDialog, TextArea } from "@/components/ui";
import { api, apiError, type Schemas } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useMe } from "@/lib/session";
import { useLoad } from "@/lib/useLoad";

import { RowAction, Show } from "./common";

type Note = Schemas["ConsultationNote"];
type Draft = { subjective: string; objective: string; assessment: string; plan: string };
type Editing = { mode: "new"; encounter: string } | { mode: "edit"; note: Note } | { mode: "addendum"; note: Note };

const SOAP: [keyof Draft, string][] = [
  ["subjective", "Subjective"],
  ["objective", "Objective"],
  ["assessment", "Assessment"],
  ["plan", "Plan"],
];

/**
 * SOAP consultation notes. The author edits a note while it is open; closing signs it
 * off and locks it. Corrections to a closed note are addenda.
 */
export function NotesSection({ patientId, encounterId }: { patientId: string; encounterId?: string }) {
  const me = useMe();
  const [notes, reload] = useLoad<Note[]>(
    () => api.GET("/api/clinical/notes/", { params: { query: { patient: patientId } } }),
    [patientId],
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [erroneous, setErroneous] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function close(note: Note) {
    const { error: failure } = await api.POST("/api/clinical/notes/{id}/close/", { params: { path: { id: note.id } } });
    setError(failure ? apiError(failure).message : null);
    reload();
  }

  return (
    <Card
      title="Consultation notes"
      actions={encounterId ? <Button onClick={() => setEditing({ mode: "new", encounter: encounterId })}>Write note</Button> : null}
    >
      {error && <Notice tone="error" title={error} />}
      <Show value={notes}>
        {(list) =>
          list.length === 0 ? (
            <p className="text-slate-600">No notes.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {list.map((note) => {
                const mine = note.author === me.id;
                const open = note.status === "open";
                return (
                  <li key={note.id} data-testid="note" className="rounded-md border border-slate-200 p-3">
                    <p className="text-sm text-slate-600">
                      {note.addendum_to ? "Addendum, " : ""}
                      {formatDateTime(note.created_at)} · {mine ? "you" : "colleague"} ·{" "}
                      <span data-testid="note-status">{open ? "Open" : `Closed ${formatDateTime(note.closed_at)}`}</span>
                    </p>
                    <dl className="mt-2 grid gap-1 text-sm">
                      {SOAP.filter(([field]) => note[field]).map(([field, label]) => (
                        <div key={field}>
                          <dt className="inline font-semibold">{label}: </dt>
                          <dd className="inline whitespace-pre-wrap">{note[field]}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {open && mine && <RowAction onClick={() => setEditing({ mode: "edit", note })}>Edit</RowAction>}
                      {open && mine && <RowAction onClick={() => close(note)}>Close and sign</RowAction>}
                      {!open && <RowAction onClick={() => setEditing({ mode: "addendum", note })}>Add addendum</RowAction>}
                      <RowAction onClick={() => setErroneous(note)}>Entered in error</RowAction>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        }
      </Show>
      <NoteDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
      <ReasonDialog
        open={erroneous !== null}
        title="Mark note as entered in error"
        explanation="The note leaves the chart but stays in the record's history."
        confirmLabel="Mark as entered in error"
        onClose={() => setErroneous(null)}
        onConfirm={async (reason) => {
          const { error: failure } = await api.POST("/api/clinical/notes/{id}/entered-in-error/", {
            params: { path: { id: erroneous!.id } },
            body: { reason },
          });
          if (failure) return apiError(failure).message;
          setErroneous(null);
          reload();
          return null;
        }}
      />
    </Card>
  );
}

const BLANK: Draft = { subjective: "", objective: "", assessment: "", plan: "" };

function NoteDialog({ editing, onClose, onSaved }: { editing: Editing | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (editing?.mode === "edit") {
      const { subjective = "", objective = "", assessment = "", plan = "" } = editing.note;
      setDraft({ subjective, objective, assessment, plan });
    } else {
      setDraft(BLANK);
    }
  }, [editing]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const { data, error: failure } =
      editing.mode === "edit"
        ? await api.PATCH("/api/clinical/notes/{id}/", { params: { path: { id: editing.note.id } }, body: draft })
        : await api.POST("/api/clinical/notes/", {
            body: {
              ...draft,
              encounter: editing.mode === "new" ? editing.encounter : editing.note.encounter,
              addendum_to: editing.mode === "addendum" ? editing.note.id : null,
            },
          });
    if (!data) return setError(apiError(failure).message);
    onSaved();
  }

  const title = !editing ? "" : editing.mode === "edit" ? "Edit note" : editing.mode === "addendum" ? "Addendum" : "New consultation note";

  return (
    <Dialog open={editing !== null} title={title} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {error && <Notice tone="error" title={error} />}
        {editing?.mode === "addendum" && (
          <p className="text-sm text-slate-700">The original note stays as signed. Write the correction or addition here.</p>
        )}
        {SOAP.map(([field, label]) => (
          <TextArea key={field} label={label} value={draft[field]} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })} />
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!Object.values(draft).some((v) => v.trim())}>
            Save note
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
