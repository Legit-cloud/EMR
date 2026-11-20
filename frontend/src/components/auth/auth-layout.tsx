import type { ReactNode } from "react";

import { LogoMark, PRODUCT_NAME } from "@/components/layout/logo";
import { FOCUS_RING } from "@/components/ui/focus";
import { cx } from "@/lib/cx";

import { Showcase } from "./showcase";

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

/**
 * The page around sign-in, sign-up, code entry and password recovery: pictures on the left
 * (large screens only) and the form on the right, sitting directly on the page with no card or
 * border around it.
 */
export function AuthLayout({ title, intro, children, footer }: Props) {
  return (
    <main className="bg-surface grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="hidden p-4 lg:block">
        <div className="sticky top-4 h-[calc(100dvh-2rem)]">
          <Showcase />
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-10 sm:px-12">
        <div className="flex w-full max-w-[420px] flex-col gap-7">
          <div className="flex items-center gap-2">
            <LogoMark />
            <span className="text-page-title text-ink-900">{PRODUCT_NAME}</span>
          </div>
          <header className="flex flex-col gap-1.5">
            <h1 id="auth-title" className="text-page-title text-ink-900">
              {title}
            </h1>
            {intro && <p className="text-body text-ink-600">{intro}</p>}
          </header>
          {children}
          {footer && <div className="flex justify-start">{footer}</div>}
        </div>
      </div>
    </main>
  );
}
