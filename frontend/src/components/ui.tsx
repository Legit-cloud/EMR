"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function Button({
  children,
  variant = "primary",
  ...props
}: React.ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-teal-700 text-white hover:bg-teal-800 disabled:bg-slate-400",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    danger: "bg-red-700 text-white hover:bg-red-800",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={`min-h-11 rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${styles} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

/** Labelled input with its error announced to assistive technology. */
export function Field({
  label,
  error,
  hint,
  ...props
}: React.ComponentProps<"input"> & { label: string; error?: string; hint?: string }) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : "", hint ? `${id}-hint` : ""].join(" ").trim();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={id}
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`min-h-11 rounded-md border px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${error ? "border-red-600" : "border-slate-300"}`}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function Select({
  label,
  error,
  children,
  ...props
}: React.ComponentProps<"select"> & { label: string; error?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <select
        id={id}
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
      >
        {children}
      </select>
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "error" | "success";
  title?: string;
  children?: ReactNode;
}) {
  const styles = {
    info: "border-sky-300 bg-sky-50 text-sky-900",
    warning: "border-amber-400 bg-amber-50 text-amber-950",
    error: "border-red-400 bg-red-50 text-red-900",
    success: "border-emerald-400 bg-emerald-50 text-emerald-900",
  }[tone];
  return (
    <div role={tone === "error" || tone === "warning" ? "alert" : "status"} className={`rounded-md border p-4 ${styles}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className="mt-1 text-sm">{children}</div>}
    </div>
  );
}

export function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * Modal dialog on the native <dialog> element: focus moves into it, focus is trapped,
 * Escape closes it, and focus returns to the opener.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-lg p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      <div className="p-6">
        <h2 id={titleId} className="mb-4 text-xl font-semibold text-slate-900">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

export function NoAccess() {
  return <Notice tone="warning" title="You do not have access to this information." />;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p role="status" className="text-slate-600">
      {label}…
    </p>
  );
}

export function TextArea({
  label,
  error,
  hint,
  ...props
}: React.ComponentProps<"textarea"> & { label: string; error?: string; hint?: string }) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : "", hint ? `${id}-hint` : ""].join(" ").trim();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`rounded-md border px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${error ? "border-red-600" : "border-slate-300"}`}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** Asks for a reason before an action that needs one (Entered-in-Error, refusals). */
export function ReasonDialog({
  open,
  title,
  explanation,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  explanation: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setReason("");
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(await onConfirm(reason));
        }}
      >
        <p className="text-sm text-slate-700">{explanation}</p>
        {error && <Notice tone="error" title={error} />}
        <TextArea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={!reason.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
