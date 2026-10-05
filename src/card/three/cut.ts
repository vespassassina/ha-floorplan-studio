// Which walls the 3D view lowers, as plain maths: no three.js, no DOM, nothing imported from core at run time (the chunk
// must share no code with the card, see palette.ts). Frame: the plan's, x east, y south, z up, cm.
//
// "Cut" is the doll's house cutaway, decided by where the camera stands, with a margin so a camera drifting over a
// threshold does not make a wall flicker:
//   - a wall that faces out of a room or the house is lowered while the camera is on that side of its plane (it is then
//     between the camera and what it encloses);
//   - an inner wall (a room's edge, a free wall), however many faces it kept, hides what lies behind it from either side: lowered when the
//     floor it hides, measured across the wall, is deep (a camera nearly overhead hides nothing, one that looks along the
//     wall sees it edge-on, one lower than its top hides everything behind it);
//   - every other wall (the far side of the house seen from outside) stands at its full height.
// "Low" lowers every wall, "full" none.
import type { Solid } from "../../core/scene";

type Pt = [number, number];
/** One wall as the decision sees it: the pieces a door cuts it into are one body, found by `poly:index`. */
export interface WallBody { key: string; mid: Pt; h: number; faces: Pt[] }
export type Walls = "full" | "cut" | "low";

/** cm. A camera this far past a wall's plane lowers it; it must come this far back inside before the wall stands again. */
export const HYSTERESIS_CM = 20;
/** cm of floor hidden behind a wall (measured across it) before it is lowered, and the lower figure it must fall under to stand again. */
const HIDE_ENTER = 60, HIDE_LEAVE = 40;

const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The walls of a scene, one body each, in the order they first appear. */
export function wallBodies(solids: readonly Solid[]): WallBody[] {
  const found = new Map<string, { lo: Pt; hi: Pt; h: number; faces: Pt[] }>();
  for (const s of solids) {
    if (s.kind !== "wall" || s.shape.type !== "prism" || s.ref.poly === undefined || s.ref.index === undefined) continue;
    const key = `${s.ref.poly}:${s.ref.index}`;
    let w = found.get(key);
    if (!w) found.set(key, (w = { lo: [Infinity, Infinity], hi: [-Infinity, -Infinity], h: 0, faces: (s.ref.faces ?? []).map((f): Pt => [f[0], f[1]]) }));
    for (const p of s.shape.base) { w.lo = [Math.min(w.lo[0], p[0]), Math.min(w.lo[1], p[1])]; w.hi = [Math.max(w.hi[0], p[0]), Math.max(w.hi[1], p[1])]; }
    w.h = Math.max(w.h, s.shape.z1);
  }
  return [...found].map(([key, w]) => ({ key, mid: [(w.lo[0] + w.hi[0]) / 2, (w.lo[1] + w.hi[1]) / 2] as Pt, h: w.h, faces: w.faces }));
}

/** Whether a wall has a face on each side (a wall between rooms, or a free wall), as against one that faces one way only. */
const twoSided = (faces: readonly Pt[]) => faces.some((p) => faces.some((q) => p[0] * q[0] + p[1] * q[1] < -0.99));

/**
 * The keys of the walls to draw lowered, for a camera at `cam`. `prev` is the set the last call returned (it is read,
 * never changed): a wall already lowered keeps that until the camera is clearly back. Junk input lowers nothing in "cut".
 */
export function lowerWalls(bodies: readonly WallBody[], cam: readonly [number, number, number], mode: Walls, prev: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  if (mode === "full") return out;
  if (mode === "low") { for (const b of bodies) out.add(b.key); return out; }
  if (!cam.every(fin)) return out;
  for (const b of bodies) {
    const was = prev.has(b.key), dx = cam[0] - b.mid[0], dy = cam[1] - b.mid[1];
    if (b.faces.length === 0) continue; // a degenerate outline: nothing says which way it faces
    // The outline faces out of the house: seen from the far side it is the far wall and stands. Any other wall is inside, and
    // seen from either side it hides a room, whatever one face it kept when two rooms' edges only overlapped in part.
    if (b.key.startsWith("o:") && !twoSided(b.faces)) {
      const n = b.faces[0], dist = n[0] * dx + n[1] * dy;
      if (dist > (was ? -HYSTERESIS_CM : HYSTERESIS_CM)) out.add(b.key);
      continue;
    }
    const hl = Math.hypot(dx, dy), n = b.faces[0], across = hl > 0 ? Math.abs(n[0] * dx + n[1] * dy) / hl : 0;
    // The line from the camera over the wall's top meets the floor this far behind the wall, along the sight line.
    const hidden = across < 1e-6 ? 0 : cam[2] <= b.h ? Infinity : (b.h * hl * across) / (cam[2] - b.h);
    if (hidden > (was ? HIDE_LEAVE : HIDE_ENTER)) out.add(b.key);
  }
  return out;
}

/**
 * The z range a solid is drawn over when the walls in `lowered` stand at `low` cm: a wall piece, or the infill of an
 * opening in such a wall, is cut to `low` (gone if nothing of it is below that); everything else keeps its own range.
 * `null`: do not draw it. A point has no range and gives `null`.
 */
export function wallZ(s: Solid, lowered: ReadonlySet<string>, low: number): [number, number] | null {
  if (s.shape.type !== "prism") return null;
  const { z0, z1 } = s.shape;
  const key = s.kind === "wall" && s.ref.poly !== undefined ? `${s.ref.poly}:${s.ref.index}` : s.kind === "opening" ? s.ref.wall : undefined;
  if (key === undefined || !lowered.has(key)) return [z0, z1];
  const top = Math.min(z1, low);
  return top > z0 ? [z0, top] : null;
}
