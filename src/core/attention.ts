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
export const ATTENTION_KINDS = ["alarm-triggered", "alarm-armed", "open", "unlocked", "leak", "smoke", "battery-low", "unavailable"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/**
 * What puts a device in Attention, besides being unavailable (which every type can be). Every `DeviceType` is a
 * decision (finding 17), so a new type fails to compile here until someone writes one down:
 * - `alarm`: `triggered` is alarm-triggered; `armed_*`, `arming` and `pending` are alarm-armed. Pending (the entry
 *   delay) is not yet triggered; it says so in the state text.
 * - `open`: a contact sensor that is `on`; a cover only while `coverActive` says so (a garage door, gate or door
 *   standing open, the plan's own rule), never a blind or curtain.
 * - `unlocked`: a lock whose state is `unlocked`. Jammed, locking and unlocking are not.
 * - `hazard`: an `other` device whose entity is a `binary_sensor` that is `on`, by its `device_class`: `moisture` is a
 *   leak; `smoke`, `carbon_monoxide` and `gas` are smoke. HA has no device type for these (`typeForEntity` makes them
 *   `other`), so the class read at runtime decides, as for a cover. An `other` with `device_class: battery` and a
 *   numeric state under 20 (`BATTERY_LOW`) is a low battery.
 * - `none`: only when unavailable. A siren sounding, a vibration sensor, a vacuum in error: not asked for here. The
 *   `battery` type is a home storage battery: its charge is not an alert.
 * Besides its rule, any placed device, and any lock or contact sensor a door carries, whose `battery_level` attribute
 * is a number under 20 is a low battery, one item per entity. A lock can be unlocked and low at once: two items, one
 * thing on the floor's count.
 */
export type AttentionRule = "alarm" | "open" | "unlocked" | "hazard" | "none";
export const ATTENTION_RULE: Record<DeviceType, AttentionRule> = {
  alarm: "alarm", contact: "open", cover: "open", lock: "unlocked", battery: "none", other: "hazard",
  heater: "none", light: "none", switch: "none", plug: "none", temp: "none", humidity: "none", motion: "none", camera: "none",
  climate: "none", ac: "none", tv: "none", computer: "none", media: "none", inverter: "none", server: "none", access_point: "none",
  vibration: "none", boiler: "none", car: "none", ups: "none", printer: "none", speaker: "none", person: "none", radar: "none",
  vacuum: "none", siren: "none",
};

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
}

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

/** A number under `BATTERY_LOW`: a finite number, or a plain decimal string. Anything else is not low. */
const low = (v: unknown): boolean => {
  const n = typeof v === "number" ? v : typeof v === "string" && DECIMAL.test(v.trim()) ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n < BATTERY_LOW;
};
const attrs = (s: StateOverlay[string]): Record<string, unknown> => (s.attributes && typeof s.attributes === "object" && !Array.isArray(s.attributes) ? s.attributes : {});

/** What a device in state `s` raises: its rule's kind, then a low battery of its own. */
function deviceKinds(d: Device, s: StateOverlay[string]): AttentionKind[] {
  const k = ruleKind(d, s);
  const out: AttentionKind[] = k ? [k] : [];
  if (k !== "battery-low" && low(attrs(s).battery_level)) out.push("battery-low");
  return out;
}

/** What `ATTENTION_RULE` raises for a device in state `s`, or null. */
function ruleKind(d: Device, s: StateOverlay[string]): AttentionKind | null {
  const v = s.state;
  switch (ATTENTION_RULE[d.type]) {
    case "alarm": return v === "triggered" ? "alarm-triggered" : v.startsWith("armed_") || v === "arming" || v === "pending" ? "alarm-armed" : null;
    case "open": return (d.type === "cover" ? coverActive(s) : v === "on") ? "open" : null;
    case "unlocked": return v === "unlocked" ? "unlocked" : null;
    case "hazard": {
      const dc = attrs(s).device_class;
      if (dc === "battery") return low(v) ? "battery-low" : null;
      if (!d.entity.startsWith("binary_sensor.") || v !== "on") return null;
      return typeof dc !== "string" ? null : LEAK_CLASSES.has(dc) ? "leak" : SMOKE_CLASSES.has(dc) ? "smoke" : null;
    }
    default: return null;
  }
}

/** Everything that needs attention across every floor of `layout`. */
export function attention(layout: Layout, state: StateOverlay | undefined): Attention {
  const items: AttentionItem[] = [], unavailable: AttentionItem[] = [], floors: Record<string, FloorAttention> = {};
  const floorList = layout && typeof layout.floors === "object" && layout.floors ? Object.entries(layout.floors) : [];
  // An entity drawn as its own icon is reported by that icon; a door lists only what is attached and nowhere else.
  const placed = new Set<string>();
  for (const [, f] of floorList) for (const d of list<Device>(f?.devices)) if (typeof d?.entity === "string" && d.entity) placed.add(d.entity);
  const seen = new Set<string>(); // an entity on two icons is reported once

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
      const kinds: AttentionKind[] = s.state === "unavailable" ? ["unavailable"] : deviceKinds(d, s);
      if (!kinds.length) continue;
      const room = p ? roomName(f, p) : undefined;
      for (const kind of kinds) add({ kind, at, name: nameFor(d, state), ...(room ? { room } : {}), type: d.type, ...base(s, d.entity) });
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
      raise("unavailable", (s) => s.state === "unavailable", [...sensors, ...locks, ...own(door.vibration), ...cover]);
      for (const e of new Set([...sensors, ...locks])) {
        const s = stateOf(state, e);
        if (s && s.state !== "unavailable" && low(attrs(s).battery_level)) add({ kind: "battery-low", at, name, ...(room ? { room } : {}), ...base(s, e) });
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
