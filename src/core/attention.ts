import type { Device, DeviceType, Door, Floor, Layout, Pt } from "./schema";
import { type StateOverlay } from "./render";
import { coverActive } from "./cover";
import { doorStateOf } from "./door-state";
import { doorRoomName as doorRoom, nameFor, roomNameAt as roomName } from "./active";
import { stateOf } from "./readings";
import { pieceDevice } from "./solids";

/**
 * S24.3 (G1, G2, G3): what is wrong in the house, before what is on. Pure: the layout and the live state in, a list out,
 * so the card's Overview can show it and a test can count it. Every input is untrusted (CLAUDE.md finding 1): a junk
 * state or list reads as nothing to report, never a throw.
 */

/** The kinds, most severe first: the order the Overview lists them in. `unavailable` is last and folded into one row. */
export const ATTENTION_KINDS = ["alarm-triggered", "alarm-armed", "open", "jammed", "unlocked", "leak", "smoke", "battery-low", "unavailable"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/**
 * What puts a device in Attention, besides being unavailable (which every type can be). Every `DeviceType` is a
 * decision (finding 17), so a new type fails to compile here until someone writes one down:
 * - `alarm`: `triggered` is alarm-triggered; `armed_*`, `arming` and `pending` are alarm-armed. Pending (the entry
 *   delay) is not yet triggered; it says so in the state text.
 * - `open`: a contact sensor that is `on`; a cover only while `coverActive` says so (a garage door, gate or door
 *   standing open, the plan's own rule), never a blind or curtain.
 * - `unlocked`: a lock whose state is `unlocked` is unlocked; one that is `jammed` is jammed (S24.R2: it cannot lock,
 *   a person must go). Locking and unlocking are neither.
 * - `hazard`: an `other` device whose entity is a `binary_sensor` that is `on`, by its `device_class`: `moisture` is a
 *   leak; `smoke`, `carbon_monoxide` and `gas` are smoke. HA has no device type for these (`typeForEntity` makes them
 *   `other`), so the class read at runtime decides, as for a cover.
 * - `none`: only when unavailable. A siren sounding, a vibration sensor, a vacuum in error: not asked for here. The
 *   `battery` type is a home storage battery: its charge is not an alert.
 * Besides its rule, a device's own battery (S24.R1, `batteryOf`): any placed device, and any lock or contact sensor a
 * door carries, is low when its entity is a battery entity that reads low, else its `battery_level` or `battery`
 * attribute is a number under 20, else (no such attribute) a diagnostic battery entity of its own HA device reads low. One item
 * per placed entity. A lock can be unlocked and low at once: two items, one thing on the floor's count.
 */
export type AttentionRule = "alarm" | "open" | "unlocked" | "hazard" | "none";
export const ATTENTION_RULE: Record<DeviceType, AttentionRule> = {
  alarm: "alarm", contact: "open", cover: "open", lock: "unlocked", battery: "none", other: "hazard",
  heater: "none", light: "none", switch: "none", plug: "none", temp: "none", humidity: "none", motion: "none", camera: "none",
  climate: "none", ac: "none", tv: "none", computer: "none", media: "none", inverter: "none", server: "none", access_point: "none",
  vibration: "none", boiler: "none", car: "none", ups: "none", printer: "none", speaker: "none", person: "none", radar: "none",
  vacuum: "none", siren: "none",
};

/** The device types whose battery is their charge, a reading, not a maintenance job: a home storage battery, an
 *  inverter, a UPS, a car. Their own battery entity, or one of their HA device, is never a low battery (S24.R1). */
const STORAGE: ReadonlySet<DeviceType> = new Set<DeviceType>(["battery", "inverter", "ups", "car"]);

/** Percent. A battery reading under this is low. */
export const BATTERY_LOW = 20;
const LEAK_CLASSES = new Set(["moisture"]);
const SMOKE_CLASSES = new Set(["smoke", "carbon_monoxide", "gas"]);
const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Where the thing is in the layout: `index` into the floor's `devices`, `furniture` (a linked piece) or `doors`. */
export interface AttentionRef { what: "device" | "piece" | "door"; index: number; id: string }

export interface AttentionItem {
  kind: AttentionKind;
  /** The layout's own floor key. */
  floor: string;
  at: AttentionRef;
  /** The entity that raised it: the device's own, or the door's sensor, lock or cover. */
  entity: string;
  /** The device's name (`nameFor`), or the door's. */
  name: string;
  /** The room it stands in, or the first room a door borders; absent when none. */
  room?: string;
  /** A device's type; absent on a door. */
  type?: DeviceType;
  /** The entity's raw HA state, for the state text. */
  state: string;
  /** The entity's raw `last_changed`, for an age; "" when HA gave none. */
  lastChanged: string;
  /** battery-low only: the level in percent, when HA gave a number (a battery binary_sensor gives none). */
  level?: number;
  /** battery-low only: the battery entity of the same HA device that reported it, when it is not `entity` itself.
   *  `state` and `lastChanged` are then that entity's. */
  source?: string;
}

/** HA's entity registry, as the frontend's `hass.entities` holds it (display entries): only the fields read here. */
export type AttentionRegistry = Record<string, { device_id?: string | null; entity_category?: string | null } | undefined>;

/** Per floor, for the floor tabs ("Ground · 3"). `count` is the number of things (a device, a piece or a door) with at
 *  least one item, not the number of items. It leaves the unavailable out: they have their own folded row, and two
 *  dozen dead entities would drown the number. `alarm`: an alarm on the floor is triggered. */
export interface FloorAttention { count: number; unavailable: number; alarm: boolean }

export interface Attention {
  /** Everything but unavailable, most severe first, then by name. */
  items: AttentionItem[];
  /** The unavailable things, one per device or door, by name: the folded row's count is its length. */
  unavailable: AttentionItem[];
  /** Every floor key of the layout, also one with nothing to report. */
  floors: Record<string, FloorAttention>;
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const strings = (v: unknown): string[] => list<unknown>(v).filter((e): e is string => typeof e === "string" && e.length > 0);
const finite = (p: unknown): p is Pt => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const centre = (d: Device): Pt | null => {
  const p: unknown = "a" in d && "b" in d && finite(d.a) && finite(d.b) ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [(d as { x: number }).x, (d as { y: number }).y];
  return finite(p) ? p : null;
};

/** A finite number, or a plain decimal string; anything else is NaN. */
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && DECIMAL.test(v.trim()) ? Number(v) : Number.NaN);
/** A number under `BATTERY_LOW`. Anything else is not low. */
const low = (v: unknown): boolean => { const n = num(v); return Number.isFinite(n) && n < BATTERY_LOW; };
const attrs = (s: StateOverlay[string]): Record<string, unknown> => (s.attributes && typeof s.attributes === "object" && !Array.isArray(s.attributes) ? s.attributes : {});
const own = <T>(m: unknown, k: string): T | undefined => (m && typeof m === "object" && Object.prototype.hasOwnProperty.call(m, k) ? (m as Record<string, T>)[k] : undefined);

/** A low reading: the level when there is one. */
interface Low { level?: number }
/** `entity` in state `s` as a battery entity (`device_class: battery`): a sensor under 20 %, or a binary_sensor that is
 *  `on` (HA's "low"). Null when it is no battery entity or not low. */
function batteryEntityLow(entity: string, s: StateOverlay[string]): Low | null {
  if (attrs(s).device_class !== "battery") return null;
  if (entity.startsWith("binary_sensor.")) return s.state === "on" ? {} : null;
  // A reading in volts (or any unit but %) is not a charge level: 2.9 V is not 2.9 % (S24.R12).
  const unit = attrs(s).unit_of_measurement;
  if (unit !== undefined && unit !== null && unit !== "" && unit !== "%") return null;
  return entity.startsWith("sensor.") && low(s.state) ? { level: num(s.state) } : null;
}

/** HA device id -> its battery entities, from the registry and the states: what `batteryOf` reads for a device that
 *  reports no battery of its own. Built once per call; junk rows are skipped. */
function batteriesByDevice(reg: AttentionRegistry | undefined, state: StateOverlay | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!reg || typeof reg !== "object" || Array.isArray(reg)) return out;
  for (const id of Object.keys(reg)) {
    const dev = own<{ device_id?: unknown }>(reg, id)?.device_id;
    if (typeof dev !== "string" || !dev || (!id.startsWith("sensor.") && !id.startsWith("binary_sensor."))) continue;
    const s = stateOf(state, id);
    if (!s || attrs(s).device_class !== "battery") continue;
    out.set(dev, [...(out.get(dev) ?? []), id]);
  }
  return out;
}

/** What raised a low battery for a thing's entity: the entity itself or another battery entity (`source`). */
interface BatteryHit extends Low { source?: string; s: StateOverlay[string] }

/**
 * S24.R1: the battery of the thing behind `entity` (state `s`), when it is low. In order, the first that has a reading
 * decides: the entity is itself a battery entity (a `battery`-type icon only when HA files it `diagnostic`: a home
 * battery's charge is its device's main reading); a `battery_level` or `battery` attribute; a battery entity of the same
 * HA device (`hass.entities[...].device_id`) that HA files `diagnostic`, the lowest, unless that entity is placed as its
 * own icon. A battery sensor counts only in % or with no unit. A storage type
 * (`STORAGE`) reads none of these but an attribute.
 */
function batteryOf(entity: string, type: DeviceType | undefined, s: StateOverlay[string], ctx: BatteryCtx): BatteryHit | null {
  const storage = !!type && STORAGE.has(type);
  if (attrs(s).device_class === "battery") {
    if (storage && own<{ entity_category?: unknown }>(ctx.reg, entity)?.entity_category !== "diagnostic") return null;
    const hit = batteryEntityLow(entity, s);
    return hit ? { ...hit, s } : null;
  }
  const a = attrs(s);
  for (const v of [a.battery_level, a.battery]) {
    if (Number.isFinite(num(v))) return low(v) ? { level: num(v), s } : null;
  }
  if (storage) return null;
  const dev = own<{ device_id?: unknown }>(ctx.reg, entity)?.device_id;
  if (typeof dev !== "string" || !dev) return null;
  let best: BatteryHit | null = null;
  for (const b of ctx.byDevice.get(dev) ?? []) {
    // Only a diagnostic battery entity is a device's own battery; a home battery's or a car's charge on the device of a
    // switch or plug is its main reading, filed without a category, and 10 % of it at night is normal (S24.R12).
    if (b === entity || ctx.placed.has(b) || own<{ entity_category?: unknown }>(ctx.reg, b)?.entity_category !== "diagnostic") continue;
    const bs = stateOf(ctx.state, b), hit = bs && bs.state !== "unavailable" ? batteryEntityLow(b, bs) : null;
    if (hit && (!best || (hit.level ?? -1) < (best.level ?? -1))) best = { ...hit, source: b, s: bs! };
  }
  return best;
}
interface BatteryCtx { reg: AttentionRegistry | undefined; state: StateOverlay | undefined; byDevice: Map<string, string[]>; placed: Set<string> }

/** What `ATTENTION_RULE` raises for a device in state `s`, or null. */
function ruleKind(d: Device, s: StateOverlay[string]): AttentionKind | null {
  const v = s.state;
  switch (ATTENTION_RULE[d.type]) {
    case "alarm": return v === "triggered" ? "alarm-triggered" : v.startsWith("armed_") || v === "arming" || v === "pending" ? "alarm-armed" : null;
    case "open": return (d.type === "cover" ? coverActive(s) : v === "on") ? "open" : null;
    case "unlocked": return v === "unlocked" ? "unlocked" : v === "jammed" ? "jammed" : null;
    case "hazard": {
      const dc = attrs(s).device_class;
      if (!d.entity.startsWith("binary_sensor.") || v !== "on") return null;
      return typeof dc !== "string" ? null : LEAK_CLASSES.has(dc) ? "leak" : SMOKE_CLASSES.has(dc) ? "smoke" : null;
    }
    default: return null;
  }
}

/** Everything that needs attention across every floor of `layout`. `reg` is HA's entity registry (`hass.entities`), for
 *  the battery sensor of a placed device's own HA device; without it a device's battery is only what its state says. */
export function attention(layout: Layout, state: StateOverlay | undefined, reg?: AttentionRegistry): Attention {
  // A floor key is layout data: `__proto__` must be a floor, not the object's prototype (finding 1, S24.R9).
  const items: AttentionItem[] = [], unavailable: AttentionItem[] = [], floors: Record<string, FloorAttention> = Object.create(null);
  const floorList = layout && typeof layout.floors === "object" && layout.floors ? Object.entries(layout.floors) : [];
  // An entity drawn as its own icon is reported by that icon; a door lists only what is attached and nowhere else.
  const placed = new Set<string>();
  for (const [, f] of floorList) for (const d of list<Device>(f?.devices)) if (typeof d?.entity === "string" && d.entity) placed.add(d.entity);
  const seen = new Set<string>(); // an entity on two icons is reported once
  const ctx: BatteryCtx = { reg, state, byDevice: batteriesByDevice(reg, state), placed };
  const sources = new Set<string>(); // a device's battery sensor read for two of its entities is reported once
  /** The battery-low item's own fields for `entity`, or null when its battery is fine or already reported. */
  const battery = (entity: string, type: DeviceType | undefined, s: StateOverlay[string]) => {
    const hit = batteryOf(entity, type, s, ctx);
    if (!hit || (hit.source && sources.has(hit.source))) return null;
    if (hit.source) sources.add(hit.source);
    return { ...(hit.level !== undefined ? { level: hit.level } : {}), ...(hit.source ? { source: hit.source } : {}), state: hit.s.state, lastChanged: typeof hit.s.last_changed === "string" ? hit.s.last_changed : "" };
  };

  for (const [key, f] of floorList) {
    floors[key] = { count: 0, unavailable: 0, alarm: false };
    if (!f || typeof f !== "object") continue;
    const add = (it: AttentionItem) => (it.kind === "unavailable" ? unavailable : items).push(it);
    const base = (s: StateOverlay[string], entity: string) => ({ floor: key, entity, state: s.state, lastChanged: typeof s.last_changed === "string" ? s.last_changed : "" });

    const things: { d: Device; at: AttentionRef; p: Pt | null }[] = [];
    list<Device>(f.devices).forEach((d, i) => { if (d && typeof d === "object") things.push({ d, at: { what: "device", index: i, id: String(d.id) }, p: centre(d) }); });
    list<Floor["furniture"][number]>(f.furniture).forEach((m, i) => {
      const d = m && typeof m === "object" ? pieceDevice(m) : null;
      if (d) things.push({ d, at: { what: "piece", index: i, id: String(m.id) }, p: finite([m.x, m.y]) ? [m.x, m.y] : null });
    });
    for (const { d, at, p } of things) {
      if (typeof d.entity !== "string" || !d.entity || seen.has(d.entity)) continue;
      const s = stateOf(state, d.entity);
      if (!s) continue;
      seen.add(d.entity);
      const k = s.state === "unavailable" ? "unavailable" : ruleKind(d, s);
      const bat = s.state === "unavailable" ? null : battery(d.entity, d.type, s);
      if (!k && !bat) continue;
      const room = p ? roomName(f, p) : undefined;
      const item = { at, name: nameFor(d, state), ...(room ? { room } : {}), type: d.type, ...base(s, d.entity) };
      if (k) add({ kind: k, ...item });
      if (bat) add({ kind: "battery-low", ...item, ...bat });
    }

    list<Door>(f.doors).forEach((door, i) => {
      if (!door || typeof door !== "object") return;
      const own = (v: unknown) => strings(v).filter((e) => !placed.has(e));
      const sensors = own(door.sensors), locks = own(door.locks);
      const cover = typeof door.cover === "string" && door.cover && !placed.has(door.cover) ? [door.cover] : [];
      // The same rule the plan draws (doorStateOf), over the entities only the door carries.
      const ds = doorStateOf({ ...door, sensors, locks, cover: cover[0] }, state);
      const name = typeof door.name === "string" && door.name ? door.name : String(door.kind);
      const at: AttentionRef = { what: "door", index: i, id: String(door.id) };
      const room = doorRoom(f, i);
      const raise = (kind: AttentionKind, pick: (s: StateOverlay[string]) => boolean, from: string[]) => {
        const e = from.find((x) => { const s = stateOf(state, x); return !!s && pick(s); });
        if (e) add({ kind, at, name, ...(room ? { room } : {}), ...base(stateOf(state, e)!, e) });
      };
      if (ds.contact || ds.cover) raise("open", (s) => s.state === "on" || s.state === "open", [...sensors, ...(ds.cover ? cover : [])]);
      if (ds.unlocked) raise("unlocked", (s) => s.state === "unlocked", locks);
      raise("jammed", (s) => s.state === "jammed", locks);
      raise("unavailable", (s) => s.state === "unavailable", [...sensors, ...locks, ...own(door.vibration), ...cover]);
      for (const e of new Set([...sensors, ...locks])) {
        const s = stateOf(state, e);
        const bat = s && s.state !== "unavailable" ? battery(e, undefined, s) : null;
        if (bat) add({ kind: "battery-low", at, name, ...(room ? { room } : {}), ...base(s!, e), ...bat });
      }
    });
  }

  const rank = (k: AttentionKind) => ATTENTION_KINDS.indexOf(k);
  const byName = (a: AttentionItem, b: AttentionItem) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  items.sort((a, b) => rank(a.kind) - rank(b.kind) || byName(a, b) || (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0));
  unavailable.sort(byName);
  const things = new Set<string>();
  for (const it of items) {
    const thing = `${it.floor}\u0000${it.at.what}\u0000${it.at.index}`;
    if (!things.has(thing)) { things.add(thing); floors[it.floor]!.count++; }
    if (it.kind === "alarm-triggered") floors[it.floor]!.alarm = true;
  }
  for (const it of unavailable) floors[it.floor]!.unavailable++;
  return { items, unavailable, floors };
}

/**
 * S25 fix B: the indexes of `f.devices` that `attention` reports on (not the merely unavailable). The plan marks them
 * `needs-attention` so the far detail level keeps them as dots; it is the same rule, run over this floor alone, never a copy.
 * Without HA's entity registry, so a hub's battery sensor is not read; the device's own state and attributes are.
 */
export function attentionDevices(f: Floor, state: StateOverlay | undefined): Set<number> {
  const out = new Set<number>();
  if (!state || !f || typeof f !== "object") return out;
  for (const it of attention({ floors: { f } } as unknown as Layout, state).items) if (it.at.what === "device") out.add(it.at.index);
  return out;
}
