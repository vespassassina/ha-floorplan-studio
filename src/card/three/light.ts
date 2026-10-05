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
export const MAX_POOLS = 8;
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
