import { format } from "date-fns";
import type { ReactNode } from "react";

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Good morning, Ada!" with the date below (docs/DESIGN.md Section 6). */
export function PageGreeting({ name, now = new Date() }: { name: string; now?: Date }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-display text-ink-900">
        {greetingFor(now)}
        {name ? `, ${name}` : ""}!
      </h1>
      <p className="text-body text-ink-600">{format(now, "EEEE, d MMMM yyyy")}</p>
    </header>
  );
}

/** Page padding and width on the canvas; optionally opens with the greeting. */
export function PageContainer({
  greeting,
  children,
}: {
  greeting?: { name: string; now?: Date };
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-4 sm:p-6">
      {greeting && <PageGreeting {...greeting} />}
      {children}
    </div>
  );
}
