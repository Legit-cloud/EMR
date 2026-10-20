"use client";

import { CheckCircle, PencilSimpleLine, Plus, Trash } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/input";
import { KebabMenu } from "@/components/ui/menu";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { api, apiError, type Schemas, unwrap } from "@/lib/api";
import { useNotes, useRefreshChart } from "@/lib/chart-queries";
import { formatDateTime } from "@/lib/format";
import { useMe } from "@/lib/session";
import type { StatusSpec } from "@/lib/status-map";

import { QueryState } from "./query-state";
import { ReasonModal } from "./reason-modal";

type Note = Schemas["ConsultationNote"];
type Draft = { subjective: string; objective: string; assessment: string; plan: string };
export type NoteEditing =
  | { mode: "new"; encounter: string }
  | { mode: "edit"; note: Note }
  | { mode: "addendum"; note: Note };

const SOAP: [keyof Draft, string][] = [
  ["subjective", "Subjective"],
  ["objective", "Objective"],
  ["assessment", "Assessment"],
  ["plan", "Plan"],
];

const BLANK: Draft = { subjective: "", objective: "", assessment: "", plan: "" };

const NOTE_STATUS: Record<"open" | "closed", StatusSpec> = {
  open: { label: "Open", tone: "amber", icon: PencilSimpleLine },
  closed: { label: "Closed", tone: "green", icon: CheckCircle },
};

type Props = {
  patientId: string;
  /** The open visit, so a new note can be written. */
  encounterId?: string;
  editing: NoteEditing | null;
  onEdit: (editing: NoteEditing | null) => void;
  hidden: ReadonlySet<string>;
  schedule: (action: { id: string; message: string; commit: () => Promise<unknown> }) => void;
};

/**
 * SOAP consultation notes. The author edits a note while it is open; closing signs it off and
 * locks it. Corrections to a closed note are addenda.
 */
export function NotesTab({ patientId, encounterId, editing, onEdit, hidden, schedule }: Props) {
  const me = useMe();
  const notes = useNotes(patientId);
  const refresh = useRefreshChart(patientId);
  const toast = useToast();
  const [correcting, setCorrecting] = useState<Note | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const close = useMutation({
    mutationFn: (note: Note) =>
      unwrap(api.POST("/api/clinical/notes/{id}/close/", { params: { path: { id: note.id } } })),
    meta: { quietErrors: true },
  });

  async function closeNote(note: Note) {
    setProblem(null);
    try {
      await close.mutateAsync(note);
    } catch (failure) {
      return setProblem(apiError(failure).message);
    }
    toast({ title: "Note closed and signed", tone: "success" });
    await refresh();
  }

  return (
    <Card
      title="Consultation notes"
      action={
        encounterId ? (
          <Button icon={Plus} onClick={() => onEdit({ mode: "new", encounter: encounterId })}>
            Write note
          </Button>
        ) : undefined
      }
    >
      {problem && <Banner tone="danger" live title={problem} />}
      <QueryState query={notes} what="consultation notes">
        {(data) => {
          const list = data.results.filter((n) => !hidden.has(n.id));
          if (list.length === 0) {
            return (
              <EmptyState
                title="No consultation notes."
                action={
                  encounterId ? (
                    <Button
                      icon={Plus}
                      onClick={() => onEdit({ mode: "new", encounter: encounterId })}
                    >
                      Write note
                    </Button>
                  ) : undefined
                }
              />
            );
          }
          return (
            <ul className="flex flex-col gap-3">
              {list.map((note) => {
                const mine = note.author === me.id;
                const open = note.status === "open";
                return (
                  <li
                    key={note.id}
                    data-testid="note"
                    className="rounded-control border-line bg-surface-muted flex flex-col gap-3 border p-4"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-small text-ink-600">
                        {note.addendum_to ? "Addendum · " : ""}
                        {formatDateTime(note.created_at)} · {mine ? "you" : "a colleague"}
                      </span>
                      <span data-testid="note-status">
                        <StatusPill status={NOTE_STATUS[open ? "open" : "closed"]} />
                        {!open && (
                          <span className="sr-only"> {formatDateTime(note.closed_at)}</span>
                        )}
                      </span>
                      <span className="ml-auto flex items-center gap-1">
                        {open && mine && (
                          <Button variant="ghost" onClick={() => onEdit({ mode: "edit", note })}>
                            Edit
                          </Button>
                        )}
                        {open && mine && (
                          <Button variant="outline" onClick={() => closeNote(note)}>
                            Close and sign
                          </Button>
                        )}
                        {!open && (
                          <Button
                            variant="ghost"
                            onClick={() => onEdit({ mode: "addendum", note })}
                          >
                            Add addendum
                          </Button>
                        )}
                        <KebabMenu
                          label={`Actions for the note of ${formatDateTime(note.created_at)}`}
                          items={[
                            {
                              label: "Entered in error",
                              icon: Trash,
                              danger: true,
                              onSelect: () => setCorrecting(note),
                            },
                          ]}
                        />
                      </span>
                    </div>
                    <dl className="text-body grid gap-2">
                      {SOAP.filter(([field]) => note[field]).map(([field, label]) => (
                        <div key={field}>
                          <dt className="text-label-caps text-ink-500 uppercase">{label}</dt>
                          <dd className="text-ink-900 whitespace-pre-wrap">{note[field]}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </QueryState>

      <NoteModal editing={editing} onClose={() => onEdit(null)} patientId={patientId} />
      <ReasonModal
        open={correcting !== null}
        onOpenChange={(open) => !open && setCorrecting(null)}
        title="Mark note as entered in error"
        explanation="The note leaves the chart but stays in the record's history."
        onConfirm={(reason) => {
          const note = correcting!;
          schedule({
            id: note.id,
            message: "Note hidden as entered in error.",
            commit: async () => {
              await unwrap(
                api.POST("/api/clinical/notes/{id}/entered-in-error/", {
                  params: { path: { id: note.id } },
                  body: { reason },
                }),
              );
              await refresh();
            },
          });
        }}
      />
    </Card>
  );
}

const FORM_ID = "note-form";

function NoteModal({
  editing,
  onClose,
  patientId,
}: {
  editing: NoteEditing | null;
  onClose: () => void;
  patientId: string;
}) {
  // A fresh form for each note being written or edited.
  const key = !editing
    ? "none"
    : editing.mode === "new"
      ? "new"
      : `${editing.mode}-${editing.note.id}`;
  return <NoteForm key={key} editing={editing} onClose={onClose} patientId={patientId} />;
}

function NoteForm({
  editing,
  onClose,
  patientId,
}: {
  editing: NoteEditing | null;
  onClose: () => void;
  patientId: string;
}) {
  const toast = useToast();
  const refresh = useRefreshChart(patientId);
  const [draft, setDraft] = useState<Draft>(() => {
    if (editing?.mode !== "edit") return BLANK;
    const { subjective = "", objective = "", assessment = "", plan = "" } = editing.note;
    return { subjective, objective, assessment, plan };
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      if (editing!.mode === "edit") {
        return unwrap(
          api.PATCH("/api/clinical/notes/{id}/", {
            params: { path: { id: editing!.note.id } },
            body: draft,
          }),
        );
      }
      return unwrap(
        api.POST("/api/clinical/notes/", {
          body: {
            ...draft,
            encounter: editing!.mode === "new" ? editing!.encounter : editing!.note.encounter,
            addendum_to: editing!.mode === "addendum" ? editing!.note.id : null,
          },
        }),
      );
    },
    meta: { quietErrors: true },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await save.mutateAsync();
    } catch (failure) {
      return setError(apiError(failure).message);
    }
    toast({ title: "Note saved", tone: "success" });
    await refresh();
    onClose();
  }

  const title = !editing
    ? "Consultation note"
    : editing.mode === "edit"
      ? "Edit note"
      : editing.mode === "addendum"
        ? "Addendum"
        : "New consultation note";

  return (
    <Modal
      open={editing !== null}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={
        editing?.mode === "addendum"
          ? "The original note stays as signed. Write the correction or addition here."
          : undefined
      }
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
              form={FORM_ID}
              loading={save.isPending}
              disabled={!Object.values(draft).some((v) => v.trim())}
            >
              Save note
            </Button>
          }
        />
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4">
        {error && <Banner tone="danger" live title={error} />}
        {SOAP.map(([field, label]) => (
          <Textarea
            key={field}
            label={label}
            rows={3}
            value={draft[field]}
            onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
          />
        ))}
      </form>
    </Modal>
  );
}
