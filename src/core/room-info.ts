import type { Device, DeviceType, Door, Floor, Pt, Room } from "./schema";
import { classOf, inside, type StateOverlay } from "./render";
import { onEdge } from "./geometry";
import { doorStateOf } from "./door-state";
import { entitiesOfDevice, entitiesOfDoor } from "./attachments";
import { colorVarFor, nameFor, type ActiveOpts } from "./active";
import { meanReading, stateOf } from "./readings";

export { meanReading };

/**
 * S11.3: what the card's left panel says about one room, built from the layout and the live state only, so it can
 * be tested without a browser. Every input is untrusted (CLAUDE.md finding 1): a malformed room, list or state
 * reads as "nothing here", never a throw, never `NaN` or `undefined` in a string.
 */

/** What a tap on a device row in the room section does. Every `DeviceType` is a decision (finding 17). Only the
 *  four types a person would flip by hand toggle; everything else opens more-info, as `NO_TOGGLE` (actions.ts) does
 *  for the plan, and a test holds the two together: no type toggles here that the plan refuses to toggle. */
export const ROOM_ROW_TAP: Record<DeviceType, "toggle" | "more-info"> = {
  light: "toggle", switch: "toggle", plug: "toggle", cover: "toggle",
  motion: "more-info", contact: "more-info", heater: "more-info", climate: "more-info", ac: "more-info", tv: "more-info",
  media: "more-info", speaker: "more-info", computer: "more-info", person: "more-info", camera: "more-info", vacuum: "more-info",
  temp: "more-info", humidity: "more-info", battery: "more-info", inverter: "more-info", server: "more-info", access_point: "more-info",
  lock: "more-info", vibration: "more-info", other: "more-info", boiler: "more-info", car: "more-info", ups: "more-info",
  printer: "more-info", radar: "more-info",
};

/** `colorVar`: the `--fp-*` property the row's icon takes (its on colour while on, the panel's own ink while off, finding 9). */
export interface RoomDeviceRow { index: number; entity: string; name: string; type: DeviceType; state: string; on: boolean; colorVar: string }
export interface RoomSensorRow { entity: string; name: string; kind: "temps" | "humidity" | "motion"; state: string }
export interface RoomSummary {
  name: string;
  /** Square metres from the room's own points; null when they are not a polygon. */
  areaM2: number | null;
  /** The mean readouts the plan draws under the room's name; "" when nothing is readable. */
  temperature: string;
  humidity: string;
  /** null when the room has no readable motion sensor. `since` is the raw `last_changed`: of the newest sensor that is on, else of the newest. */
  motion: { on: boolean; since: string } | null;
  /** Names of the open (or unlocked) doors and windows whose line lies on one of the room's edges. */
  openings: string[];
  lightsOn: string[];
  devices: RoomDeviceRow[];
  sensors: RoomSensorRow[];
  /** Every entity that belongs to the room: its devices (and what they attach), its sensors, its doors' sensors. */
  entities: ReadonlySet<string>;
}

const NO_STATE = "no state";
const finite = (p: unknown): p is Pt => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((e): e is string => typeof e === "string" && e.length > 0) : []);

/** The polygon's area in m² (the plan is in cm), to 0.1; null for anything that is not a ring of three finite points.
 *  From the points, not the room's `area` field: that one is a Home Assistant area id, not a size. */
export function roomAreaM2(pts: unknown): number | null {
  if (!Array.isArray(pts) || pts.length < 3 || !pts.every(finite)) return null;
  const twice = pts.reduce((s: number, a: Pt, i: number) => { const b = pts[(i + 1) % pts.length] as Pt; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
  return Math.round(Math.abs(twice) / 2 / 1000) / 10; // cm² to m² is /10 000; /1000 then /10 rounds to 0.1
}

/** "state unit", the way the panel prints it; `no state` when the entity is unknown to Home Assistant. */
function stateText(state: StateOverlay | undefined, entity: string): string {
  const s = stateOf(state, entity);
  if (!s) return NO_STATE;
  const unit = typeof s.attributes?.unit_of_measurement === "string" ? s.attributes.unit_of_measurement : "";
  return unit ? `${s.state} ${unit}` : s.state;
}

/** ISO date and 24-hour time in the viewer's zone ("2026-10-04 19:40:08"); "unknown" for anything that is not a date. */
export function formatChanged(iso: unknown): string {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleString("sv-SE") : "unknown";
}

const centre = (d: Device): Pt | null => {
  const p: unknown = "a" in d && "b" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [(d as { x: number }).x, (d as { y: number }).y];
  return finite(p) ? p : null;
};

/** Doors and windows whose line lies on one of the room's edges (`onEdge`, the same test the editor uses). */
function doorsOf(f: Floor, ring: Pt[]): Door[] {
  const hit = new Set<number>();
  ring.forEach((a, i) => { for (const d of onEdge(f, a, ring[(i + 1) % ring.length]!).doors) hit.add(d); });
  return [...hit].sort((a, b) => a - b).flatMap((i) => (f.doors[i] ? [f.doors[i]!] : []));
}

const SENSOR_KINDS = ["temps", "humidity", "motion"] as const;

/** The summary of `f.rooms[index]`, or null when there is no such room. */
export function roomSummary(f: Floor, index: number, state: StateOverlay | undefined, opts: ActiveOpts): RoomSummary | null {
  const r: Room | undefined = Number.isInteger(index) ? f.rooms[index] : undefined;
  if (!r) return null;
  const ring: Pt[] = Array.isArray(r.pts) && r.pts.length >= 3 && r.pts.every(finite) ? r.pts : [];
  const lists = { temps: strings(r.temps), humidity: strings(r.humidity), motion: strings(r.motion) };

  const devices: RoomDeviceRow[] = [];
  const entities = new Set<string>();
  const lightsOn: string[] = [];
  f.devices.forEach((d, i) => {
    const c = centre(d);
    // A person's drawn position comes from a room sensor at render time, not from x and y: listing one by its stored
    // point would put it in the wrong room, so a person never has a row here.
    if (!c || d.type === "person" || typeof d.entity !== "string" || !d.entity || !ring.length || !inside(c, ring)) return;
    const on = classOf(d, { scale: 1, state, ...opts }) === "on";
    devices.push({ index: i, entity: d.entity, name: nameFor(d, state), type: d.type, state: stateText(state, d.entity), on, colorVar: on ? colorVarFor(d, state) : "--fp-ink" });
    for (const e of entitiesOfDevice(d)) entities.add(e);
    if (d.type === "light" && on) lightsOn.push(nameFor(d, state));
  });

  const sensors: RoomSensorRow[] = [];
  for (const kind of SENSOR_KINDS) {
    for (const e of lists[kind]) {
      entities.add(e);
      if (devices.some((d) => d.entity === e)) continue; // it has an icon on the plan: that row already lists it
      const friendly = stateOf(state, e)?.attributes?.friendly_name;
      sensors.push({ entity: e, name: typeof friendly === "string" && friendly ? friendly : e, kind, state: stateText(state, e) });
    }
  }

  const openings: string[] = [];
  if (ring.length) {
    for (const door of doorsOf(f, ring)) {
      for (const e of entitiesOfDoor(door)) entities.add(e);
      if (doorStateOf(door, state).open) openings.push(door.name || door.kind);
    }
  }

  const seen = lists.motion.flatMap((e) => { const s = stateOf(state, e); return s && s.state !== "unavailable" && s.state !== "unknown" ? [s] : []; });
  const stamp = (s: { last_changed: string }) => { const t = Date.parse(s.last_changed); return Number.isFinite(t) ? t : -Infinity; };
  const newest = (list: typeof seen) => list.reduce((best, s) => (stamp(s) > stamp(best) ? s : best));
  const lit = seen.filter((s) => s.state === "on");
  const motion = seen.length ? { on: lit.length > 0, since: newest(lit.length ? lit : seen).last_changed } : null;

  return {
    name: typeof r.name === "string" ? r.name : "",
    areaM2: roomAreaM2(ring),
    temperature: meanReading(lists.temps, state),
    humidity: meanReading(lists.humidity, state),
    motion, openings, lightsOn, devices, sensors, entities,
  };
}

/** `items` kept to the entities that belong to the room, in their own order: the Active list while a room is selected. */
export function filterToRoom<T extends { entity: string }>(items: T[], s: RoomSummary): T[] {
  return items.filter((it) => s.entities.has(it.entity));
}

/**
 * S11.4: what Home Assistant's registries know about an entity, as label and value rows for the panel. Reads
 * `hass.entities[id].device_id` (and `.area_id`) -> `hass.devices[...]` (manufacturer, model, sw_version, area_id)
 * and `hass.areas[...].name`: the shapes of the Home Assistant frontend's own `hass` object. A field the registry
 * leaves empty is left out; with no registry entry at all only entity, state and last changed remain. Plain text:
 * the card prints it through lit, which escapes it (finding 2).
 */
export interface InfoHass {
  states?: StateOverlay;
  entities?: Record<string, { device_id?: string | null; area_id?: string | null } | undefined>;
  devices?: Record<string, { manufacturer?: string | null; model?: string | null; sw_version?: string | null; area_id?: string | null } | undefined>;
  areas?: Record<string, { name?: string | null } | undefined>;
}
export interface InfoRow { label: string; value: string }

const own = <T>(map: Record<string, T> | undefined, key: string): T | undefined =>
  key && map && typeof map === "object" && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function deviceInfo(entity: string, hass: InfoHass): InfoRow[] {
  const reg = own(hass.entities, entity);
  const device = own(hass.devices, text(reg?.device_id));
  const areaId = text(reg?.area_id) || text(device?.area_id);
  const rows: InfoRow[] = [];
  const add = (label: string, value: string) => { if (value) rows.push({ label, value }); };
  if (device && typeof device === "object") {
    add("Manufacturer", text(device.manufacturer));
    add("Model", text(device.model));
    add("Firmware", text(device.sw_version));
  }
  add("Area", text(own(hass.areas, areaId)?.name));
  rows.push({ label: "Entity", value: entity });
  rows.push({ label: "State", value: stateText(hass.states, entity) });
  rows.push({ label: "Last changed", value: formatChanged(stateOf(hass.states, entity)?.last_changed) });
  return rows;
}
