import { dist, stitch } from "../core";
import type { Floor, Pt, WallKind } from "../core";
import { newId, slug, type Sel } from "./state";

// Draw mode without the DOM: a state machine that collects points, and a pure
// function that turns the finished shape into a new floor. The editor only
// feeds it snapped points and draws what it reports.

export type DrawKind = "room" | "zone" | "water" | "outline" | "wall" | "opening" | "extra";
export interface Shape { kind: DrawKind; wall: WallKind; pts: Pt[] }
export type ClickResult = "add" | "ignore" | "finish";

const POLYGONS: readonly DrawKind[] = ["room", "zone", "water", "outline"];
/** A single segment: the second click finishes it. Walls chain instead. */
const SEGMENTS: readonly DrawKind[] = ["opening", "extra"];
const SAME = 1; // cm: a click this close to the last point is the second click of a double-click

export class Draw {
  points: Pt[] = [];
  constructor(readonly kind: DrawKind, readonly wall: WallKind = "wall") {}

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
    if (n && dist(pt, this.points[n - 1]) < SAME) return "ignore";
    this.points.push([pt[0], pt[1]]);
    return SEGMENTS.includes(this.kind) && this.points.length === 2 ? "finish" : "add";
  }

  backspace(): boolean { return this.points.pop() !== undefined; }
  cancel() { this.points = []; }

  /** The finished shape, or null when there are too few points. Either way the points are cleared. */
  finish(): Shape | null {
    const pts = this.points;
    this.points = [];
    return pts.length >= this.min ? { kind: this.kind, wall: this.wall, pts } : null;
  }

  /** The dashed path to draw: the points so far and the pointer. Null before the first point. */
  rubber(pt: Pt): Pt[] | null { return this.points.length ? [...this.points, pt] : null; }
}

/** The floor with `s` added, and what to select. Does not touch `f`. */
export function applyShape(f: Floor, floor: string, s: Shape): { floor: Floor; sel: Sel } {
  const g = structuredClone(f), pts = s.pts.map((p): Pt => [p[0], p[1]]);
  let sel: Sel = null;
  if (s.kind === "outline") {
    g.outline = pts;
    sel = { t: "edge", poly: "o", i: 0 };
  } else if (s.kind === "room" || s.kind === "zone" || s.kind === "water") {
    const name = `New ${s.kind}`, dotted = s.kind !== "room";
    g.rooms.push({ id: newId(g, floor, "room"), name, area: s.kind === "water" ? "" : slug(name), label: "", kind: s.kind, pts, wk: pts.map((): WallKind => (dotted ? "boundary" : "wall")) });
    sel = { t: "room", i: g.rooms.length - 1 };
  } else if (s.kind === "wall") {
    for (let i = 1; i < pts.length; i++) g.walls.push({ id: newId(g, floor, "wall"), a: pts[i - 1], b: [pts[i][0], pts[i][1]], kind: s.wall });
    sel = { t: "wall", i: g.walls.length - 1 };
  } else if (s.kind === "opening") {
    g.openings.push({ id: newId(g, floor, "opening"), a: pts[0], b: pts[1] });
    sel = { t: "opening", i: g.openings.length - 1 };
  } else {
    g.extras.push({ id: newId(g, floor, "extra"), name: "New line", a: pts[0], b: pts[1] });
  }
  // A polygon corner on another polygon's edge becomes a point of it, as when a corner is dropped. `stitch` itself leaves zones alone.
  if (POLYGONS.includes(s.kind)) return { floor: pts.reduce((h, p) => stitch(h, p), g), sel };
  return { floor: g, sel };
}
