// Which room a lamp lights, as plain maths: no three.js, no DOM, nothing imported from core at run time (the chunk must
// share no code with the card, see palette.ts). The card says which room each lit light is in (core `roomAt`, the rule of
// the 2D aura clip); this module turns that into what to lift: the rooms, how much, in which colour, and which lamps to
// spend a pool on. Frame: the plan's, cm.
type Pt = readonly [number, number];
export type Poly = readonly (readonly number[])[];
export type Rgb = [number, number, number];
export interface RoomShape { index: number; base: Poly; top: number; area: number }
export interface LitLight { room: number; at: Pt; rgb: Rgb; level: number }

/** The most lamps that get a pool of their own. A room is lifted whatever it holds; the pool is the cost. */
export const MAX_POOLS = 32;
/** cm. A wall's own vertex this far outside every room still belongs to the nearest one (the face of an outer wall). */
export const WALL_REACH = 12;

const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function inPoly(base: Poly, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = base.length - 1; i < base.length; j = i++) {
    const a = base[i], b = base[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** cm from the point to the nearest edge of the polygon. */
export function edgeGap(base: Poly, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < base.length; i++) {
    const a = base[i], b = base[(i + 1) % base.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)));
  }
  return best;
}

/**
 * The room that holds (x, y): the highest of those that do (a room nested in another sits above it), then the smaller.
 * With `near` > 0, a point no room holds goes to the nearest room within that many cm. -1 for none, and for junk.
 */
export function roomOfPoint(rooms: readonly RoomShape[], x: number, y: number, near = 0): number {
  if (!fin(x) || !fin(y)) return -1;
  let best: RoomShape | null = null;
  for (const r of rooms) if (inPoly(r.base, x, y) && (!best || r.top > best.top || (r.top === best.top && r.area < best.area))) best = r;
  if (best) return best.index;
  if (!(near > 0)) return -1;
  let gap = near, at = -1;
  for (const r of rooms) { const g = edgeGap(r.base, x, y); if (g <= gap) { gap = g; at = r.index; } }
  return at;
}

/** The `max` lamps nearest to `centre`: the budget. Stable for equal distances, so the choice does not flicker. */
export function pickLights<T extends { at: Pt }>(lights: readonly T[], centre: Pt, max = MAX_POOLS): T[] {
  return lights.map((l, i) => ({ l, i, d: Math.hypot(l.at[0] - centre[0], l.at[1] - centre[1]) })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, Math.max(0, max)).map((x) => x.l);
}

/** What a vertex colour is multiplied by in a room lit at `level` (0..1) by a lamp of colour `rgb`: brighter, and toward the lamp. */
export function liftFor(rgb: Rgb, level: number, boost = 1): Rgb {
  const top = Math.max(rgb[0], rgb[1], rgb[2]), warm = top > 0 ? rgb.map((c) => c / top) : [1, 1, 1], s = 0.5 * Math.max(0, Math.min(1, level)) * boost;
  return warm.map((w) => 1 + s * (0.35 + 0.65 * w)) as Rgb;
}

/** Room index to its lift. Lamps in one room add (up to one lamp's worth twice over); a lamp in no room (room -1) lifts nothing. */
export function roomLifts(lights: readonly LitLight[], boost = 1): Map<number, Rgb> {
  const sum = new Map<number, { w: number; c: Rgb }>();
  for (const l of lights) {
    if (l.room < 0) continue;
    const s = sum.get(l.room) ?? { w: 0, c: [0, 0, 0] as Rgb };
    for (let k = 0; k < 3; k++) s.c[k] += l.rgb[k] * l.level;
    s.w += l.level;
    sum.set(l.room, s);
  }
  const out = new Map<number, Rgb>();
  for (const [r, s] of sum) out.set(r, liftFor(s.w > 0 ? (s.c.map((c) => c / s.w) as Rgb) : [1, 1, 1], Math.min(1, s.w), boost));
  return out;
}

// ---- the lamp's light on the walls of its own room (S13). A wall face that looks into the lamp's room gets a soft patch, brightest
// near the lamp and gone at `GLOW_REACH`; a face of another room, the outside of an outer wall, a face turned away: nothing.
/** cm. How far a lamp's light reaches along a wall (3D distance, the height difference included). */
export const GLOW_REACH = 300;
/** cm. A patch has a vertex about this often along a face and up it; at most `GLOW_COLS` by `GLOW_ROWS` cells, so a face costs a fixed few dozen vertices. */
const GLOW_CELL = 25, GLOW_COLS = 12, GLOW_ROWS = 6;

/** 0..1: the share of the lamp's light on a wall point `dist` cm from it, `perp` of that across the wall's plane. Falls with the square of what is left of the reach, and a point seen at a grazing angle gets less. */
export function glowAt(dist: number, perp: number, reach = GLOW_REACH): number {
  if (!fin(dist) || !fin(perp) || !(dist < reach)) return 0;
  const t = 1 - Math.max(0, dist) / reach, cos = dist > 0 ? Math.max(0, Math.min(1, perp / dist)) : 1;
  return t * t * (0.35 + 0.65 * cos);
}

/** 1 for a ring wound the way the plan's y-down shoelace calls positive, -1 for the other way: the sign that makes an edge's (dy, -dx) point out of the solid (as `prismTriangles` does). */
export const outwardSign = (ring: Poly): 1 | -1 => (ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) >= 0 ? 1 : -1);

/**
 * The lit part of a wall solid's face a to b (an edge of its ring, wound with sign `s`, see `outwardSign`): the outward unit normal (plan frame) and
 * the stretches of the face, as cm from `a`, that look into the lamp's room toward the lamp; else null. A stretch looks into the room when the point
 * just in front of it lies in the room, so the face is cut wherever that point crosses a room's edge: one long outline face shared by two rooms lights
 * only the part before the lamp's own room, the outside of an outer wall and the neighbour's face of a shared wall do not, and a face the lamp is behind
 * does not. With `rooms` and `room` the room of that point is `roomOfPoint`'s (the highest, then the smallest that holds it), so the face of a room nested
 * in the lamp's room, which looks into the inner room, is not lit through it; without them it is `base`.
 */
export function facing(a: Pt, b: Pt, s: 1 | -1, base: Poly, lamp: Pt, rooms?: readonly RoomShape[], room = -1): { n: Pt; spans: [number, number][] } | null {
  if (![a[0], a[1], b[0], b[1], lamp[0], lamp[1]].every(fin)) return null;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (!(len > 0.5)) return null;
  const n: Pt = [(s * dy) / len + 0, (-s * dx) / len + 0];
  if (!((lamp[0] - a[0]) * n[0] + (lamp[1] - a[1]) * n[1] > 0)) return null;
  const x0 = a[0] + n[0] * FRONT, y0 = a[1] + n[1] * FRONT, polys: Poly[] = [base, ...(rooms ?? []).map((r) => r.base)], cuts = [0, 1];
  for (const P of polys) for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], ex = q[0] - p[0], ey = q[1] - p[1], den = dx * ey - dy * ex;
    if (!(Math.abs(den) > 1e-9)) continue;
    const t = ((p[0] - x0) * ey - (p[1] - y0) * ex) / den, u = ((p[0] - x0) * dy - (p[1] - y0) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((m, k) => m - k);
  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t0 = cuts[i], t1 = cuts[i + 1];
    if (!((t1 - t0) * len > 0.5)) continue;
    const x = x0 + dx * (t0 + t1) / 2, y = y0 + dy * (t0 + t1) / 2;
    if (!(rooms && room >= 0 ? roomOfPoint(rooms, x, y) === room : inPoly(base, x, y))) continue;
    const last = spans[spans.length - 1];
    if (last && Math.abs(last[1] - t0 * len) < 1e-6) last[1] = t1 * len; else spans.push([t0 * len, t1 * len]);
  }
  return spans.length ? { n, spans } : null;
}
/** cm. How far in front of a face the room test looks. */
const FRONT = 2;

/**
 * The patch of one face (a to b, normal `n`, drawn from `z0` to `z1`) lit by a lamp at `lamp` and height `lampZ`: a grid of vertices lifted `lift` cm off the
 * face, in three.js' frame (x, up, plan y), with the share of light (`glowAt`) at each, and the triangles. Only the stretch within reach (and within `span`, cm from `a`, when given) is meshed. Null when
 * the lamp is behind the face or out of reach, or nothing would be lit.
 */
export function glowGrid(a: Pt, b: Pt, n: Pt, z0: number, z1: number, lamp: Pt, lampZ: number, reach: number, lift: number, span?: readonly [number, number]): { pos: number[]; k: number[]; index: number[] } | null {
  if (![a[0], a[1], b[0], b[1], n[0], n[1], z0, z1, lamp[0], lamp[1], lampZ, reach, lift].every(fin) || !(z1 > z0)) return null;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  const ux = dx / len, uy = dy / len, perp = (lamp[0] - a[0]) * n[0] + (lamp[1] - a[1]) * n[1], foot = (lamp[0] - a[0]) * ux + (lamp[1] - a[1]) * uy;
  if (!(perp > 0) || !(perp < reach)) return null;
  const half = Math.sqrt(reach * reach - perp * perp), u0 = Math.max(span ? Math.max(0, span[0]) : 0, foot - half), u1 = Math.min(span ? Math.min(len, span[1]) : len, foot + half);
  if (!(u1 > u0)) return null;
  const cols = Math.max(1, Math.min(GLOW_COLS, Math.ceil((u1 - u0) / GLOW_CELL))), rows = Math.max(1, Math.min(GLOW_ROWS, Math.ceil((z1 - z0) / (GLOW_CELL * 1.6))));
  const pos: number[] = [], k: number[] = [], index: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const u = u0 + ((u1 - u0) * i) / cols, z = z0 + ((z1 - z0) * j) / rows;
    pos.push(a[0] + ux * u + n[0] * lift, z, a[1] + uy * u + n[1] * lift);
    k.push(glowAt(Math.hypot(perp, u - foot, z - lampZ), perp, reach));
  }
  if (!k.some((v) => v > 0)) return null;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const p = j * (cols + 1) + i, q = p + cols + 1; index.push(p, p + 1, q + 1, p, q + 1, q); }
  return { pos, k, index };
}
