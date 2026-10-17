import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { AA_TEXT, contrastRatio } from "@/lib/contrast";
import { parseTokens, TEXT_PAIRS } from "@/lib/design-tokens";

import { ComponentSamples } from "./component-samples";
import { StatusSamples } from "./status-samples";

export const metadata: Metadata = { title: "Design system", robots: { index: false } };
export const dynamic = "force-static";

// Full class names so Tailwind generates them.
const TYPE_SCALE = [
  { name: "display", className: "text-display", sample: "Good morning, Ada!" },
  { name: "page-title", className: "text-page-title", sample: "Dashboard" },
  { name: "card-title", className: "text-card-title", sample: "Cashflow" },
  { name: "kpi", className: "text-kpi tnum", sample: "₦13,232.00" },
  { name: "kpi-sm", className: "text-kpi-sm tnum", sample: "₦4,120.00" },
  { name: "body", className: "text-body", sample: "Follow-up visit, Dr Doctor Tester" },
  {
    name: "body-regular",
    className: "text-body-regular",
    sample: "Patient reports a mild headache since Tuesday.",
  },
  { name: "small", className: "text-small", sample: "5 items • ₦1,500.00" },
  { name: "label-caps", className: "text-label-caps uppercase", sample: "Total cash" },
  { name: "pill", className: "text-pill uppercase", sample: "Partially paid" },
  { name: "mono", className: "text-body font-mono", sample: "MRN 2026-000123" },
];

const RADII = [
  { name: "tag", className: "rounded-tag" },
  { name: "cal", className: "rounded-cal" },
  { name: "control", className: "rounded-control" },
  { name: "card", className: "rounded-card" },
  { name: "modal", className: "rounded-modal" },
  { name: "pill", className: "rounded-pill" },
];

const SHADOWS = [
  { name: "card", className: "shadow-card" },
  { name: "pop", className: "shadow-pop" },
  { name: "modal", className: "shadow-modal" },
];

const COLOUR_GROUPS = [
  {
    title: "Brand, ink and surfaces",
    match: (n: string) =>
      /^(blue|sky-400|logo|ink|line|canvas|sidebar|surface|disabled|pill|nav|search|skeleton)/.test(
        n,
      ),
  },
  {
    title: "Accents",
    match: (n: string) => /^(green|amber|pink|sky|purple|teal|now)/.test(n) && n !== "sky-400",
  },
  { title: "Chart", match: (n: string) => n.startsWith("chart-") },
];

/** Pass or fail is shown only for text pairs: most tokens are fills, never text. */
function Ratio({ value }: { value: number }) {
  const pass = value >= AA_TEXT;
  return (
    <span className={`tnum text-small ${pass ? "text-green-text" : "text-pink-text"}`}>
      {value.toFixed(2)}:1{pass ? "" : " (below 4.5:1)"}
    </span>
  );
}

/** Every design token and every component. Not linked from the app. */
export default function DesignPage() {
  const tokens = parseTokens(
    readFileSync(join(process.cwd(), "src", "styles", "tokens.css"), "utf-8"),
  );
  const colours = Object.entries(tokens).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v));
  const white = tokens["surface"];

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-page-title text-ink-900">Design system</h1>
        <p className="text-body text-ink-600">
          Tokens from src/styles/tokens.css and the components in src/components/ui, as specified in
          docs/DESIGN.md. Sample data is synthetic.
        </p>
      </header>

      {COLOUR_GROUPS.map((group) => (
        <Card key={group.title} title={group.title}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {colours
              .filter(([name]) => group.match(name))
              .map(([name, value]) => (
                <li key={name} className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="rounded-control border-line size-10 shrink-0 border"
                    style={{ background: `var(--${name})` }}
                  />
                  <span className="flex flex-col">
                    <span className="text-body text-ink-900">{name}</span>
                    <span className="text-small text-ink-600 font-mono uppercase">{value}</span>
                    <span className="text-small text-ink-600 tnum">
                      {contrastRatio(value, white).toFixed(2)}:1 on white
                    </span>
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      ))}

      <Card title="Text pairs">
        <p className="text-small text-ink-600">
          Every text colour on each background DESIGN.md puts it on. All must reach 4.5:1; the unit
          tests fail if one does not.
        </p>
        <div className="max-w-full min-w-0 overflow-x-auto">
          <table className="text-body w-full text-left">
            <caption className="sr-only">Text colour pairs and their contrast</caption>
            <thead className="bg-surface-muted text-label-caps text-ink-500 uppercase">
              <tr>
                <th scope="col" className="p-2">
                  Sample
                </th>
                <th scope="col" className="p-2">
                  Text on background
                </th>
                <th scope="col" className="p-2">
                  Use
                </th>
                <th scope="col" className="p-2">
                  Contrast
                </th>
              </tr>
            </thead>
            <tbody>
              {TEXT_PAIRS.map((pair) => (
                <tr key={`${pair.text}/${pair.background}`} className="border-line border-t">
                  <td className="p-2">
                    <span
                      className="rounded-tag px-2 py-1"
                      style={{
                        color: `var(--${pair.text})`,
                        background: `var(--${pair.background})`,
                      }}
                    >
                      Sample text
                    </span>
                  </td>
                  <td className="text-small p-2 font-mono">
                    {pair.text} on {pair.background}
                  </td>
                  <td className="text-ink-600 p-2">{pair.use}</td>
                  <td className="p-2">
                    <Ratio value={contrastRatio(tokens[pair.text], tokens[pair.background])} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Type scale">
        <ul className="flex flex-col gap-3">
          {TYPE_SCALE.map((style) => (
            <li key={style.name} className="grid items-baseline gap-2 sm:grid-cols-[160px_1fr]">
              <span className="text-small text-ink-500 font-mono">{style.name}</span>
              <span className={`text-ink-900 ${style.className}`}>{style.sample}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Radii and shadows">
        <div className="flex flex-wrap gap-6">
          {RADII.map((r) => (
            <div key={r.name} className="flex flex-col items-center gap-2">
              <span className={`size-16 border border-blue-600 bg-blue-50 ${r.className}`} />
              <span className="text-small text-ink-600">{r.name}</span>
            </div>
          ))}
          {SHADOWS.map((s) => (
            <div key={s.name} className="flex flex-col items-center gap-2">
              <span className={`rounded-card bg-surface size-16 ${s.className}`} />
              <span className="text-small text-ink-600">shadow {s.name}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Status colours">
        <StatusSamples />
      </Card>

      <h2 className="text-page-title text-ink-900 mt-4">Components</h2>
      <ComponentSamples />
    </main>
  );
}
