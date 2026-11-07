// Plain polygon maths on point lists, with no schema in it. `validate`, `migrate` and the worktop editor share it.
import type { Floor, Pt } from "./schema";

/** B54.1: a worktop holds at most this many points (and at least 3, like every polygon). */
export const WORKTOP_MIN_PTS = 3;
export const WORKTOP_MAX_PTS = 64;

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSegment = (a: Pt, b: Pt, p: Pt) => Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);

/** Whether segments ab and cd share any point, an end touching included. */
function segmentsMeet(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSegment(a, b, c)) || (d2 === 0 && onSegment(a, b, d)) || (d3 === 0 && onSegment(c, d, a)) || (d4 === 0 && onSegment(c, d, b));
}

/**
 * A simple polygon: at least 3 points, a non-zero area, and no edge touching any edge but its two neighbours, which
 * may share only their common corner (no repeated point, no spike folded back on itself). `pts` must be finite pairs;
 * the caller checks that first.
 */
export function isSimplePolygon(pts: readonly Pt[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  let area2 = 0;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; area2 += p[0] * q[1] - q[0] * p[1]; }
  if (area2 === 0) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (a[0] === b[0] && a[1] === b[1]) return false;
    for (let j = i + 1; j < n; j++) {
      const c = pts[j], d = pts[(j + 1) % n];
      if (j === i + 1 || (i === 0 && j === n - 1)) {
        // neighbours: they may meet at their shared corner only, so the far end of one must not lie on the other
        const shared = j === i + 1 ? b : a, far1 = shared === b ? a : b, far2 = shared === c ? d : c;
        if (cross(shared, far1, far2) === 0 && (far1[0] - shared[0]) * (far2[0] - shared[0]) + (far1[1] - shared[1]) * (far2[1] - shared[1]) > 0) return false;
      } else if (segmentsMeet(a, b, c, d)) return false;
    }
  }
  return true;
}

/** The bounding box of a point list as a furniture box: centre and size. Writers keep a worktop's x, y, w and h at this. */
export function boxOf(pts: readonly Pt[]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/** The four corners of a box of `w` x `h` centred on (x, y) and turned `rot` degrees: a piece's footprint as a point list. */
export function rectPts(m: { x: number; y: number; w: number; h: number; rot: number }): Pt[] {
  const a = (m.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Pt[]).map(([i, j]) => [+(m.x + (i * m.w * c) / 2 - (j * m.h * s) / 2).toFixed(2), +(m.y + (i * m.w * s) / 2 + (j * m.h * c) / 2).toFixed(2)] as Pt);
}

/** What is wrong with a worktop's `pts`, as a short phrase; empty when it is good. Never throws, whatever `v` is. */
export function worktopPtsProblem(v: unknown): string {
  try {
    if (!Array.isArray(v)) return "needs pts, a list of 3 to 64 points";
    if (v.length < WORKTOP_MIN_PTS || v.length > WORKTOP_MAX_PTS) return `has ${v.length} points; a worktop needs ${WORKTOP_MIN_PTS} to ${WORKTOP_MAX_PTS}`;
    for (const p of v) if (!(Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e7))) return "has a point that is not [x, y] numbers within 10 km";
    if (!isSimplePolygon(v as Pt[])) return "crosses itself or touches itself; a worktop must be a simple polygon";
    return "";
  } catch { return "is not a list of points"; }
}

/** B54.2: a worktop's points when it has good ones, else null (it then draws as its box, like any piece). */
export function worktopPts(m: { symbol?: unknown; pts?: unknown }): Pt[] | null {
  return m?.symbol === "worktop" && worktopPtsProblem(m.pts) === "" ? (m.pts as Pt[]) : null;
}

/**
 * A worktop with good points, framed on them: x, y, w, h are the points' own bounding box and rot is 0, whatever the file
 * says. Writers keep that anyway; this makes a hand-edited file draw the points, not a stale box. Any other piece comes back as is.
 * Every draw (2D, 2.5D, 3D) goes through here, so they cannot disagree.
 */
export function worktopFrame<T extends { symbol?: unknown; pts?: unknown }>(m: T): T {
  const p = worktopPts(m);
  return p ? { ...m, ...boxOf(p), rot: 0 } : m;
}

/** The symbol of a framed worktop: its points as one path in the 100 x 100 box the furniture transform scales to w x h. */
export function worktopSvg(pts: readonly Pt[]): string {
  const b = boxOf(pts), q = (v: number, o: number, s: number) => +(((v - o) / s) * 100).toFixed(3);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${q(p[0], b.x - b.w / 2, b.w)} ${q(p[1], b.y - b.h / 2, b.h)}`).join(" ");
  return `<path d="${d} Z" class="ff" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>`;
}

// ---- B54.3: the editor's writers. A worktop is named "w<i>" like a room is "r<i>", so the room panel's corner and edge
// code (insertPoint, removePoint, movePointAll, polyPts) reaches it. Each writer returns the floor itself when it refuses
// (a wrong index, fewer than 3 or more than 64 points, a result that crosses itself) and never a half-written piece.

/** The index of the worktop a polygon id names ("w3" is 3), else null. */
export function worktopIndex(poly: string): number | null {
  return /^w\d+$/.test(poly) ? +poly.slice(1) : null;
}

/** Worktop `poly`'s points, or undefined when `poly` names none (not a worktop, a missing piece, bad points). */
export function worktopPolyPts(f: Floor, poly: string): Pt[] | undefined {
  const i = worktopIndex(poly);
  return i === null ? undefined : worktopPts(f.furniture?.[i] ?? {}) ?? undefined;
}

/** `f` with worktop `poly` given `next`: points, bounding box and rot 0 together. `f` itself when `next` is not a good worktop or nothing changed. */
function withPts(f: Floor, poly: string, next: Pt[]): Floor {
  const i = worktopIndex(poly), cur = worktopPolyPts(f, poly);
  if (i === null || !cur || worktopPtsProblem(next) !== "") return f;
  if (next.length === cur.length && next.every((p, k) => p[0] === cur[k][0] && p[1] === cur[k][1])) return f;
  const g = structuredClone(f);
  Object.assign(g.furniture[i], boxOf(next), { rot: 0, pts: next.map((p): Pt => [p[0], p[1]]) });
  return g;
}

/** A point after edge `i` (between points i and i+1). */
export function worktopInsert(f: Floor, poly: string, i: number, pt: Pt): Floor {
  const cur = worktopPolyPts(f, poly);
  if (!cur || !Number.isInteger(i) || i < 0 || i >= cur.length) return f;
  return withPts(f, poly, [...cur.slice(0, i + 1), pt, ...cur.slice(i + 1)]);
}

/** Point `j` taken out; never below 3 points. */
export function worktopRemove(f: Floor, poly: string, j: number): Floor {
  const cur = worktopPolyPts(f, poly);
  if (!cur || !Number.isInteger(j) || j < 0 || j >= cur.length) return f;
  return withPts(f, poly, cur.filter((_, k) => k !== j));
}

/** Point `j` moved to `to`. */
export function worktopMove(f: Floor, poly: string, j: number, to: Pt): Floor {
  const cur = worktopPolyPts(f, poly);
  if (!cur || !Number.isInteger(j) || j < 0 || j >= cur.length) return f;
  return withPts(f, poly, cur.map((p, k): Pt => (k === j ? [to[0], to[1]] : p)));
}

/** Worktop `i` moved by (dx, dy): every point, and the box with them. */
export function worktopShift(f: Floor, i: number, dx: number, dy: number): Floor {
  const cur = worktopPolyPts(f, `w${i}`);
  return cur ? withPts(f, `w${i}`, cur.map((p): Pt => [p[0] + dx, p[1] + dy])) : f;
}

/** Worktop `i` turned `deg` degrees about the middle of its box. The points turn; rot stays 0, so the piece never holds two truths. */
export function worktopTurn(f: Floor, i: number, deg: number): Floor {
  const cur = worktopPolyPts(f, `w${i}`);
  if (!cur || !Number.isFinite(deg) || deg % 360 === 0) return f;
  const { x, y } = boxOf(cur), a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), r = (v: number) => +v.toFixed(2);
  return withPts(f, `w${i}`, cur.map((p): Pt => [r(x + (p[0] - x) * c - (p[1] - y) * s), r(y + (p[0] - x) * s + (p[1] - y) * c)]));
}

/** The point on edge a-b nearest `p`, kept off the two ends (5 % in), in whole cm: where a click on the edge adds a corner. Shared by the room's double-click and the worktop's click. */
export function edgePoint(a: Pt, b: Pt, p: Pt): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0.05, Math.min(0.95, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return [Math.round(a[0] + dx * t), Math.round(a[1] + dy * t)];
}

/** A piece's symbol markup: the catalogue's, except a worktop with good points, whose own outline it is. */
export function symbolOf(m: { symbol?: unknown; pts?: unknown }, catalogue: string): string {
  const p = worktopPts(m);
  return p ? worktopSvg(p) : catalogue;
}
