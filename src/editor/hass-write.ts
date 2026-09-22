/**
 * Every write the panel makes to Home Assistant, in one place. The editor never imports this file: the panel builds a `HaWriter`
 * from `hass` and hands it over as a property, so the standalone build (no `hass`) cannot reach a write. Nothing here runs on load
 * or on save; each function is called by an explicit action the person has confirmed.
 */

/** The part of `hass` a write needs. */
export interface WriteHass {
  callWS<T>(msg: { type: string; [k: string]: unknown }): Promise<T>;
  callApi<T>(method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, unknown>): Promise<T>;
}

/** What the editor calls. Built by `makeWriter(hass)`. */
export interface HaWriter {
  setDeviceArea(deviceId: string, areaId: string): Promise<void>;
  setEntityArea(entityId: string, areaId: string | null): Promise<void>;
  /** A helper (`switch_as_x`, `group`) created through its config flow, labelled `floorplan-studio`. Resolves to the entity it made. */
  createHelper(handler: "switch_as_x" | "group", steps: Record<string, unknown>[]): Promise<{ entity_id: string }>;
  /** S4.10: everything in this Home Assistant instance labelled `floorplan-studio`, so it can be found again and removed. */
  listLabelled(): Promise<Labelled[]>;
  removeLabelled(item: Labelled): Promise<void>;
}

/** The label everything the tool creates carries, so the person can find it in HA and remove it. */
export const LABEL_NAME = "floorplan-studio";

interface Label { label_id: string; name: string }
interface FlowResult { type: string; flow_id?: string; errors?: Record<string, string> | null; reason?: string; result?: unknown; description_placeholders?: Record<string, string> | null }
interface EntityEntry { entity_id: string; config_entry_id?: string | null; unique_id?: string; name?: string | null; original_name?: string | null; labels?: string[] }
interface AreaEntry { area_id: string; name: string; labels?: string[] }

/** S4.10: one thing floorplan-studio created in HA (a helper, an automation, or an area) that can be found again for cleanup. */
export interface Labelled { kind: "helper" | "automation" | "area"; id: string; name: string; entityId?: string }

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
 * S4.10: every helper, automation and area labelled `floorplan-studio`, whole-instance (not just the current plan), so cleanup finds
 * something even after a plan edit orphaned it. A helper's `id` is its config entry (removed by `removeLabelled` as a whole config
 * entry); an automation's `id` is its own id, read from the entity's `unique_id` (the id the automation delete API takes); an area's
 * `id` is its area id.
 */
export async function listLabelled(hass: WriteHass): Promise<Labelled[]> {
  const labelId = await ensureLabel(hass);
  const has = (labels: string[] | undefined) => (labels ?? []).includes(labelId);
  const [entities, areas] = await Promise.all([
    hass.callWS<EntityEntry[]>({ type: "config/entity_registry/list" }),
    hass.callWS<AreaEntry[]>({ type: "config/area_registry/list" }),
  ]);
  const out: Labelled[] = [];
  for (const e of entities) {
    if (!has(e.labels)) continue;
    const name = e.name ?? e.original_name ?? e.entity_id;
    if (e.entity_id.startsWith("automation.")) out.push({ kind: "automation", id: e.unique_id ?? e.entity_id, name, entityId: e.entity_id });
    else if (e.config_entry_id) out.push({ kind: "helper", id: e.config_entry_id, name, entityId: e.entity_id });
  }
  for (const a of areas) if (has(a.labels)) out.push({ kind: "area", id: a.area_id, name: a.name });
  return out;
}

/** Removes the HA-side thing a `Labelled` row points at. Never touches the plan: that is a separate, ordinary "remove from plan" edit. */
export async function removeLabelled(hass: WriteHass, item: Labelled): Promise<void> {
  if (item.kind === "helper") await hass.callApi("DELETE", `config/config_entries/entry/${item.id}`);
  else if (item.kind === "automation") await hass.callApi("DELETE", `config/automation/config/${item.id}`);
  else await hass.callWS({ type: "config/area_registry/delete", area_id: item.id });
}

/** The writer the editor is given. */
export function makeWriter(hass: WriteHass): HaWriter {
  return {
    setDeviceArea: (d, a) => setDeviceArea(hass, d, a),
    setEntityArea: (e, a) => setEntityArea(hass, e, a),
    createHelper: (h, s) => createHelper(hass, h, s),
    listLabelled: () => listLabelled(hass),
    removeLabelled: (item) => removeLabelled(hass, item),
  };
}
