import type { LooseRef, PtRef, Sel, View } from "./state";
import type { Corner } from "./ops";
import type { Floor, Layout, Pt } from "../core";

/** Shared by the editor's modules: the hit and drag shapes, and the small helpers the element and its parts both use. */

export type Hit =
  | { k: "corner"; poly: string; j: number }
  | { k: "loose"; ref: LooseRef }
  | { k: "dend"; i: number; end: "a" | "b" }
  | { k: "fscale"; i: number; corner: Corner }
  | { k: "door" | "opening" | "dev" | "furn" | "unl" | "wall" | "room" | "stairs" | "extra"; i: number }
  | { k: "edge"; poly: string; i: number }
  | { k: "bg" };

export type Drag =
  | { type: "pan"; sx: number; sy: number; v: View; button: number; moved: boolean }
  | { type: "corner"; base: Floor; from: Pt; ref: PtRef; moved: boolean; to: Pt }
  | { type: "edge"; base: Floor; ends: { from: Pt; ref: PtRef }[]; start: Pt; moved: boolean; to: Pt[] }
  | { type: "dend"; base: Floor; i: number; end: "a" | "b"; moved: boolean }
  | { type: "door"; base: Floor; i: number; off: Pt; len: number; moved: boolean }
  | { type: "opening"; base: Floor; i: number; off: Pt; len: number; moved: boolean }
  | { type: "dev"; base: Floor; i: number; off: Pt; moved: boolean }
  /** S26.11: a press on a member of a multi-selection. `movable`: not every member is locked. `before`: the layout as the first real move found it. */
  | { type: "devs"; base: Floor; is: number[]; i: number; start: Pt; movable: boolean; moved: boolean; before: Layout | null }
  /** S26.10: Shift+drag from the plan. `a` and `cur` are client pixels; `quad` the rectangle in plan space once it is a drag; `click` what a click without a drag selects. */
  | { type: "marquee"; a: [number, number]; cur: [number, number]; quad: [Pt, Pt, Pt, Pt] | null; click: Sel | undefined; moved: boolean }
  | { type: "furn"; base: Floor; i: number; off: Pt; moved: boolean }
  | { type: "unl"; base: Floor; i: number; off: Pt; moved: boolean }
  | { type: "fscale"; base: Floor; i: number; corner: Corner; moved: boolean }
  | { type: "room"; base: Floor; list: "rooms" | "stairs"; i: number; start: Pt; moved: boolean; alt?: boolean }
  /** S40.2: Move is on and the plan was pressed: the trace image follows the pointer. `from`: its place at the press; `before`: the layout as the first real move found it. */
  | { type: "trace"; start: Pt; from: Pt; moved: boolean; before: Layout | null };

export const round = (p: Pt): Pt => [Math.round(p[0]), Math.round(p[1])];

export const num = (n: number) => String(Math.round(n * 100) / 100);

/** Where the measure grid reads zero: the top-left corner of the floor's outline (lowest x, lowest y). A floor with no outline has none, so its zero is the layout's own. */
export const planZero = (f: Floor): Pt => (f.outline.length ? [Math.min(...f.outline.map((p) => p[0])), Math.min(...f.outline.map((p) => p[1]))] : [0, 0]);

export const DRAW_HINT = "Click to add points, double-click or Enter to finish, Esc to cancel";

export const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Where a door, window, opening or heater sits: a room, outline or water edge, or a free wall. Never a zone or stairs. */
export const HOST = { walls: true } as const;
