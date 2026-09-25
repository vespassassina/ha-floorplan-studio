import type { AvailableEntity, DeviceType, Layout } from "./schema";
import { placedEntities, unplacedCatalog } from "./bind";

/** What the host (the HA panel) knows about Home Assistant and hands to the editor. Standalone there is none. */
export interface HaData {
  floors: { id: string; name: string }[];
  areas: { id: string; name: string; floor_id?: string }[];
  /** `area` is the HA area id the entity sits in (its own, else its device's), null for none. `dc` is its device class, when it has one.
   * `members` (S4.5) is a `group.*` entity's own `entity_id` list, from its state attributes; absent on everything else.
   * `platform` (S4.7) is the integration that owns the entity (from the entity registry), used to tell a `switch_as_x` light
   * apart from a physical one. `uid` (S4.7) is an automation or script's own registry `unique_id`, the id its HA editor URL takes. */
  entities: { id: string; name: string; domain: string; area?: string | null; dc?: string; /** the HA device it belongs to */ dev?: string; members?: string[]; platform?: string; uid?: string }[];
}

/** Which entities suit a device type: [domain, device classes]. A class list of null means any class of that domain; a type with no rule (computer, server...) has none listed here and takes any entity. */
const TYPE_RULES: Partial<Record<DeviceType, { domain: string; dcs?: string[]; not?: string[] }[]>> = {
  light: [{ domain: "light" }],
  plug: [{ domain: "switch", dcs: ["outlet"] }],
  switch: [{ domain: "switch", not: ["outlet"] }],
  temp: [{ domain: "sensor", dcs: ["temperature"] }],
  humidity: [{ domain: "sensor", dcs: ["humidity"] }],
  motion: [{ domain: "binary_sensor", dcs: ["motion", "occupancy", "presence"] }],
  contact: [{ domain: "binary_sensor", dcs: ["door", "window", "garage_door", "opening"] }],
  camera: [{ domain: "camera" }],
  climate: [{ domain: "climate" }],
  ac: [{ domain: "climate" }],
  heater: [{ domain: "climate" }, { domain: "switch" }],
  media: [{ domain: "media_player" }],
  tv: [{ domain: "media_player" }],
  cover: [{ domain: "cover" }],
  battery: [{ domain: "sensor", dcs: ["battery"] }],
  person: [{ domain: "person" }, { domain: "device_tracker" }],
  // S7.9: the radar's own entity is its presence sensor, typically a binary_sensor.*occupancy; the target x/y pairs
  // are picked separately in the editor panel, not offered here (entitiesForType has no notion of a pair).
  radar: [{ domain: "binary_sensor", dcs: ["occupancy"] }],
  // S7.10: a vacuum's own entity is the vacuum.* domain (docked/cleaning/paused/returning/error states).
  vacuum: [{ domain: "vacuum" }],
};

/** The entities that suit `type`, and the rest. A type with no rule matches everything. */
export function entitiesForType(ha: HaData, type: DeviceType): { match: HaData["entities"]; rest: HaData["entities"] } {
  const rules = TYPE_RULES[type];
  if (!rules) return { match: ha.entities, rest: [] };
  const ok = (e: HaData["entities"][number]) => rules.some((r) => e.domain === r.domain && (!r.dcs || (e.dc !== undefined && r.dcs.includes(e.dc))) && !(r.not && e.dc !== undefined && r.not.includes(e.dc)));
  return { match: ha.entities.filter(ok), rest: ha.entities.filter((e) => !ok(e)) };
}

/**
 * S4.18: the reverse guess — which `DeviceType` a raw HA entity is, for placing one from a room's area menu rather than
 * `layout.catalog`. Domain + `device_class` pairs that `TYPE_RULES` already resolve unambiguously (light, lock, camera,
 * cover, a switch's outlet class, a sensor's temperature/humidity/battery class, a binary_sensor's motion/contact/vibration
 * classes, and since S7.8 `person` and `device_tracker`, which are a person, and since S7.10 `vacuum`) map straight across. A domain that is genuinely ambiguous under the forward rules (`climate` could be a plain
 * thermostat, a heater's TRV or an AC; `switch` could be a plug or a switch; `media_player` could be a TV) defaults to its
 * most common, least commital member — `climate`, `switch`, `media` — never `heater`/`ac`/`plug`/`tv`, so a wrong guess
 * never silently turns on heater/AC-only UI. Since S7.9 the same applies to a binary_sensor's `occupancy` class: it stays
 * `motion` here (a radar's own presence entity is one too, and a plain occupancy sensor is far more common than a
 * radar), correctable in the device panel; `radar` is never guessed automatically.
 * Nothing here is final: the device panel's own type field corrects any guess.
 */
export function typeForEntity(e: HaData["entities"][number]): DeviceType {
  switch (e.domain) {
    case "light": return "light";
    case "lock": return "lock";
    case "camera": return "camera";
    case "cover": return "cover";
    case "climate": return "climate";
    case "media_player": return "media";
    case "person": case "device_tracker": return "person";
    case "vacuum": return "vacuum";
    case "switch": return e.dc === "outlet" ? "plug" : "switch";
    case "sensor":
      if (e.dc === "temperature") return "temp";
      if (e.dc === "humidity") return "humidity";
      if (e.dc === "battery") return "battery";
      return "other";
    case "binary_sensor":
      if (e.dc === "motion" || e.dc === "occupancy" || e.dc === "presence") return "motion";
      if (e.dc === "door" || e.dc === "window" || e.dc === "garage_door" || e.dc === "opening") return "contact";
      if (e.dc === "vibration") return "vibration";
      return "other";
    default: return "other";
  }
}

/**
 * S8.1: which device types the room panel's Place popup offers from a Home Assistant area, and which it leaves out as
 * noise. Every `DeviceType` is in exactly one list (a test iterates the union, so a new type fails until it is decided).
 * Noise: `other` is anything the plan has no icon of its own for (power, energy, illuminance, signal, a group, a
 * script...); a `battery` is a reading of another device, not a thing in the room; a `person` is not placed by area.
 */
export const AREA_PLACEABLE_TYPES: ReadonlySet<DeviceType> = new Set<DeviceType>(["heater", "light", "switch", "plug", "temp", "humidity", "motion", "contact", "camera", "climate", "ac", "tv", "computer", "media", "cover", "inverter", "server", "access_point", "lock", "vibration", "boiler", "car", "ups", "printer", "speaker", "radar", "vacuum"]);
export const AREA_NOISE_TYPES: ReadonlySet<DeviceType> = new Set<DeviceType>(["other", "battery", "person"]);

/** S8.1: the entities of HA area `area` that are not on the plan yet and that the plan has an icon for. Never throws. */
export function placeableInArea(l: Layout, ha: HaData, area: string): HaData["entities"] {
  return unplacedHaEntities(l, ha).filter((e) => e.area === area && AREA_PLACEABLE_TYPES.has(typeForEntity(e)));
}

/**
 * S4.14: the palette's source list — every HA entity that is neither a device on any floor nor already in
 * `layout.catalog`. Both are "already the plan's", whether or not the device is currently placed (`unplacedCatalog`
 * covers the catalogued-but-unplaced case elsewhere); this only surfaces entities that have never entered the plan at all.
 * Hostile or missing `entities` never throws — an empty list, not a crash.
 */
export function unplacedHaEntities(l: Layout, ha: HaData): HaData["entities"] {
  if (!Array.isArray(ha?.entities)) return [];
  const placed = placedEntities(l), catalogued = new Set(l.catalog.map((c) => c.entity));
  return ha.entities.filter((e) => !placed.has(e.id) && !catalogued.has(e.id));
}

/**
 * S6.7: every HA entity the editor currently knows about, as a `Layout.available` snapshot — written into
 * File, Export's own download so an agent can add and position devices straight from that file, with no HA
 * connection of its own. `room` is filled only when the entity's own area already has a drawn room on this
 * plan; a room can have more than one HA area feeding into it in principle, but this takes the first match, the
 * same "first wins" rule `nameIn`'s callers already use elsewhere. Hostile or missing `entities` never throws.
 */
export function availableEntities(l: Layout, ha: HaData): AvailableEntity[] {
  if (!Array.isArray(ha?.entities)) return [];
  const placed = placedEntities(l);
  const roomByArea = new Map<string, string>();
  for (const f of Object.values(l.floors)) for (const r of f.rooms) if (r.area && !roomByArea.has(r.area)) roomByArea.set(r.area, r.name);
  const out: AvailableEntity[] = [];
  for (const e of ha.entities) {
    if (!e || typeof e.id !== "string") continue;
    const area = typeof e.area === "string" && e.area ? e.area : undefined;
    const areaName = area ? nameIn(ha.areas, area) : undefined;
    const room = area ? roomByArea.get(area) : undefined;
    out.push({
      entity: e.id,
      name: (typeof e.name === "string" && e.name) || e.id,
      domain: e.domain,
      ...(area ? { area } : {}),
      ...(areaName ? { areaName } : {}),
      ...(room ? { room } : {}),
      ...(e.dc ? { dc: e.dc } : {}),
      placed: placed.has(e.id),
    });
  }
  return out;
}

/** S4.7: one row of the room box: an entity in the room's area, and whether it is already drawn on the plan. */
export interface HaBoxRow { id: string; name: string; placed: boolean }

/** S4.7: the room box's five headings, in the order they are shown. */
export interface HaBox { devices: HaBoxRow[]; helpers: HaBoxRow[]; automations: HaBoxRow[]; scripts: HaBoxRow[]; scenes: HaBoxRow[] }

/**
 * S4.7: every entity of HA area `areaId`, grouped for the room box. `automation.*`/`script.*`/`scene.*` are their own headings;
 * `group.*`, any `input_*` domain, and a `switch_as_x` light (told apart by `platform`, since domain alone reads as an ordinary
 * light) are helpers; everything else is a device. Hostile or missing input never throws — an empty box, not a crash.
 */
export function roomHaBox(ha: HaData | undefined, areaId: string, placed: ReadonlySet<string>): HaBox {
  const box: HaBox = { devices: [], helpers: [], automations: [], scripts: [], scenes: [] };
  if (!ha || !Array.isArray(ha.entities) || !areaId) return box;
  for (const e of ha.entities) {
    if (!e || typeof e.id !== "string" || e.area !== areaId) continue;
    const row: HaBoxRow = { id: e.id, name: e.name || e.id, placed: placed.has(e.id) };
    if (e.domain === "automation") box.automations.push(row);
    else if (e.domain === "script") box.scripts.push(row);
    else if (e.domain === "scene") box.scenes.push(row);
    else if (e.domain === "group" || e.domain.startsWith("input_") || (e.domain === "light" && e.platform === "switch_as_x")) box.helpers.push(row);
    else box.devices.push(row);
  }
  const byName = (a: HaBoxRow, b: HaBoxRow) => a.name.localeCompare(b.name);
  for (const rows of Object.values(box)) rows.sort(byName);
  return box;
}

/** What to write to put `entity` in the HA area `area`, or null when it is there, unknown, or `area` is empty. The device moves when the entity is its only one; otherwise the entity alone, so its siblings stay. */
export function areaMove(ha: HaData, entity: string, area: string): { kind: "device" | "entity"; id: string; area: string } | null {
  const e = entity && area ? ha.entities.find((x) => x.id === entity) : undefined;
  if (!e || (e.area ?? "") === area) return null;
  const alone = e.dev && ha.entities.filter((x) => x.dev === e.dev).length === 1;
  return alone ? { kind: "device", id: e.dev!, area } : { kind: "entity", id: e.id, area };
}

const nameIn = (list: { id: string; name: string }[] | undefined, id: unknown): string | undefined => {
  const hit = Array.isArray(list) && typeof id === "string" && id ? list.find((x) => x?.id === id) : undefined;
  return typeof hit?.name === "string" && hit.name ? hit.name : undefined;
};

/**
 * Copies the layout with every linked name refreshed from HA: `floor.title` from the floor `floor.ha` names, `room.name` from
 * the area `room.area` names. A floor with no `ha`, a room with an empty or unknown `area`, and every other field stay as they were.
 * `changed` counts the names that differed. The input is never mutated.
 */
export function applyHaNames(l: Layout, ha: HaData): { layout: Layout; changed: number } {
  const layout = structuredClone(l);
  let changed = 0;
  for (const f of Object.values(layout.floors)) {
    const t = nameIn(ha.floors, f.ha);
    if (t !== undefined && t !== f.title) { f.title = t; changed++; }
    for (const r of f.rooms) {
      const n = nameIn(ha.areas, r.area);
      if (n !== undefined && n !== r.name) { r.name = n; changed++; }
    }
  }
  return { layout, changed };
}

/**
 * S8.5: one row of the merged Add > Device panel — either an unplaced `layout.catalog` entry or an unplaced HA entity
 * that never entered the plan (`unplacedHaEntities`), the same two sources the old "Device" and "Entities" submenus
 * drew from separately. `key` is unique across both sources. `area` is the HA area's own name; `room` is a plan room's
 * name — the room whose `area` matches the entity's HA area, on any floor, else (catalog only) the catalog entry's own
 * `room` field; `floor` is that room's plan floor, filled only when the room was found through the HA area match (a
 * catalog entry's own stored `floor` key is not read here — `placeDevice` already knows it and switches there itself).
 */
export interface AddCandidate {
  key: string;
  source: "catalog" | "ha";
  id: string;
  entity: string;
  name: string;
  type: DeviceType;
  floor?: string;
  room?: string;
  area?: string;
}

/** S8.5: where an entity sits on the plan — its HA area's name, the plan room drawn for that area (any floor), and that room's floor. */
function locateEntity(l: Layout, ha: HaData | null, entityId: string, fallbackRoom?: string): { area?: string; room?: string; floor?: string } {
  const he = ha?.entities.find((e) => e?.id === entityId);
  const areaId = typeof he?.area === "string" && he.area ? he.area : undefined;
  const areaName = areaId ? nameIn(ha?.areas, areaId) : undefined;
  if (areaId) {
    for (const [key, f] of Object.entries(l.floors)) {
      const room = f.rooms.find((r) => r.area === areaId);
      if (room) return { ...(areaName ? { area: areaName } : {}), room: room.name, floor: f.title || key };
    }
  }
  return { ...(areaName ? { area: areaName } : {}), ...(fallbackRoom ? { room: fallbackRoom } : {}) };
}

/**
 * S8.5: the merged source list for the Add > Device panel — every unplaced catalog entry plus every unplaced HA
 * entity, with no entity twice (a catalog entry wins, matching `unplacedHaEntities`'s own exclusion of catalogued
 * entities). `ha` null (standalone, or before the panel has loaded it) still returns the catalog half.
 */
export function addCandidates(l: Layout, ha: HaData | null): AddCandidate[] {
  const out: AddCandidate[] = [];
  for (const c of unplacedCatalog(l)) {
    out.push({ key: `catalog:${c.id}`, source: "catalog", id: c.id, entity: c.entity, name: c.name, type: c.type, ...locateEntity(l, ha, c.entity, c.room || undefined) });
  }
  if (ha) {
    for (const e of unplacedHaEntities(l, ha)) {
      out.push({ key: `ha:${e.id}`, source: "ha", id: e.id, entity: e.id, name: e.name || e.id, type: typeForEntity(e), ...locateEntity(l, ha, e.id) });
    }
  }
  return out;
}
