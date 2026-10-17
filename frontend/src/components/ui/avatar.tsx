"use client";

import { useState } from "react";

import { cx } from "@/lib/cx";

/** Photo, or initials on a coloured circle (docs/DESIGN.md Section 5). */

// Tint fill with the text-safe shade, so the initials stay readable.
const COLOURS = [
  "bg-pink-tint text-pink-text",
  "bg-amber-tint text-amber-text",
  "bg-blue-100 text-blue-600",
  "bg-green-tint text-green-text",
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts.at(-1)![0];
  return letters.toUpperCase();
}

/** The same name always gets the same colour. */
export function avatarColour(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLOURS[hash % COLOURS.length];
}

type Props = {
  name: string;
  size?: 32 | 40;
  /** Photo URL (staff photos are short-lived signed URLs). Patients default to initials. */
  src?: string;
  /** Set when the name is not shown next to the avatar, so screen readers still get it. */
  labelled?: boolean;
};

export function Avatar({ name, size = 32, src, labelled = false }: Props) {
  const [broken, setBroken] = useState(false);
  const box = size === 40 ? "size-10" : "size-8";
  const a11y = labelled ? { role: "img", "aria-label": name } : { "aria-hidden": true };

  if (src && !broken) {
    return (
      <span {...a11y} className={cx("inline-block shrink-0 overflow-hidden rounded-full", box)}>
        {/* Signed storage URLs change on every request, so next/image cannot cache them. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
      </span>
    );
  }

  return (
    <span
      {...a11y}
      className={cx(
        "text-small inline-grid shrink-0 place-items-center rounded-full font-bold",
        avatarColour(name),
        box,
      )}
    >
      {initials(name)}
    </span>
  );
}
