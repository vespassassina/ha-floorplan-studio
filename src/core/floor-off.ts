import type { Device, DeviceType, Floor } from "./schema";
import type { StateOverlay } from "./render";
import type { ThingRef } from "./active";
import type { SceneCall } from "./room-scenes";
import { nameFor } from "./active";
import { lampOffEntities } from "./room-info";
import { stateOf } from "./readings";
import { pieceDevice } from "./solids";

/**
 * S24.8 (C2): "Turn off on this floor…". The card's room button turns off lights only ("Lights off"); this lists what else
 * is on, so a person ticks what goes and confirms once. Pure, no DOM. Every input is untrusted (finding 1): a malformed
 * floor or state lists nothing, never throws.
 */

export type OffGroup = "lights" | "switches" | "plugs" | "media";
export const OFF_GROUPS: readonly OffGroup[] = ["lights", "switches", "plugs", "media"];
export const OFF_GROUP_LABEL: Record<OffGroup, string> = { lights: "Lights", switches: "Switches", plugs: "Plugs", media: "Media" };

/** Which group a type's row goes in, or null: not offered. A heater, a cover or a vacuum is not "off" in one tap, and a
 *  sensor cannot be turned off. Every type is a decision (finding 17); a test iterates `DEVICE_TYPES`. */
export const FLOOR_OFF_GROUP: Record<DeviceType, OffGroup | null> = {
  light: "lights", switch: "switches", plug: "plugs", tv: "media", media: "media", speaker: "media",
  heater: null, temp: null, humidity: null, motion: null, contact: null, camera: null, climate: null, ac: null, computer: null,
  cover: null, battery: null, inverter: null, server: null, access_point: null, lock: null, vibration: null, other: null,
  boiler: null, car: null, ups: null, printer: null, person: null, radar: null, vacuum: null, siren: null, alarm: null,
};

/** One thing to tick. `entities` is what it turns off: a lamp's light and its bound relay when on (`lampOffEntities`),
 *  else the device's own entity. `entity` is the device's own. `via` names the relay a lamp goes off with. */
export interface OffRow { group: OffGroup; name: string; entity: string; entities: string[]; via?: string; at: ThingRef }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
/** On for turning off: anything live that is not off. A paused speaker or an idle TV is on; it has something to turn off. */
const OFFISH = new Set(["off", "standby", "unavailable", "unknown", ""]);
const isOn = (state: StateOverlay | undefined, e: string) => { const s = stateOf(state, e); return !!s && typeof s.state === "string" && !OFFISH.has(s.state); };

/** The rows of `f` that are on, by group (`OFF_GROUPS` order), then in layout order: devices, then linked pieces. An entity
 *  listed once in a group is not listed again there. */
export function floorOffRows(f: Floor, state: StateOverlay | undefined): OffRow[] {
  if (!isObj(f)) return [];
  const rows: OffRow[] = [];
  const add = (d: Device, at: ThingRef) => {
    const group = typeof d.type === "string" && Object.hasOwn(FLOOR_OFF_GROUP, d.type) ? FLOOR_OFF_GROUP[d.type] : null;
    if (!group || typeof d.entity !== "string" || !d.entity) return;
    if (rows.some((r) => r.group === group && r.entities.includes(d.entity))) return;
    const entities = group === "lights" ? lampOffEntities(d, state) : isOn(state, d.entity) ? [d.entity] : [];
    if (!entities.length) return;
    const relay = entities.find((e) => e !== d.entity);
    const friendly = relay ? stateOf(state, relay)?.attributes?.friendly_name : undefined;
    rows.push({ group, name: nameFor(d, state), entity: d.entity, entities, ...(relay ? { via: typeof friendly === "string" && friendly ? friendly : relay } : {}), at });
  };
  (Array.isArray(f.devices) ? f.devices : []).forEach((d, index) => { if (isObj(d)) add(d, { what: "device", index }); });
  (Array.isArray(f.furniture) ? f.furniture : []).forEach((m, index) => {
    const d = isObj(m) ? pieceDevice(m) : null;
    if (d && !rows.some((r) => r.entities.includes(d.entity))) add(d, { what: "piece", index });
  });
  return OFF_GROUPS.flatMap((g) => rows.filter((r) => r.group === g));
}

const DOMAINS = ["light", "switch", "media_player"];

/** The calls for the ticked rows: one `turn_off` per domain over their entities, each once, in the card's call shape
 *  (`presetCalls`). A `light.*` to `light`, a `switch.*` to `switch`, a `media_player.*` to `media_player`; anything else
 *  (an `input_boolean` relay, a `fan` as a light) to `homeassistant`. */
export function floorOffCalls(rows: readonly { entities: readonly string[] }[]): SceneCall[] {
  const by = new Map<string, string[]>([...DOMAINS, "homeassistant"].map((d) => [d, []]));
  const seen = new Set<string>();
  for (const r of rows) for (const e of r.entities) {
    if (seen.has(e)) continue;
    seen.add(e);
    const d = e.split(".")[0] ?? "";
    by.get(DOMAINS.includes(d) ? d : "homeassistant")!.push(e);
  }
  return [...by].filter(([, ids]) => ids.length).map(([domain, ids]) => ({ domain, service: "turn_off", data: { entity_id: ids } }));
}
