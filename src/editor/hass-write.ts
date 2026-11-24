/**
 * Every write the panel makes to Home Assistant, in one place. The editor never imports this file: the panel builds a `HaWriter`
 * from `hass` and hands it over as a property, so the standalone build (no `hass`) cannot reach a write. Nothing here writes on load
 * or on save (listing only reads); each write is called by an explicit action the person has confirmed.
 */

import type { AutomationConfig } from "./automations";
import { customCalls, type SceneItem } from "../core";
import { disableHaEntity, listRoomHaScenes, loadHaDynamicScene, loadHaScene, saveHaDynamicScene, saveHaScene, type DynamicStepData, type RoomHaSceneItem } from "../card/scene";
export type { AutomationConfig } from "./automations";

/** The part of `hass` a write needs. */
export interface WriteHass {
  callWS<T>(msg: { type: string; [k: string]: unknown }): Promise<T>;
  callApi<T>(method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, unknown>): Promise<T>;
}

/** What the editor calls. Built by `makeWriter(hass)`. */
export interface HaWriter {
  setDeviceArea(deviceId: string, areaId: string): Promise<void>;
  setEntityArea(entityId: string, areaId: string | null): Promise<void>;
  /** S4.2: a new HA area, labelled `floorplan-studio`. Resolves to the id and name HA gave it. */
  createArea(name: string): Promise<{ id: string; name: string }>;
  /** A helper (`switch_as_x`, `group`) created through its config flow, labelled `floorplan-studio`. Resolves to the entity it made. */
  createHelper(handler: "switch_as_x" | "group", steps: Record<string, unknown>[]): Promise<{ entity_id: string }>;
  /** S4.10: everything in this Home Assistant instance labelled `floorplan-studio`, so it can be found again and removed. */
  listLabelled(): Promise<Labelled[]>;
  removeLabelled(item: Labelled): Promise<void>;
  /** S4.6: creates the automation, labelled `floorplan-studio`. Resolves to its own id (used to open it in HA's editor). */
  createAutomation(cfg: AutomationConfig): Promise<string>;
  /** S4.7: runs a scene from the room box's "Run" button. */
  runScene(entityId: string): Promise<void>;
  /** S17.7: one service call, as a scene item makes it (the scene designer's Try and Restore). */
  callService(call: { domain: string; service: string; data: Record<string, unknown> }): Promise<void>;
  /** S46: creates a Home Assistant floor in `config/floor_registry/create`. */
  createFloor(name: string, level?: number): Promise<{ id: string; name: string }>;
  /** S46: assigns an HA area to an HA floor (`null` clears it). */
  setAreaFloor(areaId: string, floorId: string | null): Promise<void>;
  /** S50: saves a scene as a real Home Assistant `scene.*` in `scenes.yaml` and assigns its area. */
  saveScene?(opts: { id?: string | null; name: string; areaId?: string; items: readonly SceneItem[] }): Promise<{ id: string; entityId: string | null }>;
  /** S51: saves a dynamic multi-step scene as a Home Assistant `script.fp_dyn_*` in the room's area. */
  saveDynamicScene?(opts: { id?: string | null; name: string; areaId?: string; steps: readonly DynamicStepData[]; loop: boolean }): Promise<{ id: string; entityId: string | null }>;
  /** S63: discovers enabled HA scenes, Hue scenes, and dynamic scripts in an area. */
  listRoomScenes?(areaId: string): Promise<RoomHaSceneItem[]>;
  /** S63: loads an existing HA YAML scene for in-place editing. */
  loadScene?(configId: string): Promise<{ name: string; items: SceneItem[] }>;
  /** S63: loads an existing HA dynamic script (`script.fp_dyn_*`) for in-place editing. */
  loadDynamicScene?(configId: string): Promise<{ name: string; steps: DynamicStepData[]; loop: boolean }>;
  /** S63: disables an entity (e.g. a replaced Hue scene) in HA's entity registry. */
  disableEntity?(entityId: string): Promise<void>;
}

/** The label everything the tool creates carries, so the person can find it in HA and remove it. */
export const LABEL_NAME = "floorplan-studio";

interface Label { label_id: string; name: string }
interface FlowResult { type: string; flow_id?: string; errors?: Record<string, string> | null; reason?: string; result?: unknown; description_placeholders?: Record<string, string> | null }
interface EntityEntry { entity_id: string; platform?: string; config_entry_id?: string | null; unique_id?: string; name?: string | null; original_name?: string | null; labels?: string[] }
interface AreaEntry { area_id: string; name: string; labels?: string[] }

/** S4.10: one thing floorplan-studio created in HA (a helper, an automation, or an area) that can be found again for cleanup. */
export interface Labelled { kind: "helper" | "automation" | "area"; id: string; name: string; entityId?: string }

/** The label is only a way to find things; it proves nothing, since anyone can put it on their own light. What the tool made is
 * decided by what only the tool does: helpers come from the `switch_as_x` and `group` platforms, automations get an `fp_` id, and
 * areas (which have neither) are remembered by id in this browser when `createArea` makes them. */
const HELPER_PLATFORMS = ["switch_as_x", "group"];
const AREA_KEY = "floorplan-studio:areas";
const areaMemory = new Set<string>();
function madeAreas(): Set<string> {
  try { return new Set([...areaMemory, ...(JSON.parse(localStorage.getItem(AREA_KEY) ?? "[]") as string[])]); } catch { return new Set(areaMemory); }
}
function rememberArea(id: string) {
  areaMemory.add(id);
  try { localStorage.setItem(AREA_KEY, JSON.stringify([...madeAreas()])); } catch { /* private window: the in-memory record still holds for this session */ }
}
function forgetArea(id: string) {
  areaMemory.delete(id);
  try { localStorage.setItem(AREA_KEY, JSON.stringify([...madeAreas()].filter((x) => x !== id))); } catch { /* as above */ }
}

/** The id of the `floorplan-studio` label, created when missing. Not cached: `hass` changes all the time and the label may have been deleted in HA. */
export async function ensureLabel(hass: WriteHass): Promise<string> {
  const labels = await hass.callWS<Label[]>({ type: "config/label_registry/list" });
  const hit = labels.find((l) => l.name === LABEL_NAME);
  if (hit) return hit.label_id;
  const made = await hass.callWS<Label>({ type: "config/label_registry/create", name: LABEL_NAME });
  return made.label_id;
}

export async function setDeviceArea(hass: WriteHass, deviceId: string, areaId: string): Promise<void> {
  await hass.callWS({ type: "config/device_registry/update", device_id: deviceId, area_id: areaId });
}

/** `null` takes the entity out of any area of its own (it then follows its device). */
export async function setEntityArea(hass: WriteHass, entityId: string, areaId: string | null): Promise<void> {
  await hass.callWS({ type: "config/entity_registry/update", entity_id: entityId, area_id: areaId });
}

/** S4.2: creates the area `name` with the `floorplan-studio` label, so S4.10 can find it again. HA picks the id (it may add a suffix). */
export async function createArea(hass: WriteHass, name: string): Promise<{ id: string; name: string }> {
  const n = name.trim();
  if (!n) throw new Error("An area needs a name. Give the room a plan name first.");
  const labelId = await ensureLabel(hass);
  const a = await hass.callWS<AreaEntry>({ type: "config/area_registry/create", name: n, labels: [labelId] });
  rememberArea(a.area_id);
  return { id: a.area_id, name: a.name };
}

/** S46: creates a Home Assistant floor (`config/floor_registry/create`). */
export async function createFloor(hass: WriteHass, name: string, level?: number): Promise<{ id: string; name: string }> {
  const n = name.trim();
  if (!n) throw new Error("A floor needs a name.");
  const f = await hass.callWS<{ floor_id: string; name: string }>({
    type: "config/floor_registry/create",
    name: n,
    ...(typeof level === "number" ? { level } : {}),
  });
  return { id: f.floor_id, name: f.name };
}

/** S46: assigns an HA area to an HA floor (`null` clears it). */
export async function setAreaFloor(hass: WriteHass, areaId: string, floorId: string | null): Promise<void> {
  await hass.callWS({ type: "config/area_registry/update", area_id: areaId, floor_id: floorId });
}

const flowError = (r: FlowResult) => {
  const errs = Object.values(r.errors ?? {});
  return errs.length ? errs.join(", ") : r.reason ? `${r.type}: ${r.reason}` : `unexpected answer (${r.type})`;
};

export interface HelperOptions { retryMs?: number; tries?: number }

/**
 * Creates a helper through its config flow: one POST to start it, one POST per step. `steps` are the answers, in order (for `group`
 * the first is the menu choice). A step that comes back with `errors` throws with the flow's own text, and the flow is left unfinished
 * so nothing is created. When the flow is done the new entity is found in the entity registry by its config entry (HA needs a moment
 * to register it: it is looked for `tries` times, `retryMs` apart, then this rejects) and given the `floorplan-studio` label.
 */
export async function createHelper(hass: WriteHass, handler: "switch_as_x" | "group", steps: Record<string, unknown>[], opt: HelperOptions = {}): Promise<{ entity_id: string }> {
  const labelId = await ensureLabel(hass);
  let r = await hass.callApi<FlowResult>("POST", "config/config_entries/flow", { handler, show_advanced_options: false });
  for (const data of steps) {
    if ((r.type !== "form" && r.type !== "menu") || !r.flow_id) break;
    r = await hass.callApi<FlowResult>("POST", `config/config_entries/flow/${r.flow_id}`, data);
    if (r.errors && Object.keys(r.errors).length) throw new Error(`Home Assistant refused it: ${flowError(r)}`);
  }
  if (r.type !== "create_entry") throw new Error(`Home Assistant did not finish creating it: ${flowError(r)}`);
  const res = r.result as { entry_id?: string } | string | undefined;
  const entryId = typeof res === "string" ? res : res?.entry_id;
  if (!entryId) throw new Error("Home Assistant created the helper but did not say which one; look for it under Settings, Devices & services, Helpers.");
  const tries = opt.tries ?? 10, ms = opt.retryMs ?? 500;
  for (let n = 0; n < tries; n++) {
    const all = await hass.callWS<EntityEntry[]>({ type: "config/entity_registry/list" });
    const hit = all.find((e) => e.config_entry_id === entryId);
    if (hit) {
      await hass.callWS({ type: "config/entity_registry/update", entity_id: hit.entity_id, labels: [...new Set([...(hit.labels ?? []), labelId])] });
      return { entity_id: hit.entity_id };
    }
    if (n < tries - 1) await new Promise((res2) => setTimeout(res2, ms));
  }
  throw new Error("Home Assistant made the helper but it did not appear in time; look for it under Settings, Devices & services, Helpers.");
}

/**
 * S4.10: every helper, automation and area the tool made and labelled `floorplan-studio`, whole-instance (not just the current
 * plan), so cleanup finds something even after a plan edit orphaned it. Only reads: when the label does not exist yet, nothing is
 * listed and nothing is created. A labelled thing the person made themselves is not listed (see `HELPER_PLATFORMS`). A helper's
 * `id` is its config entry (removed by `removeLabelled` as a whole config entry); an automation's `id` is its own id, read from the
 * entity's `unique_id` (the id the automation delete API takes); an area's `id` is its area id.
 */
export async function listLabelled(hass: WriteHass): Promise<Labelled[]> {
  const labels = await hass.callWS<Label[]>({ type: "config/label_registry/list" });
  const labelId = labels.find((l) => l.name === LABEL_NAME)?.label_id;
  if (!labelId) return [];
  const has = (l: string[] | undefined) => (l ?? []).includes(labelId);
  const [entities, areas] = await Promise.all([
    hass.callWS<EntityEntry[]>({ type: "config/entity_registry/list" }),
    hass.callWS<AreaEntry[]>({ type: "config/area_registry/list" }),
  ]);
  const made = madeAreas();
  const out: Labelled[] = [];
  for (const e of entities) {
    if (!has(e.labels)) continue;
    const name = e.name ?? e.original_name ?? e.entity_id;
    if (e.entity_id.startsWith("automation.")) {
      if (e.platform === "automation" && e.unique_id?.startsWith("fp_")) out.push({ kind: "automation", id: e.unique_id, name, entityId: e.entity_id });
    } else if (e.config_entry_id && e.platform && HELPER_PLATFORMS.includes(e.platform)) out.push({ kind: "helper", id: e.config_entry_id, name, entityId: e.entity_id });
  }
  for (const a of areas) if (has(a.labels) && made.has(a.area_id)) out.push({ kind: "area", id: a.area_id, name: a.name });
  return out;
}

/**
 * S4.6: creates the automation under a fresh id (`fp_` + random), the same way HA's own UI does. The registry needs a
 * moment to register the new `automation.*` entity (found by its `unique_id`, which is this id), exactly as
 * `createHelper` waits for its own entity; the label is added the same way once it appears.
 */
export async function createAutomation(hass: WriteHass, cfg: AutomationConfig, opt: HelperOptions = {}): Promise<string> {
  const labelId = await ensureLabel(hass);
  const id = `fp_${Math.random().toString(36).slice(2, 10)}`;
  await hass.callApi("POST", `config/automation/config/${id}`, cfg as unknown as Record<string, unknown>);
  const tries = opt.tries ?? 10, ms = opt.retryMs ?? 500;
  for (let n = 0; n < tries; n++) {
    const all = await hass.callWS<EntityEntry[]>({ type: "config/entity_registry/list" });
    const hit = all.find((e) => e.unique_id === id);
    if (hit) {
      await hass.callWS({ type: "config/entity_registry/update", entity_id: hit.entity_id, labels: [...new Set([...(hit.labels ?? []), labelId])] });
      return id;
    }
    if (n < tries - 1) await new Promise((res) => setTimeout(res, ms));
  }
  throw new Error("Home Assistant made the automation but it did not appear in time; look for it under Settings, Automations.");
}

/** S4.7: the room box's "Run" button on a scene row. */
export async function runScene(hass: WriteHass, entityId: string): Promise<void> {
  await hass.callWS({ type: "call_service", domain: "scene", service: "turn_on", target: { entity_id: entityId } });
}

/** S17.7: one service call. `entity_id` goes in `target`, the rest in `service_data`. */
export async function callService(hass: WriteHass, call: { domain: string; service: string; data: Record<string, unknown> }): Promise<void> {
  const { entity_id, ...rest } = call.data;
  await hass.callWS({ type: "call_service", domain: call.domain, service: call.service, service_data: rest, target: { entity_id } });
}

/** `openAutomation` actually lives in `automations.ts` (it touches no `hass`, and the editor must never import this
 * file) — re-exported here so the panel host and this file's own tests can still reach it from one place. */
export { openAutomation } from "./automations";

/** Removes the HA-side thing a `Labelled` row points at. Never touches the plan: that is a separate, ordinary "remove from plan" edit.
 * The row is checked against a fresh `listLabelled` first, so a row that is not the tool's (or no longer exists) deletes nothing. */
export async function removeLabelled(hass: WriteHass, item: Labelled): Promise<void> {
  const ours = await listLabelled(hass);
  if (!ours.some((x) => x.kind === item.kind && x.id === item.id)) {
    throw new Error(`${item.name} was not created by floorplan-studio, so it is not removed. Remove it in Home Assistant if you want it gone.`);
  }
  if (item.kind === "helper") await hass.callApi("DELETE", `config/config_entries/entry/${item.id}`);
  else if (item.kind === "automation") await hass.callApi("DELETE", `config/automation/config/${item.id}`);
  else { await hass.callWS({ type: "config/area_registry/delete", area_id: item.id }); forgetArea(item.id); }
}

/** The writer the editor is given. */
export function makeWriter(hass: WriteHass): HaWriter {
  return {
    setDeviceArea: (d, a) => setDeviceArea(hass, d, a),
    setEntityArea: (e, a) => setEntityArea(hass, e, a),
    createArea: (n) => createArea(hass, n),
    createHelper: (h, s) => createHelper(hass, h, s),
    listLabelled: () => listLabelled(hass),
    removeLabelled: (item) => removeLabelled(hass, item),
    createAutomation: (cfg) => createAutomation(hass, cfg),
    runScene: (id) => runScene(hass, id),
    callService: (c) => callService(hass, c),
    createFloor: (n, l) => createFloor(hass, n, l),
    setAreaFloor: (a, f) => setAreaFloor(hass, a, f),
    saveScene: (opts) => saveHaScene(hass, opts),
    saveDynamicScene: (opts) => saveHaDynamicScene(hass, { ...opts, customCalls }),
    listRoomScenes: (areaId) => listRoomHaScenes(hass, areaId),
    loadScene: (id) => loadHaScene(hass, id),
    loadDynamicScene: (id) => loadHaDynamicScene(hass, id),
    disableEntity: (entityId) => disableHaEntity(hass, entityId),
  };
}
