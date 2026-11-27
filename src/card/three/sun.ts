// The sun on the 3D house (S38): where its light comes from and how strong and warm it is. Pure maths, no three.js, no card code.

const RAD = Math.PI / 180;
const num = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;

/**
 * The unit vector from the house toward the sun, in the plan's frame (x east, y south, z up; the view maps it to three's
 * (x, z, y)). The plan bearing is `azimuth + north`, clockwise from plan-up (SPEC, Layout schema, `north`): bearing 0 is (0, -1),
 * 90 is (1, 0). The plan's on-screen turn (`rotate`) is not in it: the sun belongs to the house.
 * Null for a sun at or under the horizon and for anything that is not a number in range (azimuth and north in [0, 360), elevation in [-90, 90]).
 */
export function sunDir(azimuth: unknown, elevation: unknown, north: unknown): [number, number, number] | null {
  if (!num(azimuth, 0, 360) || azimuth === 360 || !num(north, 0, 360) || north === 360 || !num(elevation, -90, 90) || !(elevation > 0)) return null;
  const bearing = (azimuth + north) * RAD, el = elevation * RAD, flat = Math.cos(el);
  return [Math.sin(bearing) * flat, -Math.cos(bearing) * flat, Math.sin(el)];
}

/** The warm end of a low sun, #ffd9a0, as 0..1 channels. */
export const WARM_RGB: readonly [number, number, number] = [1, 0xd9 / 255, 0xa0 / 255];
/** Elevation (degrees) from which the sun is at full strength, and under which it turns warm. */
const FULL_AT = 30, WHITE_AT = 15, DIM = 0.6;

/** The sun light's strength as a fraction of the daylight value (1 from 30 degrees up, 0.6 at the horizon) and its colour (white from 15 degrees up, `WARM_RGB` at the horizon), both linear between. */
export function sunLook(elevation: number): { k: number; rgb: [number, number, number] } {
  const e = Math.max(0, elevation), k = e >= FULL_AT ? 1 : DIM + (1 - DIM) * (e / FULL_AT), w = e >= WHITE_AT ? 0 : 1 - e / WHITE_AT;
  return { k, rgb: [1, 1 + (WARM_RGB[1] - 1) * w, 1 + (WARM_RGB[2] - 1) * w] };
}

/** S80: minimum elevation (degrees) used for directional shadow projection so a near-horizon sun casts crisp shadows instead of stretching off-map. */
export const SHADOW_MIN_EL = 8;

export interface SunShadowBox {
  pos: [number, number, number];
  target: [number, number, number];
  half: number;
  near: number;
  far: number;
}

/**
 * S80: computes an orthographic shadow-camera frustum for `DirectionalLight.shadow.camera`, fitted tightly to `bounds`
 * (plan cm: `min: [x0, y0, z0]`, `max: [x1, y1, z1]`) along `dir` (plan unit vector toward the sun).
 * Returns null when `dir` is null or `bounds` is invalid.
 */
export function sunShadowBox(
  bounds: { min: readonly number[]; max: readonly number[] } | null | undefined,
  dir: readonly [number, number, number] | null,
): SunShadowBox | null {
  if (!dir || !bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max)) return null;
  const [x0, y0, z0 = 0] = bounds.min, [x1, y1, z1 = 300] = bounds.max;
  if (![x0, y0, z0, x1, y1, z1].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const w = x1 - x0, d = y1 - y0, h = Math.max(100, z1 - z0);
  if (!(w > 0 && d > 0)) return null;
  const minSin = Math.sin(SHADOW_MIN_EL * RAD);
  let [dx, dy, dz] = dir;
  if (dz < minSin) {
    const horiz = Math.hypot(dx, dy) || 1;
    const flat = Math.cos(SHADOW_MIN_EL * RAD);
    dx = (dx / horiz) * flat;
    dy = (dy / horiz) * flat;
    dz = minSin;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const radius = Math.hypot(w, d, h) * 0.65;
  const half = Math.max(radius * 1.15, 300);
  const dist = radius * 2.2;
  // Plan (x, y, z) -> Three.js (x, z, y)
  return {
    pos: [cx + dx * dist, cz + dz * dist, cy + dy * dist],
    target: [cx, cz, cy],
    half,
    near: Math.max(10, dist - radius * 2.1),
    far: dist + radius * 2.5,
  };
}
