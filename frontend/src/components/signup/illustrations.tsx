/**
 * The three pictures beside the sign-up form. They are drawn in SVG from the design tokens, so
 * they match the product and weigh almost nothing. To use photographs instead, replace the
 * `art` of a slide in `slides.tsx` with an <Image> of the same shape.
 */

type Art = { className?: string };

const BASE = "h-auto w-full max-w-[520px] drop-shadow-xl";

/** A clinic dashboard: totals across the top and a week of income. */
export function DashboardArt({ className = BASE }: Art) {
  const bars = [46, 64, 52, 82, 70, 96, 78];
  return (
    <svg
      viewBox="0 0 480 340"
      role="img"
      aria-label="A dashboard showing patients seen, income and a weekly chart"
      className={className}
    >
      <rect x="8" y="8" width="464" height="324" rx="22" className="fill-surface" />
      <rect x="8" y="8" width="464" height="52" rx="22" className="fill-blue-50" />
      <rect x="8" y="40" width="464" height="20" className="fill-blue-50" />
      <circle cx="38" cy="34" r="8" className="fill-blue-600" />
      <rect x="56" y="28" width="96" height="12" rx="6" className="fill-ink-900" />
      <rect x="380" y="26" width="72" height="16" rx="8" className="fill-surface" />
      {[
        ["Patients today", "48", "fill-blue-100", "fill-blue-600"],
        ["Income", "₦1.2m", "fill-green-tint", "fill-green"],
        ["Waiting", "6", "fill-amber-tint", "fill-amber"],
      ].map(([label, value, tint, dot], i) => (
        <g key={label} transform={`translate(${28 + i * 148} 80)`}>
          <rect width="132" height="76" rx="14" className={tint} />
          <circle cx="20" cy="22" r="6" className={dot} />
          <text x="32" y="26" className="fill-ink-600 text-[11px]">
            {label}
          </text>
          <text x="16" y="58" className="fill-ink-900 text-[24px] font-bold">
            {value}
          </text>
        </g>
      ))}
      <rect x="28" y="172" width="424" height="140" rx="14" className="fill-surface-muted" />
      <text x="44" y="196" className="fill-ink-900 text-[12px] font-semibold">
        This week
      </text>
      {bars.map((h, i) => (
        <rect
          key={i}
          x={52 + i * 56}
          y={300 - h}
          width="30"
          height={h}
          rx="8"
          className={i === 5 ? "fill-blue-600" : "fill-blue-100"}
        />
      ))}
    </svg>
  );
}

/** A patient chart: who they are, their latest readings and a short history. */
export function ChartArt({ className = BASE }: Art) {
  return (
    <svg
      viewBox="0 0 480 340"
      role="img"
      aria-label="A patient chart with vital signs and a short history"
      className={className}
    >
      <rect x="8" y="8" width="464" height="324" rx="22" className="fill-surface" />
      <circle cx="54" cy="56" r="26" className="fill-purple-tint" />
      <text x="54" y="64" textAnchor="middle" className="fill-purple-text text-[20px] font-bold">
        AO
      </text>
      <rect x="92" y="36" width="150" height="14" rx="7" className="fill-ink-900" />
      <rect x="92" y="60" width="104" height="10" rx="5" className="fill-ink-300" />
      <rect x="372" y="40" width="80" height="26" rx="13" className="fill-green-tint" />
      <circle cx="388" cy="53" r="5" className="fill-green" />
      <text x="400" y="57" className="fill-green-text text-[11px] font-semibold">
        Active
      </text>
      {[
        ["Blood pressure", "118/76", "fill-sky-tint", "fill-sky-text"],
        ["Heart rate", "72 bpm", "fill-pink-tint", "fill-pink-text"],
        ["Temperature", "36.7 °C", "fill-teal-tint", "fill-teal-text"],
      ].map(([label, value, tint, text], i) => (
        <g key={label} transform={`translate(${28 + i * 148} 100)`}>
          <rect width="132" height="72" rx="14" className={tint} />
          <text x="14" y="26" className="fill-ink-600 text-[11px]">
            {label}
          </text>
          <text x="14" y="54" className={`${text} text-[20px] font-bold`}>
            {value}
          </text>
        </g>
      ))}
      <rect x="28" y="188" width="424" height="124" rx="14" className="fill-surface-muted" />
      {[
        ["Consultation note signed", "Today"],
        ["Prescription dispensed", "Yesterday"],
        ["Blood test resulted", "Mon"],
      ].map(([label, when], i) => (
        <g key={label} transform={`translate(48 ${210 + i * 34})`}>
          <circle cx="6" cy="8" r="6" className={i === 0 ? "fill-blue-600" : "fill-blue-100"} />
          <text x="24" y="12" className="fill-ink-900 text-[12px] font-semibold">
            {label}
          </text>
          <text x="384" y="12" textAnchor="end" className="fill-ink-500 text-[11px]">
            {when}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** A week of appointments beside a paid bill: booking, the queue and billing in one flow. */
export function ScheduleArt({ className = BASE }: Art) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const blocks: [number, number, number, string][] = [
    [0, 0, 2, "fill-blue-100"],
    [1, 1, 1, "fill-teal-tint"],
    [2, 0, 1, "fill-purple-tint"],
    [2, 2, 2, "fill-blue-100"],
    [3, 1, 2, "fill-amber-tint"],
    [4, 0, 1, "fill-pink-tint"],
  ];
  return (
    <svg
      viewBox="0 0 480 340"
      role="img"
      aria-label="A week of appointments and a paid invoice"
      className={className}
    >
      <rect x="8" y="8" width="464" height="324" rx="22" className="fill-surface" />
      {days.map((day, i) => (
        <text
          key={day}
          x={64 + i * 76}
          y="44"
          textAnchor="middle"
          className="fill-ink-500 text-[11px] font-semibold"
        >
          {day}
        </text>
      ))}
      {[0, 1, 2, 3].map((row) => (
        <line
          key={row}
          x1="28"
          x2="452"
          y1={64 + row * 46}
          y2={64 + row * 46}
          className="stroke-line"
        />
      ))}
      {blocks.map(([day, start, span, tint], i) => (
        <rect
          key={i}
          x={30 + day * 76}
          y={68 + start * 46}
          width="68"
          height={span * 46 - 8}
          rx="10"
          className={tint}
        />
      ))}
      <g transform="translate(28 246)">
        <rect width="424" height="68" rx="14" className="fill-surface-muted" />
        <circle cx="36" cy="34" r="18" className="fill-green-tint" />
        <path
          d="M28 34l6 6 11-12"
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-green-btn"
        />
        <text x="66" y="30" className="fill-ink-900 text-[13px] font-semibold">
          Invoice INV-1042 paid
        </text>
        <text x="66" y="50" className="fill-ink-500 text-[11px]">
          Posted to the ledger automatically
        </text>
        <text x="404" y="40" textAnchor="end" className="fill-ink-900 text-[18px] font-bold">
          ₦25,000
        </text>
      </g>
    </svg>
  );
}
