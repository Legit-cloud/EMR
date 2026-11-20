"use client";

import { PencilSimpleLine } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";

import { NoAccess } from "@/components/auth/no-access";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Loading } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  memberLine,
  preview,
  refusalMessage,
  type Thread,
  useReply,
  usePeople,
  useStartThread,
  useThread,
  useThreads,
} from "@/lib/messages";
import { useMe } from "@/lib/session";

/**
 * Staff messages: your conversations on the left, the open one on the right. Opening a thread
 * marks it read. For work talk only; patient details belong on the chart.
 */
export function MessagesScreen() {
  const threads = useThreads();
  const [openId, setOpenId] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  if (threads.error instanceof ApiRequestError && threads.error.status === 403) {
    return <NoAccess what="messages" asPage />;
  }
  const rows = threads.data?.results;
  const unread = rows?.reduce((sum, t) => sum + t.unread, 0) ?? 0;

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-page-title text-ink-900">Messages</h1>
        {unread > 0 && (
          <span className="text-small text-ink-600 bg-pill-grey tnum rounded-pill px-2.5 py-0.5 font-semibold">
            {unread} unread
          </span>
        )}
        <Button icon={PencilSimpleLine} className="ml-auto" onClick={() => setWriting(true)}>
          New message
        </Button>
      </header>
      <Banner tone="info">
        Messages are for work, not the patient record. Leave names and results out and use the chart
        for anything clinical.
      </Banner>
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <section
          aria-label="Conversations"
          className="rounded-card border-line bg-surface shadow-card overflow-hidden border"
        >
          {threads.isError ? (
            <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <p className="text-body text-ink-900 font-semibold">Messages could not be loaded.</p>
              <Button variant="outline" onClick={() => threads.refetch()}>
                Try again
              </Button>
            </div>
          ) : rows === undefined ? (
            <Loading label="Loading messages">{null}</Loading>
          ) : rows.length === 0 ? (
            <EmptyState title="No messages yet." />
          ) : (
            <ul>
              {rows.map((thread) => (
                <li key={thread.id} className="border-line border-b last:border-b-0">
                  <ThreadRow thread={thread} active={thread.id === openId} onOpen={setOpenId} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section
          aria-label="Conversation"
          className="rounded-card border-line bg-surface shadow-card min-h-64 border p-5"
        >
          {openId ? (
            <Conversation key={openId} id={openId} />
          ) : (
            <p className="text-body text-ink-600">Choose a conversation to read it.</p>
          )}
        </section>
      </div>
      <NewMessageDialog open={writing} onOpenChange={setWriting} onSent={(id) => setOpenId(id)} />
    </>
  );
}

function ThreadRow({
  thread,
  active,
  onOpen,
}: {
  thread: Thread;
  active: boolean;
  onOpen: (id: string) => void;
}) {
  const me = useMe();
  const myName = `${me.first_name} ${me.last_name}`.trim() || me.username;
  return (
    <button
      type="button"
      onClick={() => onOpen(thread.id)}
      aria-current={active ? "true" : undefined}
      className={`flex w-full flex-col gap-1 px-4 py-3 text-left ${active ? "bg-nav-hover" : "hover:bg-nav-hover"}`}
    >
      <span className="flex items-center gap-2">
        <span className="text-body text-ink-900 min-w-0 flex-1 truncate font-semibold">
          {thread.subject}
        </span>
        {thread.unread > 0 && (
          <span
            aria-label={`${thread.unread} unread`}
            className="rounded-pill tnum bg-blue-600 px-2 text-xs font-semibold text-white"
          >
            {thread.unread}
          </span>
        )}
      </span>
      <span className="text-small text-ink-500 truncate">{memberLine(thread.members, myName)}</span>
      <span className="text-small text-ink-600 truncate">{preview(thread.last_body)}</span>
    </button>
  );
}

function Conversation({ id }: { id: string }) {
  const thread = useThread(id);
  const reply = useReply(id);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  if (thread.isError) {
    return <Banner tone="danger" live title="This conversation could not be loaded." />;
  }
  if (!thread.data)
    return (
      <p role="status" className="text-body text-ink-600">
        Loading…
      </p>
    );

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return setProblem("Write a message first.");
    setProblem(null);
    try {
      await reply.mutateAsync(text.trim());
      setText("");
    } catch (failure) {
      setProblem(refusalMessage(failure));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-section-title text-ink-900">{thread.data.subject}</h2>
      <ul className="flex flex-col gap-3">
        {thread.data.messages.map((message) => (
          <li key={message.id} className="bg-search-fill rounded-card flex flex-col gap-1 p-3">
            <span className="text-small text-ink-600">
              <strong className="text-ink-900">{message.sender_name}</strong>{" "}
              {formatDateTime(message.created_at)}
            </span>
            <span className="text-body text-ink-900 whitespace-pre-wrap">{message.body}</span>
          </li>
        ))}
      </ul>
      <form noValidate onSubmit={send} className="flex flex-col gap-3">
        <Textarea
          label="Reply"
          value={text}
          maxLength={4000}
          error={problem ?? undefined}
          onChange={(e) => {
            setText(e.target.value);
            setProblem(null);
          }}
        />
        <Button type="submit" className="self-end" loading={reply.isPending}>
          Send reply
        </Button>
      </form>
    </div>
  );
}

function NewMessageDialog({
  open,
  onOpenChange,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (id: string) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="New message"
      size="wide"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form="message-form">
              Send
            </Button>
          }
        />
      }
    >
      {open && (
        <NewMessageForm
          onDone={(id) => {
            onSent(id);
            onOpenChange(false);
          }}
        />
      )}
    </Modal>
  );
}

function NewMessageForm({ onDone }: { onDone: (id: string) => void }) {
  const me = useMe();
  const toast = useToast();
  const start = useStartThread();
  const [search, setSearch] = useState("");
  const people = usePeople(search.trim());
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const found: Record<string, string> = {};
    if (Object.keys(chosen).length === 0) found.to = "Choose at least one person.";
    if (!subject.trim()) found.subject = "Enter a subject.";
    if (!body.trim()) found.body = "Write a message.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      const thread = await start.mutateAsync({
        recipients: Object.keys(chosen),
        subject: subject.trim(),
        body: body.trim(),
      });
      toast({ title: "Message sent", tone: "success" });
      onDone(thread.id);
    } catch (failure) {
      setProblem(refusalMessage(failure));
    }
  }

  return (
    <form id="message-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
      {problem && <Banner tone="danger" live title={problem} />}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-body text-ink-900 font-semibold">To</legend>
        <Input
          label="Find people"
          hideLabel
          placeholder="Search staff by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {errors.to && (
          <p role="alert" className="text-small text-pink-600">
            {errors.to}
          </p>
        )}
        <ul className="max-h-40 overflow-y-auto">
          {(people.data?.results ?? [])
            .filter((p) => p.user !== me.id)
            .map((person) => (
              <li key={person.id}>
                <label className="text-body text-ink-900 flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={person.user in chosen}
                    onChange={(e) =>
                      setChosen((current) => {
                        const next = { ...current };
                        if (e.target.checked) next[person.user] = person.display_name;
                        else delete next[person.user];
                        return next;
                      })
                    }
                  />
                  {person.display_name}
                </label>
              </li>
            ))}
        </ul>
        {Object.keys(chosen).length > 0 && (
          <p className="text-small text-ink-600">Sending to {Object.values(chosen).join(", ")}</p>
        )}
      </fieldset>
      <Input
        label="Subject"
        value={subject}
        maxLength={150}
        error={errors.subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <Textarea
        label="Message"
        value={body}
        maxLength={4000}
        error={errors.body}
        onChange={(e) => setBody(e.target.value)}
      />
    </form>
  );
}
