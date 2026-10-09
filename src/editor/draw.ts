import { dist, stitch } from "../core";
import type { EdgeKind, Floor, Pt, RoomKind, WallKind } from "../core";
import { closedLoop, MAX_RING } from "./ops";
import { newId, slug, type Sel } from "./state";

// Draw mode without the DOM: a state machine that collects points, and a pure
// function that turns the finished shape into a new floor. The editor only
// feeds it snapped points and draws what it reports.

export type DrawKind = "room" | "zone" | "water" | "outline" | "wall" | "opening" | "extra";
/** S4.2: the HA area a room or zone is drawn for, from "Areas not on the plan". */
export interface AreaPreset { id: string; name: string }
export interface Shape { kind: DrawKind; wall: WallKind; pts: Pt[]; area?: AreaPreset }
export type ClickResult = "add" | "ignore" | "finish";

const POLYGONS: readonly DrawKind[] = ["room", "zone", "water", "outline"];
/** A single segment: the second click finishes it. Walls chain instead. */
const SEGMENTS: readonly DrawKind[] = ["opening", "extra"];
const MAX_TYPED_CM = 10000;
const MAX_TYPED_CHARS = 8;
const SAME = 1; // cm: a click this close to the last point is the second click of a double-click

export class Draw {
  points: Pt[] = [];
  /** S26.8: the length typed so far, "350" (cm) or "3.5m". Only digits, one dot and a closing m get in. */
  typed = "";
  constructor(readonly kind: DrawKind, readonly wall: WallKind = "wall", readonly area?: AreaPreset) {}

  get polygon() { return POLYGONS.includes(this.kind); }
  /** Points a shape needs before it can finish. */
  get min() { return this.polygon ? 3 : 2; }

  /**
   * Adds `pt`. `raw` is the pointer before snapping: a click within `closeTh` of the first point,
   * with 3 or more points, closes a polygon ("finish", nothing added). With fewer points it is
   * ignored: a 2-point polygon never closes. A click on the last point adds nothing.
   */
  click(pt: Pt, closeTh = 0, raw: Pt = pt): ClickResult {
    const n = this.points.length;
    if (this.polygon && n && dist(raw, this.points[0]) <= closeTh) return n >= 3 ? "finish" : "ignore";
    // Walls chain, but a click back on the first corner closes the loop exactly there. (S1.48)
    if (this.kind === "wall" && n >= 3 && dist(raw, this.points[0]) <= closeTh) { this.points.push([this.points[0][0], this.points[0][1]]); return "finish"; }
    if (n && dist(pt, this.points[n - 1]) < SAME) return "ignore";
    this.typed = "";
    this.points.push([pt[0], pt[1]]);
    return SEGMENTS.includes(this.kind) && this.points.length === 2 ? "finish" : "add";
  }

  backspace(): boolean { return this.points.pop() !== undefined; }
  cancel() { this.points = []; this.typed = ""; }

  /** Takes one typed character; false when it does not belong (a letter, a second dot, text after the m, a full buffer). */
  type(ch: string): boolean {
    const t = this.typed;
    if (ch.length !== 1 || t.length >= MAX_TYPED_CHARS || t.endsWith("m")) return false;
    const ok = /[0-9]/.test(ch) || (ch === "." && !t.includes(".")) || (ch === "m" && /[0-9]/.test(t));
    if (ok) this.typed = t + ch;
    return ok;
  }
  untype() { this.typed = this.typed.slice(0, -1); }

  /** The typed length in cm, or null when it is empty, not a positive number or over 10 000 cm. */
  get typedCm(): number | null {
    const m = /^(\d*\.?\d*)(m?)$/.exec(this.typed);
    const n = m ? parseFloat(m[1]) * (m[2] ? 100 : 1) : NaN;
    return Number.isFinite(n) && n > 0 && n <= MAX_TYPED_CM ? n : null;
  }

  /**
   * Adds the next point at the typed length from the last point, along the direction to `toward` (the
   * pointer). Refused ("ignore", nothing added, the buffer kept) with no typed length, no point yet, or
   * no direction. The result is what `click` says, so an opening finishes on it.
   */
  placeTyped(toward: Pt): ClickResult {
    const len = this.typedCm, n = this.points.length;
    if (len === null || !n) return "ignore";
    const from = this.points[n - 1], dx = toward[0] - from[0], dy = toward[1] - from[1], r = Math.hypot(dx, dy);
    if (!Number.isFinite(r) || r === 0) return "ignore";
    // Whole centimetres, as every snapped point is (R1a): the length then differs from the typed one by under 1 cm (0 along an axis).
    return this.click([Math.round(from[0] + (dx / r) * len), Math.round(from[1] + (dy / r) * len)]);
  }

  /** The finished shape, or null when there are too few points. Either way the points are cleared. */
  finish(): Shape | null {
    const pts = this.points;
    this.points = [];
    this.typed = "";
    if (pts.length < this.min) return null;
    return this.area ? { kind: this.kind, wall: this.wall, pts, area: this.area } : { kind: this.kind, wall: this.wall, pts };
  }

  /** The dashed path to draw: the points so far and the pointer. Null before the first point. */
  rubber(pt: Pt): Pt[] | null { return this.points.length ? [...this.points, pt] : null; }
}

/**
 * `p` moved onto the nearest `stepDeg` ray from `from`, its length rounded to `grid` cm (0: 1 cm), then the point to whole cm.
 * Junk (non-finite numbers, a step that is not positive) gives `p` back unchanged; `p` on `from` too.
 */
export function snapRay(from: Pt, p: Pt, stepDeg: number, grid: number): Pt {
  return round2(rayPoint(from, p, stepDeg, grid));
}

/** `snapRay` before the point is rounded to whole cm: the exact ray, which a typed length takes its direction from. */
export function rayPoint(from: Pt, p: Pt, stepDeg: number, grid: number): Pt {
  const dx = p[0] - from[0], dy = p[1] - from[1];
  if (![dx, dy, stepDeg].every(Number.isFinite) || stepDeg <= 0) return [p[0], p[1]];
  const r = Math.hypot(dx, dy);
  if (r === 0) return [p[0], p[1]];
  const step = (stepDeg * Math.PI) / 180, a = Math.round(Math.atan2(dy, dx) / step) * step;
  const g = Number.isFinite(grid) && grid > 0 ? grid : 1, len = Math.round(r / g) * g;
  return [from[0] + len * Math.cos(a), from[1] + len * Math.sin(a)];
}
// Whole centimetres, as every other draw snap gives (editor-app's round()): no 200.00000000000003 in a stored wall.
const round2 = (p: Pt): Pt => [Math.round(p[0]), Math.round(p[1])];

/**
 * The room kind a ring of walls becomes. The wall kinds are the truth (they are kept as `wk`), so the kind
 * follows them: all boundary is a zone, all fence or edge a garden, anything else a room. A zone may hold
 * boundary edges only; a room and a garden hold any kind. (Opus review)
 */
export function roomKindFor(kinds: readonly WallKind[]): RoomKind {
  if (kinds.every((k) => k === "boundary")) return "zone";
  if (kinds.every((k) => k === "fence" || k === "edge")) return "garden";
  return "room";
}

/** The floor with `s` added, and what to select. Does not touch `f`. */
export function applyShape(f: Floor, floor: string, s: Shape): { floor: Floor; sel: Sel; note?: string } {
  const g = structuredClone(f), pts = s.pts.map((p): Pt => [p[0], p[1]]);
  let sel: Sel = null;
  if (s.kind === "outline") {
    // owk must track the outline point for point (Opus review): kept when the redraw has the same
    // point count as before (the old kinds still line up corner for corner), external otherwise, since
    // a reshaped outline has no way to know which old edge a new one corresponds to.
    g.owk = g.owk && g.owk.length === pts.length ? g.owk : pts.map((): EdgeKind => "external");
    g.outline = pts;
    sel = { t: "edge", poly: "o", i: 0 };
  } else if (s.kind === "room" || s.kind === "zone" || s.kind === "water") {
    const name = s.area?.name ?? `New ${s.kind}`, dotted = s.kind !== "room";
    g.rooms.push({ id: newId(g, floor, "room"), name, area: s.kind === "water" ? "" : s.area?.id ?? slug(name), kind: s.kind, pts, wk: pts.map((): WallKind => (dotted ? "boundary" : "wall")) });
    sel = { t: "room", i: g.rooms.length - 1 };
  } else if (s.kind === "wall") {
    for (let i = 1; i < pts.length; i++) g.walls.push({ id: newId(g, floor, "wall"), a: pts[i - 1], b: [pts[i][0], pts[i][1]], kind: s.wall });
    sel = { t: "wall", i: g.walls.length - 1 };
    // A loop the last wall closes becomes a room, a zone or a garden, and its walls go. (S1.48)
    const loop = closedLoop(g, g.walls.length - 1, 2, pts[0]);
    const n = pts.length - 1;
    if (!loop && n > MAX_RING && dist(pts[0], pts[n]) <= 2) return { floor: g, sel, note: `${n} walls, too many to make a room (max ${MAX_RING})` };
    if (loop) {
      const kinds = loop.walls.map((i) => g.walls[i].kind), kind = roomKindFor(kinds);
      // Walls come in walking order, so wall k is the edge from corner k to corner k+1.
      g.walls = g.walls.filter((_, i) => !loop.walls.includes(i));
      g.rooms.push({ id: newId(g, floor, "room"), name: `New ${kind}`, area: "", kind, pts: loop.pts, wk: kinds as EdgeKind[] });
      sel = { t: "room", i: g.rooms.length - 1 };
      const note = `${kind === "room" ? "Room" : kind === "zone" ? "Zone" : "Garden"} created from ${kinds.length} walls`;
      const h = kind === "zone" ? g : loop.pts.reduce((x, p) => stitch(x, p), g);
      return { floor: h, sel, note };
    }
  } else if (s.kind === "opening") {
    g.openings.push({ id: newId(g, floor, "opening"), a: pts[0], b: pts[1] });
    sel = { t: "opening", i: g.openings.length - 1 };
  } else {
    g.extras.push({ id: newId(g, floor, "extra"), name: "New line", a: pts[0], b: pts[1] });
    sel = { t: "extra", i: g.extras.length - 1 };
  }
  // A polygon corner on another polygon's edge becomes a point of it, as when a corner is dropped. `stitch` itself leaves zones alone.
  if (POLYGONS.includes(s.kind)) return { floor: pts.reduce((h, p) => stitch(h, p), g), sel };
  return { floor: g, sel };
}
