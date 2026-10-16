/**
 * Reads the token values from tokens.css so tests and the /design page check the real
 * values, and lists every text-on-background pair docs/DESIGN.md uses.
 */

export type Tokens = Record<string, string>;

/** Custom properties declared in a CSS file, without the leading `--`. */
export function parseTokens(css: string): Tokens {
  const tokens: Tokens = {};
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

export type TextPair = { text: string; background: string; use: string };

/** Text colour token on background token, as used in docs/DESIGN.md. All must reach 4.5:1. */
export const TEXT_PAIRS: TextPair[] = [
  { text: "ink-900", background: "surface", use: "Headings and primary text" },
  { text: "ink-900", background: "canvas", use: "Page titles on the canvas" },
  { text: "ink-900", background: "pink-tint", use: "Allergy alert body" },
  { text: "ink-600", background: "surface", use: "Secondary text" },
  { text: "ink-600", background: "canvas", use: "Secondary text on the canvas" },
  { text: "ink-600", background: "pill-grey", use: "PENDING pill" },
  { text: "ink-500", background: "surface", use: "Captions and column headers" },
  { text: "ink-500", background: "canvas", use: "Captions on the canvas" },
  { text: "ink-500", background: "sidebar", use: "Sidebar group captions" },
  { text: "ink-500", background: "surface-muted", use: "Table header row" },
  { text: "surface", background: "blue-600", use: "Primary button" },
  { text: "surface", background: "blue-700", use: "Primary button hover" },
  { text: "surface", background: "green-btn", use: "Success button" },
  { text: "blue-600", background: "surface", use: "Links and ghost buttons" },
  { text: "blue-600", background: "blue-100", use: "Active nav item" },
  { text: "blue-600", background: "blue-50", use: "Hover on blue-tinted items" },
  { text: "blue-700", background: "surface", use: "Link hover" },
  { text: "green-text", background: "surface", use: "Success text" },
  { text: "green-text", background: "green-tint", use: "Success pill" },
  { text: "amber-text", background: "surface", use: "Warning text" },
  { text: "amber-text", background: "amber-tint", use: "Warning pill" },
  { text: "amber-text", background: "amber-strip", use: "Waiting-payment strip" },
  { text: "pink-text", background: "surface", use: "Danger text" },
  { text: "pink-text", background: "pink-tint", use: "Danger pill and allergy title" },
  { text: "sky-text", background: "surface", use: "Information text" },
  { text: "sky-text", background: "sky-tint", use: "Information pill and banner" },
  { text: "purple-text", background: "surface", use: "In-progress text" },
  { text: "purple-text", background: "purple-tint", use: "In-progress pill" },
  { text: "teal-text", background: "surface", use: "Checked-in text" },
  { text: "teal-text", background: "teal-tint", use: "Checked-in pill" },
];
