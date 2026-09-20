import { dist, movePoints, polys, stitch } from "../core";
import type { Floor, Pt, WallKind } from "../core";
import { newId, type LooseRef, type PtRef } from "./state";

// Floor edits that geometry.ts does not cover: loose wall, opening and extra ends.
// Pure like the core: each returns a new Floor.

const TOUCH = 2; // cm, same as geometry.ts

const LOOSE = ["walls", "openings", "extras"] as const;
const round = (p: Pt): Pt => [Math.round(p[0]), Math.round(p[1])];

export function looseEnds(f: Floor): LooseRef[] {
  const out: LooseRef[] = [];
  for (const k of LOOSE) f[k].forEach((_, i) => { out.push({ k, i, end: "a" }, { k, i, end: "b" }); });
  return out;
}

/** Every corner and loose end within 2 cm of p. */
export function pointsNear(f: Floor, p: Pt): Pt[] {
  const out: Pt[] = [];
  for (const P of polys(f)) for (const q of P.pts) if (dist(q, p) <= TOUCH) out.push(q);
  for (const r of looseEnds(f)) { const q = f[r.k][r.i][r.end]; if (dist(q, p) <= TOUCH) out.push(q); }
  return out;
}

/**
 * Moves every corner and loose end at `from` to `to`. `only` is the corner or end being held: a zone
 * corner moves with zone corners only, anything else with non-zone corners only. With `detach` only `only`
 * moves (or the first polygon corner when `only` is missing): Shift while dragging.
 */
export function movePointAll(f: Floor, from: Pt, to: Pt, detach = false, only?: PtRef): Floor {
  const t = round(to);
  if (detach && only && !("poly" in only)) {
    const g = structuredClone(f);
    g[only.k][only.i][only.end] = t;
    return g;
  }
  const g = movePoints(f, from, t, detach, only && "poly" in only ? { poly: only.poly, i: only.j } : undefined);
  if (!detach)
    for (const r of looseEnds(g)) if (dist(g[r.k][r.i][r.end], from) <= TOUCH) g[r.k][r.i][r.end] = [t[0], t[1]];
  return g;
}

/** Second end of an edge to a new length (m) or axis; shared corners follow. `end` is the reference of that second end: it says whether a zone corner or a room corner is held. */
export function setSecondEnd(f: Floor, a: Pt, b: Pt, how: { length: number } | { axis: "h" | "v" }, end: PtRef): Floor {
  let q: Pt;
  if ("length" in how) {
    const l = dist(a, b) || 1, n = how.length * 100;
    q = [a[0] + ((b[0] - a[0]) / l) * n, a[1] + ((b[1] - a[1]) / l) * n];
  } else q = how.axis === "h" ? [b[0], a[1]] : [a[0], b[1]];
  return movePointAll(f, b, q, false, end);
}

/** A segment a-b resized around its centre to `len` cm. */
export function resizeSegment(a: Pt, b: Pt, len: number): { a: Pt; b: Pt } {
  const c: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], l = dist(a, b) || 1;
  const u: Pt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], n = len / 2;
  return { a: round([c[0] - u[0] * n, c[1] - u[1] * n]), b: round([c[0] + u[0] * n, c[1] + u[1] * n]) };
}

/** Segment of length `len` centred on q along direction u. */
export function segmentAt(q: Pt, u: Pt, len: number): { a: Pt; b: Pt } {
  const n = len / 2;
  return { a: round([q[0] - u[0] * n, q[1] - u[1] * n]), b: round([q[0] + u[0] * n, q[1] + u[1] * n]) };
}

/** A stairs polygon of 100 x 300 cm centred on c, corners on the 5 cm grid. */
export function stairsAt(c: Pt): { name: string; pts: Pt[] } {
  const g = (n: number) => Math.round(n / 5) * 5, x = g(c[0] - 50), y = g(c[1] - 150);
  return { name: "Stairs", pts: [[x, y], [x + 100, y], [x + 100, y + 300], [x, y + 300]] };
}

/** A 200 x 200 cm square centred on c, corners on the 5 cm grid: the default zone or water polygon. */
export function squareAt(c: Pt): Pt[] {
  const g = (n: number) => Math.round(n / 5) * 5, x = g(c[0] - 100), y = g(c[1] - 100);
  return [[x, y], [x + 200, y], [x + 200, y + 200], [x, y + 200]];
}

/** Wall `i` becomes an opening with the same ends and a fresh id. `floor` is the floor key, for the id. Returns `f` itself when there is no such wall or it has no length. */
export function wallToOpening(f: Floor, i: number, floor: string): Floor {
  const w = f.walls[i];
  if (!w || dist(w.a, w.b) === 0) return f;
  const g = structuredClone(f);
  g.walls.splice(i, 1);
  g.openings.push({ id: newId(g, floor, "opening"), a: [...w.a], b: [...w.b] });
  return g;
}

/** Opening `i` becomes a wall of `kind` with the same ends and a fresh id. Returns `f` itself when there is no such opening or it has no length. */
export function openingToWall(f: Floor, i: number, kind: WallKind, floor: string): Floor {
  const o = f.openings[i];
  if (!o || dist(o.a, o.b) === 0) return f;
  const g = structuredClone(f);
  g.openings.splice(i, 1);
  g.walls.push({ id: newId(g, floor, "wall"), a: [...o.a], b: [...o.b], kind });
  return g;
}

/** Where a new item goes: right of the outline's bounding box, at its top, on the 5 cm grid. With no outline (fewer than three points) `fallback`. */
export function spawnPoint(f: Floor, fallback: Pt): Pt {
  if (f.outline.length < 3) return fallback;
  const xs = f.outline.map((p) => p[0]), ys = f.outline.map((p) => p[1]);
  const g = (n: number) => Math.round(n / 5) * 5;
  return [g(Math.max(...xs) + 150), g(Math.min(...ys))];
}

/**
 * After a room was dragged by its body: translate the whole room so the corner pair (one of its own, one of another
 * room's, the outline's or a stairs') that lies closest, within `radius` cm, lands point on point. Then stitch its
 * corners into any edge they touch, so shared walls are shared again. Zones neither snap nor are snapped to.
 * Returns `f` itself when no pair is in range.
 */
export function snapRoomTo(f: Floor, i: number, radius: number): Floor {
  const room = f.rooms[i];
  if (!room || room.kind === "zone") return f;
  const own = room.pts, others = polys(f).filter((P) => P.id !== `r${i}` && P.room?.kind !== "zone");
  let best: { d: number; dx: number; dy: number } | null = null;
  for (const P of others)
    for (const q of P.pts)
      for (const p of own) {
        const d = dist(p, q);
        if (d <= radius && (!best || d < best.d)) best = { d, dx: q[0] - p[0], dy: q[1] - p[1] };
      }
  if (!best) return f;
  let g = structuredClone(f);
  g.rooms[i].pts = g.rooms[i].pts.map((p): Pt => [p[0] + best!.dx, p[1] + best!.dy]);
  for (const p of g.rooms[i].pts) g = stitch(g, p);
  return g;
}
