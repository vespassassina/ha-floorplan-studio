import type { EdgeKind, Floor, Pt, Room, Stairs } from "./schema";

// Everything here is pure: functions return a new Floor and never touch the DOM.

const TOUCH = 2; // cm: points this close count as the same point

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Outline "o", rooms "r<i>", stairs "s<i>". Points are shared with `f`, not copied. */
export function polys(f: Floor): { id: string; pts: Pt[]; room?: Room }[] {
  return [
    { id: "o", pts: f.outline },
    ...f.rooms.map((r, i) => ({ id: `r${i}`, pts: r.pts, room: r })),
    ...f.stairs.map((s, i) => ({ id: `s${i}`, pts: s.pts })),
  ];
}

/** A zone is a dotted subdivision: it never snaps, stitches or merges with the rest of the plan. */
const isZone = (P: { room?: Room }) => P.room?.kind === "zone";
/** A free room was unsnapped on purpose: like a zone it neither attracts nor follows. */
const isFree = (P: { room?: Room }) => P.room?.free === true;
const apart = (P: { room?: Room }) => isZone(P) || isFree(P);

function edges(pts: Pt[]): { a: Pt; b: Pt; i: number }[] {
  return pts.map((a, i) => ({ a, b: pts[(i + 1) % pts.length], i }));
}

/** Projection of p on segment a-b: t along the segment (unclamped), and the foot point. */
function project(p: Pt, a: Pt, b: Pt): { t: number; q: Pt } {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  return { t, q: [a[0] + t * dx, a[1] + t * dy] };
}

/**
 * The edge nearest to `p` within `maxd`, with the foot point and the unit direction: the host of a door, window,
 * opening or heater. Stairs are skipped, and so are zones by default: a zone is only a dotted overlay.
 * `zones: true` includes them, for picking an edge with the pointer. `walls: true` also offers the free walls
 * (`poly` is "w", `i` the wall's index; a wall of no length is skipped).
 */
export function nearestEdge(f: Floor, p: Pt, maxd: number, opts: { zones?: boolean; walls?: boolean } = {}): { d: number; q: Pt; u: Pt; poly: string; i: number } | null {
  let best: { d: number; q: Pt; u: Pt; poly: string; i: number } | null = null;
  let bestZone = false;
  const seg = (a: Pt, b: Pt, poly: string, i: number, zone = false) => {
    const { t, q } = project(p, a, b);
    const c: Pt = t <= 0 ? a : t >= 1 ? b : q;
    const d = dist(p, c);
    // an exact tie goes to the edge that is not a zone's, so a room edge under a zone edge stays reachable
    if (best && !(d === best.d && bestZone && !zone) && d >= best.d) return;
    bestZone = zone;
    const l = dist(a, b) || 1;
    best = { d, q: [c[0], c[1]], u: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], poly, i };
  };
  for (const P of polys(f)) {
    if (P.id[0] === "s" || (isZone(P) && !opts.zones)) continue;
    for (const { a, b, i } of edges(P.pts)) seg(a, b, P.id, i, isZone(P));
  }
  if (opts.walls) f.walls.forEach((w, i) => { if (dist(w.a, w.b) > 0) seg(w.a, w.b, "w", i); });
  const r = best as { d: number; q: Pt; u: Pt; poly: string; i: number } | null;
  return r && r.d <= maxd ? r : null;
}

export interface SnapOpts { threshold: number; grid: number | 0; exclude: Pt[]; neighbours: Pt[] }

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** Order: corner, then T onto an edge, then neighbour axis alignment, then grid. */
export function snapPoint(f: Floor, p: Pt, o: SnapOpts): Pt {
  const th = o.threshold;
  const skip = (q: Pt) => o.exclude.some((e) => same(e, q));

  let corner: Pt | null = null;
  for (const P of polys(f).filter((x) => !apart(x)))
    for (const q of P.pts)
      if (!skip(q) && dist(q, p) < th && (!corner || dist(q, p) < dist(corner, p))) corner = q;
  if (corner) return [corner[0], corner[1]];

  let tee: { d: number; pt: Pt } | null = null;
  for (const P of polys(f)) {
    if (apart(P)) continue;
    if (P.pts.some(skip)) continue;
    for (const { a, b } of edges(P.pts)) {
      const { t, q } = project(p, a, b);
      if (t <= 0 || t >= 1) continue;
      const d = dist(p, q);
      if (d < th && (!tee || d < tee.d)) tee = { d, pt: q };
    }
  }
  if (tee) return [Math.round(tee.pt[0]), Math.round(tee.pt[1])];

  const q: Pt = [p[0], p[1]];
  for (const m of o.neighbours) {
    if (Math.abs(q[0] - m[0]) < th) q[0] = m[0];
    if (Math.abs(q[1] - m[1]) < th) q[1] = m[1];
  }
  if (o.grid) {
    if (q[0] === p[0]) q[0] = Math.round(q[0] / o.grid) * o.grid;
    if (q[1] === p[1]) q[1] = Math.round(q[1] / o.grid) * o.grid;
  }
  return q;
}

/** Puts `pt` into every polygon edge it lies on (one point per polygon), keeping room edge kinds. */
export function stitch(f: Floor, pt: Pt): Floor {
  const g = structuredClone(f);
  const at = polys(g).filter((P) => P.pts.some((q) => dist(q, pt) <= TOUCH));
  if (at.length && at.every(apart)) return g; // a zone corner never becomes a point of a wall
  for (const P of polys(g)) {
    if (apart(P)) continue;
    if (P.pts.some((q) => dist(q, pt) <= TOUCH)) continue;
    for (const { a, b, i } of edges(P.pts)) {
      const { t, q } = project(pt, a, b);
      if (t <= 0.01 || t >= 0.99) continue;
      if (dist(pt, q) <= TOUCH) {
        P.pts.splice(i + 1, 0, [pt[0], pt[1]]);
        if (P.room) P.room.wk.splice(i + 1, 0, P.room.wk[i]);
        break;
      }
    }
  }
  return g;
}

export function insertPoint(f: Floor, poly: string, i: number, pt: Pt): Floor {
  const g = structuredClone(f);
  const P = polys(g).find((x) => x.id === poly);
  if (!P) return f;
  P.pts.splice(i + 1, 0, pt);
  if (P.room) P.room.wk.splice(i + 1, 0, P.room.wk[i]);
  return g;
}

/** Refuses (returns `f` itself) when the polygon would drop below 3 points. */
export function removePoint(f: Floor, poly: string, j: number): Floor {
  const g = structuredClone(f);
  const P = polys(g).find((x) => x.id === poly);
  if (!P || P.pts.length <= 3) return f;
  P.pts.splice(j, 1);
  if (P.room) P.room.wk.splice(j, 1);
  return g;
}

/**
 * Moves every point within 2 cm of `from` to `to`. With `detach` only one point moves:
 * `only` names it, else the first match. A zone corner and a room corner never move together:
 * `only` is the corner the user holds. A zone's corners move only when `only` is a zone corner, and only
 * then; with no `only` (a loose wall end has no polygon) zone corners stay where they are.
 */
export function movePoints(f: Floor, from: Pt, to: Pt, detach: boolean, only?: { poly: string; i: number }): Floor {
  const g = structuredClone(f);
  let moved = false;
  const zoneMove = only ? apart(polys(g).find((P) => P.id === only.poly) ?? {}) : false;
  for (const P of polys(g))
    P.pts.forEach((q, i) => {
      if (dist(q, from) > TOUCH) return;
      if (apart(P) !== zoneMove) return;
      if (detach) {
        if (moved || (only && !(only.poly === P.id && only.i === i))) return;
        moved = true;
      }
      P.pts[i] = [to[0], to[1]];
    });
  return g;
}

/** Rooms that have this edge, for the wall toggle. A zone edge is always dotted: it is neither the edge asked about nor a match. */
export function edgeRooms(f: Floor, poly: string, i: number): { room: Room; i: number }[] {
  const P = polys(f).find((x) => x.id === poly);
  if (!P || isZone(P)) return [];
  const a = P.pts[i], b = P.pts[(i + 1) % P.pts.length];
  const out: { room: Room; i: number }[] = [];
  for (const room of f.rooms.filter((r) => r.kind !== "zone"))
    edges(room.pts).forEach(({ a: c, b: d, i: j }) => {
      if ((dist(a, c) <= TOUCH && dist(b, d) <= TOUCH) || (dist(a, d) <= TOUCH && dist(b, c) <= TOUCH)) out.push({ room, i: j });
    });
  return out;
}

/** Sets the kind of an edge on every room that has it. A zone edge stays a boundary: `validate` rejects anything else. Returns `f` itself when no room matches. */
export function setEdgeKind(f: Floor, poly: string, i: number, kind: EdgeKind): Floor {
  const g = structuredClone(f);
  const hits = edgeRooms(g, poly, i);
  if (!hits.length) return f;
  for (const h of hits) h.room.wk[h.i] = kind;
  return g;
}

/** Indexes of the doors and openings that lie on segment a-b: within TOUCH of its line and overlapping it. */
export function onEdge(f: Floor, a: Pt, b: Pt): { doors: number[]; openings: number[] } {
  const L = dist(a, b) || 1;
  const along = (p: Pt) => ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L;
  const off = (p: Pt) => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L;
  const on = (o: { a: Pt; b: Pt }) => off(o.a) <= TOUCH && off(o.b) <= TOUCH && Math.max(along(o.a), along(o.b)) > 0 && Math.min(along(o.a), along(o.b)) < L;
  const pick = (list: { a: Pt; b: Pt }[]) => list.flatMap((o, i) => (on(o) ? [i] : []));
  return { doors: pick(f.doors), openings: pick(f.openings) };
}

/**
 * Corners within `tol` cm become one point: the outline's if the group has one, else the average.
 * Consecutive equal corners are dropped with their edge kinds. Gardens and zones are left alone.
 */
export function mergeCorners(f: Floor, tol: number): Floor {
  const g = structuredClone(f);
  const list = [
    { pts: g.outline, outline: true, room: undefined as Room | undefined },
    ...g.rooms.filter((r) => r.kind !== "garden" && r.kind !== "zone" && !r.free).map((r) => ({ pts: r.pts, outline: false, room: r })),
    ...g.stairs.map((s) => ({ pts: s.pts, outline: false, room: undefined })),
  ];
  const all = list.flatMap((P) => P.pts.map((q) => ({ q, outline: P.outline })));
  const seen = new Set<Pt>();
  for (const { q: p } of all) {
    if (seen.has(p)) continue;
    const grp = all.filter((x) => dist(p, x.q) <= tol);
    grp.forEach((x) => seen.add(x.q));
    const o = grp.find((x) => x.outline);
    const t: Pt = o
      ? [o.q[0], o.q[1]]
      : [Math.round(grp.reduce((s, x) => s + x.q[0], 0) / grp.length), Math.round(grp.reduce((s, x) => s + x.q[1], 0) / grp.length)];
    grp.forEach((x) => { x.q[0] = t[0]; x.q[1] = t[1]; });
  }
  for (const P of list) {
    for (let i = 0; P.pts.length > 3 && i < P.pts.length; ) {
      if (same(P.pts[i], P.pts[(i + 1) % P.pts.length])) {
        P.pts.splice(i, 1);
        P.room?.wk.splice(i, 1);
      } else i++;
    }
  }
  return g;
}

/** True when a corner of polygon `poly` lies within 2 cm of a corner of another polygon that is not free. */
export function snapped(f: Floor, poly: string): boolean {
  const all = polys(f), P = all.find((x) => x.id === poly);
  if (!P) return false;
  return all.some((O) => O.id !== poly && !isFree(O) && O.pts.some((q) => P.pts.some((p) => dist(p, q) <= TOUCH)));
}

/** Polygon `poly` turned by `deg` (clockwise on screen) about the centre of its bounding box, corners rounded to 1 cm. Unknown id: `f` itself. */
export function rotatePoly(f: Floor, poly: string, deg: number): Floor {
  const g = structuredClone(f), P = polys(g).find((x) => x.id === poly);
  if (!P) return f;
  const xs = P.pts.map((p) => p[0]), ys = P.pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  P.pts.forEach((p, i) => { P.pts[i] = [Math.round(cx + (p[0] - cx) * cos - (p[1] - cy) * sin) + 0, Math.round(cy + (p[0] - cx) * sin + (p[1] - cy) * cos) + 0]; }); // + 0 turns -0 into 0
  return g;
}

/** Steps of a stair: one every 40 cm of run, at least 2, at most 40. A round stair runs along its mean circumference. */
export const TREAD = 40;
export function stairSteps(t: Pick<Stairs, "pts" | "shape" | "dia" | "inner">): number {
  const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  let run = 0;
  if (t.shape === "round" && fin(t.dia) && t.dia > 0) run = (Math.PI * (t.dia + (fin(t.inner) ? t.inner : 0))) / 2;
  else if (Array.isArray(t.pts) && t.pts.some(Array.isArray)) {
    const q = t.pts.filter(Array.isArray), xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    run = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }
  return Math.max(2, Math.min(40, Math.round((fin(run) ? run : 0) / TREAD)));
}
