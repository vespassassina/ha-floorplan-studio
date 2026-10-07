import { MAX_ROOM_SCENES, MAX_SCENE_ITEMS, SCENE_DOMAINS, SCENE_FIELDS, roomSummary } from "../core";
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

const FIELD_RANGE: Record<string, [number, number]> = { brightness: [1, 100], kelvin: [1000, 10000], percentage: [0, 100], position: [0, 100], temperature: [5, 35], volume: [0, 100] };

/** One draft item cleaned for storage: a known type only, only the fields that type may set, only when on, numbers clamped, text trimmed. */
export function cleanSceneItem(it: SceneItem): SceneItem | null {
  const domain = typeof it?.entity === "string" ? it.entity.split(".")[0] : "";
  if (!(SCENE_DOMAINS as readonly string[]).includes(domain)) return null;
  const out: SceneItem = { entity: it.entity, on: it.on === true };
  if (!out.on) return out;
  const src = it as unknown as Record<string, unknown>, dst = out as unknown as Record<string, unknown>;
  for (const f of SCENE_FIELDS[domain as (typeof SCENE_DOMAINS)[number]]) {
    const v = src[f];
    if (f === "hs") { if (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n))) dst.hs = [Math.min(360, Math.max(0, v[0])), Math.min(100, Math.max(0, v[1]))]; }
    else if (f === "hvac" || f === "source") { if (typeof v === "string" && v.trim()) dst[f] = v.trim().slice(0, 80); }
    else if (typeof v === "number" && Number.isFinite(v)) { const [lo, hi] = FIELD_RANGE[f]; dst[f] = Math.min(hi, Math.max(lo, Math.round(v * 10) / 10)); }
  }
  return out;
}

/**
 * S17.3: the designer's Save. `id` null makes a new scene. A name is required (the reason comes back, nothing changes), the items are
 * cleaned by `cleanSceneItem` (duplicates and unknown types dropped, capped) and a scene with none left is refused. Call inside one `commit`.
 */
export function saveScene(r: Room, id: string | null, name: string, items: SceneItem[]): { ok: true; id: string } | { ok: false; reason: string } {
  const t = name.trim().slice(0, MAX_NAME);
  if (!t) return { ok: false, reason: "Give the scene a name." };
  const seen = new Set<string>();
  const clean = items.flatMap((it) => { const c = cleanSceneItem(it); if (!c || seen.has(c.entity)) return []; seen.add(c.entity); return [c]; }).slice(0, MAX_SCENE_ITEMS);
  if (!clean.length) return { ok: false, reason: "Pick at least one device." };
  const list = r.scenes ?? [];
  const old = id === null ? undefined : find(r, id);
  if (id !== null && !old) return { ok: false, reason: "That scene is gone." };
  if (list.some((s) => s !== old && s.name === t)) return { ok: false, reason: `A scene called ${t} exists already.` };
  if (old) { old.name = t; old.items = clean; return { ok: true, id: old.id }; }
  if (list.length >= MAX_ROOM_SCENES) return { ok: false, reason: `A room keeps at most ${MAX_ROOM_SCENES} scenes.` };
  let n = list.length + 1;
  while (list.some((s) => s.id === `scene-${n}`)) n++;
  r.scenes = [...list, { id: `scene-${n}`, name: t, items: clean }];
  return { ok: true, id: `scene-${n}` };
}
