import { structure } from "./align";
import { COORD_LIMIT, type Floor, type Layout, type Pt } from "./schema";

/** S27.3: the order of the floors, lowest first: the order of `floors`, as `floorElevation` stacks them. Never throws; junk is no floors. */
function keys(layout: Layout): string[] {
  const f = (layout as any)?.floors;
  return typeof f === "object" && f !== null && !Array.isArray(f) ? Object.keys(f) : [];
}

/** The key of the floor under this one, or null for the lowest floor and for an unknown key. */
export function floorBelow(layout: Layout, key: string): string | null {
  const ks = keys(layout), i = ks.indexOf(key);
  return i > 0 ? ks[i - 1] : null;
}

/** S96: the key of the floor above this one, or null for the highest floor and for an unknown key. */
export function floorAbove(layout: Layout, key: string): string | null {
  const ks = keys(layout), i = ks.indexOf(key);
  return i >= 0 && i + 1 < ks.length ? ks[i + 1] : null;
}

/** Every key under this one, nearest first. Empty for the lowest floor and for an unknown key. */
export function floorsBelow(layout: Layout, key: string): string[] {
  const ks = keys(layout), i = ks.indexOf(key);
  return i > 0 ? ks.slice(0, i).reverse() : [];
}

/** A floor's offset as two finite numbers within COORD_LIMIT; anything else, and an unknown key, is [0, 0]. */
function offsetOf(layout: Layout, key: string): Pt {
  const floors = (layout as any)?.floors;
  if (!keys(layout).includes(key)) return [0, 0];
  const o = floors[key]?.offset;
  return Array.isArray(o) && o.length === 2 && o.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= COORD_LIMIT) ? [o[0], o[1]] : [0, 0];
}

// ---------------------------------------------------------------------------------------------------------------------
// S29.2: pose helpers. Design note (the full text is in docs/DECISIONS.md, 2026-10-11 "S29.2").
//
// SIGN. Degrees, CLOCKWISE on screen, y pointing down: R(t)·(x, y) = (x cos t - y sin t, x sin t + y cos t).
//   R(90)·(1, 0) = (0, 1): the point to the right goes to the point below. R(4)·(100, 0) = (99.756, 6.976).
// POSE. A stored point p of a floor sits in the house at R(rotation)·p + offset.
// PLACE. { turn, shift }: p' = R(turn)·p + shift. floorPlace(from, to) is what to do to a stored point of `from` to draw it
//   in the stored frame of `to`: turn = rot_from - rot_to, shift = R(-rot_to)·(off_from - off_to).
//   Worked example: basement at the origin, ground at rotation -2.5 and offset [-57, 112]. floorPlace(ground, basement) =
//   { turn: -2.5, shift: [-57, 112] }; the ground's (400, 240) lands at (353.09, 334.32) in the basement.
// COMPOSE. composePlace(a, b) = apply a, then b: turn a.turn + b.turn, shift R(b.turn)·a.shift + b.shift.
// ---------------------------------------------------------------------------------------------------------------------

/** A turn (degrees, clockwise on screen) then a shift (cm): `p' = R(turn) · p + shift`. */
export interface Place { turn: number; shift: Pt }
/** A floor's stored pose: rotation (degrees) and offset (cm), as `floorPlace` reads them. */
export interface Pose { rot: number; off: Pt }

/** `v` turned by `deg` clockwise on screen. A turn of 0 returns `v` untouched (no cos, no sin), so zero rotations stay exact. */
function turned(v: Pt, deg: number): Pt {
  if (deg === 0) return [v[0], v[1]];
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}

/** Degrees wrapped into (-180, 180]. */
export function normaliseTurn(deg: number): number {
  const m = deg % 360; // exact for an angle already in range: adding 360 first left 0.1 as 0.10000000000002274
  return m > 180 ? m - 360 : m <= -180 ? m + 360 : m;
}

/** A floor's stored pose. Junk (a rotation that is not a finite number from -180 to 180, a bad offset) and an unknown key read as identity, field by field. */
export function floorPose(layout: Layout, key: string): Pose {
  const f = (layout as any)?.floors;
  const r = keys(layout).includes(key) ? f[key]?.rotation : undefined;
  return { rot: typeof r === "number" && Number.isFinite(r) && r >= -180 && r <= 180 ? r : 0, off: offsetOf(layout, key) };
}

/** `R(turn) · p + shift`. */
export function placePoint(place: Place, p: Pt): Pt {
  const r = turned(p, place.turn);
  return [r[0] + place.shift[0], r[1] + place.shift[1]];
}

/** What to do to a stored point of `from` to draw it in the stored frame of `to`. With both rotations 0 it is `{ turn: 0, shift: from.offset - to.offset }` exactly. */
export function floorPlace(layout: Layout, from: string, to: string): Place {
  const a = floorPose(layout, from), b = floorPose(layout, to);
  return { turn: a.rot - b.rot, shift: turned([a.off[0] - b.off[0], a.off[1] - b.off[1]], -b.rot) };
}

/** The place that undoes `place`. */
export function invertPlace(place: Place): Place {
  const s = turned(place.shift, -place.turn);
  return { turn: -place.turn, shift: [-s[0], -s[1]] };
}

/** Apply `a`, then `b`. Turns add without wrapping. */
export function composePlace(a: Place, b: Place): Place {
  const s = turned(a.shift, b.turn);
  return { turn: a.turn + b.turn, shift: [s[0] + b.shift[0], s[1] + b.shift[1]] };
}

/** The unrounded pose of floor `key` that makes `floorPlace(layout, key, below)` equal `place`. The rotation is wrapped into (-180, 180]; rounding is the writer's job. */
export function poseFromPlace(layout: Layout, key: string, below: string, place: Place): Pose {
  void key;
  const b = floorPose(layout, below), s = turned(place.shift, b.rot);
  return { rot: normaliseTurn(b.rot + place.turn), off: [b.off[0] + s[0], b.off[1] + s[1]] };
}

/** The centre of the bounding box of `pts` that are finite points, or null when there are none. */
function boxCentre(pts: unknown[]): Pt | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) if (Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && typeof p[0] === "number" && typeof p[1] === "number") {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
  }
  return x0 > x1 ? null : [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** The point a turn of this floor is about: the centre of the bounds of its structure lines (what Align reads), else of its stairs, else [0, 0]. In the floor's own frame, so the pose never moves it. Never throws. */
export function floorPivot(floor: Floor): Pt {
  const segs = structure(floor);
  const fromLines = boxCentre(segs.flatMap((s) => [[s[0], s[1]], [s[2], s[3]]]));
  if (fromLines) return fromLines;
  const stairs = (floor as any)?.stairs;
  return boxCentre(Array.isArray(stairs) ? stairs.flatMap((t: any) => (t && Array.isArray(t.pts) ? t.pts : [])) : []) ?? [0, 0];
}
