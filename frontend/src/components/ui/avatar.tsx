/** Initials on a coloured circle (docs/DESIGN.md Section 5). Photos come with the component library. */

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

export function Avatar({ name, size = 32 }: { name: string; size?: 32 | 40 }) {
  return (
    <span
      aria-hidden
      className={`text-small inline-grid shrink-0 place-items-center rounded-full font-bold ${avatarColour(name)} ${size === 40 ? "size-10" : "size-8"}`}
    >
      {initials(name)}
    </span>
  );
}
