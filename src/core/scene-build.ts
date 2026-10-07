// The 3D scene of one floor: raw solids in cm, plain data, no three.js and no DOM. Where solids.ts returns projected SVG
// for the 2.5D view, this returns the same things before any projection, so a viewer can turn them into meshes.
// Every height comes from the resolvers in heights.ts and every fixed size from solids.ts, so the 2.5D and the 3D view
// cannot disagree (docs/specs/real-3d.md, R3). A layout file is untrusted input (CLAUDE.md finding 1): nothing here
// throws, and a piece that cannot be built is skipped while the rest is kept.
//
// Frame: x and y are the plan's, in cm, y down as on the plan; z is up, in cm, 0 the walking surface of the floor.
// `opts.elevation` lifts the whole scene (the floor's slab top, `floorElevation`) so floors can be stacked.
import { debugOnce } from "./debug-once";
import type { FloorsAround } from "./stairs";
import type { Device, Floor, FurnitureSymbol, Pt } from "./schema";

// What this file needs from the rest of core arrives as `SceneDeps` (core/three-deps.ts). The card already carries those
// modules for the 2D and 2.5D plan; if this file imported them, the bundler would give the 3D chunk a second copy of them
// (or the card a shared chunk to load first). So the lazy 3D chunk holds this builder and the card hands it the helpers.
type Heights = typeof import("./heights");
type Render = typeof import("./render");
type Solids = typeof import("./solids");
type Schema = typeof import("./schema");
export type SceneDeps = Pick<Heights, "deviceZ" | "doorSpan" | "edgeHeight" | "floorHeight" | "floorSlab" | "furnitureBottom" | "furnitureHeight" | "openingSpan" | "radiatorSpan" | "unlinkedHeight" | "wallHeight">
  & Pick<Render, "attachedTest" | "inside"> & Pick<typeof import("./stairs"), "resolveStairDirection">
  & Pick<Solids, "DEVICE_SOLID" | "FURNITURE_SOLID" | "KERB_HIGH" | "KERB_OUT" | "OPENING_FILL" | "RADIATOR_DEEP" | "SPEAKER_HEIGHT" | "SPEAKER_SIDE" | "TV_HEIGHT" | "TV_THICK" | "TV_WIDTH" | "UNLINKED_BASE" | "WELL_DEPTH" | "pieceDevice" | "stairBlocks" | "turnAbout" | "tvPlacement" | "within">
  & Pick<Schema, "DEVICE_TYPES" | "ROOM_KINDS" | "WALL_KINDS">;

/** A vertical extrusion of a polygon from `z0` to `z1` (every box is one), or a single point (a device with no body of its own). */
export type Shape = { type: "prism"; base: Pt[]; z0: number; z1: number } | { type: "point"; at: Pt; z: number };
export type SolidKind = "floor" | "room" | "wall" | "opening" | "furniture" | "unlinked" | "stair" | "device";
/**
 * What the viewer needs to find the thing again. `poly` is "o" (the outline), "r<n>" (room n) or "w" (a free wall) and
 * `index` the edge or wall in it, for a wall. For everything else `index` is the item's own index in its floor array
 * (a door's, for an opening). `room` is a room fill's index. `entity` is a device's entity, or a door's first sensor;
 * `entities` is every entity a door owns. `size` is a furniture piece's own [w, h], for the crown of a tree.
 * A wall also carries `faces`, the unit normals (plan frame, y down) of the sides that face out of a room or the outline
 * ("out" is away from what the polygon holds); a free wall has both sides, as it has no inside. An opening's infill carries
 * `wall`, the `poly:index` of the wall it sits in, so a viewer that lowers that wall can lower the infill with it.
 */
export interface SolidRef { poly?: string; index?: number; room?: number; id?: string; entity?: string; entities?: string[]; size?: [number, number]; faces?: [number, number][]; wall?: string;
  /** A device that is a room's own sensor (its `temps`, `humidity` or `motion` list): it draws no marker, and a tap passes through it (DECISIONS S11.1, S12.5). */
  hidden?: true }
/** `role` is a token the viewer maps to a theme colour; `color` and `texture` are the user's own choice, passed on as written. */
/** `textureRot` and `textureScale` are the layout's own values, untrusted: the reader normalises them (core/textures.ts). */
export interface Paint { role: string; color?: string; texture?: string; textureRot?: number; textureScale?: number }
export interface Solid { id: string; kind: SolidKind; tag: string; shape: Shape; ref: SolidRef; paint: Paint }
export interface Scene { solids: Solid[]; bounds: { min: [number, number, number]; max: [number, number, number] } }
export interface SceneOpts {
  /** cm: lifts everything. The floor's own `floorElevation`. Default 0. */
  elevation?: number;
  /** Whether a floor lies above and below, which sets where an unmarked stair goes (see `resolveStairDirection`). Absent: up. */
  around?: FloorsAround;
}

/** cm. How thick a wall is, by kind (the plan draws 10, and 20 for an external wall; a fence is a thin rail). Centred on its line. */
export const WALL_THICKNESS: Record<string, number> = { wall: 10, external: 20, fence: 4, edge: 10, boundary: 10, parapet: 20 };
/** cm. A glass pane, a closed door's leaf, a stair-side trunk and the slab of a room fill. */
export const PANE_THICKNESS = 2, LEAF_THICKNESS = 4, TRUNK_SIDE = 12, ROOM_THICKNESS = 1;
/** cm. How high a wall stands where a viewer lowers it to show the rooms behind it: ONE figure for the 3D view's "cut" and "low" walls (S14.5: 30 -> 110, Diego: low was too low). */
export const CUT_WALL_HEIGHT = 110;
/** cm. A device's icon and point stay this far under the top of the floor's walls, so a ceiling light or camera does not float over the house (S14.5: 10 -> 25, with the lower presets). */
export const ICON_MARGIN = 25;
/** Most rooms for which nesting is worked out (it is quadratic); more than this and every fill sits at the same height. */
const NEST_LIMIT = 300;
/** The most point tests nesting may cost: the square of the total points of all rooms bounds it (S12 review). Over it, no nesting, as past NEST_LIMIT. */
const NEST_WORK = 1e7;
/** cm. Two wall ends this close are one corner. */
const JOINT_TOLERANCE = 1;

/** The scene builder, bound to the helpers of core it needs. The 3D chunk builds one per view; `core/scene.ts` binds the real ones for the tests. */
export function makeBuildScene(d: SceneDeps): (floor: Floor, opts?: SceneOpts) => Scene {
  const { deviceZ, doorSpan, edgeHeight, floorHeight, floorSlab, furnitureBottom, furnitureHeight, openingSpan, radiatorSpan, unlinkedHeight, wallHeight, attachedTest, inside, resolveStairDirection, DEVICE_SOLID, FURNITURE_SOLID, KERB_HIGH, KERB_OUT, OPENING_FILL, RADIATOR_DEEP, SPEAKER_HEIGHT, SPEAKER_SIDE, TV_HEIGHT, TV_THICK, TV_WIDTH, UNLINKED_BASE, WELL_DEPTH, pieceDevice, stairBlocks, turnAbout, tvPlacement, within, DEVICE_TYPES, ROOM_KINDS, WALL_KINDS } = d;
  const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const isPt = (p: unknown): p is Pt => Array.isArray(p) && fin(p[0]) && fin(p[1]);
  const ring = (p: unknown): Pt[] | null => (Array.isArray(p) && p.length >= 3 && p.every(isPt) ? (p as Pt[]) : null);
  const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  const isObj = (x: unknown): x is Record<string, any> => typeof x === "object" && x !== null;
  const has = <T extends string>(table: Record<T, unknown>, k: unknown): k is T => typeof k === "string" && Object.prototype.hasOwnProperty.call(table, k);
  const oneOf = <T extends string>(set: readonly T[], k: unknown): k is T => typeof k === "string" && (set as readonly string[]).includes(k);
  /** Turns a negative zero into zero: a normal that went through JSON must equal the one that did not. */
  const nz = (v: number): number => (v === 0 ? 0 : v);
  const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  /** A rectangle `len` long from `a` to `b` and `thick` across, centred on the line, between t0 and t1 along it. */
  function slab(a: Pt, b: Pt, t0: number, t1: number, thick: number): Pt[] {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, h = thick / 2, nx = uy * h, ny = -ux * h;
    const at = (t: number): Pt => [a[0] + ux * t, a[1] + uy * t];
    const p = at(t0), q = at(t1);
    return [[p[0] + nx, p[1] + ny], [q[0] + nx, q[1] + ny], [q[0] - nx, q[1] - ny], [p[0] - nx, p[1] - ny]];
  }

  interface WallSeg { a: Pt; b: Pt; h: number; kind: string; poly: string; index: number; external: boolean; faces: Pt[] }

  /** Every edge and free wall that has a height and a length, once each. The rule of `collectWalls` in solids.ts, without the cutaway. */
  function collectWalls(f: Floor): WallSeg[] {
    const out: WallSeg[] = [];
    const polys: { id: string; pts: Pt[]; room: Floor["rooms"][number] | null }[] = [];
    const outline = ring(f.outline);
    if (outline) polys.push({ id: "o", pts: outline, room: null });
    list(f.rooms).forEach((r, i) => {
      const pts = isObj(r) && r.kind !== "zone" ? ring(r.pts) : null;
      if (pts) polys.push({ id: `r${i}`, pts, room: r as Floor["rooms"][number] });
    });
    for (const P of polys) {
      const wk = (P.room ? P.room.wk : f.owk) as unknown;
      // Shoelace in plan coordinates (y down): for a positive sum the outward normal of a to b is (dy, -dx), for a negative one (-dy, dx).
      const sign = Math.sign(P.pts.reduce((s, a, i) => { const b = P.pts[(i + 1) % P.pts.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0));
      P.pts.forEach((a, i) => {
        const b = P.pts[(i + 1) % P.pts.length], h = edgeHeight(f, P.room, i), k = Array.isArray(wk) ? wk[i] : undefined;
        if (!(h > 0) || !(Math.hypot(b[0] - a[0], b[1] - a[1]) > 0)) return;
        const kind = oneOf(WALL_KINDS, k) ? k : P.room ? "wall" : "external";
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), faces: Pt[] = sign === 0 ? [] : [[nz((sign * (b[1] - a[1])) / len), nz((sign * -(b[0] - a[0])) / len)]];
        out.push({ a, b, h, kind, poly: P.id, index: i, external: kind === "external", faces });
      });
    }
    list(f.walls).forEach((w, i) => {
      if (!isObj(w) || !isPt(w.a) || !isPt(w.b)) return;
      const h = wallHeight(f, w as never);
      if (!(h > 0) || !(Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 0)) return;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), n: Pt = [nz((w.b[1] - w.a[1]) / len), nz(-(w.b[0] - w.a[0]) / len)];
      out.push({ a: w.a, b: w.b, h, kind: oneOf(WALL_KINDS, w.kind) ? w.kind : "wall", poly: "w", index: i, external: w.kind === "external", faces: [n, [nz(-n[0]), nz(-n[1])]] });
    });
    // The same edge twice (a room's wall on the outline, two rooms side by side) is one wall: the taller wins, and the external kind.
    const seen = new Map<string, WallSeg>();
    for (const w of out) {
      const k = [w.a, w.b].map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).sort().join("|"), o = seen.get(k);
      if (!o) { seen.set(k, { ...w, faces: [...w.faces] }); continue; }
      o.faces.push(...w.faces);
      if (w.h > o.h) { o.h = w.h; o.kind = w.kind; o.poly = w.poly; o.index = w.index; }
      if (w.kind === "external") o.kind = "external";
    }
    return [...seen.values()];
  }

  interface Span { a: Pt; b: Pt; at: (ceiling: number) => { sill: number; head: number }; kind: string; index: number; id?: string; entities: string[] }
  function spansOf(f: Floor): Span[] {
    const out: Span[] = [];
    list(f.doors).forEach((d, i) => {
      if (!isObj(d) || !isPt(d.a) || !isPt(d.b)) return;
      const entities = [...list(d.sensors), ...list(d.vibration), ...list(d.locks), d.cover].filter((e): e is string => typeof e === "string");
      out.push({ a: d.a, b: d.b, at: (c) => doorSpan(d as never, c), kind: String(d.kind), index: i, id: text(d.id), entities });
    });
    list(f.openings).forEach((o, i) => {
      if (isObj(o) && isPt(o.a) && isPt(o.b)) out.push({ a: o.a, b: o.b, at: () => openingSpan(o as never), kind: "opening", index: i, id: text(o.id), entities: [] });
    });
    return out;
  }

  /** The scene of one floor. Never throws; the order is fixed (slab, rooms, walls with their openings, stairs, furniture, unlinked, devices), each in array order. */
  function buildScene(floor: Floor, opts: SceneOpts = {}): Scene {
    const solids: Solid[] = [];
    const lift = isObj(opts) && fin(opts.elevation) ? opts.elevation : 0;
    const f = (isObj(floor) ? floor : {}) as Floor;
    /** One choke point: a shape with a non-finite number or no thickness never leaves here. */
    const add = (kind: SolidKind, id: string, tag: string, shape: Shape, ref: SolidRef, paint: Paint) => {
      if (shape.type === "prism") {
        if (shape.base.length < 3 || !shape.base.every(isPt) || !fin(shape.z0) || !fin(shape.z1) || !(shape.z1 > shape.z0)) return;
        solids.push({ id, kind, tag, shape: { type: "prism", base: shape.base.map((p): Pt => [p[0], p[1]]), z0: shape.z0 + lift, z1: shape.z1 + lift }, ref, paint });
      } else if (isPt(shape.at) && fin(shape.z)) solids.push({ id, kind, tag, shape: { type: "point", at: [shape.at[0], shape.at[1]], z: shape.z + lift }, ref, paint });
    };
    /** Runs one piece's builder; whatever it throws, the piece is lost and the scene is not. */
    const piece = (fn: () => void) => { try { fn(); } catch (e) { debugOnce("3D scene: a piece of the layout could not be built and was left out", e); } };

    // The slab under the house, its top at the walking surface.
    piece(() => { const o = ring(f.outline); if (o) add("floor", "floor", "slab", { type: "prism", base: o, z0: -floorSlab(f), z1: 0 }, {}, { role: "slab" }); });

    // Room fills. A zone is an overlay and a structure has no floor of its own (ROOM_OWNS in render.ts says neither owns a point);
    // a fill with no name is not drawn, as in render.ts. Both keep their edges as walls. A room inside a bigger one sits above it.
    const rooms = list(f.rooms), rings = rooms.map((r) => (isObj(r) ? ring(r.pts) : null));
    const area = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
    const areas = rings.map((p) => (p ? area(p) : 0));
    const points = rings.reduce((n, p) => n + (p ? p.length : 0), 0);
    const nestable = rooms.length <= NEST_LIMIT && points * points <= NEST_WORK;
    // Two room fills at one height fight for the pixel and one floor goes missing (Diego, 2026-10-06 and 07: the garden house). So a room
    // that overlaps a bigger one sits above it, however it sits: over the border by a few cm or by half, turned, in a notch, across it.
    // Rooms that only share a border do not overlap. A corner within TOUCH cm of the other's edge is on it, not in it; the even-odd
    // `inside` is arbitrary there. This replaces the 30 cm corner rule of 0.18.2, which left a shed over the border by more unfixed.
    const TOUCH = 1;
    const near = (v: Pt, q: Pt[], tol: number) => q.some((a, k) => {
      const b = q[(k + 1) % q.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / l2)) : 0;
      return Math.hypot(v[0] - (a[0] + t * dx), v[1] - (a[1] + t * dy)) <= tol;
    });
    const mid = (p: Pt[]): Pt => [p.reduce((s, v) => s + v[0], 0) / p.length, p.reduce((s, v) => s + v[1], 0) / p.length];
    const side = (a: Pt, b: Pt, c: Pt) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    /** Two edges cross at a point inside both (an end touching the other edge is not a crossing: the corner tests see that). */
    const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
    const overlap = (p: Pt[], q: Pt[]) => inside(mid(p), q) || inside(mid(q), p)
      || p.some((v) => inside(v, q) && !near(v, q, TOUCH)) || q.some((v) => inside(v, p) && !near(v, p, TOUCH))
      || p.some((a, i) => q.some((c, j) => cross(a, p[(i + 1) % p.length], c, q[(j + 1) % q.length])));
    // Only a drawn room can be under another: zones, structures and unnamed fills have no floor here.
    const drawn = (r: unknown) => isObj(r) && oneOf(ROOM_KINDS, r.kind) && r.kind !== "zone" && r.kind !== "structure" && !(r.kind === "fill" && !r.name);
    const box = (p: Pt[]) => [Math.min(...p.map((v) => v[0])), Math.min(...p.map((v) => v[1])), Math.max(...p.map((v) => v[0])), Math.max(...p.map((v) => v[1]))];
    // Overlap is not transitive (a shed on a terrace on a garden, the shed clear of the garden), so a count would put the shed level with the
    // terrace. Go biggest first, equal areas by array order (the one drawn last on the plan is on top): a room is one step above the
    // highest bigger room it overlaps. Boxes that do not meet skip the exact test.
    const level: number[] = rooms.map(() => 0), boxes = rings.map((p) => (p ? box(p) : null));
    if (nestable) {
      const order = rooms.map((_, i) => i).filter((i) => rings[i] && drawn(rooms[i])).sort((x, y) => areas[y] - areas[x] || x - y);
      order.forEach((i, n) => {
        const p = rings[i]!, bi = boxes[i]!;
        for (const j of order.slice(0, n)) {
          const bj = boxes[j]!;
          if (bj[0] > bi[2] || bi[0] > bj[2] || bj[1] > bi[3] || bi[1] > bj[3]) continue;
          if (level[j] + 1 > level[i] && overlap(p, rings[j]!)) level[i] = level[j] + 1;
        }
      });
    }
    const nest = (i: number) => level[i];
    rooms.forEach((r, i) => piece(() => {
      const p = rings[i];
      if (!p || !isObj(r) || !drawn(r)) return;
      const z0 = nest(i) * ROOM_THICKNESS, paint: Paint = { role: `room-${r.kind}` };
      if (typeof r.color === "string") paint.color = r.color;
      if (typeof r.texture === "string") paint.texture = r.texture;
      if (typeof r.textureRot === "number") paint.textureRot = r.textureRot;
      if (typeof r.textureScale === "number") paint.textureScale = r.textureScale;
      add("room", `room:${i}`, r.kind, { type: "prism", base: p, z0, z1: z0 + ROOM_THICKNESS }, { room: i }, paint);
    }));

    // Walls, each cut by the openings that lie in it: a block under the sill, a header over the head, nothing between.
    const spans = spansOf(f), placed = new Set<number>();
    piece(() => { const all = collectWalls(f);
      // Wall ends on a grid one tolerance wide: a corner is found by looking at nine cells, not at every wall (near linear, S12 review).
      const ends = new Map<string, number[]>(), cell = (q: Pt) => `${Math.floor(q[0] / JOINT_TOLERANCE)},${Math.floor(q[1] / JOINT_TOLERANCE)}`;
      all.forEach((o, k) => { for (const q of [o.a, o.b]) { const key = cell(q), at = ends.get(key); if (at) { if (at[at.length - 1] !== k) at.push(k); } else ends.set(key, [k]); } });
      const near = (p: Pt): number[] => {
        const cx = Math.floor(p[0] / JOINT_TOLERANCE), cy = Math.floor(p[1] / JOINT_TOLERANCE), hit = new Set<number>();
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const k of ends.get(`${cx + dx},${cy + dy}`) ?? []) hit.add(k);
        return [...hit].sort((x, y) => x - y); // the order of `all`, as before
      };
      all.forEach((w) => piece(() => {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), thick = WALL_THICKNESS[w.kind] ?? 10, ref: SolidRef = { poly: w.poly, index: w.index, faces: w.faces };
      // A corner: two walls end on the same point, so the outer corner would be a notch half a wall thick. An end that meets
      // another wall's end runs on by half of that wall's thickness. Not a corner, and left alone: a T-joint (the end on the
      // middle of another wall, which may itself be drawn as two collinear pieces ending at the joint; running on would poke
      // the end out to that wall's far face, where its colour fights the wall's), and a straight continuation.
      const meet = (p: Pt, far: Pt) => {
        const dir = (q: Pt, r: Pt): Pt => { const l = Math.hypot(r[0] - q[0], r[1] - q[1]); return [(r[0] - q[0]) / l, (r[1] - q[1]) / l]; };
        const dw = dir(p, far), around: { d: Pt; half: number }[] = [];
        for (const k of near(p)) {
          const o = all[k];
          if (o === w) continue;
          const end = [o.a, o.b].find((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= JOINT_TOLERANCE);
          if (end) around.push({ d: dir(end, end === o.a ? o.b : o.a), half: (WALL_THICKNESS[o.kind] ?? 10) / 2 });
        }
        const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1], cross = (a: Pt, b: Pt) => Math.abs(a[0] * b[1] - a[1] * b[0]);
        if (around.some((o) => cross(dw, o.d) < 0.2 && dot(dw, o.d) < 0)) return 0; // this wall runs on through the joint
        const turned = around.filter((o) => cross(dw, o.d) >= 0.2);
        if (turned.some((a) => turned.some((b) => cross(a.d, b.d) < 0.2 && dot(a.d, b.d) < 0))) return 0; // a wall passes through: a T
        return turned.reduce((m, o) => Math.max(m, o.half), 0);
      };
      const ext0 = meet(w.a, w.b), ext1 = meet(w.b, w.a);
      let n = 0;
      const block = (a0: number, a1: number, z0: number, z1: number) => {
        const t0 = a0 <= 0 ? -ext0 : a0, t1 = a1 >= len ? len + ext1 : a1;
        if (a1 > a0 && z1 > z0) add("wall", `wall:${w.poly}:${w.index}:${n++}`, w.kind, { type: "prism", base: slab(w.a, w.b, t0, t1, thick), z0, z1 }, ref, { role: `wall-${w.kind}` });
      };
      const here = spans.map((s) => ({ s, r: within(w, s) })).filter((x): x is { s: Span; r: [number, number] } => x.r !== null).sort((p, q) => p.r[0] - q.r[0]);
      let cursor = 0;
      for (const { s, r } of here) {
        const t0 = Math.max(r[0], cursor), t1 = r[1];
        if (t1 <= t0) continue;
        block(cursor, t0, 0, w.h);
        const own = s.at(w.h), sill = Math.min(own.sill, w.h), head = Math.min(own.head, w.h);
        block(t0, t1, 0, sill);
        block(t0, t1, head, w.h);
        // The opening's own infill, once per opening even when two coincident walls both carry it.
        if (!placed.has(s.index + (s.kind === "opening" ? 1e6 : 0))) {
          placed.add(s.index + (s.kind === "opening" ? 1e6 : 0));
          const fill = has(OPENING_FILL, s.kind) ? OPENING_FILL[s.kind] : "gap", oref: SolidRef = { index: s.index, id: s.id, entity: s.entities[0], entities: s.entities, wall: `${w.poly}:${w.index}` };
          const part = (tag: string, role: string, t: number) => add("opening", `opening:${s.index}:${tag}`, tag, { type: "prism", base: slab(w.a, w.b, t0, t1, t), z0: sill, z1: head }, oref, { role });
          if (fill === "glass") part("glass", `glass-${s.kind}`, PANE_THICKNESS);
          else if (fill === "panel") part("panel", "panel", thick);
          else if (s.kind !== "opening" && fill !== "void") part("door-leaf", "door-leaf", LEAF_THICKNESS);
          // A doorway has no leaf: its live state (open, vibrating, cover open) is a thin alert slab in the gap, shown only then (S14.5).
          else if (s.kind !== "opening") part("band", "door-band", PANE_THICKNESS);
        }
        cursor = t1;
      }
      block(cursor, len, 0, w.h);
    })); });

    // Stairs: one block per step, each as high as the flight has climbed by then. Down, the treads are sunk into the floor (a
    // stairwell; the viewer may cut the slab); both ways, the flight rises and keeps a kerb round its foot.
    list(f.stairs).forEach((t, i) => piece(() => {
      const blocks = isObj(t) ? stairBlocks(t as never) : null;
      if (!blocks) return;
      const dir = resolveStairDirection(t as never, opts?.around), rise = floorHeight(f), count = blocks.steps.length, paint: Paint = { role: "stair" };
      if (typeof (t as { color?: unknown }).color === "string") paint.color = (t as { color: string }).color;
      if (typeof (t as { texture?: unknown }).texture === "string") paint.texture = (t as { texture: string }).texture;
      for (const k of ["textureRot", "textureScale"] as const) if (typeof (t as Record<string, unknown>)[k] === "number") paint[k] = (t as unknown as Record<string, number>)[k];
      blocks.steps.forEach((base, k) => {
        if (dir === "down") { const z = -WELL_DEPTH + (k * WELL_DEPTH) / count; add("stair", `stair:${i}:${k}`, "stair-down", { type: "prism", base, z0: z - WELL_DEPTH / count, z1: z }, { index: i }, paint); }
        else add("stair", `stair:${i}:${k}`, "stair", { type: "prism", base, z0: 0, z1: ((k + 1) / count) * rise }, { index: i }, paint);
      });
      if (dir === "both") {
        const inner = blocks.foot(0), outer = blocks.foot(KERB_OUT);
        inner.forEach((a, k) => { const j = (k + 1) % inner.length; add("stair", `stair:${i}:kerb${k}`, "kerb", { type: "prism", base: [a, inner[j], outer[j], outer[k]], z0: 0, z1: KERB_HIGH }, { index: i }, { role: "stair" }); });
      }
    }));

    // Furniture: a block, a trunk (a tree: the crown is the viewer's, from `ref.size`) or a flat slab, by FURNITURE_SOLID.
    list(f.furniture).forEach((m, i) => piece(() => {
      if (!isObj(m) || !has(FURNITURE_SOLID, m.symbol) || ![m.x, m.y, m.rot, m.w, m.h].every(fin) || !(m.w > 0) || !(m.h > 0)) return;
      const z0 = furnitureBottom(m as never), h = z0 + furnitureHeight(m as never), c: Pt = [m.x, m.y], pole = FURNITURE_SOLID[m.symbol as FurnitureSymbol] === "pole";
      const half = pole ? [TRUNK_SIDE / 2, TRUNK_SIDE / 2] : [m.w / 2, m.h / 2];
      const base = ([[-half[0], -half[1]], [half[0], -half[1]], [half[0], half[1]], [-half[0], half[1]]] as Pt[]).map((q) => turnAbout([c[0] + q[0], c[1] + q[1]], pole ? 0 : m.rot, c));
      // A linked tv, speaker or computer (`pieceDevice`) carries its entity and its own colour: the viewer recolours it by state and hands a tap on it to the gesture code.
      const linked = pieceDevice(m as never);
      add("furniture", `furniture:${i}`, m.symbol, { type: "prism", base, z0, z1: h }, { index: i, id: text(m.id), size: [m.w, m.h], ...(linked ? { entity: linked.entity } : {}) }, { role: linked ? "furniture-linked" : `furniture-${m.symbol}` });
    }));

    // An unlinked appliance: a low block at its own height, 40 cm across times its scale. Its rotation is not drawn, as in 2.5D.
    list(f.unlinked).forEach((u, i) => piece(() => {
      if (!isObj(u) || !fin(u.x) || !fin(u.y)) return;
      const scale = fin(u.scale) && u.scale > 0 ? u.scale : 1, r = (UNLINKED_BASE * scale) / 2, tag = oneOf(DEVICE_TYPES, u.type) ? u.type : "other", paint: Paint = { role: "unlinked" };
      if (typeof u.color === "string") paint.color = u.color;
      add("unlinked", `unlinked:${i}`, tag, { type: "prism", base: [[u.x - r, u.y - r], [u.x + r, u.y - r], [u.x + r, u.y + r], [u.x - r, u.y + r]], z0: 0, z1: unlinkedHeight(u as never) }, { index: i, id: text(u.id) }, paint);
    }));

    // Devices. The radiator, the speaker and the TV have a body (DEVICE_SOLID, the same list 2.5D reads); every other device,
    // and one of those three whose numbers cannot be drawn, is a point at the height of its icon.
    // The highest wall of this floor (its storey when it has none), without the lift: what an icon is held under.
    const wallTop = solids.reduce((m, s) => (s.kind === "wall" && s.shape.type === "prism" ? Math.max(m, s.shape.z1 - lift) : m), 0) || floorHeight(f);
    const attached = attachedTest({ ...f, rooms: list(f.rooms).filter(isObj) } as Floor);
    list(f.devices).forEach((d, i) => piece(() => {
      if (!isObj(d)) return;
      const dev = d as unknown as Device & { x?: number; y?: number; a?: Pt; b?: Pt; rot?: number };
      const type = oneOf(DEVICE_TYPES, d.type) ? d.type : "other", kind = has(DEVICE_SOLID, d.type) ? DEVICE_SOLID[d.type] : "none";
      const ref: SolidRef = { index: i, id: text(d.id), entity: text(d.entity) }, paint: Paint = { role: `device-${type}` }, id = `device:${i}`;
      if (attached(dev)) ref.hidden = true;
      const has2 = (): boolean => fin(dev.x) && fin(dev.y);
      const before = solids.length;
      if (kind === "radiator" && isPt(dev.a) && isPt(dev.b)) {
        const len = Math.hypot(dev.b[0] - dev.a[0], dev.b[1] - dev.a[1]), { bottom, top } = radiatorSpan(dev);
        if (len > 0 && top > bottom) add("device", id, type, { type: "prism", base: slab(dev.a, dev.b, 0, len, RADIATOR_DEEP), z0: bottom, z1: top }, ref, paint);
      } else if (kind === "speaker" && has2()) {
        const c: Pt = [dev.x as number, dev.y as number], r = SPEAKER_SIDE / 2, rot = fin(dev.rot) ? dev.rot : 0;
        add("device", id, type, { type: "prism", base: ([[-r, -r], [r, -r], [r, r], [-r, r]] as Pt[]).map((q) => turnAbout([c[0] + q[0], c[1] + q[1]], rot, c)), z0: 0, z1: SPEAKER_HEIGHT }, ref, paint);
      } else if (kind === "tv") {
        // A free-standing TV looks toward +y, the way the 2.5D camera looks down the screen.
        const place = tvPlacement(f, dev, [0, 1]);
        if (place) {
          const { c, n, off, z0 } = place, u: Pt = [-n[1], n[0]], at = (t: number, o: number): Pt => [c[0] + u[0] * t + n[0] * o, c[1] + u[1] * t + n[1] * o], w = TV_WIDTH / 2;
          add("device", id, type, { type: "prism", base: [at(-w, off), at(w, off), at(w, off + TV_THICK), at(-w, off + TV_THICK)], z0, z1: z0 + TV_HEIGHT }, ref, paint);
        }
      }
      if (solids.length > before) return;
      const at: Pt | null = has2() ? [dev.x as number, dev.y as number] : isPt(dev.a) && isPt(dev.b) ? [(dev.a[0] + dev.b[0]) / 2, (dev.a[1] + dev.b[1]) / 2] : null;
      if (at) add("device", id, type, { type: "point", at, z: Math.min(deviceZ(dev), Math.max(0, wallTop - ICON_MARGIN)) }, ref, paint);
    }));

    const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const grow = (x: number, y: number, z: number) => { lo[0] = Math.min(lo[0], x); lo[1] = Math.min(lo[1], y); lo[2] = Math.min(lo[2], z); hi[0] = Math.max(hi[0], x); hi[1] = Math.max(hi[1], y); hi[2] = Math.max(hi[2], z); };
    for (const s of solids) {
      if (s.shape.type === "prism") for (const p of s.shape.base) { grow(p[0], p[1], s.shape.z0); grow(p[0], p[1], s.shape.z1); }
      else grow(s.shape.at[0], s.shape.at[1], s.shape.z);
    }
    return solids.length ? { solids, bounds: { min: lo, max: hi } } : { solids, bounds: { min: [0, 0, 0], max: [0, 0, 0] } };
  }
  return buildScene;
}
