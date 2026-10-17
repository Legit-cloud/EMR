import { CheckCircle, CircleNotch, type Icon } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "@/lib/cx";

import { FOCUS_RING } from "./focus";

export type ButtonVariant = "primary" | "outline" | "neutral" | "ghost" | "dashed" | "success";

// Disabled looks the same for every filled variant: disabled-fill with ink-400 text.
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-600 text-surface hover:bg-blue-700 disabled:bg-disabled-fill disabled:text-ink-400",
  outline:
    "border border-blue-600 bg-surface text-blue-600 hover:bg-blue-50 disabled:border-line disabled:text-ink-400 disabled:hover:bg-surface",
  neutral:
    "border border-ink-300 bg-surface text-ink-900 hover:bg-surface-muted disabled:border-line disabled:text-ink-400 disabled:hover:bg-surface",
  ghost: "px-1 text-blue-600 hover:underline disabled:text-ink-400 disabled:no-underline",
  dashed:
    "border border-dashed border-blue-600 bg-surface text-blue-600 hover:bg-blue-50 disabled:border-ink-300 disabled:text-ink-400",
  success:
    "bg-green-btn text-surface hover:brightness-95 disabled:bg-disabled-fill disabled:text-ink-400",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary, outline (blue), neutral (grey outline: "Today", "Filters"), ghost link, dashed, success. */
  variant?: ButtonVariant;
  icon?: Icon;
  /** Shows progress and blocks clicks while a save is running. */
  loading?: boolean;
  children: ReactNode;
};

/** The button set from docs/DESIGN.md Section 7. */
export function Button({
  variant = "primary",
  icon: LeadingIcon,
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: Props) {
  const Lead = loading
    ? CircleNotch
    : variant === "success" && !LeadingIcon
      ? CheckCircle
      : LeadingIcon;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "rounded-control text-body inline-flex shrink-0 items-center justify-center gap-2 font-semibold whitespace-nowrap transition-colors duration-150 ease-out disabled:cursor-not-allowed",
        variant === "ghost" ? "h-8" : "h-10 px-4",
        VARIANTS[variant],
        FOCUS_RING,
        className,
      )}
      {...props}
    >
      {Lead && (
        <Lead
          aria-hidden
          size={variant === "ghost" ? 16 : 20}
          weight={variant === "success" && !loading ? "fill" : "regular"}
          className={loading ? "animate-spin motion-reduce:animate-none" : undefined}
        />
      )}
      {children}
    </button>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: Icon;
  /** Required: an icon alone has no visible name. */
  label: string;
  /** "add" is the filled blue round + button; "ghost" is every other round icon button. */
  variant?: "add" | "ghost";
};

/** 40 px round icon button. */
export function IconButton({
  icon: Glyph,
  label,
  variant = "ghost",
  type = "button",
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-grid size-10 shrink-0 place-items-center rounded-full transition-colors duration-150 ease-out disabled:cursor-not-allowed",
        variant === "add"
          ? "bg-blue-600 text-surface hover:bg-blue-700 disabled:bg-disabled-fill disabled:text-ink-400"
          : "text-ink-500 hover:bg-nav-hover hover:text-ink-900 disabled:text-ink-300",
        FOCUS_RING,
        className,
      )}
      {...props}
    >
      <Glyph aria-hidden size={20} weight={variant === "add" ? "bold" : "regular"} />
    </button>
  );
}
