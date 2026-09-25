import type { AvailableEntity, Device, DeviceType, Layout } from "./schema";
import { placedEntities, unplacedCatalog } from "./bind";

/** What the host (the HA panel) knows about Home Assistant and hands to the editor. Standalone there is none. */
export interface HaData {
  floors: { id: string; name: string }[];
  areas: { id: string; name: string; floor_id?: string }[];
  /** S8.6: the HA device registry, one row per physical device — used to label a device row in the Add list and the
   * Place popup, and to group an already-placed device's entity picker. Absent on an older HA or a failed registry
   * call; every device-grouping function then falls back to the entity's own name. */
  devices?: { id: string; name: string; area?: string | null }[];
  /** `area` is the HA area id the entity sits in (its own, else its device's), null for none. `dc` is its device class, when it has one.
   * `members` (S4.5) is a `group.*` entity's own `entity_id` list, from its state attributes; absent on everything else.
   * `platform` (S4.7) is the integration that owns the entity (from the entity registry), used to tell a `switch_as_x` light
   * apart from a physical one. `uid` (S4.7) is an automation or script's own registry `unique_id`, the id its HA editor URL takes.
   * `cat` (S8.6) is the entity's `entity_category` — "config" or "diagnostic" for a helper entity a device owns
   * (a plug's connectivity sensor, a light's signal strength), absent on a device's primary entity. */
  entities: { id: string; name: string; domain: string; area?: string | null; dc?: string; /** the HA device it belongs to */ dev?: string; members?: string[]; platform?: string; uid?: string; cat?: string | null }[];
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
 * S8.6: which HA devices already have an entity on the plan or in the catalog — a device counts as placed when ANY
 * of its entities does, not only the one `mainEntity` would pick, so a plug placed through its switch does not
 * reappear through its power sensor once that sensor becomes the ranked "main" of a differently-ordered group.
 */
function placedDeviceIds(l: Layout, ha: HaData): Set<string> {
  const placed = placedEntities(l), catalogued = new Set(l.catalog.map((c) => c.entity));
  const ids = new Set<string>();
  for (const e of ha.entities ?? []) if (e?.dev && (placed.has(e.id) || catalogued.has(e.id))) ids.add(e.dev);
  return ids;
}

/** S8.6: a device-registry name lookup, `id => name`, for every function that labels a device row. */
function deviceNames(ha: HaData): Map<string, string> {
  return new Map((ha.devices ?? []).map((d) => [d.id, d.name]));
}

/** S8.6: a device row's own display copy of its main entity — same id, `name` swapped for the device registry's name when there is one, so a device row reads "Kitchen plug", not the switch entity's own name, wherever HA happens to differ. */
function asDeviceRow(main: HaData["entities"][number], nameOf: Map<string, string>): HaData["entities"][number] {
  const name = (main.dev && nameOf.get(main.dev)) || main.name || main.id;
  return name === main.name ? main : { ...main, name };
}

/** S8.6: `entities`, grouped by `dev` ("" for none, kept apart from real ids by the caller never looking it up). */
function byDevice(entities: HaData["entities"]): Map<string, HaData["entities"]> {
  const groups = new Map<string, HaData["entities"]>();
  for (const e of entities) {
    if (!e?.dev) continue;
    if (!groups.has(e.dev)) groups.set(e.dev, []);
    groups.get(e.dev)!.push(e);
  }
  return groups;
}

const DOMAIN_PRIORITY = ["light", "switch", "climate", "cover", "fan", "lock", "media_player", "vacuum", "camera", "binary_sensor", "sensor"];

/**
 * S8.6: "devices, not entities" — the one entity that best represents an HA device, for every list that adds a new
 * icon to the plan from a raw HA entity (the Add panel, the Place popup, a room's "Add device from" menu). `entities`
 * is every entity of ONE device; grouping by `dev` is the caller's job, this never groups.
 * 1. Any entity with a truthy `cat` (`entity_category`: "config" or "diagnostic") is dropped first — this is what
 *    hides a plug's network/signal diagnostic sensor and a multisensor's own battery reading.
 * 2. Nothing left: returns undefined. A device whose entities are all diagnostic or config gets no row; it has
 *    nothing of its own to show.
 * 3. The rest are ranked by domain: light > switch > climate > cover > fan > lock > media_player > vacuum > camera >
 *    binary_sensor > sensor > everything else (a domain this list does not know sits at the tail, in the order it
 *    is first seen).
 * 4. Tiebreak within the same domain rank: the entity whose `name` equals `deviceName` wins (when given, from the
 *    HA device registry); else the entity with the shortest id; else the first one encountered — every sort here is
 *    stable, so a genuine tie keeps encounter order.
 */
export function mainEntity(entities: HaData["entities"], deviceName?: string): HaData["entities"][number] | undefined {
  const live = entities.filter((e) => e && !e.cat);
  if (!live.length) return undefined;
  const rank = (e: HaData["entities"][number]) => { const i = DOMAIN_PRIORITY.indexOf(e.domain); return i === -1 ? DOMAIN_PRIORITY.length : i; };
  const best = Math.min(...live.map(rank));
  const tied = live.filter((e) => rank(e) === best);
  if (tied.length === 1) return tied[0];
  const named = deviceName ? tied.find((e) => e.name === deviceName) : undefined;
  if (named) return named;
  return [...tied].sort((a, b) => a.id.length - b.id.length)[0];
}

/** S8.6: one main entity per HA device, across the whole of `ha.entities` — the source map every device-grouped list builds from. Devices with no dev field on any entity, or whose every entity is diagnostic/config, have no entry. */
export function mainEntitiesByDevice(ha: HaData): Map<string, HaData["entities"][number]> {
  const out = new Map<string, HaData["entities"][number]>();
  if (!Array.isArray(ha?.entities)) return out;
  const nameOf = new Map((ha.devices ?? []).map((d) => [d.id, d.name]));
  for (const [devId, ents] of byDevice(ha.entities)) {
    const main = mainEntity(ents, nameOf.get(devId));
    if (main) out.set(devId, main);
  }
  return out;
}

/**
 * S8.6: `placeableInArea`, grouped by device — one row per HA device (its main entity), plus the area's device-less
 * entities exactly as `placeableInArea` already returns them. A device counts as placed, and a device's row is
 * offered, by its main entity's own `typeForEntity`/`AREA_PLACEABLE_TYPES` rule.
 */
export function placeableDevicesInArea(l: Layout, ha: HaData, area: string): HaData["entities"] {
  if (!Array.isArray(ha?.entities) || !area) return [];
  const deviceless = placeableInArea(l, { ...ha, entities: ha.entities.filter((e) => !e?.dev) }, area);
  const placedDevs = placedDeviceIds(l, ha);
  const nameOf = deviceNames(ha);
  const devRows: HaData["entities"] = [];
  for (const [devId, ents] of byDevice(ha.entities.filter((e) => e?.area === area))) {
    if (placedDevs.has(devId)) continue;
    const main = mainEntity(ents, nameOf.get(devId));
    if (main && AREA_PLACEABLE_TYPES.has(typeForEntity(main))) devRows.push(asDeviceRow(main, nameOf));
  }
  return [...devRows, ...deviceless];
}

/**
 * S8.6: every unplaced entity of HA area `area`, one row per device (main entity) plus device-less entities as
 * themselves — the room right-click "Add device from <room>" menu's own source list, which unlike `placeableInArea`
 * keeps every type, noise included (that menu has always shown everything the area has, `placeArea`'s popup is the
 * one that filters noise). Placed is checked against `placedEntities` alone, matching this menu's own history —
 * unlike the Add panel's device rows, it has never excluded a merely catalogued entity.
 */
export function unplacedDevicesInArea(l: Layout, ha: HaData | undefined, area: string | undefined): HaData["entities"] {
  if (!ha || !Array.isArray(ha.entities) || !area) return [];
  const placed = placedEntities(l);
  const loose: HaData["entities"] = [];
  const withDev: HaData["entities"] = [];
  for (const e of ha.entities) {
    if (!e || typeof e.id !== "string" || e.area !== area || placed.has(e.id)) continue;
    (e.dev ? withDev : loose).push(e);
  }
  const nameOf = deviceNames(ha);
  const devRows: HaData["entities"] = [];
  for (const [devId, ents] of byDevice(withDev)) {
    if (ha.entities.some((x) => x?.dev === devId && placed.has(x.id))) continue; // any sibling placed: the device already is
    const main = mainEntity(ents, nameOf.get(devId));
    if (main) devRows.push(asDeviceRow(main, nameOf));
  }
  return [...loose, ...devRows];
}

/**
 * S8.5/S8.6: one row of the merged Add > Device panel — either an unplaced `layout.catalog` entry, an unplaced
 * device-less HA entity (`unplacedHaEntities`), or one row per unplaced HA device (its main entity, `mainEntity`),
 * the same "devices, not entities" rule as the Place popup and the room menu. `key` is unique across all three:
 * `catalog:<id>`, `ha:<entityId>` for a device-less entity, `ha-dev:<deviceId>` for a device row — `id` is the
 * device id there, `entity` its main entity's id, `name` the device registry's name (its main entity's own name,
 * failing that). `area` is the HA area's own name; `room` is a plan room's name — the room whose `area` matches the
 * entity's HA area, on any floor, else (catalog only) the catalog entry's own `room` field; `floor` is that room's
 * plan floor, filled only when the room was found through the HA area match (a catalog entry's own stored `floor`
 * key is not read here — `placeDevice` already knows it and switches there itself).
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
    for (const e of unplacedHaEntities(l, ha).filter((e) => !e.dev)) {
      out.push({ key: `ha:${e.id}`, source: "ha", id: e.id, entity: e.id, name: e.name || e.id, type: typeForEntity(e), ...locateEntity(l, ha, e.id) });
    }
    const placedDevs = placedDeviceIds(l, ha);
    const nameOf = new Map((ha.devices ?? []).map((d) => [d.id, d.name]));
    for (const [devId, main] of mainEntitiesByDevice(ha)) {
      if (placedDevs.has(devId)) continue;
      const name = nameOf.get(devId) || main.name || main.id;
      out.push({ key: `ha-dev:${devId}`, source: "ha", id: devId, entity: main.id, name, type: typeForEntity(main), ...locateEntity(l, ha, main.id) });
    }
  }
  return out;
}

/**
 * S8.7: the HA floor id(s) that plan floor `floorKey` maps to — every `floor_id` of an HA area that one of this
 * floor's own rooms already carries (`room.area`). A plan floor with no room linked to an area, or whose areas are
 * not themselves on an HA floor, maps to nothing; a candidate is then never offered by area/floor alone (it can
 * still be offered through the catalog, which is plan-floor-scoped already).
 */
function haFloorIdsForPlanFloor(l: Layout, ha: HaData, floorKey: string): Set<string> {
  const ids = new Set<string>();
  const floor = l.floors[floorKey];
  if (!floor) return ids;
  const floorIdOfArea = new Map((ha.areas ?? []).map((a) => [a.id, a.floor_id]));
  for (const r of floor.rooms) {
    const fid = r.area ? floorIdOfArea.get(r.area) : undefined;
    if (fid) ids.add(fid);
  }
  return ids;
}

/** S8.7: lowercase `name`, split on runs of non-alphanumeric characters, drop generic stopwords. Used to score a switch's name against a light's own. */
const NAME_STOPWORDS = new Set(["switch", "plug", "socket", "relay", "the", "and", "of"]);
function nameTokens(name: string): Set<string> {
  return new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !NAME_STOPWORDS.has(t)));
}

/** S8.7: one row of `switchChoicesForLight` — a switch or plug the light panel may bind `bound` to. */
export interface SwitchChoice { entity: string; name: string; area?: string; room?: string; suggested: boolean; source: "catalog" | "ha" }

/**
 * S8.7: the switches and plugs offered to power light `light` on plan floor `floorKey` — restricted to that floor
 * (maintainer feedback: "only show the floor related switches"), unlike the all-floors `bindChoices` it replaces on
 * the light panel. Candidates are the union of: this floor's own catalogued switch/plug entries, and, when `ha` is
 * given, every HA switch-domain entity that is a device's main entity (`mainEntitiesByDevice`, so a plug's siblings
 * don't each get their own row), has no `entity_category`, and sits in an HA area that is on the HA floor(s)
 * `haFloorIdsForPlanFloor` maps this plan floor to. Without `ha`, only the catalog half is offered. The light's
 * current `bound` value, if any, is always included even when it would not otherwise qualify (off-floor or
 * unplaced) — the field must always be able to show what it is already set to.
 *
 * Scoring (folded in here rather than a separate function, so a caller need not re-walk the candidate list to
 * apply it): a candidate is `suggested` only when its own HA area equals the light's own HA area, it scores at
 * least 1 shared name token with the light (lowercased, split on non-alphanumeric runs, stopwords dropped), and it
 * is the unique top scorer there. Being the sole switch/plug candidate in the area is never enough by itself
 * (Opus review, finding 4): a wrong guess is worse than no guess, and a lone candidate with nothing in common with
 * the light's name is still a guess. A tie at the top, among more than one candidate, suggests nobody.
 */
export function switchChoicesForLight(l: Layout, ha: HaData | null, floorKey: string, light: Device): SwitchChoice[] {
  const out: SwitchChoice[] = [];
  const seen = new Set<string>();
  const f = l.floors[floorKey];
  const areaOf = (entity: string): string | undefined => ha?.entities.find((e) => e?.id === entity)?.area ?? undefined;
  const nameOf = (entity: string): string => ha?.entities.find((e) => e?.id === entity)?.name || l.catalog.find((c) => c.entity === entity)?.name || entity;
  /** The plan room name for an HA area — this floor's own rooms first (the common case), any floor's otherwise (an off-floor `bound` value, so its room still reads sensibly). */
  const roomOf = (areaId: string | undefined, fallbackCatalogRoom?: string): string | undefined => {
    if (fallbackCatalogRoom) return fallbackCatalogRoom;
    if (!areaId) return undefined;
    for (const fl of [f, ...Object.values(l.floors)]) {
      const r = fl?.rooms.find((r) => r.area === areaId);
      if (r) return r.name;
    }
    return undefined;
  };
  const add = (entity: string, name: string, area: string | undefined, room: string | undefined) => {
    if (!entity || entity === light.entity || seen.has(entity)) return;
    seen.add(entity);
    out.push({ entity, name, area, room, suggested: false, source: ha?.entities.some((e) => e?.id === entity) ? "ha" : "catalog" });
  };
  for (const c of l.catalog) {
    if (c.floor === floorKey && (c.type === "switch" || c.type === "plug")) add(c.entity, c.name, areaOf(c.entity), c.room || undefined);
  }
  if (ha) {
    const floorIds = haFloorIdsForPlanFloor(l, ha, floorKey);
    const floorIdOfArea = new Map((ha.areas ?? []).map((a) => [a.id, a.floor_id]));
    const onFloor = (main: HaData["entities"][number]) => {
      if (main.domain !== "switch" || main.cat) return;
      const areaId = main.area ?? undefined;
      const fid = areaId ? floorIdOfArea.get(areaId) : undefined;
      if (!fid || !floorIds.has(fid)) return;
      add(main.id, main.name || main.id, areaId, roomOf(areaId));
    };
    // Device-grouped switches (one row per device, S8.6's mainEntity), plus device-less switch entities — mirrors
    // addCandidates's own split, since mainEntitiesByDevice only sees entities that carry a `dev` field.
    for (const main of mainEntitiesByDevice(ha).values()) onFloor(main);
    for (const e of ha.entities) if (e && !e.dev) onFloor(e);
  }
  if (light.bound) add(light.bound, nameOf(light.bound), areaOf(light.bound), roomOf(areaOf(light.bound), l.catalog.find((c) => c.entity === light.bound)?.room));

  const lightArea = areaOf(light.entity);
  if (lightArea) {
    const group = out.filter((s) => s.area === lightArea);
    // Opus review (finding 4): being the only candidate in the area is not, on its own, reason to suggest it — a
    // score of at least 1 shared name token is required even when there is nothing else to compare it to.
    if (group.length >= 1) {
      const lightName = light.name || light.entity;
      const lightTokens = nameTokens(lightName);
      const scored = group.map((s) => ({ s, score: [...nameTokens(s.name)].filter((t) => lightTokens.has(t)).length }));
      const max = Math.max(...scored.map((x) => x.score));
      const top = scored.filter((x) => x.score === max);
      if (max >= 1 && top.length === 1) top[0].s.suggested = true;
    }
  }
  return out;
}
