// The 2.5D solids: walls, furniture, appliances and stairs drawn as extruded shapes. Pure string builders; `renderFloor`
// decides when to call them and in what order (one draw path, CLAUDE.md finding 8). Nothing here knows the OBLIQUE
// numbers: they arrive in a `Proj`, so this file never imports render.ts.
import { deviceZ, deviceZOr, doorSpan, edgeHeight, floorHeight, furnitureBottom, furnitureHeight, furnitureTop, openingSpan, radiatorSpan, unlinkedHeight, wallHeight } from "./heights";
import { esc, num, pts, tag } from "./fmt";
import { edgeKindAt, nearestEdge, stairSteps } from "./geometry";
import { doorStateOf, type DoorState } from "./door-state";
import type { StateOverlay } from "./render";
import type { Device, DeviceType, DoorKind, Floor, Furniture, FurnitureSymbol, Pt, StairDirection, Stairs, Unlinked } from "./schema";

/** A device mount at or above this height gets a stem up from its icon (a ceiling light yes, a plug no). */
export const STEM_MIN_Z = 100;

/** What `renderFloor` hands in: the projection, in the frame of the plan group (so a turned plan still lifts screen-up). */
export interface Proj {
  /** Where a plan point at height h cm is drawn, in plan coordinates. */
  lift: (p: Pt, h: number) => Pt;
  /** A plan point in the screen frame: for facing and depth, which are what the viewer sees. */
  scr: (p: Pt) => Pt;
  rise: number;
  skew: number;
  cutaway: number;
}
/** A drawn thing and where it stands in the back-to-front order: the larger, the nearer. */
export interface Solid {
  key: number; svg: string;
  /** Lies below the floor (a stairwell): drawn before every standing thing, in key order among its own kind, not sorted with them. */
  under?: boolean;
}

const finite = (p: unknown): p is Pt => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
/** Nearer to the viewer is larger: the camera is south and a little west of the plan, so down and left are near. */
const depth = (px: Proj, p: Pt) => { const s = px.scr(p); return s[1] - px.skew * s[0]; };
const nearest = (px: Proj, ps: Pt[]) => Math.max(...ps.map((p) => depth(px, p)));

/**
 * The tallest thing the 2.5D view draws on a floor, in cm, before any cutaway: `viewBoxFor` widens its box by this
 * (times rise and skew) so nothing is clipped. Heights come from the resolvers in heights.ts, never from here.
 */
export function tallestDrawn(f: Floor): number {
  let top = 0;
  const up = (h: number) => { if (Number.isFinite(h) && h > top) top = h; };
  (f.outline ?? []).forEach((_, i) => up(edgeHeight(f, null, i)));
  for (const r of f.rooms ?? []) if (r.kind !== "zone") (r.pts ?? []).forEach((_, i) => up(edgeHeight(f, r, i)));
  for (const w of f.walls ?? []) up(wallHeight(f, w));
  for (const m of f.furniture ?? []) up(furnitureTop(m));
  for (const u of f.unlinked ?? []) up(unlinkedHeight(u));
  if ((f.stairs ?? []).length) up(floorHeight(f));
  for (const d of f.devices ?? []) {
    if (d.type !== "person" && !("a" in d)) { const z = deviceZ(d); if (z >= STEM_MIN_Z) up(z); }
    up(deviceSolidTop(d));
  }
  return top;
}

/** Twice the unsigned area of a polygon, by the shoelace sum. */
const area2 = (q: Pt[]) => Math.abs(q.reduce((s, a, i) => { const b = q[(i + 1) % q.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0));

/** `subject` cut down to the inside of the convex `clip` (Sutherland-Hodgman); a concave subject is fine for its area. */
function clipToConvex(subject: Pt[], clip: Pt[]): Pt[] {
  const sign = Math.sign(clip.reduce((s, a, i) => { const b = clip[(i + 1) % clip.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) || 1;
  let out = subject;
  clip.forEach((c1, i) => {
    const c2 = clip[(i + 1) % clip.length], inside = (p: Pt) => sign * ((c2[0] - c1[0]) * (p[1] - c1[1]) - (c2[1] - c1[1]) * (p[0] - c1[0])) >= 0;
    const crossing = (p: Pt, q: Pt): Pt => {
      const dp = (c2[0] - c1[0]) * (p[1] - c1[1]) - (c2[1] - c1[1]) * (p[0] - c1[0]), dq = (c2[0] - c1[0]) * (q[1] - c1[1]) - (c2[1] - c1[1]) * (q[0] - c1[0]), t = dp / (dp - dq);
      return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    };
    const prev = out;
    out = [];
    prev.forEach((p, j) => {
      const q = prev[(j + 1) % prev.length];
      if (inside(p)) { out.push(p); if (!inside(q)) out.push(crossing(p, q)); } else if (inside(q)) out.push(crossing(p, q));
    });
  });
  return out;
}

/**
 * How much a wall facing the viewer is lowered, 0 (keeps its height) to 1 (drawn at the cutaway), by how squarely it
 * faces down the screen: `ny` is the y of its normal, or of the unit vector across a free wall, in the screen frame.
 * Up to EASE_FROM a wall is seen side-on or from behind and keeps its height; from EASE_TO it faces the viewer and is cut;
 * between the two it eases (smoothstep), so a turning plan never snaps a wall and two walls at one angle always agree.
 * An axis-aligned plan lands on the ends (sides 0, front 1), and so does a 45 degree one (0.71 is past EASE_TO).
 */
const EASE_FROM = 0.2, EASE_TO = 0.6;
function ease(ny: number): number {
  const t = Math.min(1, Math.max(0, (ny - EASE_FROM) / (EASE_TO - EASE_FROM)));
  return t * t * (3 - 2 * t);
}

/** A back wall that hides this much (cm of floor, measured across the wall) is cut fully; less eases in. */
const COVER_FULL_DEPTH = 30;

/**
 * How far, across the wall, the face of a wall from `a` to `b` (screen frame, `n` its outward unit normal), lifted to `h`,
 * reaches over any of the `floors` (inner rooms' outlines, screen frame): the covered area over the wall's length. The
 * wall sweeps the parallelogram from its base along the lift, and only the outward side counts: its own room lies
 * behind it, and the sides it leans over are the side walls' business.
 */
function coveredDepth(px: Proj, a: Pt, b: Pt, n: Pt, h: number, floors: Pt[][]): number {
  const lift: Pt = [h * px.rise * px.skew, -h * px.rise];
  if (n[0] * lift[0] + n[1] * lift[1] <= 0) return 0;
  const sweep: Pt[] = [a, b, [b[0] + lift[0], b[1] + lift[1]], [a[0] + lift[0], a[1] + lift[1]]];
  return Math.max(0, ...floors.map((q) => area2(clipToConvex(q, sweep)) / 2)) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
}

/**
 * How the 2.5D view draws wall heights (card config and View menu `walls`). "full": every wall at its model height, no
 * cutaway. "cut": the doll's house rule below, the default. "low": every wall at the cutaway height, or its own if lower.
 * A union walked by a test, so a new mode fails until someone writes down what it does (finding 17).
 */
export const WALLS_MODES = ["full", "cut", "low"] as const;
export type WallsMode = (typeof WALLS_MODES)[number];
export const WALLS_LABELS: Record<WallsMode, string> = { full: "Full height", cut: "Cutaway", low: "Low" };
/** A mode from untrusted input (a config, a saved view): anything not in the list is the default, "cut". */
export const wallsModeOf = (v: unknown): WallsMode => (typeof v === "string" && (WALLS_MODES as readonly string[]).includes(v) ? (v as WallsMode) : "cut");

/** One wall piece of the 2.5D plan: an edge or a free wall with a height above zero. */
interface WallSeg {
  a: Pt; b: Pt; h: number; /** 0..1: how far it is lowered toward the cutaway. */ cut: number; kind: string;
  /** Unit outward normals of the room edges that made this piece, in the screen frame; none for a free wall. */
  faces: Pt[];
}

/** The height a wall is drawn at: its model height lowered toward the cutaway by its cut. */
const drawnHeight = (w: WallSeg, px: Proj) => w.h - w.cut * Math.max(0, w.h - px.cutaway);

/** cm: how far off one line two pieces may sit and still be one wall; how far apart their ends may be and still touch. */
const RUN_TOL = 3, TOUCH = 1;
/** Whether two pieces lie on one straight line, within the editor's snap tolerance. */
function collinear(p: WallSeg, q: WallSeg): boolean {
  const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], len = Math.hypot(dx, dy), qx = q.b[0] - q.a[0], qy = q.b[1] - q.a[1], ql = Math.hypot(qx, qy);
  if (!len || !ql || Math.abs((dx * qy - dy * qx) / (len * ql)) > 0.02) return false;
  return [q.a, q.b].every((r) => Math.abs((r[0] - p.a[0]) * dy - (r[1] - p.a[1]) * dx) / len <= RUN_TOL);
}
/**
 * A straight wall made of several edges (rooms side by side, a vertex in the middle of a line) is one wall to the eye, so it
 * has one cut: the largest of its pieces. Pieces that overlap are always one run; pieces that only touch are one run when they
 * face the same way (an L-shaped house's two walls on one line, facing opposite ways, are two walls).
 */
function evenRuns(ws: WallSeg[]): void {
  const root = ws.map((_, i) => i), find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  const along = (p: WallSeg, r: Pt) => ((r[0] - p.a[0]) * (p.b[0] - p.a[0]) + (r[1] - p.a[1]) * (p.b[1] - p.a[1])) / (Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) || 1);
  const sameFace = (p: WallSeg, q: WallSeg) => p.faces.some((n) => q.faces.some((m) => n[0] * m[0] + n[1] * m[1] > 0.99));
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
    const p = ws[i], q = ws[j];
    if (!collinear(p, q)) continue;
    const len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]), t0 = Math.min(along(p, q.a), along(p, q.b)), t1 = Math.max(along(p, q.a), along(p, q.b));
    const overlap = Math.min(len, t1) - Math.max(0, t0);
    if (overlap > TOUCH || (overlap >= -TOUCH && sameFace(p, q))) root[find(i)] = find(j);
  }
  const top = new Map<number, number>();
  ws.forEach((w, i) => top.set(find(i), Math.max(top.get(find(i)) ?? 0, w.cut)));
  ws.forEach((w, i) => { w.cut = top.get(find(i))!; });
}

/** Twice the signed area in the screen frame; its sign says which way the polygon winds, so which side of an edge is outside. */
function winding(px: Proj, ps: Pt[]): number {
  const q = ps.map(px.scr);
  return q.reduce((s, a, i) => { const b = q[(i + 1) % q.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
}

/**
 * Every edge and free wall that has a height, once each.
 *
 * Cutaway rule, one for every wall. A wall keeps the height its model gives it (heights.ts), wherever it stands and
 * whatever the turn, except where it would hide a floor the viewer wants to see. The viewer is at the south, so:
 *   - a wall whose outward normal points down the screen would hide the room it closes: lowered (a doll's house with
 *     the front taken off);
 *   - a wall facing up the screen hides what lies outside it, which matters only when that is another room: lowered
 *     when its lift covers the floor of a room of kind "room". A garden, pavement, terrace, fill, water, structure or
 *     zone behind a wall is not an interior and never counts (Diego's field report, 2026-10-03: a lawn behind the house
 *     had cut every back wall flat);
 *   - a wall seen side-on keeps its height.
 * "Lowered" is one constant, `cutaway`, and the step to it is eased in the angle (see `ease`), not a snap. A free wall has
 * no outside; it is judged by how horizontal it is on screen, by the same ease. The whole segment takes the cut, not just
 * the covered part: a wall that steps up and down along its length would read as a fault.
 */
export function collectWalls(f: Floor, px: Proj, mode: WallsMode = "cut"): WallSeg[] {
  const out: WallSeg[] = [];
  const floors = (f.rooms ?? []).filter((r) => r?.kind === "room").map((r) => r.pts).filter((q): q is Pt[] => Array.isArray(q) && q.length >= 3 && q.every(finite)).map((q) => q.map(px.scr));
  const polys: { pts: Pt[]; room: Floor["rooms"][number] | null }[] = [{ pts: f.outline ?? [], room: null }, ...(f.rooms ?? []).filter((r) => r.kind !== "zone").map((room) => ({ pts: room.pts ?? [], room }))];
  for (const P of polys) {
    if (!Array.isArray(P.pts) || P.pts.length < 3 || !P.pts.every(finite)) continue;
    const dir = Math.sign(winding(px, P.pts));
    const wk = (P.room ? P.room.wk : f.owk) as unknown;
    P.pts.forEach((a, i) => {
      const b = P.pts[(i + 1) % P.pts.length], h = edgeHeight(f, P.room, i);
      if (!(h > 0)) return;
      const s = px.scr(a), t = px.scr(b), len = Math.hypot(t[0] - s[0], t[1] - s[1]) || 1;
      // Screen y points down; for a polygon with positive winding the outward normal of a->b is (dy, -dx), so its y is -dx.
      const nx = (dir * (t[1] - s[1])) / len, ny = (dir * -(t[0] - s[0])) / len;
      const toward = ease(Math.abs(ny));
      const cut = dir === 0 ? 0 : ny > 0 ? toward : toward && toward * Math.min(1, coveredDepth(px, s, t, [nx, ny], h, floors) / COVER_FULL_DEPTH);
      out.push({ a, b, h, cut, faces: dir === 0 ? [] : [[nx, ny]], kind: Array.isArray(wk) && typeof wk[i] === "string" ? (wk[i] as string) : P.room ? "wall" : "external" });
    });
  }
  for (const w of f.walls ?? []) {
    if (!finite(w.a) || !finite(w.b)) continue;
    const h = wallHeight(f, w);
    if (!(h > 0)) continue;
    const s = px.scr(w.a), t = px.scr(w.b);
    out.push({ a: w.a, b: w.b, h, cut: ease(Math.abs(t[0] - s[0]) / (Math.hypot(t[0] - s[0], t[1] - s[1]) || 1)), faces: [], kind: String(w.kind) });
  }
  // The same edge twice (a room's wall on the outline, two rooms side by side) is one wall: the taller, the more
  // exposed (the most cut) and the external kind win, so a doubled edge never draws doubled.
  const seen = new Map<string, WallSeg>();
  for (const w of out) {
    const k = [w.a, w.b].map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).sort().join("|");
    const o = seen.get(k);
    if (!o) { seen.set(k, { ...w }); continue; }
    o.cut = Math.max(o.cut, w.cut);
    o.faces = [...o.faces, ...w.faces];
    if (w.h > o.h) { o.h = w.h; o.kind = w.kind; }
    if (w.kind === "external") o.kind = "external";
  }
  const walls = [...seen.values()];
  if (mode === "cut") evenRuns(walls);
  else for (const w of walls) w.cut = mode === "low" ? 1 : 0;
  return walls;
}

/**
 * What fills the hole an opening cuts between its sill and head: nothing (a door stands open, a plain opening is a
 * gap), a translucent band of glass (a window, a glass door) or a solid panel (sealed, as the 2D plan draws it). `void`
 * (an open doorway) is a gap that draws nothing closed and the red frame when its sensors say open. One
 * entry per DoorKind, so a new kind fails the test that walks DOOR_KINDS until someone decides (finding 17).
 */
export const OPENING_FILL: Record<DoorKind | "opening", "gap" | "void" | "glass" | "panel"> = { door: "gap", open: "void", opening: "gap", glass: "glass", window: "glass", slit: "glass", fullwindow: "glass", sealed: "panel" };
/** S25.D1 (Diego, 2026-10-09): a door and a glass door fill their gap only while a sensor says closed; with none, or any other state, they are a hole. */
export const SHUT_KINDS: readonly string[] = ["door", "glass"];
const has = <T extends string>(table: Record<T, unknown>, k: unknown): k is T => typeof k === "string" && Object.prototype.hasOwnProperty.call(table, k);

/** A door, window or opening as the wall sees it: where it lies and between which heights, and what its sensors say. */
interface Span { a: Pt; b: Pt; at: (ceiling: number) => { sill: number; head: number }; kind: string; live: DoorState }
const CLOSED: DoorState = { open: false, contact: false, unlocked: false, alarm: false, cover: false, closed: false };
const spansOf = (f: Floor, state: StateOverlay | undefined): Span[] => [
  ...(f.doors ?? []).filter((d) => finite(d.a) && finite(d.b)).map((d) => ({ a: d.a, b: d.b, at: (c: number) => doorSpan(d, c), kind: String(d.kind), live: doorStateOf(d, state) })),
  ...(f.openings ?? []).filter((o) => finite(o.a) && finite(o.b)).map((o) => ({ a: o.a, b: o.b, at: () => openingSpan(o), kind: "opening", live: CLOSED })),
];
/** The state classes an opening's infill wears: red for open or alarm (solid), the cover's own colour for an open cover. */
const liveClass = (l: DoorState) => `${l.open ? " open" : ""}${l.alarm ? " alarm" : ""}${l.cover ? " cover-open" : ""}`;
/** How far from a wall's line an opening's middle may sit and still be in it: the editor's own snap tolerance (render.ts, DOOR_WALL_TOL). */
export const HOST_TOL = 10;

/** The part of `span` that lies in the wall, as distances along it, or null when the span is not in this wall. */
export function within(w: Pick<WallSeg, "a" | "b">, span: Pick<Span, "a" | "b">): [number, number] | null {
  const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy);
  if (!len) return null;
  const ux = dx / len, uy = dy / len, sx = span.b[0] - span.a[0], sy = span.b[1] - span.a[1], sl = Math.hypot(sx, sy);
  if (!sl || Math.abs(ux * (sy / sl) - uy * (sx / sl)) > 0.05) return null; // not parallel
  const m: Pt = [(span.a[0] + span.b[0]) / 2, (span.a[1] + span.b[1]) / 2];
  const along = (m[0] - w.a[0]) * ux + (m[1] - w.a[1]) * uy;
  const off = Math.abs((m[0] - w.a[0]) * uy - (m[1] - w.a[1]) * ux);
  if (off > HOST_TOL || along < 0 || along > len) return null;
  const clamp = (v: number) => Math.max(0, Math.min(len, v));
  const t0 = clamp((span.a[0] - w.a[0]) * ux + (span.a[1] - w.a[1]) * uy), t1 = clamp((span.b[0] - w.a[0]) * ux + (span.b[1] - w.a[1]) * uy);
  return t1 === t0 ? null : [Math.min(t0, t1), Math.max(t0, t1)];
}

/** The kind of wall as a class suffix: nothing for a plain wall, so the colour rules key on `external` and `fence`. */
const kindClass = (kind: string) => (kind === "wall" ? "" : ` ${esc(kind)}`);

/**
 * cm the top of a wall is drawn across in 2.5D at the default tilt: its footprint is 10 (20 external), but the cap is a
 * rim on a solid, and a full-width one outweighs the face under it. It thins with the tilt (no lift, no change), by an
 * inline style, which beats the kind rules in the stylesheet whatever their specificity.
 */
const CAP_WIDTH = 7, CAP_WIDTH_EXTERNAL = 12, FLAT_WIDTH = 10, FLAT_WIDTH_EXTERNAL = 20, CAP_FULL_RISE = 0.55;
/** cm up from the floor the darker foot of a wall face reaches. */
const FOOT_HEIGHT = 12;

/**
 * How a wall face is lit, by which way it looks on screen: a fixed light from the upper left, so a face turned toward
 * it is "lit", one turned away "dim", and one that looks straight at the viewer is the plain tone. The screen frame, so
 * turning the plan turns the light with the viewer, and two walls at one angle always agree. Returns the unit normal
 * (in the plan's own frame) that faces the camera, for the highlight, and the class suffix.
 */
function lighting(w: WallSeg, px: Proj, ux: number, uy: number): { tone: string; toward: Pt } {
  const n: Pt = [uy, -ux], s = px.scr(w.a), t = px.scr([w.a[0] + n[0], w.a[1] + n[1]]), v: Pt = [t[0] - s[0], t[1] - s[1]];
  const flip = v[1] - px.skew * v[0] < 0, sx = flip ? -v[0] : v[0];
  return { tone: sx < -0.35 ? " lit" : sx > 0.35 ? " dim" : "", toward: flip ? [-n[0], -n[1]] : n };
}

/**
 * Every wall as side faces plus a top, with its openings cut out: below the sill a block, above the head a header,
 * between them nothing (a plain opening), a painted leaf (a closed door), a red frame (an open one), a glass band (a
 * window, a glass door) or a panel (sealed). `state` is what the sensors say: an open or alarmed opening wears the
 * same red as its line in 2D (Diego, 0.12.23).
 */
export function wallSolids(f: Floor, px: Proj, mode: WallsMode = "cut", state?: StateOverlay): Solid[] {
  const spans = spansOf(f, state);
  return collectWalls(f, px, mode).map((w) => {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), ux = (w.b[0] - w.a[0]) / len, uy = (w.b[1] - w.a[1]) / len;
    // Seen from straight above (no lift) a wall has no face: it is drawn exactly as it always was.
    const solid = px.rise > 0, hh = drawnHeight(w, px), { tone, toward } = solid ? lighting(w, px, ux, uy) : { tone: "", toward: [0, 0] as Pt };
    const at = (t: number): Pt => [w.a[0] + ux * t, w.a[1] + uy * t];
    const quad = (t0: number, t1: number, z0: number, z1: number, cls: string) =>
      z1 > z0 && t1 > t0 ? `<polygon class="${cls}" points="${pts([px.lift(at(t0), z0), px.lift(at(t1), z0), px.lift(at(t1), z1), px.lift(at(t0), z1)])}"/>` : "";
    const wall = `ws${kindClass(w.kind)}${tone}`;
    /** A block of wall from the floor to `z1`, with its darker foot. */
    const block = (t0: number, t1: number, z1: number) => quad(t0, t1, 0, z1, wall) + (solid ? quad(t0, t1, 0, Math.min(z1, FOOT_HEIGHT), "wfoot") : "");
    const here = spans.map((s) => ({ s, r: within(w, s) })).filter((x): x is { s: Span; r: [number, number] } => x.r !== null).sort((p, q) => p.r[0] - q.r[0]);
    const faces: string[] = [], tops: [number, number][] = [];
    const top = (t0: number, t1: number) => { const last = tops[tops.length - 1]; if (last && last[1] >= t0 - 0.01) last[1] = Math.max(last[1], t1); else tops.push([t0, t1]); };
    let cursor = 0;
    for (const { s, r } of here) {
      const t0 = Math.max(r[0], cursor), t1 = r[1];
      if (t1 <= t0) continue;
      faces.push(block(cursor, t0, hh));
      if (t0 > cursor) top(cursor, t0);
      const own = s.at(w.h), sill = Math.min(own.sill, hh), head = Math.min(own.head, hh), live = solid ? liveClass(s.live) : "";
      faces.push(block(t0, t1, sill));
      const fill = has(OPENING_FILL, s.kind) ? OPENING_FILL[s.kind] : "gap";
      const shut = SHUT_KINDS.includes(s.kind), alert = s.live.open || s.live.alarm || s.live.cover;
      if (fill === "glass") { if (!shut || s.live.closed || alert) faces.push(quad(t0, t1, sill, head, `glass g-${esc(s.kind)}${live}`)); }
      else if (fill === "panel") faces.push(quad(t0, t1, sill, head, `ws sealed${live}`));
      // A door: closed (its sensor says so) it is a painted leaf, open (or alarmed, or its cover open) a red frame round the gap; with no sensor it is a hole. A plain opening is only a gap.
      else if (s.kind !== "opening" && solid && (live || (fill !== "void" && (!shut || s.live.closed)))) faces.push(quad(t0, t1, sill, head, live ? `opn${live}${fill === "void" ? " band" : ""}` : "door-leaf"));
      faces.push(quad(t0, t1, head, hh, wall));
      if (own.head < hh || own.sill >= hh) top(t0, t1); // a header, or a sill that reaches the top, closes the wall above the gap
      cursor = t1;
    }
    faces.push(block(cursor, len, hh));
    if (len > cursor) top(cursor, len);
    const kc = kindClass(w.kind), ext = w.kind === "external" || w.kind === "parapet", cap = ext ? CAP_WIDTH_EXTERNAL : CAP_WIDTH;
    // Only a wall and an external wall are thinned; a fence or an edge is a line already. The halo is 2 wider, as in 2D.
    const thin = solid && (w.kind === "wall" || ext) ? Math.min(1, px.rise / CAP_FULL_RISE) : 0, flat = ext ? FLAT_WIDTH_EXTERNAL : FLAT_WIDTH;
    const width = (halo: number) => (thin ? ` style="stroke-width:${num(flat + (cap - flat) * thin + halo)}"` : "");
    const lines = tops.map(([t0, t1]) => {
      const a = px.lift(at(t0), hh), b = px.lift(at(t1), hh), g = `x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"`;
      // The lit edge of the face: a thin line on the cap's near edge, drawn after the cap so it shows.
      const o: Pt = [(toward[0] * cap) / 2, (toward[1] * cap) / 2], ha = px.lift([at(t0)[0] + o[0], at(t0)[1] + o[1]], hh), hb = px.lift([at(t1)[0] + o[0], at(t1)[1] + o[1]], hh);
      return `<line class="eh${kc} top" ${g}${width(2)}/><line class="e${kc} top" ${g}${width(0)}/>${solid ? `<line class="wl" x1="${num(ha[0])}" y1="${num(ha[1])}" x2="${num(hb[0])}" y2="${num(hb[1])}"/>` : ""}`;
    });
    return { key: nearest(px, [w.a, w.b]), svg: faces.join("") + lines.join("") };
  });
}

/** `p` turned clockwise by `deg` about `c` (y points down, the way SVG's rotate() turns). */
export function turnAbout(p: Pt, deg: number, c: Pt): Pt {
  const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a), dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs];
}

/**
 * A straight-sided block: the side faces the viewer sees, then the lid. A face is seen when its outward normal, in the
 * screen frame, points toward the camera (south and a little west): ny > skew * nx. The rest are hidden by the lid and
 * the near faces, so they are not drawn. Returns the markup, or null for a base with no area or a height of zero.
 */
function prism(base: Pt[], h: number, px: Proj, z0 = 0): string | null {
  const dir = Math.sign(winding(px, base));
  if (!dir || !(h > 0) || !base.every(finite)) return null;
  const faces = base.map((a, i) => {
    const b = base[(i + 1) % base.length], s = px.scr(a), t = px.scr(b), len = Math.hypot(t[0] - s[0], t[1] - s[1]) || 1;
    const nx = (dir * (t[1] - s[1])) / len, ny = (dir * -(t[0] - s[0])) / len;
    return ny > px.skew * nx + 1e-9 ? `<polygon class="bs${Math.abs(nx) > Math.abs(ny) ? " w" : ""}" points="${pts(z0 ? [px.lift(a, z0), px.lift(b, z0), px.lift(b, h), px.lift(a, h)] : [a, b, px.lift(b, h), px.lift(a, h)])}"/>` : "";
  });
  return `${faces.join("")}<polygon class="bt" points="${pts(base.map((p) => px.lift(p, h)))}"/>`;
}

/**
 * What each furniture symbol becomes in 2.5D. A box is a block with the symbol on its lid; a pole (a tree) is a trunk
 * with the symbol, its crown, at the top; flat stays as drawn in 2D (a patio is 5 cm, not a thing to stand behind).
 * One entry per symbol, so a new FurnitureSymbol fails the test that walks the list until someone decides (finding 17).
 */
export const FURNITURE_SOLID: Record<FurnitureSymbol, "box" | "pole" | "flat"> = {
  table: "box", sofa: "box", bed: "box", cabinet: "box", chair: "box", sink: "box", toilet: "box", shower: "box", bathtub: "box", tv: "box", computer: "box", speaker: "box",
  car: "box", tree: "pole", "patio-wood": "flat", "patio-concrete": "flat",
};
/** How a piece of furniture draws in 2.5D. A piece that is not finite or not known is flat: the 2D path deals with it as ever. */
export function furnitureMode(m: Furniture): "box" | "pole" | "flat" {
  const ok = [m.x, m.y, m.w, m.h, m.rot].every((v) => typeof v === "number" && Number.isFinite(v)) && m.w > 0 && m.h > 0 && furnitureHeight(m) > 0;
  return ok && has(FURNITURE_SOLID, m.symbol) ? FURNITURE_SOLID[m.symbol] : "flat";
}

/**
 * S18.12: ` data-linked` for a tv, speaker or computer piece with an entity, else "". It tracks that device, and the stylesheet
 * gives it its own idle colour. An attribute, not a class: the class list (`furn`, `on`) is pinned as it is by older tests.
 * One function for the 2D and 2.5D draw paths.
 */
export function furnitureLinked(m: Furniture): string {
  return pieceDevice(m) ? " data-linked" : "";
}

/**
 * The device a linked piece stands for in the card: same type, entity and name, at the piece's own place. A tv, speaker or computer
 * piece with an entity (S18.12 "linked") is, for its state, its Active row, its room row and its tap, that device (DECISIONS
 * 2026-10-07). Null for any other piece. Built fresh each time, never stored, so the layout file is unchanged.
 */
export function pieceDevice(m: Furniture): Device | null {
  if (typeof m?.entity !== "string" || !m.entity || (m.symbol !== "tv" && m.symbol !== "speaker" && m.symbol !== "computer")) return null;
  return { id: m.id, type: m.symbol, entity: m.entity, ...(m.name ? { name: m.name } : {}), x: m.x, y: m.y };
}

/**
 * One piece of furniture as a block (or a trunk), its symbol drawn at the top. `symbol` is the symbol's own markup, and
 * the group wraps all of it, so a tap anywhere on the piece still reaches `data-f`.
 */
export function furnitureSolid(m: Furniture, i: number, mode: "box" | "pole", on: boolean, symbol: string, px: Proj, waves?: string | null): Solid | null {
  const z0 = furnitureBottom(m), h = furnitureTop(m), c: Pt = [m.x, m.y];
  const base = ([[-m.w / 2, -m.h / 2], [m.w / 2, -m.h / 2], [m.w / 2, m.h / 2], [-m.w / 2, m.h / 2]] as Pt[]).map((q) => turnAbout([m.x + q[0], m.y + q[1]], m.rot, c));
  const top = px.lift(c, h);
  let body: string;
  if (mode === "box") { const p = prism(base, h, px, z0); if (!p) return null; body = p; }
  else body = `<line class="trunk" x1="${num(c[0])}" y1="${num(c[1])}" x2="${num(top[0])}" y2="${num(top[1])}"/>`;
  const sym = `<g transform="translate(${num(top[0])} ${num(top[1])}) rotate(${num(m.rot)}) scale(${num(m.w / 100)} ${num(m.h / 100)}) translate(-50 -50)">${symbol}</g>`;
  // S18.9: a playing tv or speaker sends its waves from the lid, outside the scaled symbol group so they stay round.
  const w = waves ? waves.replace("%AT%", `${num(top[0])} ${num(top[1])}`) : "";
  return { key: nearest(px, base), svg: `<g data-f="${i}" class="furn${on ? " on" : ""}" color="var(--fp-furniture)"${furnitureLinked(m)}>${body}${sym}${w}</g>` };
}

/** cm across the block under an unlinked appliance, times its own scale: a small thing, the icon says what it is. */
export const UNLINKED_BASE = 40;
/** A low box at the appliance's own height; the icon (drawn by renderFloor, at the plan position) stays on top. */
export function unlinkedSolid(u: Unlinked, px: Proj): Solid | null {
  if (![u.x, u.y].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const scale = typeof u.scale === "number" && Number.isFinite(u.scale) && u.scale > 0 ? u.scale : 1, r = (UNLINKED_BASE * scale) / 2;
  const base: Pt[] = [[u.x - r, u.y - r], [u.x + r, u.y - r], [u.x + r, u.y + r], [u.x - r, u.y + r]];
  const p = prism(base, unlinkedHeight(u), px);
  return p ? { key: nearest(px, base), svg: `<g class="obj">${p}</g>` } : null;
}

/**
 * What each device type becomes in 2.5D, beside its icon (which stays the tap target and keeps its lift). "radiator" is the
 * heater bar as a box under a window; "speaker" a small cabinet with two drivers (speaker and media_player); "tv" a flat
 * panel on the nearest wall. One entry per DeviceType, so a new type fails the test that walks DEVICE_TYPES until someone
 * decides (finding 17).
 */
export const DEVICE_SOLID: Record<DeviceType, "radiator" | "speaker" | "tv" | "none"> = {
  light: "none", camera: "none", motion: "none", radar: "none", access_point: "none", ac: "none", speaker: "speaker", cover: "none",
  switch: "none", plug: "none", contact: "none", vibration: "none", lock: "none", temp: "none", humidity: "none", climate: "none",
  boiler: "none", battery: "none", inverter: "none", media: "speaker", tv: "tv", other: "none", heater: "radiator", computer: "none",
  server: "none", ups: "none", printer: "none", car: "none", person: "none", vacuum: "none", siren: "none", alarm: "none",
};
const kindOf = (d: Device) => (has(DEVICE_SOLID, (d as { type?: unknown } | null)?.type) ? DEVICE_SOLID[d.type] : "none");

/** cm. A radiator is 8 deep. A speaker cabinet is 20 x 20 x 30, its drivers 7 across on a face 20 wide. */
export const RADIATOR_DEEP = 8, SPEAKER_SIDE = 20, SPEAKER_HEIGHT = 30;
const RADIATOR_WALL_REACH = 25, DRIVER_R = 3.5, DRIVER_Z = 15;
/** cm. A TV panel is 100 wide, 6 thick, 60 tall, with a 3 cm bezel; it is looked for on a wall within 150 cm, and a free-standing one stands 30 cm up on its feet. */
export const TV_WIDTH = 100, TV_THICK = 6, TV_HEIGHT = 60;
const TV_BEZEL = 3, TV_WALL_REACH = 150, TV_STAND = 30;
/** Half a wall's thickness (plan: 10 cm, 20 external, kept here because render.ts imports this file): where its room face lies. */
export const wallFace = (kind: string) => (kind === "external" || kind === "parapet" ? 10 : kind === "wall" ? 5 : 0);

/** The top of a device's solid above the floor, or 0 when it has none; `viewBoxFor` widens by it. */
export function deviceSolidTop(d: Device): number {
  const k = kindOf(d);
  if (k === "radiator") return "a" in d ? radiatorSpan(d).top : 0;
  if (k === "speaker") return SPEAKER_HEIGHT;
  if (k === "tv") return deviceZOr(d, TV_STAND) + TV_HEIGHT;
  return 0;
}

/** Plan-frame unit vector that points down the screen (toward the viewer): where a free-standing screen looks. */
function downScreen(px: Proj): Pt {
  const o = px.scr([0, 0]), e1 = px.scr([1, 0]), e2 = px.scr([0, 1]);
  return [e1[1] - o[1], e2[1] - o[1]];
}

/**
 * Where a thing that hangs on a wall sorts: a wall piece is keyed by its nearer end, so a long wall that ends far to the
 * left would be drawn after a TV or a radiator on it and cover them. Such a thing takes the wall's own key, plus a hair.
 */
function onWallKey(f: Floor, hit: NonNullable<ReturnType<typeof nearestEdge>>, own: number, px: Proj): number {
  const ring = hit.poly === "o" ? f.outline : /^r\d+$/.test(hit.poly) ? f.rooms?.[+hit.poly.slice(1)]?.pts : null;
  const ends = hit.poly === "w" ? [f.walls?.[hit.i]?.a, f.walls?.[hit.i]?.b] : [ring?.[hit.i], ring?.[(hit.i + 1) % (ring?.length || 1)]];
  return ends.every(finite) ? Math.max(own, nearest(px, ends as Pt[]) + 0.01) : own;
}

/**
 * Where a TV stands: the centre `c` of its back, the unit normal `n` it looks along, the offset `off` of its back from `c`
 * along `n`, and the height `z0` of its bottom. On the nearest wall within 150 cm it is flush with the room's face of that wall;
 * with none near it stands free, `down` (the way the viewer looks) in front of it, 30 cm up. Shared by the 2.5D solid and the 3D scene.
 */
export function tvPlacement(f: Floor, d: Device, down: Pt): { c: Pt; n: Pt; off: number; z0: number; hit: ReturnType<typeof nearestEdge> } | null {
  if (!("x" in d) || ![d.x, d.y].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const p: Pt = [d.x, d.y], hit = nearestEdge(f, p, TV_WALL_REACH, { walls: true });
  if (!hit) return { c: p, n: down, off: -TV_THICK / 2, z0: deviceZOr(d, TV_STAND), hit };
  const side: Pt = [hit.u[1], -hit.u[0]], flip = (p[0] - hit.q[0]) * side[0] + (p[1] - hit.q[1]) * side[1] < 0;
  return { c: hit.q, n: flip ? [-side[0], -side[1]] : side, off: wallFace(edgeKindAt(f, hit.poly, hit.i)), z0: deviceZ(d), hit };
}

/** A flat panel `TV_THICK` thick on a wall of the room the TV is in, or standing free when no wall is near. */
function tvSolid(f: Floor, d: Device, on: string, px: Proj): Solid | null {
  const place = tvPlacement(f, d, downScreen(px));
  if (!place) return null;
  const { c, n, off, z0, hit } = place;
  const u: Pt = [-n[1], n[0]], at = (t: number, o: number): Pt => [c[0] + u[0] * t + n[0] * o, c[1] + u[1] * t + n[1] * o];
  const w = TV_WIDTH / 2, base = [at(-w, off), at(w, off), at(w, off + TV_THICK), at(-w, off + TV_THICK)], z1 = z0 + TV_HEIGHT;
  const body = prism(base, z1, px, z0);
  if (!body) return null;
  const s = px.scr(c), t = px.scr([c[0] + n[0], c[1] + n[1]]), v: Pt = [t[0] - s[0], t[1] - s[1]];
  const b = TV_BEZEL, screen = v[1] - px.skew * v[0] > 1e-9
    ? `<polygon class="tv-screen" points="${pts([px.lift(at(-w + b, off + TV_THICK), z0 + b), px.lift(at(w - b, off + TV_THICK), z0 + b), px.lift(at(w - b, off + TV_THICK), z1 - b), px.lift(at(-w + b, off + TV_THICK), z1 - b)])}"/>`
    : "";
  return { key: hit ? onWallKey(f, hit, nearest(px, base), px) : nearest(px, base), svg: `<g class="obj dsolid tv ${on}">${body}${screen}</g>` };
}

/** The heater bar as a box: 8 cm deep along the bar, from 10 cm up to its top. */
function radiatorSolid(f: Floor, d: Device, on: string, px: Proj): Solid | null {
  if (!("a" in d) || !finite(d.a) || !finite(d.b)) return null;
  const len = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]), { bottom, top } = radiatorSpan(d);
  if (!len || !(top > bottom)) return null;
  const h = RADIATOR_DEEP / 2, nx = ((d.b[1] - d.a[1]) / len) * h, ny = (-(d.b[0] - d.a[0]) / len) * h;
  const base: Pt[] = [[d.a[0] + nx, d.a[1] + ny], [d.b[0] + nx, d.b[1] + ny], [d.b[0] - nx, d.b[1] - ny], [d.a[0] - nx, d.a[1] - ny]];
  const body = prism(base, top, px, bottom);
  // It stands under a window, on a wall: sorted after that wall, if one is within its own depth of the bar's middle.
  const host = nearestEdge(f, [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2], RADIATOR_WALL_REACH, { walls: true }), own = nearest(px, base);
  return body ? { key: host ? onWallKey(f, host, own, px) : own, svg: `<g class="obj dsolid radiator ${on}">${body}</g>` } : null;
}

/** A small cabinet on the floor at the device's point, two round drivers on the face that looks most at the viewer. */
function speakerSolid(d: Device, on: string, px: Proj): Solid | null {
  if (!("x" in d) || ![d.x, d.y].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const r = SPEAKER_SIDE / 2, c: Pt = [d.x, d.y], rot = typeof d.rot === "number" && Number.isFinite(d.rot) ? d.rot : 0;
  const base = ([[-r, -r], [r, -r], [r, r], [-r, r]] as Pt[]).map((q) => turnAbout([c[0] + q[0], c[1] + q[1]], rot, c));
  const body = prism(base, SPEAKER_HEIGHT, px);
  if (!body) return null;
  // Of the four faces, the one whose normal (screen frame) looks most down the screen and a little west: the front.
  const dir = Math.sign(winding(px, base));
  const score = (i: number) => {
    const s = px.scr(base[i]), t = px.scr(base[(i + 1) % 4]), len = Math.hypot(t[0] - s[0], t[1] - s[1]) || 1;
    return (dir * -(t[0] - s[0])) / len - (px.skew * dir * (t[1] - s[1])) / len;
  };
  const front = [0, 1, 2, 3].reduce((best, i) => (score(i) > score(best) ? i : best), 0);
  const a = base[front], b = base[(front + 1) % 4], u: Pt = [(b[0] - a[0]) / SPEAKER_SIDE, (b[1] - a[1]) / SPEAKER_SIDE];
  const l = px.lift([0, 0], 1), m = `matrix(${num(u[0])} ${num(u[1])} ${num(l[0])} ${num(l[1])} ${num(a[0])} ${num(a[1])})`;
  const drivers = [SPEAKER_SIDE / 4, (SPEAKER_SIDE * 3) / 4].map((t) => `<circle class="drv" transform="${m}" cx="${num(t)}" cy="${DRIVER_Z}" r="${DRIVER_R}"/>`).join("");
  return { key: nearest(px, base), svg: `<g class="obj dsolid speaker${d.type === "media" ? " media" : ""} ${on}">${body}${drivers}</g>` };
}

/** The 2.5D solid of a device, or null when its type has none or its numbers cannot be drawn. `on` is the class the icon wears. */
export function deviceSolid(f: Floor, d: Device, on: string, px: Proj): Solid | null {
  const k = kindOf(d);
  return k === "radiator" ? radiatorSolid(f, d, on, px) : k === "speaker" ? speakerSolid(d, on, px) : k === "tv" ? tvSolid(f, d, on, px) : null;
}

/**
 * The steps of a staircase as base polygons turned by `rot` about the centre of the box, as in 2D, lowest first; the
 * edge of each that faces the low end; and the outline of the whole foot, grown by `margin` cm. Null for a stair that
 * cannot be drawn. A straight flight climbs toward +x when it runs along x and toward -y when it runs along y, away from
 * the viewer, so every riser faces it. A round one climbs once round, anticlockwise on screen from the right.
 */
export function stairBlocks(t: Stairs): { steps: Pt[][]; lowEdge: number; foot: (margin: number) => Pt[] } | null {
  if (!Array.isArray(t.pts) || t.pts.length < 3 || !t.pts.every(finite)) return null;
  const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
  const rot = typeof t.rot === "number" && Number.isFinite(t.rot) ? t.rot : 0, n = stairSteps(t);
  const turn = (ps: Pt[]) => (rot ? ps.map((p) => turnAbout(p, rot, c)) : ps);
  const steps: Pt[][] = [];
  if (t.shape === "round" && typeof t.dia === "number" && t.dia > 0) {
    const R = t.dia / 2, r = typeof t.inner === "number" && t.inner > 0 ? t.inner / 2 : 0, ARC = 3;
    for (let k = 0; k < n; k++) {
      const at = (rad: number, j: number): Pt => { const a = ((k + j / ARC) * 2 * Math.PI) / n; return [c[0] + rad * Math.cos(a), c[1] + rad * Math.sin(a)]; };
      const outer = Array.from({ length: ARC + 1 }, (_, j) => at(R, j));
      steps.push(turn([...outer, ...(r ? Array.from({ length: ARC + 1 }, (_, j) => at(r, ARC - j)) : [c])]));
    }
    // The radial edge that closes a step, back to where it starts, faces the low end. The foot is a 24-gon round the outer rim.
    const foot = (m: number) => Array.from({ length: 24 }, (_, i): Pt => [c[0] + (R + m) * Math.cos((i * Math.PI) / 12), c[1] + (R + m) * Math.sin((i * Math.PI) / 12)]);
    return { steps, lowEdge: steps[0].length - 1, foot };
  }
  const along = x1 - x0 > y1 - y0, dx = (x1 - x0) / n, dy = (y1 - y0) / n;
  for (let k = 0; k < n; k++) steps.push(turn(along
    ? [[x0 + k * dx, y0], [x0 + (k + 1) * dx, y0], [x0 + (k + 1) * dx, y1], [x0 + k * dx, y1]]
    : [[x0, y1 - (k + 1) * dy], [x1, y1 - (k + 1) * dy], [x1, y1 - k * dy], [x0, y1 - k * dy]]));
  return { steps, lowEdge: along ? 3 : 2, foot: (m) => turn([[x0 - m, y0 - m], [x1 + m, y0 - m], [x1 + m, y1 + m], [x0 - m, y1 + m]]) };
}

/**
 * A staircase as steps, each a block as high as the stairs have climbed by then, the last as high as the storey.
 * The flat group renderFloor draws stays under, as the click target. `rise` is the storey height. Going `down` it is a
 * stairwell instead (`stairWell`); going `both` it rises and keeps a low rim round its foot.
 */
export function stairSolids(t: Stairs, rise: number, px: Proj, dir: StairDirection = "up"): Solid[] {
  const blocks = stairBlocks(t);
  if (!blocks) return [];
  if (dir === "down") return stairWell(blocks, px);
  const out: Solid[] = [];
  blocks.steps.forEach((turned, k) => {
    const p = prism(turned, ((k + 1) / blocks.steps.length) * rise, px);
    if (p) out.push({ key: nearest(px, turned), svg: `<g class="obj">${p}</g>` });
  });
  if (dir === "both") out.push(...stairRim(blocks.foot, px));
  return out;
}

/** cm a stairwell sinks below the floor at its lowest step: a drawing of going down, not the storey. */
export const WELL_DEPTH = 60;
/** cm the near edges of a stairwell stand above the floor. */
const WELL_RIM = 6;
/** How far out from the foot, and how high, the kerb of stairs that go both ways stands. */
export const KERB_OUT = 6, KERB_HIGH = 10;

/** A low kerb round the foot of stairs that go both ways. In segments, so each sorts against the steps by its own depth. */
function stairRim(foot: (margin: number) => Pt[], px: Proj): Solid[] {
  const inner = foot(0), outer = foot(KERB_OUT), out: Solid[] = [];
  inner.forEach((a, i) => {
    const j = (i + 1) % inner.length, base = [a, inner[j], outer[j], outer[i]], p = prism(base, KERB_HIGH, px);
    if (p) out.push({ key: nearest(px, base), svg: `<g class="obj">${p}</g>` });
  });
  return out;
}

/**
 * Stairs that go down, drawn as a stairwell in the floor: the inner walls of the opening that the viewer looks across,
 * one tread sunk lower per step with the risers that face the viewer, and a short rim on the near edges, which hide a
 * little of what lies below. The lowest step is at the low end, as when the flight goes up. Each piece sorts by depth like
 * the rest, so a lower tread behind a higher one is covered by it. The treads and the walls take a veil, darker with depth.
 */
function stairWell({ steps, lowEdge, foot }: NonNullable<ReturnType<typeof stairBlocks>>, px: Proj): Solid[] {
  const n = steps.length, outline = foot(0), out: Solid[] = [];
  /** Edge i of `base` as a quad from height z0 to z1, when the viewer does (or does not) see its outer face. */
  const face = (base: Pt[], i: number, z0: number, z1: number, cls: string, seen: boolean) => {
    const a = base[i], b = base[(i + 1) % base.length], d = Math.sign(winding(px, base)), s = px.scr(a), t = px.scr(b), len = Math.hypot(t[0] - s[0], t[1] - s[1]) || 1;
    const nx = (d * (t[1] - s[1])) / len, ny = (d * -(t[0] - s[0])) / len;
    return d && (ny > px.skew * nx + 1e-9) === seen ? `<polygon class="${cls}" points="${pts([px.lift(a, z0), px.lift(b, z0), px.lift(b, z1), px.lift(a, z1)])}"/>` : "";
  };
  const veil = (poly: string, opacity: number) => poly.replace(/^<polygon class="[^"]*"/, `<polygon class="stair-shade" opacity="${num(opacity)}"`);
  // Below the floor you see only what the opening lets through: everything sunk is clipped to the footprint at floor
  // level, or the lowered treads would hang out of the hole toward the viewer like a block. The id is a hash of the
  // footprint, as the opening mask's is, so two cards drawing this floor mint the same one.
  const clip = `fp-well-${tag(pts(outline))}`, inWell = `<g class="obj" clip-path="url(#${clip})">`;
  const walls = outline.map((_, i) => face(outline, i, 0, -WELL_DEPTH, "well-wall", false)).filter(Boolean);
  const first = Math.min(...steps.map((b) => nearest(px, b)));
  out.push({ key: first - 3, under: true, svg: `<clipPath id="${clip}"><polygon points="${pts(outline)}"/></clipPath>` });
  // A dark ground first, so what no tread covers (a round stair's well, a gap between lowered treads) reads as depth, not as the floor.
  const ground = `<polygon class="well-floor" points="${pts(outline)}"/>`;
  out.push({ key: first - 2, under: true, svg: `${inWell}${ground}${veil(ground, 0.8)}${walls.join("")}${walls.map((w) => veil(w, 0.8)).join("")}</g>` });
  steps.forEach((base, k) => {
    const z = -WELL_DEPTH + (k * WELL_DEPTH) / n, lid = `<polygon class="well-tread" points="${pts(base.map((p) => px.lift(p, z)))}"/>`;
    const riser = k ? face(base, lowEdge, z - WELL_DEPTH / n, z, "well-riser", true) : "";
    // The veil is --fp-night, 45% at best; two layers reach 70%, so the lowest step reads as deep. A riser is in shadow: darker than the tread above it.
    const op = (n - k) / n, shade = (poly: string) => (poly ? veil(poly, op) + veil(poly, op) : "");
    out.push({ key: nearest(px, base), under: true, svg: `${inWell}${riser}${shade(riser)}${lid}${shade(lid)}</g>` });
  });
  // The border of the opening, over the treads, at floor level: no tread edge ends up drawn over it.
  out.push({ key: Infinity, under: true, svg: `<polygon class="well-edge" points="${pts(outline)}"/>` });
  const rim = outline.map((_, i) => face(outline, i, 0, WELL_RIM, "well-rim", true)).filter(Boolean);
  if (rim.length) out.push({ key: Math.max(...steps.map((b) => nearest(px, b))), svg: `<g class="obj">${rim.join("")}</g>` });
  return out;
}
