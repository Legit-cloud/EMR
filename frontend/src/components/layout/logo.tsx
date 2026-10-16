import { useId } from "react";

/**
 * The EMR mark: a cross drawn from two rounded strokes in the brand gradient
 * (docs/DESIGN.md Section 9).
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  const gradient = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--logo-start)" }} />
          <stop offset="1" style={{ stopColor: "var(--blue-600)" }} />
        </linearGradient>
      </defs>
      <path
        d="M16 6v20M6 16h20"
        stroke={`url(#${gradient})`}
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export const PRODUCT_NAME = "EMR";
