// The 2.5D solids: walls, furniture, appliances and stairs drawn as extruded shapes. Pure string builders; `renderFloor`
// decides when to call them and in what order (one draw path, CLAUDE.md finding 8). Nothing here knows the OBLIQUE
// numbers: they arrive in a `Proj`, so this file never imports render.ts.
import { deviceZ, doorSpan, edgeHeight, floorHeight, furnitureHeight, openingSpan, unlinkedHeight, wallHeight } from "./heights";
import { esc, num, pts } from "./fmt";
import type { Floor, Pt } from "./schema";

/** A device mount at or above this height gets a stem up from its icon (a ceiling light yes, a plug no). */
export const STEM_MIN_Z = 100;

/** What `renderFloor` hands in: the projection, in the frame of the plan group (so a turned plan still lifts screen-up). */
export interface Proj {
  /** Where a plan point at height h cm is drawn, in plan coordinates. */
  lift: (p: Pt, h: number) => Pt;
  /** A plan point in the screen frame: for facing and depth, which are what the viewer sees. */
  scr: (p: Pt) => Pt;
  skew: number;
  cutaway: number;
}
/** A drawn thing and where it stands in the back-to-front order: the larger, the nearer. */
export interface Solid { key: number; svg: string }

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
  for (const m of f.furniture ?? []) up(furnitureHeight(m));
  for (const u of f.unlinked ?? []) up(unlinkedHeight(u));
  if ((f.stairs ?? []).length) up(floorHeight(f));
  for (const d of f.devices ?? []) if (d.type !== "person" && !("a" in d)) { const z = deviceZ(d); if (z >= STEM_MIN_Z) up(z); }
  return top;
}

/** One wall piece of the 2.5D plan: an edge or a free wall with a height above zero. */
interface WallSeg { a: Pt; b: Pt; h: number; front: boolean; kind: string }

/** Twice the signed area in the screen frame; its sign says which way the polygon winds, so which side of an edge is outside. */
function winding(px: Proj, ps: Pt[]): number {
  const q = ps.map(px.scr);
  return q.reduce((s, a, i) => { const b = q[(i + 1) % q.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
}

/**
 * Every edge and free wall that has a height, once each.
 *
 * Cutaway rule. A wall hides what is behind it, and the viewer is at the south, so a wall whose outward normal points
 * down the screen (+y) would hide the room it closes. Such a wall is drawn at most `cutaway` cm high, like a doll's
 * house with the front taken off; back and side walls keep their full height. A free wall has no outside, so one that
 * is mostly horizontal on screen counts as front. `front` marks them; the cut itself is applied where the faces are made.
 */
function collectWalls(f: Floor, px: Proj): WallSeg[] {
  const out: WallSeg[] = [];
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
      const ny = (dir * -(t[0] - s[0])) / len;
      out.push({ a, b, h, front: dir !== 0 && ny > 0.3, kind: Array.isArray(wk) && typeof wk[i] === "string" ? (wk[i] as string) : P.room ? "wall" : "external" });
    });
  }
  for (const w of f.walls ?? []) {
    if (!finite(w.a) || !finite(w.b)) continue;
    const h = wallHeight(f, w);
    if (!(h > 0)) continue;
    const s = px.scr(w.a), t = px.scr(w.b);
    out.push({ a: w.a, b: w.b, h, front: Math.abs(t[0] - s[0]) > Math.abs(t[1] - s[1]), kind: String(w.kind) });
  }
  // The same edge twice (a room's wall on the outline, two rooms side by side) is one wall: the taller, the more
  // exposed (front) and the external kind win, so a doubled edge never draws doubled.
  const seen = new Map<string, WallSeg>();
  for (const w of out) {
    const k = [w.a, w.b].map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).sort().join("|");
    const o = seen.get(k);
    if (!o) { seen.set(k, { ...w }); continue; }
    o.front ||= w.front;
    if (w.h > o.h) { o.h = w.h; o.kind = w.kind; }
    if (w.kind === "external") o.kind = "external";
  }
  return [...seen.values()];
}

/** A door, window or opening as the wall sees it: where it lies and between which heights. */
interface Span { a: Pt; b: Pt; sill: number; head: number; kind: string }
const spansOf = (f: Floor): Span[] => [
  ...(f.doors ?? []).filter((d) => finite(d.a) && finite(d.b)).map((d) => ({ a: d.a, b: d.b, ...doorSpan(d), kind: String(d.kind) })),
  ...(f.openings ?? []).filter((o) => finite(o.a) && finite(o.b)).map((o) => ({ a: o.a, b: o.b, ...openingSpan(o), kind: "opening" })),
];
/** How far from a wall's line an opening's middle may sit and still be in it: the editor's own snap tolerance (render.ts, DOOR_WALL_TOL). */
const HOST_TOL = 10;

/** The part of `span` that lies in the wall, as distances along it, or null when the span is not in this wall. */
function within(w: WallSeg, span: Span): [number, number] | null {
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
 * Every wall as side faces plus a top, with its openings cut out: below the sill a block, above the head a header,
 * between them nothing (a door, an opening), a glass band (a window, a glass door) or a panel (sealed).
 */
export function wallSolids(f: Floor, px: Proj): Solid[] {
  const spans = spansOf(f);
  return collectWalls(f, px).map((w) => {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), ux = (w.b[0] - w.a[0]) / len, uy = (w.b[1] - w.a[1]) / len;
    const hh = w.front ? Math.min(w.h, px.cutaway) : w.h;
    const at = (t: number): Pt => [w.a[0] + ux * t, w.a[1] + uy * t];
    const quad = (t0: number, t1: number, z0: number, z1: number, cls: string) =>
      z1 > z0 && t1 > t0 ? `<polygon class="${cls}" points="${pts([px.lift(at(t0), z0), px.lift(at(t1), z0), px.lift(at(t1), z1), px.lift(at(t0), z1)])}"/>` : "";
    const wall = `ws${kindClass(w.kind)}`;
    const here = spans.map((s) => ({ s, r: within(w, s) })).filter((x): x is { s: Span; r: [number, number] } => x.r !== null).sort((p, q) => p.r[0] - q.r[0]);
    const faces: string[] = [], tops: [number, number][] = [];
    const top = (t0: number, t1: number) => { const last = tops[tops.length - 1]; if (last && last[1] >= t0 - 0.01) last[1] = Math.max(last[1], t1); else tops.push([t0, t1]); };
    let cursor = 0;
    for (const { s, r } of here) {
      const t0 = Math.max(r[0], cursor), t1 = r[1];
      if (t1 <= t0) continue;
      faces.push(quad(cursor, t0, 0, hh, wall));
      if (t0 > cursor) top(cursor, t0);
      const sill = Math.min(s.sill, hh), head = Math.min(s.head, hh);
      faces.push(quad(t0, t1, 0, sill, wall));
      if (s.kind === "window" || s.kind === "glass") faces.push(quad(t0, t1, sill, head, `glass g-${s.kind}`));
      else if (s.kind === "sealed") faces.push(quad(t0, t1, sill, head, "ws sealed"));
      faces.push(quad(t0, t1, head, hh, wall));
      if (s.head < hh || s.sill >= hh) top(t0, t1); // a header, or a sill that reaches the top, closes the wall above the gap
      cursor = t1;
    }
    faces.push(quad(cursor, len, 0, hh, wall));
    if (len > cursor) top(cursor, len);
    const kc = kindClass(w.kind);
    const lines = tops.map(([t0, t1]) => {
      const a = px.lift(at(t0), hh), b = px.lift(at(t1), hh), g = `x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"`;
      return `<line class="eh${kc} top" ${g}/><line class="e${kc} top" ${g}/>`;
    });
    return { key: nearest(px, [w.a, w.b]), svg: faces.join("") + lines.join("") };
  });
}
