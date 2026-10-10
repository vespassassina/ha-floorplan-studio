// S28.8: the contact shadows of the 3D view, as pure maths. `contactShadows(solids)` turns the scene's solids into ONE
// triangle soup (three's frame: plan x stays x, height is y, plan y is z) with an alpha per vertex: 1 at a footprint's
// edge, falling to 0 a band away. The viewer draws it as a single transparent mesh in `--fp-shade` at `--fp-shade-alpha`.
// A wall gets a band on every side; a piece of furniture, an unlinked box and a device body get a narrower one; a tree
// gets a soft ellipse under its crown. Plain maths, no core import (the chunk shares no code with the card), and the
// layout is untrusted input: a solid that cannot give a footprint is skipped and nothing throws.
import type { Solid } from "../../core/scene";

/** cm. How far a wall's shade reaches from its foot, and a piece's. */
export const BAND_WALL = 14, BAND_PATCH = 8;
/** cm. The shade lies this far above the surface it falls on: enough for the depth test, too little to see. */
export const HAIR = 0.3;
/** cm. Lower than this a piece is a deck or a slab, and casts nothing; higher than this off the floor it floats, and casts nothing. */
const FLAT = 10, FLOAT = 5;
/** A tree's crown shade: where it falls (cm, plan), its strength in the middle, and how smooth the rim is. */
const TREE_OFFSET: [number, number] = [4, 6], TREE_CENTRE = 0.8, TREE_STEPS = 24;
/** cm. Past this a size is not a footprint; it also keeps every vertex finite in float32. */
const LIMIT = 1e6;

export interface Shade { position: Float32Array; alpha: Float32Array; walls: number; patches: number }
type Pt = [number, number];
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pt = (p: unknown): p is Pt => Array.isArray(p) && num(p[0]) && num(p[1]) && Math.abs(p[0]) < LIMIT && Math.abs(p[1]) < LIMIT;

/** The box the ground plane covers: 1.5 times the scene box, centred on it. Null for numbers no plane can have. */
export function groundBox(b: { min: readonly number[]; max: readonly number[] }): { x0: number; y0: number; x1: number; y1: number } | null {
  const lo = b?.min, hi = b?.max;
  if (!Array.isArray(lo) || !Array.isArray(hi) || ![lo[0], lo[1], hi[0], hi[1]].every((n) => num(n) && Math.abs(n) < LIMIT)) return null;
  const w = hi[0] - lo[0], h = hi[1] - lo[1];
  if (!(w > 0) || !(h > 0)) return null;
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;
  return { x0: cx - 0.75 * w, y0: cy - 0.75 * h, x1: cx + 0.75 * w, y1: cy + 0.75 * h };
}

const inside = (p: Pt, poly: readonly Pt[]): boolean => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

export function contactShadows(solids: readonly Solid[]): Shade {
  const list = (Array.isArray(solids) ? solids : []).filter((s): s is Solid => typeof s === "object" && s !== null && !!s.shape);
  const prism = (s: Solid): { base: Pt[]; z0: number; z1: number } | null => {
    const sh = s.shape;
    if (sh.type !== "prism" || !Array.isArray(sh.base) || sh.base.length < 3 || !sh.base.every(pt) || !num(sh.z0) || !num(sh.z1) || !(sh.z1 > sh.z0) || Math.abs(sh.z0) > LIMIT || Math.abs(sh.z1) > LIMIT) return null;
    return { base: sh.base, z0: sh.z0, z1: sh.z1 };
  };
  // What a point stands on: the highest room fill that holds it (a nested room sits above its parent), else the slab.
  const rooms: { base: Pt[]; top: number }[] = [];
  let slab: number | null = null;
  for (const s of list) {
    const p = prism(s);
    if (!p) continue;
    if (s.kind === "room") rooms.push({ base: p.base, top: p.z1 });
    else if (s.kind === "floor") slab = Math.max(slab ?? -Infinity, p.z1);
  }
  const support = (at: Pt, fallback: number): number => {
    let top = -Infinity;
    for (const r of rooms) if (r.top > top && inside(at, r.base)) top = r.top;
    return top > -Infinity ? top : slab ?? fallback;
  };

  // Typed buffers that double when full: 5000 pieces are about 180 000 vertices, and the maths is the whole cost.
  let pos = new Float32Array(1 << 15), alpha = new Float32Array(1 << 13), nv = 0;
  const vert = (x: number, y: number, z: number, a: number) => {
    if (nv === alpha.length) { const p2 = new Float32Array(pos.length * 2), a2 = new Float32Array(alpha.length * 2); p2.set(pos); a2.set(alpha); pos = p2; alpha = a2; }
    pos[nv * 3] = x; pos[nv * 3 + 1] = y; pos[nv * 3 + 2] = z; alpha[nv++] = a;
  };
  /** A band round a convex footprint: a quad on each edge and a wedge on each corner, 1 at the edge and 0 at `band`. */
  const ring = (base: Pt[], band: number, y: number) => {
    const n = base.length;
    let area = 0;
    for (let i = 0; i < n; i++) { const a = base[i]!, b = base[(i + 1) % n]!; area += a[0] * b[1] - b[0] * a[1]; }
    if (!area) return;
    const sg = area > 0 ? 1 : -1;
    let px = 0, pz = 0; // the previous edge's normal
    {
      const a = base[n - 1]!, b = base[0]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l > 0) { px = (sg * (b[1] - a[1])) / l; pz = (-sg * (b[0] - a[0])) / l; }
    }
    for (let i = 0; i < n; i++) {
      const a = base[i]!, b = base[(i + 1) % n]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = l > 0 ? (sg * (b[1] - a[1])) / l : 0, nz = l > 0 ? (-sg * (b[0] - a[0])) / l : 0;
      const ax = a[0] + nx * band, az = a[1] + nz * band, bx = b[0] + nx * band, bz = b[1] + nz * band;
      vert(a[0], y, a[1], 1); vert(b[0], y, b[1], 1); vert(bx, y, bz, 0); // the quad on the edge
      vert(a[0], y, a[1], 1); vert(bx, y, bz, 0); vert(ax, y, az, 0);
      vert(a[0], y, a[1], 1); vert(a[0] + px * band, y, a[1] + pz * band, 0); vert(ax, y, az, 0); // the corner at `a`
      px = nx; pz = nz;
    }
  };

  let walls = 0, patches = 0;
  for (const s of list) {
    const p = prism(s);
    if (!p) continue;
    const c: Pt = [0, 0];
    for (const q of p.base) { c[0] += q[0]; c[1] += q[1]; }
    c[0] /= p.base.length; c[1] /= p.base.length;
    if (s.kind === "wall") {
      // Both faces of a wall may stand on different floors (a nested room): take the higher, sampled a hand's width off each side.
      let long: Pt = [1, 0], best = -1;
      p.base.forEach((a, i) => { const b = p.base[(i + 1) % p.base.length]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; long = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; } });
      const t = BAND_WALL / 2 + 5, top = Math.max(support([c[0] - long[1] * t, c[1] + long[0] * t], p.z0), support([c[0] + long[1] * t, c[1] - long[0] * t], p.z0));
      ring(p.base, BAND_WALL, top + HAIR);
      walls++;
      continue;
    }
    if (s.kind !== "furniture" && s.kind !== "unlinked" && s.kind !== "device") continue;
    const level = support(c, p.z0);
    if (p.z1 - p.z0 < FLAT || p.z0 > level + FLOAT) continue;
    const size = s.ref?.size, crown = s.ref?.crown;
    if (s.kind === "furniture" && crown && Array.isArray(size) && num(size[0]) && num(size[1]) && size[0] > 0 && size[1] > 0 && size[0] < LIMIT && size[1] < LIMIT && num(crown.rot)) {
      const th = (crown.rot * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th), rx = size[0] / 2, ry = size[1] / 2;
      const mx = c[0] + TREE_OFFSET[0], mz = c[1] + TREE_OFFSET[1], y = level + HAIR;
      const ex = (a: number) => mx + Math.cos(a) * rx * co - Math.sin(a) * ry * si, ez = (a: number) => mz + Math.cos(a) * rx * si + Math.sin(a) * ry * co;
      for (let k = 0; k < TREE_STEPS; k++) {
        const a0 = (k / TREE_STEPS) * 2 * Math.PI, a1 = ((k + 1) / TREE_STEPS) * 2 * Math.PI;
        vert(mx, y, mz, TREE_CENTRE); vert(ex(a0), y, ez(a0), 0); vert(ex(a1), y, ez(a1), 0);
      }
    } else ring(p.base, BAND_PATCH, level + HAIR);
    patches++;
  }
  return { position: pos.slice(0, nv * 3), alpha: alpha.slice(0, nv), walls, patches };
}
