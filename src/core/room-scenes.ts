import type { Floor, Room, RoomScene, SceneItem } from "./schema";
import { roomSummary } from "./room-info";

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

/** What a custom scene asks of Home Assistant: one call per light or switch it lists, with only the fields it sets. */
export function customCalls(scene: RoomScene | null | undefined): SceneCall[] {
  if (!isObj(scene) || !Array.isArray(scene.items)) return [];
  const calls: SceneCall[] = [];
  for (const it of scene.items as unknown[]) {
    if (!isObj(it) || typeof it.entity !== "string") continue;
    const domain = it.entity.split(".")[0];
    if (domain !== "light" && domain !== "switch") continue;
    if (it.on !== true) { calls.push({ domain, service: "turn_off", data: { entity_id: it.entity } }); continue; }
    const data: Record<string, unknown> = { entity_id: it.entity };
    if (domain === "light") {
      if (fin(it.brightness)) data.brightness_pct = it.brightness;
      if (fin(it.kelvin)) data.color_temp_kelvin = it.kelvin;
      if (Array.isArray(it.hs) && fin(it.hs[0]) && fin(it.hs[1])) data.hs_color = [it.hs[0], it.hs[1]];
    }
    calls.push({ domain, service: "turn_on", data });
  }
  return calls;
}

/** S14.2's rule: turning anything but a light OFF asks first. A custom scene that turns a switch off does. */
export function sceneNeedsConfirm(scene: RoomScene | null | undefined): boolean {
  return customCalls(scene).some((c) => c.service === "turn_off" && c.domain !== "light");
}

/** The All off / All on presets: one call over the room's lights; none when it has none. Lights only, so no confirm (Diego's spec: "lights only, no confirm"). */
export function presetCalls(which: "on" | "off", lights: string[]): SceneCall[] {
  return lights.length ? [{ domain: "light", service: which === "on" ? "turn_on" : "turn_off", data: { entity_id: [...lights] } }] : [];
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
