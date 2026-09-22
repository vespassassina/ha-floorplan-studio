import type { DeviceType, Layout } from "./schema";
import { placedEntities } from "./bind";

/** What the host (the HA panel) knows about Home Assistant and hands to the editor. Standalone there is none. */
export interface HaData {
  floors: { id: string; name: string }[];
  areas: { id: string; name: string; floor_id?: string }[];
  /** `area` is the HA area id the entity sits in (its own, else its device's), null for none. `dc` is its device class, when it has one. */
  entities: { id: string; name: string; domain: string; area?: string | null; dc?: string; /** the HA device it belongs to */ dev?: string }[];
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
 * classes) map straight across. A domain that is genuinely ambiguous under the forward rules (`climate` could be a plain
 * thermostat, a heater's TRV or an AC; `switch` could be a plug or a switch; `media_player` could be a TV) defaults to its
 * most common, least commital member — `climate`, `switch`, `media` — never `heater`/`ac`/`plug`/`tv`, so a wrong guess
 * never silently turns on heater/AC-only UI. Nothing here is final: the device panel's own type field corrects any guess.
 */
export function typeForEntity(e: HaData["entities"][number]): DeviceType {
  switch (e.domain) {
    case "light": return "light";
    case "lock": return "lock";
    case "camera": return "camera";
    case "cover": return "cover";
    case "climate": return "climate";
    case "media_player": return "media";
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
