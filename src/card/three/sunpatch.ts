// Where the sun shines in (S38.4): the patch of floor behind a window the sun reaches. Pure maths, no three.js, no card code; the meshes
// are patches.ts. Frame: the plan's, cm. It trusts nothing: junk in, null out.
import type { Aperture } from "../../core/scene-build";
import { inPoly, roomOfPoint, type RoomShape } from "./light";

type Pt = readonly [number, number];
/** cm. A patch reaches at most this far from the wall, measured along the light. */
export const SUN_REACH = 800;
/** The most patches drawn, the largest first. */
export const MAX_SUN_PATCHES = 24;
/** The openings that let sun through. A door, a sealed panel or anything unknown does not. */
const SHINES = ["window", "fullwindow", "glass", "slit", "open"];
/** Ground drawn as a room (a lawn, a terrace, a pond, a zone, a fill): outside, so it is neither lit by the sun nor a room the glass looks into. */
const OUTDOORS = ["garden", "terrace", "pavement", "water", "zone", "fill"];
/** Rays across the opening; each gives one column of the patch. */
const COLUMNS = 9;
/** cm. The clip stops a hair inside the room, so a patch never touches the wall it ends at. */
const CLIP_GAP = 0.5;

/** `cols`: per ray, where the sill's and the head's light land on the floor. `ring`: the patch outline (near edge left to right, far edge back). `strength`: sin(elevation) x cos(angle to the wall's normal). */
export interface SunPatch { room: number; cols: { near: Pt; far: Pt }[]; ring: Pt[]; area: number; cos: number; strength: number }

const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isPt = (p: unknown): p is [number, number] => Array.isArray(p) && p.length >= 2 && fin(p[0]) && fin(p[1]);
const ringArea = (r: readonly Pt[]) => Math.abs(r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;

/** How far from `p` along the unit vector `r` the ray first meets the room's outline (past `CLIP_GAP`), and 0 if it does not go into the room at all. */
function inside(base: RoomShape["base"], p: Pt, r: Pt): number {
  let hit = Infinity;
  for (let i = 0; i < base.length; i++) {
    const a = base[i], b = base[(i + 1) % base.length], ex = b[0] - a[0], ey = b[1] - a[1], den = r[0] * ey - r[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den, s = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / den;
    if (s >= 0 && s <= 1 && t > CLIP_GAP && t < hit) hit = t;
  }
  const probe = Math.min(hit, SUN_REACH * 2) / 2;
  return inPoly(base, p[0] + r[0] * probe, p[1] + r[1] * probe) ? hit : 0;
}

/**
 * The floor patch of one opening, or null. `dir` is `sunDir`'s vector (toward the sun, z up). The opening, from sill to head, is projected along
 * the light onto the floor: a point h up lands h / tan(elevation) from the wall, away from the sun. Each ray is cut where the room ends and at
 * `SUN_REACH`. Null for a kind that lets no sun through, a wall with no outside on one side (`outer`, and by the rooms themselves: a room on the
 * inner side, none on the outer), a face turned from the sun, and anything that is not a finite number.
 */
export function sunPatch(ap: Aperture, rooms: readonly (RoomShape & { kind?: string })[], dir: readonly number[] | null): SunPatch | null {
  try {
    if (!Array.isArray(dir) || dir.length < 3 || !dir.slice(0, 3).every(fin) || !(dir[2] > 0)) return null;
    const flat = Math.hypot(dir[0], dir[1]);
    if (!(flat > 1e-6) || typeof ap !== "object" || ap === null || !SHINES.includes(ap.kind) || ap.outer !== true || !Array.isArray(ap.faces) || !Array.isArray(rooms)) return null;
    if (!isPt(ap.a) || !isPt(ap.b) || !fin(ap.sill) || !fin(ap.head) || !(ap.sill >= 0) || !(ap.head > ap.sill)) return null;
    const len = Math.hypot(ap.b[0] - ap.a[0], ap.b[1] - ap.a[1]);
    if (!(len > 0)) return null;
    const shapes = rooms.filter((r) => typeof r === "object" && r !== null && !OUTDOORS.includes(String(r.kind)) && Array.isArray(r.base) && r.base.length >= 3 && r.base.every(isPt) && fin(r.index) && fin(r.top) && fin(r.area));
    const h: Pt = [dir[0] / flat, dir[1] / flat], tan = dir[2] / flat, mid: Pt = [(ap.a[0] + ap.b[0]) / 2, (ap.a[1] + ap.b[1]) / 2], away = (fin(ap.thick) && ap.thick > 0 ? ap.thick : 10) / 2 + 4;
    for (const f of ap.faces) {
      if (!isPt(f)) continue;
      const fl = Math.hypot(f[0], f[1]), n: Pt = [f[0] / fl, f[1] / fl], cos = n[0] * h[0] + n[1] * h[1];
      if (!(cos > 1e-6)) continue;
      // The room behind the glass has the light's side of the wall to its back, and the other side of the wall holds no room: the outside.
      const room = roomOfPoint(shapes, mid[0] - n[0] * away, mid[1] - n[1] * away);
      if (room < 0 || roomOfPoint(shapes, mid[0] + n[0] * away, mid[1] + n[1] * away) >= 0) continue;
      const base = shapes.find((r) => r.index === room)!.base, r: Pt = [-h[0], -h[1]];
      const d0 = ap.sill / tan, d1 = Math.min(ap.head / tan, SUN_REACH);
      if (!(d0 < d1)) continue;
      const cols = Array.from({ length: COLUMNS }, (_, i) => {
        const t = i / (COLUMNS - 1), p: Pt = [ap.a[0] + (ap.b[0] - ap.a[0]) * t, ap.a[1] + (ap.b[1] - ap.a[1]) * t], e = inside(base, p, r) - CLIP_GAP;
        const near = Math.max(0, Math.min(d0, e)), far = Math.max(near, Math.min(d1, e));
        return { near: [p[0] + r[0] * near, p[1] + r[1] * near] as Pt, far: [p[0] + r[0] * far, p[1] + r[1] * far] as Pt };
      });
      const ring = [...cols.map((c) => c.near), ...cols.map((c) => c.far).reverse()], area = ringArea(ring);
      if (!(area > 1)) continue;
      return { room, cols, ring, area, cos, strength: dir[2] * cos };
    }
    return null;
  } catch { return null; }
}

/** Every patch the openings throw, the largest first. */
export function sunPatches(openings: readonly Aperture[], rooms: readonly (RoomShape & { kind?: string })[], dir: readonly number[] | null): SunPatch[] {
  if (!Array.isArray(openings)) return [];
  return openings.map((o) => sunPatch(o, rooms, dir)).filter((p): p is SunPatch => p !== null).sort((a, b) => b.area - a.area);
}
