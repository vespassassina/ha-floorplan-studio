// The pure part of the 3D view: a prism from the scene module (plan x, y in cm, z up) as flat-shaded triangles in
// three.js' frame. Plan x stays x, plan z (up) is y, and plan y (down the page, south) is z, which points at a camera
// standing south of the house: east is on the right, as on the plan, and nothing is mirrored.
// A layout is untrusted input (CLAUDE.md finding 1): a base that cannot be drawn makes no triangles and never throws.
import { ShapeUtils, Vector2 } from "three";

type Pt = [number, number];
export interface Triangles { position: number[]; normal: number[] }

/** Past this (cm) a coordinate is not a house; it also keeps every float32 and every product finite. */
const LIMIT = 1e7;

const finitePt = (p: unknown): p is Pt => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" && Math.abs(p[0]) <= LIMIT && Math.abs(p[1]) <= LIMIT;

/** Appends one triangle with the winding that faces `want` (a unit vector), and that vector as its normal at each corner. */
function emit(out: Triangles, a: number[], b: number[], c: number[], want: number[]): void {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const flip = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0;
  for (const p of flip ? [a, c, b] : [a, b, c]) { out.position.push(p[0], p[1], p[2]); out.normal.push(want[0], want[1], want[2]); }
}

/**
 * Adds the prism over `base` from `z0` to `z1` to `out`: a top cap, a bottom cap and one quad per edge, each facing
 * outward whichever way the base is wound. A concave base is triangulated (earcut, from three). Returns whether
 * anything was added; a base with fewer than three distinct points, a line, a non-finite or huge coordinate, or a
 * flat height adds nothing.
 */
export function prismTriangles(base: unknown, z0: number, z1: number, out: Triangles): boolean {
  if (!Array.isArray(base) || !(typeof z0 === "number" && typeof z1 === "number" && Math.abs(z0) <= LIMIT && Math.abs(z1) <= LIMIT && z1 > z0)) return false;
  if (!base.every(finitePt)) return false;
  const p: Pt[] = [];
  for (const q of base as Pt[]) { const l = p[p.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) p.push(q); }
  while (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
  if (p.length < 3) return false;
  // Shoelace in plan coordinates (y down): positive is clockwise on the page.
  const area = p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
  if (!(Math.abs(area) > 1e-9)) return false;
  let faces: number[][];
  try { faces = ShapeUtils.triangulateShape(p.map((q) => new Vector2(q[0], q[1])), []); } catch { return false; }
  const before = out.position.length;
  for (const [i, j, k] of faces) {
    if (p[i] === undefined || p[j] === undefined || p[k] === undefined) continue;
    const at = (q: Pt, z: number) => [q[0], z, q[1]];
    emit(out, at(p[i], z1), at(p[j], z1), at(p[k], z1), [0, 1, 0]);
    emit(out, at(p[i], z0), at(p[j], z0), at(p[k], z0), [0, -1, 0]);
  }
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (!(len > 0)) return;
    // Outward is (dy, -dx) for a positive area, the other way for a negative one.
    const s = area > 0 ? 1 : -1, want = [(s * dy) / len, 0, (-s * dx) / len];
    const A = [a[0], z0, a[1]], B = [b[0], z0, b[1]], C = [b[0], z1, b[1]], D = [a[0], z1, a[1]];
    emit(out, A, B, C, want);
    emit(out, A, C, D, want);
  });
  if (out.position.length === before) return false;
  return true;
}
