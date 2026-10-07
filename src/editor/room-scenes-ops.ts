import { MAX_ROOM_SCENES, MAX_SCENE_ITEMS, SCENE_DOMAINS, roomSummary } from "../core";
import type { Floor, Room, RoomScene, SceneItem } from "../core";

// S14.7: writers for a room's custom scenes and its explicit Home Assistant scene list. Each mutates the room it is given
// (call them inside `EditorState.edit`, one gesture, one undo step) and returns whether it changed anything. One writer per
// field, so no combination of picks can make a layout `validate` refuses (CLAUDE.md finding 12).

const MAX_NAME = 60;
const MAX_HA_SCENES = MAX_ROOM_SCENES * 4;
const LIGHT_OR_SWITCH = /^(light|switch)\./;
const SCENE_ENTITY = new RegExp(`^(${SCENE_DOMAINS.join("|")})\\.`);

/** What a scene may set: the devices of a scene type (`SCENE_DOMAINS`) whose icon is inside the room, once each. */
export function roomSceneTargets(f: Floor, roomIndex: number): { entity: string; name: string }[] {
  const seen = new Set<string>();
  const out: { entity: string; name: string }[] = [];
  for (const d of roomSummary(f, roomIndex, undefined, {})?.devices ?? []) {
    if (!SCENE_ENTITY.test(d.entity) || seen.has(d.entity)) continue;
    seen.add(d.entity);
    out.push({ entity: d.entity, name: d.name });
  }
  return out;
}

const find = (r: Room, id: string): RoomScene | undefined => r.scenes?.find((s) => s.id === id);

/** A new scene named "Scene N" with `entities` switched on (only light and switch ids are kept). False at the cap, and false when none is left: a scene with nothing in it does nothing, so none is made. */
export function addScene(r: Room, entities: string[]): boolean {
  const list = r.scenes ?? [];
  if (list.length >= MAX_ROOM_SCENES) return false;
  const items: SceneItem[] = [...new Set(entities.filter((e) => LIGHT_OR_SWITCH.test(e)))].slice(0, MAX_SCENE_ITEMS).map((entity) => ({ entity, on: true }));
  if (!items.length) return false;
  let n = list.length + 1;
  while (list.some((s) => s.id === `scene-${n}` || s.name === `Scene ${n}`)) n++;
  r.scenes = [...list, { id: `scene-${n}`, name: `Scene ${n}`, items }];
  return true;
}

export function removeScene(r: Room, id: string): boolean {
  if (!find(r, id)) return false;
  r.scenes = r.scenes!.filter((s) => s.id !== id);
  if (!r.scenes.length) delete r.scenes;
  return true;
}

/** Trims; an empty name or the same name changes nothing. */
export function renameScene(r: Room, id: string, name: string): boolean {
  const s = find(r, id), t = name.trim().slice(0, MAX_NAME);
  if (!s || !t || s.name === t) return false;
  s.name = t;
  return true;
}

export function addSceneItem(r: Room, id: string, entity: string): boolean {
  const s = find(r, id);
  if (!s || !SCENE_ENTITY.test(entity) || s.items.some((i) => i.entity === entity) || s.items.length >= MAX_SCENE_ITEMS) return false;
  s.items.push({ entity, on: true });
  return true;
}

export function removeSceneItem(r: Room, id: string, entity: string): boolean {
  const s = find(r, id);
  if (!s || !s.items.some((i) => i.entity === entity)) return false;
  s.items = s.items.filter((i) => i.entity !== entity);
  return true;
}

/**
 * Sets an item's state or brightness. Brightness is a whole percent from 1 to 100 (out of range is clamped), `null` clears it, only a light
 * on takes one, and switching an item off drops the light fields. NaN is refused.
 */
export function setSceneItem(r: Room, id: string, entity: string, patch: { on?: boolean; brightness?: number | null }): boolean {
  const it = find(r, id)?.items.find((i) => i.entity === entity);
  if (!it) return false;
  const before = JSON.stringify(it);
  if (patch.brightness !== undefined && patch.brightness !== null && !Number.isFinite(patch.brightness)) return false;
  if (patch.on !== undefined) it.on = patch.on;
  if (patch.brightness === null) delete it.brightness;
  else if (patch.brightness !== undefined && it.entity.startsWith("light.") && it.on) it.brightness = Math.min(100, Math.max(1, Math.round(patch.brightness)));
  if (!it.on) { delete it.brightness; delete it.kelvin; delete it.hs; }
  return JSON.stringify(it) !== before;
}

/** The room's explicit Home Assistant scene list: `scene.*` only, first occurrence wins, capped; empty deletes the key. */
export function setRoomHaScenes(r: Room, next: string[]): void {
  const list = [...new Set(next.filter((e) => typeof e === "string" && e.startsWith("scene.")))].slice(0, MAX_HA_SCENES);
  if (list.length) r.haScenes = list; else delete r.haScenes;
}
