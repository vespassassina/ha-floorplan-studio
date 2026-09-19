import type { Floor, Pt, Room } from "./schema";

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

function edges(pts: Pt[]): { a: Pt; b: Pt; i: number }[] {
  return pts.map((a, i) => ({ a, b: pts[(i + 1) % pts.length], i }));
}

/** Projection of p on segment a-b: t along the segment (unclamped), and the foot point. */
function project(p: Pt, a: Pt, b: Pt): { t: number; q: Pt } {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  return { t, q: [a[0] + t * dx, a[1] + t * dy] };
}

export function nearestEdge(f: Floor, p: Pt, maxd: number): { d: number; q: Pt; u: Pt; poly: string; i: number } | null {
  let best: { d: number; q: Pt; u: Pt; poly: string; i: number } | null = null;
  for (const P of polys(f)) {
    if (P.id[0] === "s") continue;
    for (const { a, b, i } of edges(P.pts)) {
      const { t, q } = project(p, a, b);
      const c: Pt = t <= 0 ? a : t >= 1 ? b : q;
      const d = dist(p, c);
      if (!best || d < best.d) {
        const l = dist(a, b) || 1;
        best = { d, q: [c[0], c[1]], u: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], poly: P.id, i };
      }
    }
  }
  return best && best.d <= maxd ? best : null;
}

export interface SnapOpts { threshold: number; grid: number | 0; exclude: Pt[]; neighbours: Pt[] }

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** Order: corner, then T onto an edge, then neighbour axis alignment, then grid. */
export function snapPoint(f: Floor, p: Pt, o: SnapOpts): Pt {
  const th = o.threshold;
  const skip = (q: Pt) => o.exclude.some((e) => same(e, q));

  let corner: Pt | null = null;
  for (const P of polys(f).filter((x) => !isZone(x)))
    for (const q of P.pts)
      if (!skip(q) && dist(q, p) < th && (!corner || dist(q, p) < dist(corner, p))) corner = q;
  if (corner) return [corner[0], corner[1]];

  let tee: { d: number; pt: Pt } | null = null;
  for (const P of polys(f)) {
    if (isZone(P)) continue;
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

/** Puts `pt` into every polygon edge it lies on (one point per polygon), keeping room wall flags. */
export function stitch(f: Floor, pt: Pt): Floor {
  const g = structuredClone(f);
  const at = polys(g).filter((P) => P.pts.some((q) => dist(q, pt) <= TOUCH));
  if (at.length && at.every(isZone)) return g; // a zone corner never becomes a point of a wall
  for (const P of polys(g)) {
    if (isZone(P)) continue;
    if (P.pts.some((q) => dist(q, pt) <= TOUCH)) continue;
    for (const { a, b, i } of edges(P.pts)) {
      const { t, q } = project(pt, a, b);
      if (t <= 0.01 || t >= 0.99) continue;
      if (dist(pt, q) <= TOUCH) {
        P.pts.splice(i + 1, 0, [pt[0], pt[1]]);
        if (P.room) P.room.w.splice(i + 1, 0, P.room.w[i]);
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
  if (P.room) P.room.w.splice(i + 1, 0, P.room.w[i]);
  return g;
}

/** Refuses (returns `f` itself) when the polygon would drop below 3 points. */
export function removePoint(f: Floor, poly: string, j: number): Floor {
  const g = structuredClone(f);
  const P = polys(g).find((x) => x.id === poly);
  if (!P || P.pts.length <= 3) return f;
  P.pts.splice(j, 1);
  if (P.room) P.room.w.splice(j, 1);
  return g;
}

/**
 * Moves every point within 2 cm of `from` to `to`. With `detach` only one point moves:
 * `only` names it, else the first match. A zone corner and a room corner never move together:
 * with `only` set, a zone's corners move only when `only` is a zone corner, and only then.
 */
export function movePoints(f: Floor, from: Pt, to: Pt, detach: boolean, only?: { poly: string; i: number }): Floor {
  const g = structuredClone(f);
  let moved = false;
  const zoneMove = only ? isZone(polys(g).find((P) => P.id === only.poly) ?? {}) : undefined;
  for (const P of polys(g))
    P.pts.forEach((q, i) => {
      if (dist(q, from) > TOUCH) return;
      if (zoneMove !== undefined && isZone(P) !== zoneMove) return;
      if (detach) {
        if (moved || (only && !(only.poly === P.id && only.i === i))) return;
        moved = true;
      }
      P.pts[i] = [to[0], to[1]];
    });
  return g;
}

export function edgeRooms(f: Floor, poly: string, i: number): { room: Room; i: number }[] {
  const P = polys(f).find((x) => x.id === poly);
  if (!P) return [];
  const a = P.pts[i], b = P.pts[(i + 1) % P.pts.length];
  const out: { room: Room; i: number }[] = [];
  for (const room of f.rooms)
    edges(room.pts).forEach(({ a: c, b: d, i: j }) => {
      if ((dist(a, c) <= TOUCH && dist(b, d) <= TOUCH) || (dist(a, d) <= TOUCH && dist(b, c) <= TOUCH)) out.push({ room, i: j });
    });
  return out;
}

/** Flips the wall flag of an edge on every room that has it, all to the same new value. */
export function toggleWall(f: Floor, poly: string, i: number): Floor {
  const g = structuredClone(f);
  const hits = edgeRooms(g, poly, i);
  if (!hits.length) return f;
  const next = !hits[0].room.w[hits[0].i];
  for (const h of hits) h.room.w[h.i] = next;
  return g;
}

/**
 * Corners within `tol` cm become one point: the outline's if the group has one, else the average.
 * Consecutive equal corners are dropped with their wall flags. Outdoor rooms and zones are left alone.
 */
export function mergeCorners(f: Floor, tol: number): Floor {
  const g = structuredClone(f);
  const list = [
    { pts: g.outline, outline: true, room: undefined as Room | undefined },
    ...g.rooms.filter((r) => r.kind !== "outdoor" && r.kind !== "zone").map((r) => ({ pts: r.pts, outline: false, room: r })),
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
        P.room?.w.splice(i, 1);
      } else i++;
    }
  }
  return g;
}
