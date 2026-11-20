"use client";

import { Info, ShieldCheck } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import {
  actionsText,
  checkInvite,
  type InviteErrors,
  type InviteForm,
  inviteProblem,
  isReadOnly,
  limitText,
  type RoleInfo,
  useInvite,
  useRoleCatalogue,
} from "@/lib/people";

const FORM_ID = "invite-form";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the invited person's email address once the invitation is sent. */
  onInvited: (email: string) => void;
};

/**
 * Invite someone: their name, email address and role, and next to the role exactly what that role
 * is allowed to do. The list is the server's own, so what is shown is what will be enforced.
 */
export function InviteDialog({ open, onOpenChange, onInvited }: Props) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a team member"
      description="They get an email to set a password, then sign in with their email address."
      size="wide"
      footer={
        <ModalFooter
          start={
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          }
          end={
            <Button type="submit" form={FORM_ID}>
              Send invitation
            </Button>
          }
        />
      }
    >
      {open && (
        <InviteForm
          onInvited={(email) => {
            onInvited(email);
            onOpenChange(false);
          }}
        />
      )}
    </Modal>
  );
}

function InviteForm({ onInvited }: { onInvited: (email: string) => void }) {
  const invite = useInvite();
  const roles = useRoleCatalogue();
  const [form, setForm] = useState<InviteForm>({
    first_name: "",
    last_name: "",
    email: "",
    role: "",
  });
  const [errors, setErrors] = useState<InviteErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<InviteForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors({});
    setProblem(null);
  };
  const chosen = roles.data?.find((r) => r.role === form.role);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = checkInvite(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      await invite.mutateAsync({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        role: form.role as never,
      });
      onInvited(form.email.trim().toLowerCase());
    } catch (failure) {
      const refused = inviteProblem(failure);
      setErrors(refused.fields);
      setProblem(refused.message);
    }
  }

  return (
    <form id={FORM_ID} noValidate onSubmit={submit} className="flex flex-col gap-5">
      {problem && <Banner tone="danger" live title={problem} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="First name"
          autoComplete="off"
          value={form.first_name}
          error={errors.first_name}
          onChange={(e) => set({ first_name: e.target.value })}
        />
        <Input
          label="Last name"
          optional
          autoComplete="off"
          value={form.last_name}
          onChange={(e) => set({ last_name: e.target.value })}
        />
      </div>
      <Input
        label="Email address"
        type="email"
        autoComplete="off"
        hint="They will sign in with this address."
        value={form.email}
        error={errors.email}
        onChange={(e) => set({ email: e.target.value })}
      />
      <Select
        label="Role"
        placeholder={roles.isPending ? "Loading roles…" : "Choose a role"}
        options={(roles.data ?? []).map((r) => ({ value: r.role, label: r.label }))}
        value={form.role || undefined}
        error={errors.role}
        disabled={roles.isError}
        onValueChange={(value) => set({ role: value })}
      />
      {roles.isError && (
        <Banner tone="danger" live title="The roles could not be loaded. Try again shortly." />
      )}
      {chosen ? (
        <Permissions role={chosen} />
      ) : (
        !roles.isError && (
          <p className="text-small text-ink-600 flex items-center gap-2">
            <Info aria-hidden size={16} />
            Choose a role to see what it can do.
          </p>
        )
      )}
    </form>
  );
}

/** What the chosen role is, and every thing it may do, in plain words. */
function Permissions({ role }: { role: RoleInfo }) {
  return (
    <section
      aria-label={`What ${role.label} can do`}
      className="rounded-control bg-search-fill flex flex-col gap-3 p-4"
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-body text-ink-900 flex items-center gap-2 font-semibold">
          <ShieldCheck aria-hidden size={18} />
          What {role.label} can do
        </h3>
        <p className="text-small text-ink-600">{role.description}</p>
        {isReadOnly(role) && (
          <p className="text-small text-ink-900 font-semibold">This role can only look.</p>
        )}
      </header>
      <ul className="border-line max-h-60 divide-y overflow-y-auto rounded-md border bg-white">
        {role.permissions.map((line) => (
          <li key={line.resource} className="flex flex-col gap-0.5 px-3 py-2">
            <span className="text-body text-ink-900 font-semibold">{line.label}</span>
            <span className="text-small text-ink-600">
              {actionsText(line.actions)}
              {limitText(line) ? `, ${limitText(line)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-small text-ink-600">
        You can narrow a role to one facility or department after they join. Every action is
        recorded in the audit log.
      </p>
    </section>
  );
}
