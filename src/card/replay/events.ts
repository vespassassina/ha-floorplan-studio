import type { coverActive as CoverActive } from "../../core/cover";
import type { doorStateOf as DoorStateOf } from "../../core/door-state";
import type { doorRoomIndexes as DoorRooms } from "../../core/active";
import type { roomAt as RoomAt } from "../../core/render";
import type { HistoryIndex } from "./history";

// R2.2: what counts as an event in a replay (docs/specs/replay-2.md, item 4). It lives in the replay chunk with the parser: a card
// that never replays does not carry the table. Pure: no DOM, no hass. Imports nothing of the card at runtime (bar.ts says why), so
// the two helpers it needs are handed over, as `BarTools` hands over lit.

/** Only this module holds it, so a test can prove the card file does not contain the event table. */
export const EVENTS_MARKER = "fp-events-v1";

export type EventGroup = "lamp" | "motion" | "opening" | "alarm";
/** One onset: `t` in ms like `stateAt`'s; `kind` is the device type, `door` for a door or window, `room` for a room's motion sensor.
 * R2.6: `rooms` are indexes into the floor's `rooms` (the rooms it is in; absent when it is in none). */
export interface Onset { entity: string; t: number; group: EventGroup; kind: string; rooms?: number[] }
/** Handed over like the two state helpers: the plan's own room rule (`roomAt`) and the rooms a door joins (`doorRoomIndexes`). */
export interface EventTools { doorStateOf: typeof DoorStateOf; coverActive: typeof CoverActive; roomAt: typeof RoomAt; doorRooms: typeof DoorRooms }

type Attrs = Record<string, unknown>;
/** `cls` sorts a state into a class (null: a passing state that says nothing, ignored); entering a class in `fires` is an onset. */
interface Rule { group: EventGroup; cls(state: string, a: Attrs, tools: EventTools): string | null; fires: readonly string[] }

const onOff = (s: string) => (s === "on" ? "on" : "off");
const onRule = (group: EventGroup): Rule => ({ group, cls: onOff, fires: ["on"] });
/** Attention's hazard rule: a leak or smoke sensor, by device_class (`LEAK_CLASSES` and `SMOKE_CLASSES` in core/attention.ts). */
const HAZARD = ["moisture", "smoke", "carbon_monoxide", "gas"];

/** A device type with a rule. Every `DEVICE_TYPES` member is here or in `NO_EVENT`, never both (finding 17; tested). */
export const EVENT_RULES: Record<string, Rule> = {
  light: onRule("lamp"),
  motion: onRule("motion"),
  radar: onRule("motion"),
  contact: onRule("opening"),
  cover: { group: "opening", cls: (s, a, t) => (t.coverActive({ state: s, attributes: a, last_changed: "" }) ? "open" : "shut"), fires: ["open"] },
  lock: { group: "opening", cls: (s) => (s === "unlocked" || s === "jammed" ? "open" : "shut"), fires: ["open"] },
  // Arming and disarming are events, so is triggered. `arming`, `pending` and `disarming` are on the way to one of these.
  alarm: { group: "alarm", cls: (s) => (s === "triggered" ? "triggered" : s.startsWith("armed_") ? "armed" : s === "disarmed" ? "disarmed" : null), fires: ["triggered", "armed", "disarmed"] },
  siren: onRule("alarm"),
  vibration: onRule("alarm"),
  other: { group: "alarm", cls: (s, a) => (s === "on" && typeof a.device_class === "string" && HAZARD.includes(a.device_class) ? "on" : "off"), fires: ["on"] },
};
/** Their changes are readings or routine, not things to look for. */
export const NO_EVENT: readonly string[] = [
  "heater", "switch", "plug", "temp", "humidity", "camera", "climate", "ac", "tv", "computer", "media", "battery", "inverter", "server",
  "access_point", "boiler", "car", "ups", "printer", "speaker", "person", "vacuum", "fan",
];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : []);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : []);
const dead = (s: string) => s === "unavailable" || s === "unknown";

/** One entity's onsets: the first row is the baseline (the start-time state), a dead row is skipped, and what follows it is compared with the last known class. */
function ruleOnsets(index: HistoryIndex, entity: string, rule: Rule, kind: string, tools: EventTools, out: Onset[], rooms: number[]) {
  let last: string | null = null;
  for (const r of index.get(entity) ?? []) {
    const c = dead(r.state) ? null : rule.cls(r.state, r.attributes, tools);
    if (c === null) continue;
    if (last !== null && c !== last && rule.fires.includes(c)) out.push({ entity, t: r.lu * 1000, group: rule.group, kind, ...(rooms.length ? { rooms } : {}) });
    last = c;
  }
}

/** A door or window opens when `doorStateOf` says so on the states its entities held, dead rows left out; the entity that changed is the onset's. */
function doorOnsets(index: HistoryIndex, door: Record<string, unknown>, tools: EventTools, out: Onset[], rooms: number[]) {
  const ids = [...strings(door.sensors), ...strings(door.locks), ...(typeof door.cover === "string" ? [door.cover] : [])];
  const mine: HistoryIndex = new Map();
  const moments: { t: number; entity: string }[] = [];
  for (const id of new Set(ids)) {
    const rows = (index.get(id) ?? []).filter((r) => !dead(r.state));
    if (!rows.length) continue;
    mine.set(id, rows);
    for (const r of rows) moments.push({ t: r.lu * 1000, entity: id });
  }
  moments.sort((a, b) => a.t - b.t);
  // Rows are sorted by `lu` (parseHistory), so each entity keeps one index that only moves forward: the row it held at a moment is the last at or before it.
  const at = new Map<string, number>();
  let was: boolean | null = null;
  for (const m of moments) {
    const state: Record<string, { state: string; attributes: Attrs }> = Object.create(null);
    for (const [id, rows] of mine) {
      let i = at.get(id) ?? -1;
      while (i + 1 < rows.length && rows[i + 1].lu * 1000 <= m.t) i++;
      at.set(id, i);
      if (i >= 0) state[id] = { state: rows[i].state, attributes: rows[i].attributes };
    }
    const d = tools.doorStateOf(door as never, state as never);
    const now = d.open || d.cover;
    if (was === false && now) out.push({ ...m, group: "opening", kind: "door", ...(rooms.length ? { rooms } : {}) });
    was = now;
  }
}

/** The rooms of door `i`; a door or neighbour of the wrong shape makes `onEdge` throw, and an event is not worth a thrown replay. */
function doorRooms(f: Record<string, unknown>, i: number, tools: EventTools): number[] {
  try { return tools.doorRooms(f as never, i); } catch { return []; }
}

/** Where a device stands: its point, or a line device's middle; NaN where the layout has no usable number (`roomAt` then says no room). */
function standsAt(d: Record<string, unknown>): [number, number] {
  const a = d.a, b = d.b, num = (v: unknown) => (typeof v === "number" ? v : NaN);
  return Array.isArray(a) && Array.isArray(b) ? [(num(a[0]) + num(b[0])) / 2, (num(a[1]) + num(b[1])) / 2] : [num(d.x), num(d.y)];
}

/**
 * The onsets of one floor's history, in time order. The floor is a layout floor (untrusted: wrong shapes give nothing); an entity placed
 * twice counts once. An entity with no row before its first change has no baseline, so that first row is not an onset.
 */
export function onsets(index: HistoryIndex, floor: unknown, tools: EventTools): Onset[] {
  const out: Onset[] = [];
  const f = isObject(floor) ? floor : {};
  const seen = new Set<string>();
  const watch = (entity: unknown, rule: Rule | undefined, kind: string, rooms: number[]) => {
    if (typeof entity !== "string" || !rule || seen.has(entity)) return;
    seen.add(entity);
    ruleOnsets(index, entity, rule, kind, tools, out, rooms);
  };
  // A room with no usable name cannot be listed in the filter, so an onset in it counts as in none.
  const roomList: unknown[] = Array.isArray(f.rooms) ? f.rooms : [];
  const named = (i: number) => { const r = roomList[i]; return isObject(r) && typeof r.name === "string" && r.name ? [i] : []; };
  for (const d of list(f.devices)) watch(d.entity, typeof d.type === "string" && Object.prototype.hasOwnProperty.call(EVENT_RULES, d.type) ? EVENT_RULES[d.type] : undefined, String(d.type), named(tools.roomAt(f as never, standsAt(d))));
  roomList.forEach((r, i) => { if (isObject(r)) for (const e of strings(r.motion)) watch(e, EVENT_RULES.motion, "room", named(i)); });
  // The door's own index in the layout's list, not in the cleaned one: `doorRooms` finds it by that index.
  (Array.isArray(f.doors) ? f.doors : []).forEach((d, i) => { if (isObject(d)) doorOnsets(index, d, tools, out, doorRooms(f, i, tools)); });
  // The same entity at the same moment from a device and a door is one onset.
  const key = new Set<string>();
  return out.filter((o) => !key.has(`${o.entity} ${o.t}`) && key.add(`${o.entity} ${o.t}`)).sort((a, b) => a.t - b.t || (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0));
}

/**
 * R2.4: the onset nearest to `t`, strictly after (`dir` 1) or strictly before (-1), that `allow` lets through. `onsets` is in time order.
 * An onset at `t` itself is not a jump: standing on one, the next press moves on. R2.6 supplies `allow` from the filters.
 */
export function neighbour(onsets: readonly Onset[], t: number, dir: 1 | -1, allow: (o: Onset) => boolean = () => true): Onset | undefined {
  const ahead = dir > 0;
  for (let i = ahead ? 0 : onsets.length - 1; ahead ? i < onsets.length : i >= 0; i += dir) {
    const o = onsets[i];
    if ((ahead ? o.t > t : o.t < t) && allow(o)) return o;
  }
  return undefined;
}

/** R2.6: the filters, as what is OFF (the empty sets are "all on", the state every bar opens in, and a room or group nobody names stays on). */
export interface Filters { groups: ReadonlySet<EventGroup>; rooms: ReadonlySet<number> }
/** Whether the filters let an onset through: its group is on, and some room of it is on. An onset with no room passes only while every room is on. */
export function allows(f: Filters, o: Onset): boolean {
  return !f.groups.has(o.group) && (o.rooms ? o.rooms.some((i) => !f.rooms.has(i)) : f.rooms.size === 0);
}
