import {
  MAX_HEIGHT,
  contentPoints,
  deviceZ,
  dist,
  doorCeiling,
  doorSpan,
  edgeHeight,
  floorHeight,
  floorSlab,
  furnitureBottom,
  furnitureTop,
  nearestEdge,
  openingSpan,
  rotateAbout,
  roomHeight,
  unlinkedHeight,
  wallHeight,
  worktopIndex,
  worktopPts,
  worktopShift,
  worktopTurn,
  type Floor,
  type Pt,
} from "../core";
import type { Hit3D } from "../card/three/host";
import type { Ray } from "../card/three/pick";
import { HOST, mirrorOnWall, round } from "./editor-kit";
import { gridRound, rotateSegment, segmentAt } from "./ops";
import { polyPts, ptOf, type PtRef, type Sel } from "./state";

export type V3 = [number, number, number];
export type HandleKind3D = "corner" | "wall-h" | "room-h" | "sill" | "head" | "floor-h" | "floor-slab" | "dev-z" | "furn-z" | "rot";

export interface HandleSpec {
  id: string;
  kind: HandleKind3D;
  label: string;
  at: V3;
  /** Underlying z value (cm) when the handle visually floats above the object (e.g. dev-z / furn-z gizmo). */
  baseZ?: number;
  /** Rotation handle pivot centre in plan cm, item kind, and current/base rotation angle in degrees. */
  center?: Pt;
  itemKind?: "dev" | "furn" | "unl";
  baseRot?: number;
  ref?: PtRef;
  index?: number;
  list?: "doors" | "openings";
}

export interface WireSpec {
  pts: V3[];
  closed?: boolean;
  zone?: boolean;
}

const normRot = (deg: number): number => ((Math.round(deg) % 360) + 360) % 360;
const clampH = (z: number): number => Math.max(0, Math.min(MAX_HEIGHT, Math.round(z)));

/** Intersects a ray in plan coordinates (x, y, z up) with the horizontal plane Z = z. */
export function rayOnZ(ray: Ray, z: number): Pt | null {
  const dz = ray.d[2];
  if (Math.abs(dz) < 1e-6) return null;
  const t = (z - ray.o[2]) / dz;
  if (!(t > 0) || !Number.isFinite(t)) return null;
  return [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t];
}

/** Finds Z along the vertical line through (ax, ay) nearest to a camera ray in plan coordinates. */
export function rayZAt(ray: Ray, ax: number, ay: number): number | null {
  const [ox, oy, oz] = ray.o, [dx, dy, dz] = ray.d;
  const hh = dx * dx + dy * dy;
  if (hh < 1e-6) return null;
  const t = -((ox - ax) * dx + (oy - ay) * dy) / hh;
  if (!(t > 0) || !Number.isFinite(t)) return null;
  const z = oz + dz * t;
  return Number.isFinite(z) ? z : null;
}

/** Maps a 3D hit (icon, camera thumb, or solid) to the Editor's shared `Sel`. */
export function selFromHit(f: Floor, hit: Hit3D | null): Sel {
  if (!hit) return null;
  if (hit.kind !== "solid") {
    return hit.index >= 0 && hit.index < f.devices.length ? { t: "dev", i: hit.index } : null;
  }
  const s = hit.solid, i = s.ref?.index;
  switch (s.kind) {
    case "device": return typeof i === "number" && i >= 0 && i < f.devices.length ? { t: "dev", i } : null;
    case "furniture": return typeof i === "number" && i >= 0 && i < f.furniture.length ? { t: "furn", i } : null;
    case "unlinked": return typeof i === "number" && i >= 0 && i < f.unlinked.length ? { t: "unl", i } : null;
    case "opening": return typeof i === "number" && i >= 0 && i < f.doors.length ? { t: "door", i } : null;
    case "stair": return typeof i === "number" && i >= 0 && i < f.stairs.length ? { t: "stairs", i } : null;
    case "room": {
      const r = s.ref?.room;
      return typeof r === "number" && r >= 0 && r < f.rooms.length ? { t: "room", i: r } : null;
    }
    case "wall": {
      if (s.ref?.poly === "w" && typeof i === "number" && i >= 0 && i < f.walls.length) return { t: "wall", i };
      if (typeof s.ref?.poly === "string" && typeof i === "number" && polyPts(f, s.ref.poly)?.[i]) {
        return { t: "edge", poly: s.ref.poly, i };
      }
      return null;
    }
    default: return null;
  }
}

/** Anchor `(x, y, z)` in plan cm for dragging a device, furniture piece or unlinked item in 3D. */
export function itemAnchor3D(f: Floor, s: Sel): V3 | null {
  if (s?.t === "dev") {
    const dv = f.devices[s.i];
    if (!dv) return null;
    if ("a" in dv) return [(dv.a[0] + dv.b[0]) / 2, (dv.a[1] + dv.b[1]) / 2, deviceZ(dv)];
    return [dv.x, dv.y, deviceZ(dv)];
  }
  if (s?.t === "furn") {
    const m = f.furniture[s.i];
    return m ? [m.x, m.y, furnitureBottom(m)] : null;
  }
  if (s?.t === "unl") {
    const u = f.unlinked[s.i];
    return u ? [u.x, u.y, 0] : null;
  }
  return null;
}

/** Moves a device, furniture piece or unlinked appliance horizontally to `target`, snapped to `gs` cm. */
export function moveItem3D(base: Floor, kind: "dev" | "furn" | "unl", i: number, target: Pt, gs: number): Floor | null {
  const g5 = (n: number) => gridRound(n, gs);
  if (kind === "dev") {
    const dv = base.devices[i];
    if (!dv || dv.locked) return null;
    const g = structuredClone(base), t = g.devices[i];
    const c: Pt = [g5(target[0]), g5(target[1])];
    if ("a" in dv && "a" in t) {
      const len = dist(dv.a, dv.b), e = nearestEdge(base, target, 80, HOST);
      if (e) {
        const nx = -e.u[1], ny = e.u[0], sd = (target[0] - e.q[0]) * nx + (target[1] - e.q[1]) * ny >= 0 ? 1 : -1;
        Object.assign(t, segmentAt([e.q[0] + nx * sd * 16, e.q[1] + ny * sd * 16], e.u, len));
      } else {
        Object.assign(t, segmentAt(c, [(dv.b[0] - dv.a[0]) / (len || 1), (dv.b[1] - dv.a[1]) / (len || 1)], len));
      }
    } else if ("x" in t) {
      t.x = c[0];
      t.y = c[1];
    }
    return g;
  }
  if (kind === "furn") {
    const m0 = base.furniture[i];
    if (!m0 || m0.locked) return null;
    if (worktopPts(m0)) {
      return worktopShift(base, i, Math.round(g5(target[0]) - m0.x), Math.round(g5(target[1]) - m0.y));
    }
    const g = structuredClone(base);
    const nx = g5(target[0]), ny = g5(target[1]);
    g.furniture[i].x = nx;
    g.furniture[i].y = ny;
    if (g.furniture[i].symbol === "mirror") Object.assign(g.furniture[i], mirrorOnWall(base, target, g.furniture[i].h) ?? {});
    return g;
  }
  const u0 = base.unlinked[i];
  if (!u0 || u0.locked) return null;
  const g = structuredClone(base);
  g.unlinked[i].x = g5(target[0]);
  g.unlinked[i].y = g5(target[1]);
  return g;
}

/** Updates vertical mount `z` (0..MAX_HEIGHT cm) of a device or furniture piece. */
export function setItemZ(base: Floor, kind: "dev" | "furn", i: number, z: number): Floor | null {
  const nz = clampH(z);
  const g = structuredClone(base);
  if (kind === "dev") {
    const d = g.devices[i];
    if (!d || d.locked) return null;
    d.z = nz;
    return g;
  }
  const m = g.furniture[i];
  if (!m || m.locked) return null;
  m.z = nz;
  return g;
}

/** Sets rotation (degrees, 0..359) of a device, furniture piece, or unlinked appliance. */
export function setItemRot(base: Floor, kind: "dev" | "furn" | "unl", i: number, rotDeg: number, baseRot = 0): Floor | null {
  if (!Number.isFinite(rotDeg)) return null;
  const rot = normRot(rotDeg);
  if (kind === "furn") {
    const m = base.furniture[i];
    if (!m || m.locked) return null;
    if (worktopPts(m)) return worktopTurn(base, i, rot - baseRot);
    const g = structuredClone(base);
    g.furniture[i].rot = rot;
    return g;
  }
  if (kind === "unl") {
    const u = base.unlinked[i];
    if (!u || u.locked) return null;
    const g = structuredClone(base);
    g.unlinked[i].rot = rot;
    return g;
  }
  const d = base.devices[i];
  if (!d || d.locked) return null;
  const g = structuredClone(base), dv = g.devices[i];
  if ("a" in dv) {
    Object.assign(dv, rotateSegment(dv.a, dv.b, rot - baseRot));
    return g;
  }
  if (rot === 0) delete dv.rot;
  else dv.rot = rot;
  return g;
}

/** Rotates the selected furniture, unlinked appliance, device, or stair by `stepDeg` (e.g. 15°). */
export function rotateSel15(f: Floor, sel: Sel, stepDeg = 15): { next: Floor; msg: string } | null {
  if (!sel || !Number.isFinite(stepDeg) || stepDeg === 0) return null;
  if (sel.t === "furn" && f.furniture[sel.i]) {
    const m = f.furniture[sel.i];
    if (m.locked) return null;
    if (worktopPts(m)) return { next: worktopTurn(f, sel.i, stepDeg), msg: `Rotated ${stepDeg > 0 ? "+" : ""}${stepDeg}°` };
    const g = structuredClone(f);
    g.furniture[sel.i].rot = normRot((m.rot ?? 0) + stepDeg);
    return { next: g, msg: `Rotated to ${g.furniture[sel.i].rot}°` };
  }
  if (sel.t === "unl" && f.unlinked[sel.i]) {
    const u = f.unlinked[sel.i];
    if (u.locked) return null;
    const g = structuredClone(f);
    g.unlinked[sel.i].rot = normRot((u.rot ?? 0) + stepDeg);
    return { next: g, msg: `Rotated to ${g.unlinked[sel.i].rot}°` };
  }
  if (sel.t === "dev" && f.devices[sel.i]) {
    const d = f.devices[sel.i];
    if (d.locked) return null;
    const g = structuredClone(f), dv = g.devices[sel.i];
    if ("a" in dv) {
      Object.assign(dv, rotateSegment(dv.a, dv.b, stepDeg));
      return { next: g, msg: `Rotated ${stepDeg > 0 ? "+" : ""}${stepDeg}°` };
    }
    const r = normRot((d.rot ?? 0) + stepDeg);
    if (r === 0) delete dv.rot;
    else dv.rot = r;
    return { next: g, msg: `Rotated to ${r}°` };
  }
  if (sel.t === "stairs" && f.stairs[sel.i]) {
    const g = structuredClone(f);
    g.stairs[sel.i].rot = normRot((f.stairs[sel.i].rot ?? 0) + stepDeg);
    return { next: g, msg: `Rotated to ${g.stairs[sel.i].rot}°` };
  }
  return null;
}

/** Updates a Stage 3 vertical height/slab/sill/head or item Z gizmo handle on a copy of `base`. */
export function applyHeightHandle(base: Floor, h: HandleSpec, nextZ: number, span?: { sill: number; head: number }): Floor | null {
  if (h.kind === "dev-z" && typeof h.index === "number") return setItemZ(base, "dev", h.index, nextZ);
  if (h.kind === "furn-z" && typeof h.index === "number") return setItemZ(base, "furn", h.index, nextZ);
  const g = structuredClone(base);
  if (h.kind === "wall-h" && typeof h.index === "number" && g.walls[h.index]) {
    g.walls[h.index].height = clampH(nextZ);
    return g;
  }
  if (h.kind === "room-h" && typeof h.index === "number" && g.rooms[h.index]) {
    g.rooms[h.index].height = clampH(nextZ);
    return g;
  }
  if (h.kind === "floor-h") {
    g.height = clampH(nextZ);
    return g;
  }
  if (h.kind === "floor-slab") {
    g.slab = clampH(-nextZ);
    return g;
  }
  if ((h.kind === "sill" || h.kind === "head") && h.list && typeof h.index === "number") {
    const item = g[h.list][h.index];
    if (!item) return null;
    const curSill = span?.sill ?? 0, curHead = span?.head ?? curSill + 100;
    if (h.kind === "sill") {
      const sill = Math.max(0, Math.min(MAX_HEIGHT, Math.min(curHead - 10, Math.round(nextZ))));
      item.sill = sill;
      item.height = Math.max(10, Math.min(MAX_HEIGHT, Math.round(curHead - sill)));
    } else {
      item.sill = clampH(curSill);
      item.height = Math.max(10, Math.min(MAX_HEIGHT, Math.round(nextZ - item.sill)));
    }
    return g;
  }
  return null;
}

const boxWires = (poly: Pt[], z0: number, z1: number, zone = false): WireSpec[] => {
  if (poly.length < 2) return [];
  const bot: V3[] = poly.map(([x, y]) => [x, y, z0]);
  if (z1 <= z0 + 0.5) return [{ pts: bot, closed: true, zone }];
  const top: V3[] = poly.map(([x, y]) => [x, y, z1]);
  const out: WireSpec[] = [{ pts: bot, closed: true, zone }, { pts: top, closed: true, zone }];
  for (let i = 0; i < poly.length; i++) out.push({ pts: [bot[i], top[i]], closed: false, zone });
  return out;
};

const rectCorners = (x: number, y: number, w: number, h: number, rot: number): Pt[] =>
  ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as Pt[]).map((q) => rotateAbout([x + q[0], y + q[1]], rot, [x, y]));

function rotGizmo(cx: number, cy: number, z: number, radius: number, rotDeg: number, kind: "dev" | "furn" | "unl", index: number): { wire: WireSpec; handle: HandleSpec } {
  const pts: V3[] = Array.from({ length: 24 }, (_, k) => {
    const a = (k * Math.PI * 2) / 24;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a), z];
  });
  const rad = ((rotDeg - 90) * Math.PI) / 180;
  return {
    wire: { pts, closed: true },
    handle: {
      id: `rot:${kind}:${index}`,
      kind: "rot",
      label: `Rotate ${Math.round(normRot(rotDeg))}° (drag around; Alt free)`,
      at: [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad), z],
      center: [cx, cy],
      itemKind: kind,
      baseRot: normRot(rotDeg),
      index,
    },
  };
}

const floorAnchorPt = (f: Floor): Pt | null => {
  if (f.outline.length > 0) {
    let best = f.outline[0];
    for (const p of f.outline) if (p[0] + p[1] > best[0] + best[1]) best = p;
    return best;
  }
  const pts = contentPoints(f);
  if (!pts.length) return null;
  const mx = Math.max(...pts.map((p) => p[0])), my = Math.max(...pts.map((p) => p[1]));
  return [mx, my];
};

/** Computes wireframe highlights and interactive Stage 3 handles for the current selection in plan space. */
export function handlesForSel(f: Floor, s: Sel): { wires: WireSpec[]; handles: HandleSpec[] } {
  const wires: WireSpec[] = [];
  const handles: HandleSpec[] = [];

  if (!s) {
    const a = floorAnchorPt(f);
    if (a) {
      const fh = floorHeight(f), slab = floorSlab(f);
      wires.push({ pts: [[a[0], a[1], -slab], [a[0], a[1], fh]], closed: false });
      handles.push(
        { id: "floor-h", kind: "floor-h", label: `Floor height ${fh} cm`, at: [a[0], a[1], fh] },
        { id: "floor-slab", kind: "floor-slab", label: `Slab thickness ${slab} cm`, at: [a[0], a[1], -slab] },
      );
    }
    return { wires, handles };
  }

  if (s.t === "room") {
    const r = f.rooms[s.i];
    if (r && r.pts.length >= 3) {
      const h = roomHeight(f, r), zone = r.kind === "zone";
      if (zone) wires.push({ pts: r.pts.map(([x, y]) => [x, y, 2] as V3), closed: true, zone: true });
      else wires.push({ pts: r.pts.map(([x, y]) => [x, y, h] as V3), closed: true });
      r.pts.forEach((p, j) => handles.push({ id: `corner:r${s.i}:${j}`, kind: "corner", label: `Corner ${j + 1}`, at: [p[0], p[1], 1], ref: { poly: `r${s.i}`, j } }));
      if (!zone) {
        const p = r.pts[0];
        handles.push({ id: `room-h:${s.i}`, kind: "room-h", label: `Room height ${h} cm`, at: [p[0], p[1], h], index: s.i });
      }
    }
    return { wires, handles };
  }

  if (s.t === "edge") {
    const pts = polyPts(f, s.poly);
    if (pts && pts[s.i]) {
      const j = (s.i + 1) % pts.length, a = pts[s.i], b = pts[j];
      const isRoom = s.poly.startsWith("r"), rIdx = isRoom ? +s.poly.slice(1) : -1;
      const room = isRoom ? f.rooms[rIdx] ?? null : null;
      const eh = edgeHeight(f, room, s.i);
      const topH = room ? roomHeight(f, room) : floorHeight(f);
      wires.push(...boxWires([a, b], 0, eh));
      handles.push(
        { id: `corner:${s.poly}:${s.i}`, kind: "corner", label: "Corner", at: [a[0], a[1], 1], ref: { poly: s.poly, j: s.i } },
        { id: `corner:${s.poly}:${j}`, kind: "corner", label: "Corner", at: [b[0], b[1], 1], ref: { poly: s.poly, j } },
      );
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (isRoom && room && room.kind !== "zone") handles.push({ id: `room-h:${rIdx}`, kind: "room-h", label: `Room height ${topH} cm`, at: [mid[0], mid[1], topH], index: rIdx });
      else if (s.poly === "o") handles.push({ id: "floor-h", kind: "floor-h", label: `Floor height ${topH} cm`, at: [mid[0], mid[1], topH] });
    }
    return { wires, handles };
  }

  if (s.t === "wall") {
    const w = f.walls[s.i];
    if (w) {
      const h = wallHeight(f, w), mid: Pt = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
      wires.push(...boxWires([w.a, w.b], 0, h));
      handles.push(
        { id: `corner:walls:${s.i}:a`, kind: "corner", label: "Wall end A", at: [w.a[0], w.a[1], 1], ref: { k: "walls", i: s.i, end: "a" } },
        { id: `corner:walls:${s.i}:b`, kind: "corner", label: "Wall end B", at: [w.b[0], w.b[1], 1], ref: { k: "walls", i: s.i, end: "b" } },
        { id: `wall-h:${s.i}`, kind: "wall-h", label: `Wall height ${h} cm`, at: [mid[0], mid[1], h], index: s.i },
      );
    }
    return { wires, handles };
  }

  if (s.t === "door" || s.t === "opening") {
    const list = s.t === "door" ? "doors" : "openings";
    const d = f[list][s.i];
    if (d) {
      const span = s.t === "door" ? doorSpan(f.doors[s.i], doorCeiling(f, f.doors[s.i])) : openingSpan(f.openings[s.i]);
      const mid: Pt = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
      wires.push(...boxWires([d.a, d.b], span.sill, span.head));
      handles.push(
        { id: `${list}-sill:${s.i}`, kind: "sill", label: `Sill ${span.sill} cm`, at: [mid[0], mid[1], span.sill], index: s.i, list },
        { id: `${list}-head:${s.i}`, kind: "head", label: `Head ${span.head} cm`, at: [mid[0], mid[1], span.head], index: s.i, list },
      );
    }
    return { wires, handles };
  }

  if (s.t === "stairs") {
    const t = f.stairs[s.i];
    if (t && t.pts.length >= 3) {
      wires.push(...boxWires(t.pts, 0, floorHeight(f)));
      if (t.shape === "straight" && !t.rot) {
        t.pts.forEach((p, j) => handles.push({ id: `corner:s${s.i}:${j}`, kind: "corner", label: `Stair corner ${j + 1}`, at: [p[0], p[1], 1], ref: { poly: `s${s.i}`, j } }));
      }
    }
    return { wires, handles };
  }

  if (s.t === "furn" || (s.t === "v" && "poly" in s.ref && worktopIndex(s.ref.poly) !== null)) {
    const wi = s.t === "furn" ? s.i : s.t === "v" && "poly" in s.ref ? worktopIndex(s.ref.poly)! : -1;
    const m = f.furniture[wi];
    if (m) {
      const z0 = furnitureBottom(m), z1 = furnitureTop(m);
      const wt = worktopPts(m);
      const base = wt ?? rectCorners(m.x, m.y, m.w, m.h, m.rot);
      wires.push(...boxWires(base, z0, z1));
      if (!m.locked) {
        const gz = z1 + 35;
        wires.push({ pts: [[m.x, m.y, z1], [m.x, m.y, gz]], closed: false });
        handles.push({ id: `furn-z:${wi}`, kind: "furn-z", label: `Height z ${Math.round(z0)} cm (drag up/down)`, at: [m.x, m.y, gz], baseZ: z0, index: wi });
        const rg = rotGizmo(m.x, m.y, z1 + 2, Math.max(30, Math.hypot(m.w, m.h) / 2 + 12), m.rot ?? 0, "furn", wi);
        wires.push(rg.wire);
        handles.push(rg.handle);
      }
      if (wt) {
        wt.forEach((p, j) => handles.push({ id: `corner:w${wi}:${j}`, kind: "corner", label: `Worktop corner ${j + 1}`, at: [p[0], p[1], z1], ref: { poly: `w${wi}`, j } }));
      }
    }
    return { wires, handles };
  }

  if (s.t === "v") {
    const pt = ptOf(f, s.ref);
    if (pt) {
      const id = "poly" in s.ref ? `${s.ref.poly}:${s.ref.j}` : `${s.ref.k}:${s.ref.i}:${s.ref.end}`;
      handles.push({ id: `corner:${id}`, kind: "corner", label: "Corner", at: [pt[0], pt[1], 1], ref: s.ref });
    }
    return { wires, handles };
  }

  if (s.t === "dev") {
    const dv = f.devices[s.i];
    if (dv) {
      const c: Pt = "a" in dv ? [(dv.a[0] + dv.b[0]) / 2, (dv.a[1] + dv.b[1]) / 2] : [dv.x, dv.y];
      const z = deviceZ(dv), r = 16;
      wires.push(...boxWires([[c[0] - r, c[1] - r], [c[0] + r, c[1] - r], [c[0] + r, c[1] + r], [c[0] - r, c[1] + r]], Math.max(0, z - r), z + r));
      if (!dv.locked) {
        const gz = z + r + 35;
        wires.push({ pts: [[c[0], c[1], z + r], [c[0], c[1], gz]], closed: false });
        handles.push({ id: `dev-z:${s.i}`, kind: "dev-z", label: `Height z ${Math.round(z)} cm (drag up/down)`, at: [c[0], c[1], gz], baseZ: z, index: s.i });
        const curRot = "a" in dv ? Math.round((Math.atan2(dv.b[1] - dv.a[1], dv.b[0] - dv.a[0]) * 180) / Math.PI) : (dv.rot ?? 0);
        const rg = rotGizmo(c[0], c[1], z, 32, curRot, "dev", s.i);
        wires.push(rg.wire);
        handles.push(rg.handle);
      }
    }
    return { wires, handles };
  }

  if (s.t === "unl") {
    const u = f.unlinked[s.i];
    if (u) {
      const r = 20 * (u.scale || 1), uh = unlinkedHeight(u);
      wires.push(...boxWires(rectCorners(u.x, u.y, r * 2, r * 2, u.rot), 0, uh));
      if (!u.locked) {
        const rg = rotGizmo(u.x, u.y, uh + 2, Math.max(30, r * 1.6), u.rot ?? 0, "unl", s.i);
        wires.push(rg.wire);
        handles.push(rg.handle);
      }
    }
    return { wires, handles };
  }

  if (s.t === "devs") {
    for (const idx of s.is) {
      const dv = f.devices[idx];
      if (!dv) continue;
      const c: Pt = "a" in dv ? [(dv.a[0] + dv.b[0]) / 2, (dv.a[1] + dv.b[1]) / 2] : [dv.x, dv.y];
      const z = deviceZ(dv), r = 16;
      wires.push(...boxWires([[c[0] - r, c[1] - r], [c[0] + r, c[1] - r], [c[0] + r, c[1] + r], [c[0] - r, c[1] + r]], Math.max(0, z - r), z + r));
    }
    return { wires, handles };
  }

  return { wires, handles };
}

/** Rotates `pts` of a worktop/polygon without losing precision. */
export { round, rotateAbout };
