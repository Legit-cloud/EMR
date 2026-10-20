import { Info, Warning, WarningOctagon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

type Props = {
  /**
   * info: sky tint, sky text. danger: pink tint and border, bold pink title (allergies, blocking
   * alerts). warning: amber tint and border (safety warnings that do not block).
   */
  tone?: "info" | "danger" | "warning";
  title?: string;
  /** Link-style action on the right, for example "Extend time". */
  action?: ReactNode;
  /** Announce the banner when it appears after the page has loaded (offline, save failed). */
  live?: boolean;
  children?: ReactNode;
};

/** Info and danger banners (docs/DESIGN.md Sections 2.4 and 7). Danger banners stay until resolved. */
export function Banner({ tone = "info", title, action, live = false, children }: Props) {
  const danger = tone === "danger";
  const warning = tone === "warning";
  const Glyph = danger ? WarningOctagon : warning ? Warning : Info;
  return (
    <div
      role={live ? (danger ? "alert" : "status") : undefined}
      className={cx(
        "rounded-control flex items-start gap-3 px-4 py-3",
        danger
          ? "bg-pink-tint border-pink border"
          : warning
            ? "bg-amber-tint border-amber border"
            : "bg-sky-tint text-sky-text",
      )}
    >
      <Glyph
        aria-hidden
        size={20}
        weight="fill"
        className={cx(
          "mt-px shrink-0",
          danger ? "text-pink" : warning ? "text-amber" : "text-sky-text",
        )}
      />
      <div className="text-body min-w-0 flex-1">
        {title && (
          <p
            className={cx(
              "font-bold",
              danger ? "text-pink-text" : warning ? "text-amber-text" : "text-sky-text",
            )}
          >
            {title}
          </p>
        )}
        {children && (
          <div className={danger || warning ? "text-ink-900" : "text-sky-text"}>{children}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
