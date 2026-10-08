import { DEVICE_TYPES } from "./schema";
import type { Device, DeviceType, Door, Floor, Layout, Pt } from "./schema";
import { acMode, classOf, ROOM_OWNS, roomAt, type RenderOpts, type StateOverlay } from "./render";
import { onEdge } from "./geometry";
import { pieceDevice } from "./solids";

/**
 * S9.5: one row the card's floating active-devices panel can show. `floor` is the layout's own floor key (not the
 * shown one — the panel lists every floor at once, CLAUDE.md domain: a card can switch floors, the list must not).
 * `colorVar` is the `--fp-*` custom property (CLAUDE.md finding 9: colours only through these) the row's icon
 * should take its `color` from, already resolved for a device (like `ac`) whose colour depends on its live state.
 */
export interface ActiveDevice {
  entity: string;
  name: string;
  type: DeviceType;
  floor: string;
  colorVar: string;
  /** S24.7 (F2): where the row's thing is on its floor, so a tap can switch floor and find it: an index into
   *  `devices`, `furniture` (a linked piece) or `doors` (a sensor the door carries). */
  at: ThingRef;
  /** The room it stands in (`roomAt`), or the first room a door borders; absent when none. */
  room?: string;
}

/** A thing on a floor: the index into the floor's `devices`, `furniture` or `doors`. */
export interface ThingRef { what: "device" | "piece" | "door"; index: number }

const finitePt = (p: unknown): p is Pt => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const roomList = (f: Floor): Floor["rooms"] => (Array.isArray(f.rooms) ? f.rooms : []);

/** The name of the room `p` is in (`roomAt`, the plan's own rule), or undefined. Shared with attention.ts. */
export function roomNameAt(f: Floor, p: Pt): string | undefined {
  const name = roomList(f)[roomAt(f, p)]?.name;
  return typeof name === "string" && name ? name : undefined;
}

/** The first room (layout order) that may own a device (`ROOM_OWNS`) and has door `index` on one of its edges. */
export function doorRoomName(f: Floor, index: number): string | undefined {
  for (const r of roomList(f)) {
    const ring: unknown[] = Array.isArray(r?.pts) ? r.pts : [];
    if (!r || !ROOM_OWNS[r.kind] || ring.length < 3 || !ring.every(finitePt) || typeof r.name !== "string" || !r.name) continue;
    const pts = ring as Pt[];
    if (pts.some((a, i) => onEdge(f, a, pts[(i + 1) % pts.length]!).doors.includes(index))) return r.name;
  }
  return undefined;
}

/** Where a device stands: its point, or a line device's middle; null when not finite. A person moves: no stored room. */
function standsAt(d: Device): Pt | null {
  if (d.type === "person") return null;
  const p: unknown = "a" in d && "b" in d && finitePt(d.a) && finitePt(d.b) ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [(d as { x: number }).x, (d as { y: number }).y];
  return finitePt(p) ? p : null;
}

/**
 * Every `DeviceType` is a decision (CLAUDE.md finding 17), written down here rather than left to fall through a
 * catch-all:
 * - `"on"`: listed while `classOf` (the same function `renderFloor` uses to paint the plan) says "on" — light,
 *   motion, contact, heater, climate, ac, tv, media, plug, computer, person, and cover: only a garage door, gate or
 *   door is ever "on" (`coverActive`, Diego 2026-10-03), a curtain or blind is not. The list and the plan can
 *   never disagree about one of these.
 * - `"cleaning"`: vacuum. `classOf` reads both "cleaning" and "returning" as one active colour on the plan (S7.10:
 *   `.dev-vacuum.on`), but the maintainer's brief for this list asks only for "vacuums that are cleaning" — a
 *   robot on its way back to the dock is winding down, not something to check. So vacuum is the one type whose
 *   list membership is narrower than its plan colour, not merely reused from it.
 * - `"never"`: camera (S24.3, G1: until then "always", which put ten cameras in "Active 150" whatever their state; a
 *   camera is a view, not something on, and "recording" or "streaming" is its normal state, so no state of it is
 *   "on" either), and every other type — a sensor with no on/off shape of its own (temp, humidity), a plain switch or
 *   lock (not asked for), or a type the card only ever watches through its own dialog (battery, inverter, server,
 *   access_point, boiler, car, ups, printer, other). A radar is "on" like a motion sensor (`MOTION_TYPES`).
 */
export const ACTIVE_LIST_RULE: Record<DeviceType, "on" | "cleaning" | "never"> = {
  light: "on", motion: "on", contact: "on", heater: "on", climate: "on", ac: "on", tv: "on", media: "on",
  plug: "on", computer: "on", person: "on", speaker: "on",
  camera: "never",
  vacuum: "cleaning",
  cover: "on", switch: "never", temp: "never", humidity: "never", battery: "never", inverter: "never", server: "never",
  access_point: "never", lock: "never", vibration: "never", other: "never", boiler: "never", car: "never",
  ups: "never", printer: "never",
  siren: "on", alarm: "on", // a sounding siren; an alarm panel that is armed or triggered
  radar: "on", // a radar that sees someone is motion like any other (MOTION_TYPES); it was "never" until 0.12.24
};

/** The `--fp-dev-*` token each type's on colour comes from on the plan (render.ts's `FLOORPLAN_CSS`), so the list's
 *  icon is never a colour invented separately from the one the plan already draws. `ac` is resolved by `acMode`
 *  instead, since it alone carries two (cool/heat). A type with no entry here (every "never"/never-reached one)
 *  falls back to `--fp-idle`, the same grey the plan gives a device with no colour rule of its own.
 *
 *  Opus review finding 10: `camera` is deliberately not `--fp-dev-camera` here. On the plan, that token tints a
 *  camera icon against the room it sits in, and `theme-roles.ts` sets it to the same shade as `--fp-idle`
 *  (`rolesToTokens`'s `shades.idle`) for every generated theme. The panel row's own background is `--fp-room`
 *  (`.fp-active` in floorplan-studio-card.ts), and in blueprint (a dark navy base) `--fp-idle` sits close enough
 *  in lightness to `--fp-room` that the camera row read as a dark blue icon on navy - hard to make out. `--fp-ink`
 *  is the row's own text colour (`.fp-active{color:var(--fp-ink)}`), already relied on to read against
 *  `--fp-room` in every theme, so the camera row borrows it instead of a plan token never meant for this
 *  background. */
const COLOR_VAR: Partial<Record<DeviceType, string>> = {
  light: "--fp-dev-light", motion: "--fp-dev-motion", contact: "--fp-dev-contact", heater: "--fp-dev-heater",
  climate: "--fp-dev-climate", tv: "--fp-dev-tv", media: "--fp-dev-media",
  plug: "--fp-dev-plug", computer: "--fp-dev-computer", camera: "--fp-ink", person: "--fp-dev-person",
  vacuum: "--fp-dev-vacuum", speaker: "--fp-dev-speaker", radar: "--fp-dev-radar",
  siren: "--fp-danger", alarm: "--fp-danger", // no token of their own: the danger red every theme already has
};

/** What `renderFloor` takes besides state, so the list reads a plug exactly as the plan does. */
export type ActiveOpts = Pick<RenderOpts, "plugWatts" | "powerLinks">;

export function colorVarFor(d: Device, state: StateOverlay | undefined): string {
  if (d.type === "ac") {
    const mode = acMode(d, { scale: 1, state });
    return mode === "cool" ? "--fp-dev-ac-cool" : "--fp-dev-ac-heat";
  }
  return COLOR_VAR[d.type] ?? "--fp-idle";
}

/** Whether `d` belongs on the active list right now, per `ACTIVE_LIST_RULE`. Untrusted state (CLAUDE.md finding 1):
 *  a missing or malformed entry just reads as off, never thrown on — the same contract `classOf` already keeps. */
function isActive(d: Device, state: StateOverlay | undefined, opts: ActiveOpts): boolean {
  // Opus review finding 9: an empty entity has nothing to open more-info on and nothing HA reports state for —
  // never list it, whatever ACTIVE_LIST_RULE says for its type.
  if (typeof d.entity !== "string" || !d.entity) return false;
  const rule = ACTIVE_LIST_RULE[d.type];
  const s = state?.[d.entity]?.state;
  if (s === "unavailable" || s === "unknown") return false;
  if (rule === "never") return false;
  if (rule === "cleaning") return s === "cleaning";
  return classOf(d, { scale: 1, state, ...opts }) === "on";
}

/** A device's name for the list: its own plan name, else HA's `friendly_name`, else its entity id — the same
 *  fallback order the task asked for, and the only one that can never come up empty. Untrusted state: anything
 *  that is not text is skipped. */
export function nameFor(d: Device, state: StateOverlay | undefined): string {
  const friendly = state?.[d.entity]?.attributes?.friendly_name;
  return d.name ?? (typeof friendly === "string" && friendly ? friendly : d.entity);
}

/** S10.3: a contact or vibration sensor attached to a door (not placed as its own device icon) still belongs on
 *  the list when it is on, under the door's own name, so pulling a sensor off the plan into a door (S10.3's other
 *  half) never makes it vanish from here. `field` picks which of the door's own entity lists to read; `placed` is
 *  every entity that already has a device icon somewhere in the layout, so that one is never listed twice. */
function doorAttachedRows(door: Door, field: "sensors" | "vibration", state: StateOverlay | undefined, placed: ReadonlySet<string>, floorKey: string, at: ThingRef, room: () => string | undefined): ActiveDevice[] {
  const type: DeviceType = field === "sensors" ? "contact" : "vibration";
  const list = door[field];
  if (!Array.isArray(list)) return [];
  const out: ActiveDevice[] = [];
  for (const e of list) {
    if (typeof e !== "string" || !e || placed.has(e)) continue;
    if (state?.[e]?.state !== "on") continue;
    const r = room();
    out.push({ entity: e, name: door.name ?? e, type, floor: floorKey, colorVar: "--fp-open-door", at, ...(r ? { room: r } : {}) });
  }
  return out;
}

/** Every active device across every floor of `layout` (not only one shown floor: the card can switch floors, this
 *  list must not — CLAUDE.md domain notes). Order follows each floor's own device order, floors in the layout's
 *  own key order; `groupActiveByType` is what the panel actually renders from, in `DEVICE_TYPES` order. */
export function activeDevices(layout: Layout, state: StateOverlay | undefined, opts: ActiveOpts = {}): ActiveDevice[] {
  const out: ActiveDevice[] = [];
  // S10.3: an entity already drawn as its own device icon is never repeated as a door row, whichever floor either
  // one is on - built once, over every floor, before the per-floor loop below reads it.
  const placed = new Set<string>();
  for (const floor of Object.values(layout.floors)) {
    for (const d of floor.devices) if (typeof d.entity === "string" && d.entity) placed.add(d.entity);
  }
  // A linked tv, speaker or computer piece is listed as the device of its type; an entity already listed (a device, or another piece) is not repeated.
  const listed = new Set(placed);
  for (const [floorKey, floor] of Object.entries(layout.floors)) {
    const things: { d: Device; at: ThingRef }[] = floor.devices.map((d, index) => ({ d, at: { what: "device", index } }));
    (floor.furniture ?? []).forEach((m, index) => { const d = pieceDevice(m); if (d && !listed.has(d.entity) && listed.add(d.entity)) things.push({ d, at: { what: "piece", index } }); });
    for (const { d, at } of things) {
      if (!isActive(d, state, opts)) continue;
      const p = standsAt(d), room = p ? roomNameAt(floor, p) : undefined;
      out.push({ entity: d.entity, name: nameFor(d, state), type: d.type, floor: floorKey, colorVar: colorVarFor(d, state), at, ...(room ? { room } : {}) });
    }
    (floor.doors ?? []).forEach((door, index) => {
      // The room is looked up only for a door that lists something: `onEdge` over every room is not free.
      let room: string | undefined | null = null;
      const roomOnce = () => (room === null ? (room = doorRoomName(floor, index)) : room);
      const at: ThingRef = { what: "door", index };
      out.push(...doorAttachedRows(door, "sensors", state, placed, floorKey, at, roomOnce));
      out.push(...doorAttachedRows(door, "vibration", state, placed, floorKey, at, roomOnce));
    });
  }
  return out;
}

/** `items` grouped by type, in `DEVICE_TYPES`' own fixed order, dropping any type with nothing active — the panel's
 *  "grouped by type, with a small type heading" (S9.5). */
export function groupActiveByType(items: ActiveDevice[]): [DeviceType, ActiveDevice[]][] {
  const byType = new Map<DeviceType, ActiveDevice[]>();
  for (const it of items) {
    const arr = byType.get(it.type);
    if (arr) arr.push(it);
    else byType.set(it.type, [it]);
  }
  return DEVICE_TYPES.filter((t) => byType.has(t)).map((t) => [t, byType.get(t)!]);
}
