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
  if (!num(azimuth, 0, 359.999999999) || !num(north, 0, 359.999999999) || !num(elevation, -90, 90) || !(elevation > 0)) return null;
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
