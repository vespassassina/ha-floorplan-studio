// Small string helpers for the SVG that `renderFloor` and `solids.ts` build as text. One copy, so the flat and the 2.5D
// drawing can never escape or round differently.
import type { Pt } from "./schema";

/** Text for markup. A name that is not text (a layout that skipped `validate`) is shown as text, never thrown on. */
export const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const num = (n: number) => String(Math.round(n * 100) / 100);
export const pts = (p: Pt[]) => p.map((q) => `${num(q[0])},${num(q[1])}`).join(" ");
