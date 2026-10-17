import { MagnifyingGlass } from "@phosphor-icons/react";
import type { InputHTMLAttributes, Ref } from "react";

import { cx } from "@/lib/cx";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  /** Screen-reader name; the pill shows only a placeholder. */
  label: string;
  /** "filled" sits in the top bar and page headers; "table" is the white toolbar version. */
  variant?: "filled" | "table";
  className?: string;
  ref?: Ref<HTMLInputElement>;
};

/** Full-radius search field with the icon on the left (docs/DESIGN.md Section 7). */
export function SearchPill({ label, variant = "filled", className, ...props }: Props) {
  return (
    <div className={cx("relative", className)}>
      <MagnifyingGlass
        aria-hidden
        size={16}
        className="text-ink-500 pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
      />
      <input
        type="search"
        aria-label={label}
        className={cx(
          "rounded-pill text-body text-ink-900 placeholder:text-ink-400 w-full pr-4 pl-10 transition-shadow duration-150 ease-out focus-visible:ring-4 focus-visible:ring-blue-600/15 focus-visible:outline-none",
          variant === "filled"
            ? "bg-search-fill focus-visible:bg-surface h-10 border border-transparent focus-visible:border-blue-600"
            : "border-line bg-surface hover:border-ink-300 h-9 border focus-visible:border-blue-600",
        )}
        {...props}
      />
    </div>
  );
}
