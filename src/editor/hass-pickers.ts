import type { HaData } from "../core";

/** The part of Home Assistant's `hass` object the pickers read. */
export interface PickerHass {
  callWS<T>(msg: { type: string; [k: string]: unknown }): Promise<T>;
  states?: Record<string, { state: string; attributes: Record<string, unknown> }>;
}

interface EntityReg { entity_id: string; name?: string | null; original_name?: string | null; area_id?: string | null; device_id?: string | null; disabled_by?: string | null; device_class?: string | null; original_device_class?: string | null; platform?: string | null; unique_id?: string | null }

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * What the editor's pickers need from Home Assistant: floors, areas and entities with the area each sits in. An entity's own area wins,
 * else its device's. Every entity in `hass.states` is offered, plus registry entries not yet in states, except disabled ones.
 * A registry call that fails leaves that part empty (an older HA has no floor registry); when neither the area nor the entity
 * registry answers there is nothing to pick from, so this returns undefined and the editor keeps its text fields.
 */
export async function haData(hass: PickerHass): Promise<HaData | undefined> {
  const get = <T>(type: string) => hass.callWS<T>({ type });
  const [floors, areas, ents, devs] = await Promise.allSettled([
    get<{ floor_id: string; name: string }[]>("config/floor_registry/list"),
    get<{ area_id: string; name: string; floor_id?: string | null }[]>("config/area_registry/list"),
    get<EntityReg[]>("config/entity_registry/list"),
    get<{ id: string; area_id?: string | null }[]>("config/device_registry/list"),
  ]);
  if (areas.status === "rejected" && ents.status === "rejected") return undefined;
  const deviceArea = new Map<string, string | null>();
  if (devs.status === "fulfilled") for (const d of devs.value) deviceArea.set(d.id, d.area_id ?? null);
  const reg = new Map<string, EntityReg>();
  const disabled = new Set<string>();
  if (ents.status === "fulfilled") for (const e of ents.value) { if (e.disabled_by) disabled.add(e.entity_id); else reg.set(e.entity_id, e); }
  const ids = new Set([...Object.keys(hass.states ?? {}), ...reg.keys()].filter((id) => !disabled.has(id)));
  const entities: HaData["entities"] = [];
  for (const id of ids) {
    const r = reg.get(id), attrs = hass.states?.[id]?.attributes ?? {};
    if (!hass.states?.[id] && !r) continue;
    const area = r?.area_id ?? (r?.device_id ? deviceArea.get(r.device_id) : null) ?? null;
    const domain = id.split(".")[0];
    // S4.5: a group's own membership list, so the Group menu can tell which of its members sit on the current floor.
    const members = domain === "group" && Array.isArray(attrs.entity_id) ? attrs.entity_id.filter((m): m is string => typeof m === "string") : undefined;
    // S4.7: the room box only needs to tell a switch_as_x light apart from a physical one, and an automation/script's editor id.
    const platform = domain === "light" ? text(r?.platform) : undefined;
    const uid = domain === "automation" || domain === "script" ? text(r?.unique_id) : undefined;
    entities.push({ id, name: text(attrs.friendly_name) ?? text(r?.name) ?? text(r?.original_name) ?? id, domain, area, dc: text(attrs.device_class) ?? text(r?.device_class) ?? text(r?.original_device_class), ...(r?.device_id ? { dev: r.device_id } : {}), ...(members ? { members } : {}), ...(platform ? { platform } : {}), ...(uid ? { uid } : {}) });
  }
  return {
    floors: floors.status === "fulfilled" ? floors.value.map((f) => ({ id: f.floor_id, name: f.name })) : [],
    areas: areas.status === "fulfilled" ? areas.value.map((a) => ({ id: a.area_id, name: a.name, ...(a.floor_id ? { floor_id: a.floor_id } : {}) })) : [],
    entities,
  };
}
