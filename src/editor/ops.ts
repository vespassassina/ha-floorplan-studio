import { dist, movePoints, nearestEdge, polys } from "../core";
import type { Floor, Pt } from "../core";
import type { LooseRef, PtRef } from "./state";

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
 * Moves every corner and loose end at `from` to `to`. With `detach` only `only` moves
 * (or the first polygon corner when `only` is missing): Shift while dragging.
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

/** Second end of an edge to a new length (m) or axis; shared corners follow. */
export function setSecondEnd(f: Floor, a: Pt, b: Pt, how: { length: number } | { axis: "h" | "v" }): Floor {
  let q: Pt;
  if ("length" in how) {
    const l = dist(a, b) || 1, n = how.length * 100;
    q = [a[0] + ((b[0] - a[0]) / l) * n, a[1] + ((b[1] - a[1]) / l) * n];
  } else q = how.axis === "h" ? [b[0], a[1]] : [a[0], b[1]];
  return movePointAll(f, b, q);
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

/**
 * The edge a door-like item is placed on: the nearest polygon edge (outline, room, water) or free wall to `p`,
 * with the point on it and its unit direction. Null when the floor has neither.
 */
export function hostEdge(f: Floor, p: Pt): { q: Pt; u: Pt } | null {
  const e = nearestEdge(f, p, Infinity);
  let best: { d: number; q: Pt; u: Pt } | null = e ? { d: e.d, q: e.q, u: e.u } : null;
  for (const w of f.walls) {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], l = Math.hypot(dx, dy);
    if (!l) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy) / (l * l)));
    const q: Pt = [w.a[0] + t * dx, w.a[1] + t * dy], d = dist(p, q);
    if (!best || d < best.d) best = { d, q, u: [dx / l, dy / l] };
  }
  return best ? { q: best.q, u: best.u } : null;
}
