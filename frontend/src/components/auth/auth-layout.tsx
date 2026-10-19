import Link from "next/link";
import type { ReactNode } from "react";

import { LogoMark, PRODUCT_NAME } from "@/components/layout/logo";
import { FOCUS_RING } from "@/components/ui/focus";
import { cx } from "@/lib/cx";

/** Ghost-button style link for the sign-in pages ("Forgot password?", "Back to sign in"). */
export const AUTH_LINK = cx(
  "text-small rounded-tag font-semibold text-blue-600 hover:underline",
  FOCUS_RING,
);

type Props = {
  title: string;
  /** One sentence under the title. */
  intro?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

/** Centred card on the canvas for sign-in, code entry and password recovery. */
export function AuthLayout({ title, intro, children, footer }: Props) {
  return (
    <main className="bg-canvas flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-[420px] flex-col gap-6">
        <Link
          href="/login"
          className={cx("rounded-control flex items-center gap-2 self-center", FOCUS_RING)}
        >
          <LogoMark />
          <span className="text-page-title text-ink-900">{PRODUCT_NAME}</span>
        </Link>
        <section
          aria-labelledby="auth-title"
          className="rounded-card border-line bg-surface shadow-card flex flex-col gap-5 border p-6 sm:p-8"
        >
          <header className="flex flex-col gap-1.5">
            <h1 id="auth-title" className="text-page-title text-ink-900">
              {title}
            </h1>
            {intro && <p className="text-body text-ink-600">{intro}</p>}
          </header>
          {children}
        </section>
        {footer && <div className="flex justify-center">{footer}</div>}
      </div>
    </main>
  );
}
