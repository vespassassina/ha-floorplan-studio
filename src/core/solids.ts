// The 2.5D solids: walls, furniture, appliances and stairs drawn as extruded shapes. Pure string builders; `renderFloor`
// decides when to call them and in what order (one draw path, CLAUDE.md finding 8). Nothing here knows the OBLIQUE
// numbers: they arrive in a `Proj`, so this file never imports render.ts.
import { deviceZ, doorSpan, edgeHeight, floorHeight, furnitureHeight, openingSpan, unlinkedHeight, wallHeight } from "./heights";
import { esc, num, pts } from "./fmt";
import { stairSteps } from "./geometry";
import type { DoorKind, Floor, Furniture, FurnitureSymbol, Pt, Stairs, Unlinked } from "./schema";

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

/** Below this much screen area (cm squared) a sweep only grazes a room: a wall lying along a border is not covering it. */
const COVER_MIN_AREA = 25;

/**
 * Whether a wall from `a` to `b` (screen frame, `n` its outward unit normal), lifted to `h`, hides part of any of the
 * `floors` (room and zone outlines, screen frame). The wall sweeps the parallelogram from its base along the lift, and
 * only the outward side counts: its own room lies behind it, and the sides it leans over are the side walls' business.
 */
function coversFloor(px: Proj, a: Pt, b: Pt, n: Pt, h: number, floors: Pt[][]): boolean {
  const lift: Pt = [h * px.rise * px.skew, -h * px.rise];
  if (n[0] * lift[0] + n[1] * lift[1] <= 0) return false;
  const sweep: Pt[] = [a, b, [b[0] + lift[0], b[1] + lift[1]], [a[0] + lift[0], a[1] + lift[1]]];
  return floors.some((q) => area2(clipToConvex(q, sweep)) / 2 > COVER_MIN_AREA);
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
 *
 * A back wall is no safer for being a back wall: the room behind it may be another room's floor (the Hall's north wall
 * over the Living room), and that edge is not the Living room's front wall, so nothing above would pair them. So a wall
 * facing up the screen is also cut when its lift covers the floor of any room or zone. The whole segment takes the cut,
 * not just the covered part: a wall that steps up and down along its length would read as a fault.
 */
function collectWalls(f: Floor, px: Proj): WallSeg[] {
  const out: WallSeg[] = [];
  const floors = (f.rooms ?? []).map((r) => r?.pts).filter((q): q is Pt[] => Array.isArray(q) && q.length >= 3 && q.every(finite)).map((q) => q.map(px.scr));
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
      const front = dir !== 0 && (ny > 0.3 || (ny < -0.3 && coversFloor(px, s, t, [nx, ny], h, floors)));
      out.push({ a, b, h, front, kind: Array.isArray(wk) && typeof wk[i] === "string" ? (wk[i] as string) : P.room ? "wall" : "external" });
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

/**
 * What fills the hole an opening cuts between its sill and head: nothing (a door stands open, a plain opening is a
 * gap), a translucent band of glass (a window, a glass door) or a solid panel (sealed, as the 2D plan draws it). One
 * entry per DoorKind, so a new kind fails the test that walks DOOR_KINDS until someone decides (finding 17).
 */
export const OPENING_FILL: Record<DoorKind | "opening", "gap" | "glass" | "panel"> = { door: "gap", opening: "gap", glass: "glass", window: "glass", sealed: "panel" };
const has = <T extends string>(table: Record<T, unknown>, k: unknown): k is T => typeof k === "string" && Object.prototype.hasOwnProperty.call(table, k);

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
      const fill = has(OPENING_FILL, s.kind) ? OPENING_FILL[s.kind] : "gap";
      if (fill === "glass") faces.push(quad(t0, t1, sill, head, `glass g-${esc(s.kind)}`));
      else if (fill === "panel") faces.push(quad(t0, t1, sill, head, "ws sealed"));
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

/** `p` turned clockwise by `deg` about `c` (y points down, the way SVG's rotate() turns). */
function turnAbout(p: Pt, deg: number, c: Pt): Pt {
  const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a), dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs];
}

/**
 * A straight-sided block: the side faces the viewer sees, then the lid. A face is seen when its outward normal, in the
 * screen frame, points toward the camera (south and a little west): ny > skew * nx. The rest are hidden by the lid and
 * the near faces, so they are not drawn. Returns the markup, or null for a base with no area or a height of zero.
 */
function prism(base: Pt[], h: number, px: Proj): string | null {
  const dir = Math.sign(winding(px, base));
  if (!dir || !(h > 0) || !base.every(finite)) return null;
  const faces = base.map((a, i) => {
    const b = base[(i + 1) % base.length], s = px.scr(a), t = px.scr(b), len = Math.hypot(t[0] - s[0], t[1] - s[1]) || 1;
    const nx = (dir * (t[1] - s[1])) / len, ny = (dir * -(t[0] - s[0])) / len;
    return ny > px.skew * nx + 1e-9 ? `<polygon class="bs${Math.abs(nx) > Math.abs(ny) ? " w" : ""}" points="${pts([a, b, px.lift(b, h), px.lift(a, h)])}"/>` : "";
  });
  return `${faces.join("")}<polygon class="bt" points="${pts(base.map((p) => px.lift(p, h)))}"/>`;
}

/**
 * What each furniture symbol becomes in 2.5D. A box is a block with the symbol on its lid; a pole (a tree) is a trunk
 * with the symbol, its crown, at the top; flat stays as drawn in 2D (a patio is 5 cm, not a thing to stand behind).
 * One entry per symbol, so a new FurnitureSymbol fails the test that walks the list until someone decides (finding 17).
 */
export const FURNITURE_SOLID: Record<FurnitureSymbol, "box" | "pole" | "flat"> = {
  table: "box", sofa: "box", bed: "box", cabinet: "box", chair: "box", sink: "box", toilet: "box", shower: "box", bathtub: "box", tv: "box", computer: "box",
  car: "box", tree: "pole", "patio-wood": "flat", "patio-concrete": "flat",
};
/** How a piece of furniture draws in 2.5D. A piece that is not finite or not known is flat: the 2D path deals with it as ever. */
export function furnitureMode(m: Furniture): "box" | "pole" | "flat" {
  const ok = [m.x, m.y, m.w, m.h, m.rot].every((v) => typeof v === "number" && Number.isFinite(v)) && m.w > 0 && m.h > 0 && furnitureHeight(m) > 0;
  return ok && has(FURNITURE_SOLID, m.symbol) ? FURNITURE_SOLID[m.symbol] : "flat";
}

/**
 * One piece of furniture as a block (or a trunk), its symbol drawn at the top. `symbol` is the symbol's own markup, and
 * the group wraps all of it, so a tap anywhere on the piece still reaches `data-f`.
 */
export function furnitureSolid(m: Furniture, i: number, mode: "box" | "pole", on: boolean, symbol: string, px: Proj): Solid | null {
  const h = furnitureHeight(m), c: Pt = [m.x, m.y];
  const base = ([[-m.w / 2, -m.h / 2], [m.w / 2, -m.h / 2], [m.w / 2, m.h / 2], [-m.w / 2, m.h / 2]] as Pt[]).map((q) => turnAbout([m.x + q[0], m.y + q[1]], m.rot, c));
  const top = px.lift(c, h);
  let body: string;
  if (mode === "box") { const p = prism(base, h, px); if (!p) return null; body = p; }
  else body = `<line class="trunk" x1="${num(c[0])}" y1="${num(c[1])}" x2="${num(top[0])}" y2="${num(top[1])}"/>`;
  const sym = `<g transform="translate(${num(top[0])} ${num(top[1])}) rotate(${num(m.rot)}) scale(${num(m.w / 100)} ${num(m.h / 100)}) translate(-50 -50)">${symbol}</g>`;
  return { key: nearest(px, base), svg: `<g data-f="${i}" class="furn${on ? " on" : ""}" color="var(--fp-furniture)">${body}${sym}</g>` };
}

/** cm across the block under an unlinked appliance, times its own scale: a small thing, the icon says what it is. */
const UNLINKED_BASE = 40;
/** A low box at the appliance's own height; the icon (drawn by renderFloor, at the plan position) stays on top. */
export function unlinkedSolid(u: Unlinked, px: Proj): Solid | null {
  if (![u.x, u.y].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const scale = typeof u.scale === "number" && Number.isFinite(u.scale) && u.scale > 0 ? u.scale : 1, r = (UNLINKED_BASE * scale) / 2;
  const base: Pt[] = [[u.x - r, u.y - r], [u.x + r, u.y - r], [u.x + r, u.y + r], [u.x - r, u.y + r]];
  const p = prism(base, unlinkedHeight(u), px);
  return p ? { key: nearest(px, base), svg: `<g class="obj">${p}</g>` } : null;
}

/**
 * A staircase as steps, each a block as high as the stairs have climbed by then, the last as high as the storey.
 * A straight flight climbs toward +x when it runs along x and toward -y when it runs along y, away from the viewer, so
 * every riser faces it. A round one climbs once round, anticlockwise on screen from the right. The flat group renderFloor
 * draws stays under, as the click target. `rise` is the storey height; `rot` turns the whole thing about its centre, as in 2D.
 */
export function stairSolids(t: Stairs, rise: number, px: Proj): Solid[] {
  if (!Array.isArray(t.pts) || t.pts.length < 3 || !t.pts.every(finite)) return [];
  const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
  const rot = typeof t.rot === "number" && Number.isFinite(t.rot) ? t.rot : 0, n = stairSteps(t);
  const steps: Pt[][] = [];
  if (t.shape === "round" && typeof t.dia === "number" && t.dia > 0) {
    const R = t.dia / 2, r = typeof t.inner === "number" && t.inner > 0 ? t.inner / 2 : 0, ARC = 3;
    for (let k = 0; k < n; k++) {
      const at = (rad: number, j: number): Pt => { const a = ((k + j / ARC) * 2 * Math.PI) / n; return [c[0] + rad * Math.cos(a), c[1] + rad * Math.sin(a)]; };
      const outer = Array.from({ length: ARC + 1 }, (_, j) => at(R, j));
      steps.push([...outer, ...(r ? Array.from({ length: ARC + 1 }, (_, j) => at(r, ARC - j)) : [c])]);
    }
  } else {
    const along = x1 - x0 > y1 - y0, dx = (x1 - x0) / n, dy = (y1 - y0) / n;
    for (let k = 0; k < n; k++) steps.push(along
      ? [[x0 + k * dx, y0], [x0 + (k + 1) * dx, y0], [x0 + (k + 1) * dx, y1], [x0 + k * dx, y1]]
      : [[x0, y1 - (k + 1) * dy], [x1, y1 - (k + 1) * dy], [x1, y1 - k * dy], [x0, y1 - k * dy]]);
  }
  const out: Solid[] = [];
  steps.forEach((base, k) => {
    const turned = rot ? base.map((p) => turnAbout(p, rot, c)) : base, p = prism(turned, ((k + 1) / n) * rise, px);
    if (p) out.push({ key: nearest(px, turned), svg: `<g class="obj">${p}</g>` });
  });
  return out;
}
