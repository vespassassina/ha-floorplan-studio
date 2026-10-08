import { SCENE_DOMAINS } from "./schema";
import type { Device, Floor, Room, RoomScene, SceneItem } from "./schema";
import { lampOffEntities, roomSummary } from "./room-info";
import type { StateOverlay } from "./render";

// S14.7: room scenes (docs/specs/card-polish-and-light.md, item 19). Pure rules, no DOM: which scenes a room offers and which
// service calls each one makes. Every input is untrusted (CLAUDE.md finding 1): a malformed room, scene or hass reads as
// "nothing here", never a throw.

/** `states` is the overlay the card renders from; `entities` and `devices` are the frontend's registry copies (see `Hass` in the card). */
export interface SceneHass {
  states?: Record<string, { state?: string; attributes?: Record<string, unknown> } | undefined>;
  entities?: Record<string, { area_id?: string | null; device_id?: string | null } | undefined>;
  devices?: Record<string, { area_id?: string | null } | undefined>;
}
export interface HaSceneRow { entity: string; name: string }
export interface SceneCall { domain: string; service: string; data: Record<string, unknown> }
export interface RoomSceneMenu { ha: HaSceneRow[]; custom: { id: string; name: string; confirm: boolean }[]; lights: string[] }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isScene = (e: unknown): e is string => typeof e === "string" && e.startsWith("scene.");
const MAX_HA_SCENES = 30;

/** The area a scene entity sits in: its own, else its device's. Hue scenes take the second way. */
function areaOf(hass: SceneHass, entity: string): string | null {
  const reg = isObj(hass.entities) ? hass.entities[entity] : undefined;
  if (!isObj(reg)) return null;
  if (typeof reg.area_id === "string" && reg.area_id) return reg.area_id;
  const dev = typeof reg.device_id === "string" && isObj(hass.devices) ? hass.devices[reg.device_id] : undefined;
  return isObj(dev) && typeof dev.area_id === "string" && dev.area_id ? dev.area_id : null;
}

/** The `scene.*` entities of a room: those in its Home Assistant area (by the entity, else its device) and those named in its `haScenes`, once each, by name. */
export function haScenesFor(room: Room | null | undefined, hass: SceneHass | null | undefined): HaSceneRow[] {
  if (!isObj(room) || !isObj(hass) || !isObj(hass.states)) return [];
  const states = hass.states;
  const area = typeof room.area === "string" ? room.area : "";
  const picked = new Set<string>(Array.isArray(room.haScenes) ? room.haScenes.filter(isScene) : []);
  if (area) for (const e of Object.keys(states)) if (isScene(e) && areaOf(hass, e) === area) picked.add(e);
  const rows: HaSceneRow[] = [];
  for (const e of picked) {
    const s = states[e];
    if (!isObj(s)) continue; // Home Assistant no longer has it
    const friendly = isObj(s.attributes) ? s.attributes.friendly_name : undefined;
    rows.push({ entity: e, name: typeof friendly === "string" && friendly ? friendly : e });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.entity.localeCompare(b.entity)).slice(0, MAX_HA_SCENES);
}

/** What a custom scene asks of Home Assistant: the calls for each listed device, with only the fields it sets. A type outside `SCENE_DOMAINS` is ignored. */
export function customCalls(scene: RoomScene | null | undefined): SceneCall[] {
  if (!isObj(scene) || !Array.isArray(scene.items)) return [];
  const calls: SceneCall[] = [];
  for (const it of scene.items as unknown[]) {
    if (!isObj(it) || typeof it.entity !== "string") continue;
    const domain = it.entity.split(".")[0] as string;
    if (!(SCENE_DOMAINS as readonly string[]).includes(domain)) continue;
    const id = { entity_id: it.entity };
    const add = (service: string, extra: Record<string, unknown> = {}) => calls.push({ domain, service, data: { ...id, ...extra } });
    if (it.on !== true) { add(domain === "cover" ? "close_cover" : "turn_off"); continue; }
    switch (domain) {
      case "cover": if (fin(it.position)) add("set_cover_position", { position: it.position }); else add("open_cover"); break;
      case "climate": {
        const hvac = typeof it.hvac === "string" && it.hvac, t = fin(it.temperature);
        if (hvac) add("set_hvac_mode", { hvac_mode: it.hvac });
        if (t) add("set_temperature", { temperature: it.temperature });
        if (!hvac && !t) add("turn_on");
        break;
      }
      case "media_player":
        add("turn_on");
        if (fin(it.volume)) add("volume_set", { volume_level: it.volume / 100 });
        if (typeof it.source === "string" && it.source) add("select_source", { source: it.source });
        break;
      default: {
        const extra: Record<string, unknown> = {};
        if (domain === "light") {
          if (fin(it.brightness)) extra.brightness_pct = it.brightness;
          if (fin(it.kelvin)) extra.color_temp_kelvin = it.kelvin;
          if (Array.isArray(it.hs) && fin(it.hs[0]) && fin(it.hs[1])) extra.hs_color = [it.hs[0], it.hs[1]];
        } else if (domain === "fan" && fin(it.percentage)) extra.percentage = it.percentage;
        add("turn_on", extra);
      }
    }
  }
  return calls;
}

/** S14.2's rule: turning anything but a light OFF asks first. A custom scene that turns a switch, fan, climate or player off does; closing a cover does not. */
export function sceneNeedsConfirm(scene: RoomScene | null | undefined): boolean {
  return customCalls(scene).some((c) => c.service === "turn_off" && c.domain !== "light");
}

/** The All off / All on presets: one call per domain over the room's lights; none when it has none. Each entity goes to its own domain's service: a `light.*` to `light`, a `switch.*` to `switch`, anything else to `homeassistant` (a `group` or a fan has no `turn_on` of its own, or not a shared one). Lights only, so no confirm (Diego's spec: "lights only, no confirm"). */
export function presetCalls(which: "on" | "off", lights: string[]): SceneCall[] {
  const service = which === "on" ? "turn_on" : "turn_off";
  const by: Record<string, string[]> = { light: [], switch: [], homeassistant: [] };
  for (const e of lights) {
    const d = e.split(".")[0] ?? "";
    (by[d === "light" || d === "switch" ? d : "homeassistant"] as string[]).push(e);
  }
  return Object.entries(by).filter(([, ids]) => ids.length).map(([domain, ids]) => ({ domain, service, data: { entity_id: ids } }));
}

/** S22.1: Turn off on one lamp's popup: `presetCalls` over `lampOffEntities`, so a relay goes to `switch.turn_off` (or
 *  `homeassistant.turn_off` for another domain) next to the light's own `light.turn_off`. No calls for a lamp drawn off. */
export function lampOffCalls(d: Device, state: StateOverlay | undefined): SceneCall[] {
  return presetCalls("off", lampOffEntities(d, state));
}

/** What the Room section lists for `f.rooms[index]`. All three empty: show no scene section. */
export function roomScenes(f: Floor, index: number, hass: SceneHass | null | undefined): RoomSceneMenu {
  const room = Number.isInteger(index) ? f.rooms[index] : undefined;
  if (!isObj(room)) return { ha: [], custom: [], lights: [] };
  const custom = (Array.isArray(room.scenes) ? room.scenes : []).flatMap((s: unknown) =>
    isObj(s) && typeof s.id === "string" && s.id && typeof s.name === "string" && s.name.trim() ? [{ id: s.id, name: s.name, confirm: sceneNeedsConfirm(s as unknown as RoomScene) }] : []);
  const lights = [...new Set((roomSummary(f, index, undefined, {})?.devices ?? []).filter((d) => d.type === "light").map((d) => d.entity))];
  return { ha: haScenesFor(room, hass), custom, lights };
}

/** The scene `id` of room `index`, or undefined. */
export function customScene(f: Floor, index: number, id: string): RoomScene | undefined {
  const list = f.rooms[index]?.scenes;
  return Array.isArray(list) ? list.find((s) => isObj(s) && s.id === id) : undefined;
}

export type { SceneItem };
