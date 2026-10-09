import type { Pt } from "./schema";

// S25.5: spiderfy. Devices whose discs overlap on screen are a stack, and a tap on a stack fans its members out in a ring.
// Pure geometry only; renderFloor draws the ring (`RenderOpts.spider`) and the card decides when it is open.

/** Two device centres closer than this many screen px are a stack: it is the width of a device disc (32k plan units, never under 29 px, `NAME_MIN_PX`). */
export const STACK_PX = 32;
/** Members of a ring sit at least this far apart on screen: a touch target. */
export const SPIDER_GAP_PX = 44;
/** The smallest ring radius on screen, so two members do not sit side by side at the stack. */
export const SPIDER_MIN_R_PX = 40;
/** The most members one ring takes. */
export const SPIDER_MAX = 8;
/** Room kept beside the ring, on screen, for the names that stand outside it. */
const LABEL_PX = 110;

const isPt = (p: unknown): p is Pt => Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * The indices of points that form a stack, as groups of two or more, by first index. Two points closer than `minDist`
 * are linked and links chain, so a-b and b-c close with a-c far is one group. Untrusted input: a junk point is skipped,
 * a junk `minDist` (not a finite number above 0) or a non-array gives none.
 */
export function stackGroups(points: readonly unknown[], minDist: number): number[][] {
  if (!Array.isArray(points) || typeof minDist !== "number" || !Number.isFinite(minDist) || !(minDist > 0)) return [];
  const ok: number[] = [];
  points.forEach((p, i) => { if (isPt(p)) ok.push(i); });
  const root = new Map<number, number>(ok.map((i) => [i, i]));
  const find = (i: number): number => { let r = i; while (root.get(r) !== r) r = root.get(r)!; return r; };
  for (let a = 0; a < ok.length; a++) for (let b = a + 1; b < ok.length; b++) {
    const p = points[ok[a]] as Pt, q = points[ok[b]] as Pt;
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < minDist) root.set(find(ok[b]), find(ok[a]));
  }
  const groups = new Map<number, number[]>();
  for (const i of ok) { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); }
  return [...groups.values()].filter((g) => g.length > 1).sort((x, y) => x[0] - y[0]);
}

/**
 * Where the members of a stack go: evenly on one ring about the mean of their true spots, the first straight up. `unit`
 * is plan units per screen px, so the ring is the same size on screen at any zoom. The centre is moved until the ring and
 * room for the names beside it lie inside `box` (a box too small gets the ring at its centre). Junk gives none.
 */
export function spiderLayout(spots: readonly unknown[], unit: number, box: { x: number; y: number; w: number; h: number }): Pt[] {
  if (!Array.isArray(spots) || !spots.length || !spots.every(isPt) || typeof unit !== "number" || !Number.isFinite(unit) || !(unit > 0)) return [];
  const n = spots.length;
  const mean: Pt = [spots.reduce((s, p) => s + p[0], 0) / n, spots.reduce((s, p) => s + p[1], 0) / n];
  const r = Math.max(SPIDER_MIN_R_PX, n > 1 ? SPIDER_GAP_PX / (2 * Math.sin(Math.PI / n)) : 0) * unit;
  const fit = (v: number, lo: number, hi: number, mid: number) => (lo > hi ? mid : Math.min(hi, Math.max(lo, v)));
  const okBox = box && [box.x, box.y, box.w, box.h].every((v) => typeof v === "number" && Number.isFinite(v));
  let cx = mean[0], cy = mean[1];
  if (okBox) {
    const mx = Math.min(LABEL_PX * unit, Math.max(0, (box.w - 2 * r) / 4)), my = Math.min(24 * unit, Math.max(0, (box.h - 2 * r) / 4));
    cx = fit(cx, box.x + r + mx, box.x + box.w - r - mx, box.x + box.w / 2);
    cy = fit(cy, box.y + r + my, box.y + box.h - r - my, box.y + box.h / 2);
  }
  return spots.map((_, j) => [cx + r * Math.cos(-Math.PI / 2 + (2 * Math.PI * j) / n), cy + r * Math.sin(-Math.PI / 2 + (2 * Math.PI * j) / n)] as Pt);
}
