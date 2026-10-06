// Heights, in cm. The only place a default height lives: every other file asks a resolver here.
// Defaults are read, never stored, so changing one later changes old plans (docs/specs/heights-and-2-5d.md).
// Layout files are untrusted: every resolver takes junk (NaN, text, negative, over 1000) and falls back to the default.
import { edgesNear } from "./geometry";
import type { Device, Door, DoorKind, DeviceType, EdgeKind, Floor, FurnitureSymbol, Furniture, Layout, Opening, Room, Unlinked, Wall, WallKind } from "./schema";

export const DEFAULT_FLOOR_HEIGHT = 250;
export const DEFAULT_SLAB = 25;
/** The range `validate` accepts for any height, sill or mount height. */
export const MAX_HEIGHT = 1000;

/** Top of the piece above the floor. Furniture first, by what a person would measure with a tape. */
export const FURNITURE_HEIGHTS: Record<FurnitureSymbol, number> = {
  table: 75, sofa: 85, bed: 55, cabinet: 180, chair: 90, sink: 90, toilet: 40, shower: 200, bathtub: 55, tv: 60, computer: 50,
  tree: 400, // a garden tree, crown included
  "patio-wood": 5, "patio-concrete": 5, // a deck or slab: flat, but not zero so it can stand off the lawn
  car: 150,
};

/** Top of an unlinked appliance. Wall and ceiling things sit at the height of their top edge; floor things at theirs. */
export const UNLINKED_HEIGHTS: Record<DeviceType, number> = {
  // Floor-standing or desk-top: the top of the body.
  heater: 60, computer: 50, car: 150, server: 60, ups: 30, vacuum: 10, printer: 90, speaker: 90, person: 170, tv: 100,
  // On the wall: top edge of the unit.
  boiler: 120, battery: 120, inverter: 100, ac: 220, climate: 150, media: 100, other: 100,
  // Ceiling-mounted.
  light: 250, camera: 230, motion: 230, radar: 230, access_point: 230,
  // Small wall fittings at hand height.
  switch: 120, plug: 30, temp: 150, humidity: 150, contact: 120, vibration: 120, lock: 100,
  cover: 200, // a blind or curtain motor sits up at the head of the window
};

/** Mount height of the real object an icon stands for. Same reasoning as UNLINKED_HEIGHTS, but where it is fixed, not its top. */
export const DEVICE_Z: Record<DeviceType, number> = {
  // Ceiling-mounted. The icon stands for the fitting, not for its mount: a pendant or a dome hangs 35-45 cm under a 250 cm ceiling in 3D,
  // so it reads as in the room and not stuck to the slab (S14.5, Diego: "put all lights and high icons lower, they float too high").
  light: 215, camera: 205, motion: 205, radar: 205, access_point: 205,
  // On the wall, up high: 25 cm lower than the real unit's top edge, for the same reason.
  ac: 195, cover: 175,
  // Wall fittings at hand height (a switch is 120 by habit in Europe, a plug sits low; a thermostat or sensor at eye level, 135).
  switch: 120, plug: 30, contact: 120, vibration: 120, lock: 100, temp: 135, humidity: 135, climate: 135,
  // Plant on the wall or a shelf.
  boiler: 120, battery: 120, inverter: 100, tv: 100, other: 100,
  // A speaker or media player is the 30 cm cabinet 2.5D draws (`deviceSolidTop`): the icon sits on top of it.
  speaker: 30, media: 30,
  // Floor or desk.
  heater: 60, computer: 75, server: 60, ups: 30, printer: 90, car: 150, person: 170, vacuum: 10,
};

/** `storey` means the wall rises to the ceiling of its floor (or its room). */
export const WALL_KIND_HEIGHT: Record<WallKind, number | "storey"> = {
  wall: "storey", external: "storey",
  fence: 110,
  edge: 0, // a curb: flat on the plan
  boundary: 0, // a drawn line, no wall
};

/** `sill` is the opening's bottom above the floor; its top is `sill + height`. */
export const DOOR_DEFAULTS: Record<DoorKind, { height: number; sill: number }> = {
  door: { height: 210, sill: 0 },
  glass: { height: 210, sill: 0 },
  sealed: { height: 210, sill: 0 },
  window: { height: 120, sill: 90 },
  open: { height: 210, sill: 0 }, // a doorway: the cut of a door, nothing drawn in it
  slit: { height: 60, sill: 150 }, // for the default 250 storey; see SLIT_HEIGHT, SLIT_HEAD_GAP and doorSpan: the real sill follows the wall's ceiling
};
/** A slit window is this high (Diego, 2026-10-05). */
export const SLIT_HEIGHT = 60;
/**
 * A slit window's head ends this far under the ceiling of its wall: as far as a window's does under the default wall,
 * 250 - (sill 90 + height 120) = 40 cm (Diego, 2026-10-06; it used to touch the ceiling). Derived, so the two cannot drift.
 */
export const SLIT_HEAD_GAP = DEFAULT_FLOOR_HEIGHT - (DOOR_DEFAULTS.window.sill + DOOR_DEFAULTS.window.height);
const OPENING_DEFAULT = { height: 210, sill: 0 };

/** A usable value: a finite number from 0 to 1000. Anything else is "not set". */
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX_HEIGHT;
const own = (o: unknown, k: string): number | undefined => {
  const v = typeof o === "object" && o !== null ? (o as Record<string, unknown>)[k] : undefined;
  return valid(v) ? v : undefined;
};
const has = <T extends string>(table: Record<T, number>, k: unknown): k is T => typeof k === "string" && Object.prototype.hasOwnProperty.call(table, k);
const FALLBACK = 100; // an unknown symbol or type: a number, not a crash

export const floorHeight = (f: Floor): number => own(f, "height") ?? DEFAULT_FLOOR_HEIGHT;
export const floorSlab = (f: Floor): number => own(f, "slab") ?? DEFAULT_SLAB;

/** Elevation of a floor's slab top: the sum of every lower floor's height and slab, in `floors` key order. */
export function floorElevation(layout: Layout, floorKey: string): number {
  const floors = layout?.floors;
  if (typeof floors !== "object" || floors === null) return 0;
  let z = 0;
  for (const [k, f] of Object.entries(floors)) {
    if (k === floorKey) return z;
    z += floorHeight(f) + floorSlab(f);
  }
  return 0; // an unknown key
}

export const roomHeight = (f: Floor, room: Room): number => own(room, "height") ?? floorHeight(f);

const storeyOr = (v: number | "storey", storey: number) => (v === "storey" ? storey : v);

export function wallHeight(f: Floor, wall: Wall): number {
  const kind = (wall as { kind?: unknown })?.kind;
  const byKind = has(WALL_KIND_HEIGHT as Record<string, any>, kind) ? WALL_KIND_HEIGHT[kind as WallKind] : "storey";
  return own(wall, "height") ?? storeyOr(byKind, floorHeight(f));
}

/** Height of one edge of a room, by its EdgeKind; `room` null reads the house outline's `owk`. A missing kind is a wall. */
export function edgeHeight(f: Floor, room: Room | null, edgeIndex: number): number {
  const kinds = (room ? room.wk : f?.owk) as EdgeKind[] | undefined;
  const kind = Array.isArray(kinds) ? kinds[edgeIndex] : undefined;
  if (kind === "none") return 0;
  const storey = room ? roomHeight(f, room) : floorHeight(f);
  const byKind = typeof kind === "string" && has(WALL_KIND_HEIGHT as Record<string, any>, kind) ? WALL_KIND_HEIGHT[kind as WallKind] : "storey";
  return storeyOr(byKind, storey);
}

/**
 * `ceiling` is the top of the wall the door sits in (the storey height when it is not known). Only a slit reads it: its
 * default is 60 high with its head SLIT_HEAD_GAP under the ceiling, so its sill is `ceiling - 40 - height` (150 on 250).
 * An own `height` keeps that head, an own `sill` wins and the head follows it; the head never passes the ceiling and the
 * sill is never negative. On a wall so low that the slit would not fit under the gap, the slit is as high as the wall
 * allows: from 0, to the lower of its height and the wall.
 */
export function doorSpan(door: Door, ceiling: number = DEFAULT_FLOOR_HEIGHT): { sill: number; head: number } {
  const kind = (door as { kind?: unknown })?.kind;
  if (kind === "slit") {
    const top = valid(ceiling) ? ceiling : DEFAULT_FLOOR_HEIGHT, h = Math.min(own(door, "height") ?? SLIT_HEIGHT, top);
    const head = Math.min(top, Math.max(top - SLIT_HEAD_GAP, h));
    const sill = Math.min(own(door, "sill") ?? head - h, top);
    return { sill, head: Math.min(sill + h, top) };
  }
  const d = has(DOOR_DEFAULTS as Record<string, any>, kind) ? DOOR_DEFAULTS[kind as DoorKind] : DOOR_DEFAULTS.door;
  const sill = own(door, "sill") ?? d.sill;
  return { sill, head: sill + (own(door, "height") ?? d.height) };
}

/**
 * The top of the wall a door sits in: the highest of the walls under its middle (two coincident walls draw as one, the
 * taller, as the 3D scene does), or the storey when it sits in none. What a slit hangs from.
 */
export function doorCeiling(f: Floor, door: Door): number {
  const a = door?.a, b = door?.b;
  if (!Array.isArray(a) || !Array.isArray(b) || ![...a, ...b].every((n) => Number.isFinite(n))) return floorHeight(f);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!l) return floorHeight(f);
  const hosts = edgesNear(f, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [(b[0] - a[0]) / l, (b[1] - a[1]) / l], 10);
  const heights = hosts.map((e) => (e.poly === "w" ? wallHeight(f, f.walls[e.i]) : edgeHeight(f, e.poly === "o" ? null : f.rooms[Number(e.poly.slice(1))] ?? null, e.i)));
  const top = Math.max(0, ...heights);
  return top > 0 ? top : floorHeight(f);
}

export function openingSpan(op: Opening): { sill: number; head: number } {
  const sill = own(op, "sill") ?? OPENING_DEFAULT.sill;
  return { sill, head: sill + (own(op, "height") ?? OPENING_DEFAULT.height) };
}

export function furnitureHeight(m: Furniture): number {
  const s = (m as { symbol?: unknown })?.symbol;
  return own(m, "height") ?? (has(FURNITURE_HEIGHTS, s) ? FURNITURE_HEIGHTS[s] : FALLBACK);
}

export function unlinkedHeight(u: Unlinked): number {
  const t = (u as { type?: unknown })?.type;
  return own(u, "height") ?? (has(UNLINKED_HEIGHTS, t) ? UNLINKED_HEIGHTS[t] : FALLBACK);
}

export function deviceZ(d: Device): number {
  const t = (d as { type?: unknown } | null)?.type;
  return own(d, "z") ?? (has(DEVICE_Z, t) ? DEVICE_Z[t] : FALLBACK);
}

/** `z` as the user set it, or `fallback` when it is missing or invalid. For the devices whose solid has a default of its own (a radiator, a free-standing TV). */
export const deviceZOr = (d: Device, fallback: number): number => own(d, "z") ?? fallback;

/** A radiator hangs 10 cm off the floor, and its top stays this far under the window sill (a radiator under a window). */
export const RADIATOR_LIFT = 10, RADIATOR_SILL_MARGIN = 20;
/** Bottom and top of a radiator box. `z` on the device is its top; the default is the window sill less a margin, 70 cm. */
export function radiatorSpan(d: Device): { bottom: number; top: number } {
  return { bottom: RADIATOR_LIFT, top: deviceZOr(d, DOOR_DEFAULTS.window.sill - RADIATOR_SILL_MARGIN) };
}
