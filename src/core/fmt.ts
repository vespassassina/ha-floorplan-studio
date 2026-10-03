// Small string helpers for the SVG that `renderFloor` and `solids.ts` build as text. One copy, so the flat and the 2.5D
// drawing can never escape or round differently.
import type { Pt } from "./schema";

/** Text for markup. A name that is not text (a layout that skipped `validate`) is shown as text, never thrown on. */
export const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const num = (n: number) => String(Math.round(n * 100) / 100);
export const pts = (p: Pt[]) => p.map((q) => `${num(q[0])},${num(q[1])}`).join(" ");
/** A short, deterministic tag for a string (FNV-1a, 32-bit, base36). Not security-sensitive: only used to keep a
 *  generated id short while still varying with its content. */
export function tag(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
