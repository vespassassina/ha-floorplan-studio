// What a tap in the 3D view lands on, as plain maths: no three.js, no DOM, nothing imported from core at run time (the
// chunk must share no code with the card, see palette.ts). The view turns the pointer into a ray (plan frame: x east,
// y south, z up, cm) and this module says what the nearest thing along it is. Same semantics as 2D, in 3D:
//   - a device (its body, or the hit proxy around its marker), a door or window (leaf, glass or panel) and an unlinked
//     appliance are what they are: the card gives them to the same gesture code the plan uses;
//   - a room's floor, or furniture standing on it, is that room;
//   - a wall, a stair, the slab and furniture on no room are "other": they stop the ray and a tap on them clears the pick.
// A hatched fill (a room of kind "fill") is not a room and is looked through. A wall the view has lowered is only as
// tall as it is drawn (`zOf`), so a ray goes over it. Every solid has a bounding box tested first, so 5000 pieces of
// furniture cost 5000 box tests per tap.
import type { Solid } from "../../core/scene";

type V3 = [number, number, number];
export interface Ray { o: V3; d: V3 }
export type Pick =
  | { type: "device"; index: number }
  | { type: "door"; index: number }
  | { type: "unlinked"; index: number }
  | { type: "piece"; index: number }
  | { type: "room"; index: number }
  | { type: "other" };

/** cm. The ball drawn for a device that has no body of its own, and the bigger invisible ball a tap on it hits. */
export const MARKER_R = 12, PROXY_R = 24;

const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const vec = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every(fin);

interface Item { s: Solid; lo: V3; hi: V3 }

const contains = (poly: readonly number[][], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

/** Where a ray enters a box, or `null`. Slab method. */
function boxHit(r: Ray, lo: V3, hi: V3, max: number): boolean {
  let t0 = 0, t1 = max;
  for (let k = 0; k < 3; k++) {
    if (r.d[k] === 0) { if (r.o[k] < lo[k] || r.o[k] > hi[k]) return false; continue; }
    let a = (lo[k] - r.o[k]) / r.d[k], b = (hi[k] - r.o[k]) / r.d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

/** The nearest `t > 0` at which the ray meets the prism over `base` between `z0` and `z1`, or `null`. */
function prismHit(r: Ray, base: readonly number[][], z0: number, z1: number): number | null {
  let best = Infinity;
  const [ox, oy, oz] = r.o, [dx, dy, dz] = r.d;
  if (dz !== 0) {
    for (const z of [z1, z0]) {
      const t = (z - oz) / dz;
      if (t > 1e-9 && t < best && contains(base, ox + dx * t, oy + dy * t)) best = t;
    }
  }
  if (dx !== 0 || dy !== 0) {
    for (let i = 0; i < base.length; i++) {
      const a = base[i], b = base[(i + 1) % base.length], ex = b[0] - a[0], ey = b[1] - a[1];
      const den = dx * ey - dy * ex;
      if (den === 0) continue;
      const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den, u = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;
      if (t > 1e-9 && t < best && u >= 0 && u <= 1) { const z = oz + dz * t; if (z >= z0 && z <= z1) best = t; }
    }
  }
  return best < Infinity ? best : null;
}

/** The nearest `t > 0` at which the ray meets the ball, or `null`. `d` is a unit vector. */
function ballHit(r: Ray, c: V3, rad: number): number | null {
  const mx = r.o[0] - c[0], my = r.o[1] - c[1], mz = r.o[2] - c[2];
  const b = mx * r.d[0] + my * r.d[1] + mz * r.d[2], q = mx * mx + my * my + mz * mz - rad * rad, disc = b * b - q;
  if (disc < 0) return null;
  const s = Math.sqrt(disc), t = -b - s > 1e-9 ? -b - s : -b + s;
  return t > 1e-9 ? t : null;
}

/**
 * What hides a label or an icon behind it (S12.5): a wall, a stair, a door's leaf, a sealed panel. Not the floor or the slab
 * (a label lies on them), not furniture and devices (small, and a label under a table would never show), not glass or a doorway's alert band (a slab 2 cm thick).
 */
const BLOCKS = (s: Solid): boolean => s.kind === "wall" || s.kind === "stair" || (s.kind === "opening" && s.tag !== "glass" && s.tag !== "band");

export class Picker {
  private items: Item[] = [];
  private rooms: { index: number; base: number[][]; top: number }[] = [];
  private shade: Item[] = [];

  /** `solids` are a scene's. A solid that cannot be drawn (junk base, non-finite number) is not pickable. */
  constructor(solids: readonly Solid[]) {
    for (const s of Array.isArray(solids) ? solids : []) {
      const sh = s?.shape;
      if (!sh || s.ref?.hidden === true) continue; // a room's own sensor draws nothing and a tap passes through it (S12.5)
      if (sh.type === "point") {
        if (!Array.isArray(sh.at) || !fin(sh.at[0]) || !fin(sh.at[1]) || !fin(sh.z)) continue;
        this.items.push({ s, lo: [sh.at[0] - PROXY_R, sh.at[1] - PROXY_R, sh.z - PROXY_R], hi: [sh.at[0] + PROXY_R, sh.at[1] + PROXY_R, sh.z + PROXY_R] });
        continue;
      }
      if (sh.type !== "prism" || !Array.isArray(sh.base) || sh.base.length < 3 || !sh.base.every((p: unknown[]) => Array.isArray(p) && fin(p[0]) && fin(p[1])) || !fin(sh.z0) || !fin(sh.z1)) continue;
      const xs = sh.base.map((p: number[]) => p[0]), ys = sh.base.map((p: number[]) => p[1]);
      const item: Item = { s, lo: [Math.min(...xs), Math.min(...ys), Math.min(sh.z0, sh.z1)], hi: [Math.max(...xs), Math.max(...ys), Math.max(sh.z0, sh.z1)] };
      this.items.push(item);
      if (BLOCKS(s)) this.shade.push(item);
      if (s.kind === "room" && s.tag !== "fill" && fin(s.ref?.room)) this.rooms.push({ index: s.ref.room!, base: sh.base, top: sh.z1 });
    }
  }

  /** The room whose floor lies under (x, y): the highest of those that contain it (a room nested in another sits above it). */
  private roomAt(x: number, y: number): number | null {
    let best: { index: number; top: number } | null = null;
    for (const r of this.rooms) if ((!best || r.top >= best.top) && contains(r.base, x, y)) best = r;
    return best ? best.index : null;
  }

  /** Whether something that hides labels (BLOCKS) stands between the ray's origin and the point `tMax` along it. `zOf` as in `pick`. */
  blocked(ray: Ray, tMax: number, zOf: (s: Solid) => [number, number] | null): boolean {
    if (!ray || !vec(ray.o) || !vec(ray.d) || !(tMax > 0) || !Number.isFinite(tMax)) return false;
    const len = Math.hypot(...ray.d);
    if (!(len > 0)) return false;
    const r: Ray = { o: ray.o, d: [ray.d[0] / len, ray.d[1] / len, ray.d[2] / len] };
    for (const it of this.shade) {
      const sh = it.s.shape, z = zOf(it.s);
      if (sh.type !== "prism" || !z || !(z[1] > z[0])) continue;
      if (!boxHit(r, [it.lo[0], it.lo[1], z[0]], [it.hi[0], it.hi[1], z[1]], tMax)) continue;
      const t = prismHit(r, sh.base, z[0], z[1]);
      if (t !== null && t < tMax) return true;
    }
    return false;
  }

  /**
   * What the ray meets first. `zOf` says the z range each prism is drawn over (null: not drawn, so not hit); the view
   * passes the lowered walls through it. `null` when nothing is hit, and for a ray that is not a finite ray.
   */
  pick(ray: Ray, zOf: (s: Solid) => [number, number] | null): Pick | null {
    if (!ray || !vec(ray.o) || !vec(ray.d)) return null;
    const len = Math.hypot(...ray.d);
    if (!(len > 0)) return null;
    const r: Ray = { o: ray.o, d: [ray.d[0] / len, ray.d[1] / len, ray.d[2] / len] };
    let bestT = Infinity, bestItem: Item | null = null;
    for (const it of this.items) {
      const sh = it.s.shape;
      let t: number | null = null;
      if (sh.type === "point") {
        if (boxHit(r, it.lo, it.hi, bestT)) t = ballHit(r, [sh.at[0], sh.at[1], sh.z], PROXY_R);
      } else if (sh.type === "prism") {
        if (it.s.kind === "room" && it.s.tag === "fill") continue; // not a room, and not in the way
        const z = zOf(it.s);
        if (!z || !(z[1] > z[0])) continue;
        const lo: V3 = [it.lo[0], it.lo[1], z[0]], hi: V3 = [it.hi[0], it.hi[1], z[1]];
        if (boxHit(r, lo, hi, bestT)) t = prismHit(r, sh.base, z[0], z[1]);
      }
      if (t !== null && t < bestT) { bestT = t; bestItem = it; }
    }
    if (!bestItem) return null;
    const s = bestItem.s, i = s.ref?.index;
    switch (s.kind) {
      case "device": return fin(i) ? { type: "device", index: i } : { type: "other" };
      case "opening": return fin(i) ? { type: "door", index: i } : { type: "other" };
      case "unlinked": return fin(i) ? { type: "unlinked", index: i } : { type: "other" };
      case "room": return fin(s.ref.room) ? { type: "room", index: s.ref.room } : { type: "other" };
      case "furniture": {
        if (s.ref.entity && fin(i)) return { type: "piece", index: i }; // a linked tv, speaker or computer: its own thing, as a device
        const x = r.o[0] + r.d[0] * bestT, y = r.o[1] + r.d[1] * bestT, room = this.roomAt(x, y);
        return room === null ? { type: "other" } : { type: "room", index: room };
      }
      default: return { type: "other" };
    }
  }
}
