import { areaMove, groupKind, inside, type Pt } from "../core";
import { confirm as askHa } from "./confirm";
import { motionLights, openAutomation, schedule, switchControls } from "./automations";
import type { Labelled } from "./hass-write";
import { html } from "lit";
import { stopDraw } from "./editor-draw";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- writes to Home Assistant: areas, groups, automations, scenes, the labelled list ---------------------

/** S4.3: the room a placed device sits in, when it has an HA area that differs from the one HA has the device in. */
export function areaDiff(ed: FloorplanStudioEditor, i: number): { room: string; name: string; move: NonNullable<ReturnType<typeof areaMove>> } | null {
  const st = ed.st, d = st.f.devices[i], ha = st.ha;
  if (!d || !ha || !ed.writer) return null;
  const at: Pt = "a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y];
  const room = st.f.rooms.find((r) => r.area && (r.kind === "room" || r.kind === "structure") && inside(at, r.pts));
  const move = room && areaMove(ha, d.entity, room.area);
  return room && move ? { room: room.area, name: room.name, move } : null;
}

/** S4.3: after a device is dropped in a room, offers to put it in that room's HA area. Dropping outside every room asks nothing. */
export async function offerAreaMove(ed: FloorplanStudioEditor, i: number, force = false) {
  const diff = areaDiff(ed, i), d = ed.st.f.devices[i];
  if (!diff || !d) return;
  if (!ed.moveWithoutAsking || force) {
    const ok = await askHa(ed.shadowRoot ?? ed, `Move ${d.name ?? d.entity} to ${diff.name}?`, [
      `Home Assistant will put ${diff.move.kind === "device" ? "the device" : d.entity} in the area ${diff.name}.`], { okLabel: "Move", remember: "Don't ask again this session", onRemember: () => { ed.moveWithoutAsking = true; } });
    if (!ok) return;
  }
  try {
    if (diff.move.kind === "device") await ed.writer!.setDeviceArea(diff.move.id, diff.move.area);
    else await ed.writer!.setEntityArea(diff.move.id, diff.move.area);
  } catch (err) {
    ed.status = `Could not move it in Home Assistant: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; ed.requestUpdate();
    return;
  }
  const ha = ed.st.ha;
  if (ha) { // keep our copy in step, so the mismatch note goes away
    const ids = new Set(diff.move.kind === "device" ? ha.entities.filter((e) => e.dev === diff.move.id).map((e) => e.id) : [diff.move.id]);
    ed.ha = { ...ha, entities: ha.entities.map((e) => (ids.has(e.id) ? { ...e, area: diff.move.area } : e)) };
  }
  ed.status = `Moved ${d.name ?? d.entity} to ${diff.name} in Home Assistant.`; ed.requestUpdate();
}

/** S4.2: asks, creates an HA area named after the room, then links the room to it (one undo step; the area stays in HA). A failure changes nothing. */
export async function createArea(ed: FloorplanStudioEditor, i: number) {
  const w = ed.writer, st = ed.st, r = st.f.rooms[i];
  if (!w || !r) return;
  const name = r.name.trim(), id = r.id;
  const ok = await askHa(ed.shadowRoot ?? ed, `Create area ${name}`, [
    `Home Assistant will get a new area "${name}", labelled floorplan-studio.`, "This room is then linked to it."]);
  if (!ok) return;
  ed.status = `Creating area ${name}...`; ed.requestUpdate();
  try {
    const a = await w.createArea(name);
    void loadHaList(ed); // S8.1: the Edit, Home Assistant button lists it
    const ha = st.ha;
    if (ha && !ha.areas.some((x) => x.id === a.id)) ed.ha = { ...ha, areas: [...ha.areas, { id: a.id, name: a.name }] };
    // The plan may have changed while HA worked: find the room again by its id.
    const at = st.f.rooms.findIndex((x) => x.id === id);
    if (at < 0) { ed.status = `Created area ${a.name} in Home Assistant, but the room is gone. Pick the area on another room.`; ed.requestUpdate(); return; }
    if (st.edit((f) => { const room = f.rooms[at]; room.area = a.id; room.name = a.name; delete room.entity; })) ed.changed(`Created area ${a.name} in Home Assistant. It stays there if you undo.`);
  } catch (err) {
    ed.status = `Could not create the area: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; ed.requestUpdate();
  }
}

/** S4.4: asks, has Home Assistant wrap the placed switch in a light, then swaps it on the plan. A failure changes nothing on the plan. */
export async function makeLight(ed: FloorplanStudioEditor, i: number) {
  const w = ed.writer, st = ed.st, d = st.f.devices[i];
  if (!w || !d || !st.canMakeLight(i)) return;
  const name = d.name ?? d.entity;
  const ok = await askHa(ed.shadowRoot ?? ed, "Create a light from this switch", [
    `Home Assistant will create a light "${name}" that wraps ${d.entity}, and label it floorplan-studio.`,
    "The switch stays in Home Assistant. The plan shows the light, bound to the switch."]);
  if (!ok) return;
  ed.status = `Creating a light from ${name}...`; ed.requestUpdate();
  try {
    const { entity_id } = await w.createHelper("switch_as_x", [{ entity_id: d.entity, target_domain: "light" }]);
    void loadHaList(ed); // S8.1: the Edit, Home Assistant button lists it
    // The plan may have changed while HA worked: find the switch again by its entity.
    const at = st.f.devices.findIndex((x) => x.entity === d.entity);
    if (at < 0 || !st.lightFromSwitch(at, entity_id, name)) { ed.status = `Created ${entity_id} in Home Assistant, but the plan changed meanwhile. Place it from the Device menu.`; ed.requestUpdate(); return; }
    const ha = st.ha;
    if (ha && !ha.entities.some((e) => e.id === entity_id)) ed.ha = { ...ha, entities: [...ha.entities, { id: entity_id, name, domain: "light" }] };
    ed.changed(`Created ${entity_id}. The helper stays in Home Assistant if you undo.`);
  } catch (err) {
    ed.status = `Could not create the light: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; ed.requestUpdate();
  }
}

/** S4.5: asks, has Home Assistant build a light or motion group of the selected devices, then remembers it for the Group menu. Nothing on the plan changes: the plan never stores group membership, HA does. */
export async function createGroup(ed: FloorplanStudioEditor, is: number[], kind: "light" | "motion", name: string) {
  const w = ed.writer, st = ed.st, f = st.f;
  const n = name.trim();
  if (!w || !n || groupKind(f, is) !== kind) return;
  const entities = is.map((i) => f.devices[i]?.entity).filter((e): e is string => !!e);
  const ok = await askHa(ed.shadowRoot ?? ed, `Create group ${n}`, [
    `Home Assistant will get a new group "${n}" of ${entities.length} ${kind === "light" ? "lights" : "motion sensors"}, labelled floorplan-studio.`]);
  if (!ok) return;
  ed.status = `Creating group ${n}...`; ed.requestUpdate();
  try {
    const nextStep = kind === "light" ? "light" : "binary_sensor";
    const { entity_id } = await w.createHelper("group", [{ next_step_id: nextStep }, { name: n, entities, hide_members: false, all: false }]);
    void loadHaList(ed); // S8.1: the Edit, Home Assistant button lists it
    const ha = st.ha;
    if (ha && !ha.entities.some((e) => e.id === entity_id)) ed.ha = { ...ha, entities: [...ha.entities, { id: entity_id, name: n, domain: "group", members: entities }] };
    st.groupDraft = ""; st.sel = null;
    ed.changed(`Created group ${entity_id} with ${entities.length} ${kind === "light" ? "lights" : "motion sensors"}. It stays in Home Assistant if you undo.`);
  } catch (err) {
    ed.status = `Could not create the group: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; ed.requestUpdate();
  }
}

/** S4.6: asks, has Home Assistant build the "switch controls..." automation, then opens it in HA's own editor. The plan never changes: nothing here is undoable. */
export async function controlsAutomation(ed: FloorplanStudioEditor, i: number, targets: string[]) {
  const w = ed.writer, d = ed.st.f.devices[i];
  if (!w || !d || !targets.length) return;
  const ok = await askHa(ed.shadowRoot ?? ed, "Create automation", [
    `Home Assistant will get a new automation: ${d.entity} turns ${targets.length} thing${targets.length === 1 ? "" : "s"} on and off with it, labelled floorplan-studio.`,
    "It opens in Home Assistant's own editor once created, to finish or rename."]);
  if (!ok) return;
  ed.status = "Creating the automation..."; ed.requestUpdate();
  try {
    const cfg = switchControls(d.entity, targets);
    const id = await w.createAutomation(cfg);
    void loadHaList(ed); // S8.1: the Edit, Home Assistant button lists it
    ed.st.controlsDraft = [];
    ed.status = `Created the automation. Opening it in Home Assistant...`; ed.requestUpdate();
    openAutomation(id);
  } catch (err) {
    ed.status = `Could not create the automation: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; ed.requestUpdate();
  }
}

/** S4.6: asks, has Home Assistant build the "schedule" automation, then opens it in HA's own editor. */
export async function scheduleAutomation(ed: FloorplanStudioEditor, i: number, on: string, off: string) {
  const w = ed.writer, d = ed.st.f.devices[i];
  if (!w || !d || !on || !off) return;
  const ok = await askHa(ed.shadowRoot ?? ed, "Create automation", [
    `Home Assistant will get a new automation: ${d.entity} on at ${on}, off at ${off}, every day, labelled floorplan-studio.`,
    "It opens in Home Assistant's own editor once created, to finish or rename."]);
  if (!ok) return;
  ed.status = "Creating the automation..."; ed.requestUpdate();
  try {
    const cfg = schedule(d.entity, on, off);
    const id = await w.createAutomation(cfg);
    void loadHaList(ed); // S8.1: the Edit, Home Assistant button lists it
    ed.st.scheduleOn = ""; ed.st.scheduleOff = "";
    ed.status = `Created the automation. Opening it in Home Assistant...`; ed.requestUpdate();
    openAutomation(id);
  } catch (err) {
    ed.status = `Could not create the automation: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; ed.requestUpdate();
  }
}

/**
 * S4.6/S8.7: asks, has Home Assistant build the "turns on..." motion automation, then opens it in HA's own
 * editor. Shared by the Group menu's motion-group flow (`deviceIndex` omitted: the plan never changes, as
 * before) and the light panel's own "Motion" pick (`deviceIndex` given: on success, also records `motion` on
 * that specific light — a group's own light target may not be one `Device` on the plan, so this side effect
 * only ever applies to a concrete light).
 *
 * Opus review finding 2: `deviceIndex` is only a snapshot from before `askHa` and `createAutomation` — either
 * await can run for a while, and the user is free to undo, delete the device, redraw the floor, or switch floors
 * while it is in flight. The device's own id and floor are captured up front and the device is looked up again,
 * by id, after the automation exists; a light that is gone, or is no longer a light, does not stop the
 * automation from being reported as created, only from being recorded on the plan.
 */
export async function motionAutomation(ed: FloorplanStudioEditor, motionId: string, lightId: string, minutes: number, deviceIndex?: number) {
  const w = ed.writer;
  if (!w || !lightId || !(minutes > 0)) return;
  const floorKey = ed.st.floor;
  const devId = deviceIndex !== undefined ? ed.st.f.devices[deviceIndex]?.id : undefined;
  const ok = await askHa(ed.shadowRoot ?? ed, "Create automation", [
    `Home Assistant will get a new automation: ${lightId} turns on with ${motionId}, off ${minutes} minute${minutes === 1 ? "" : "s"} after motion stops, labelled floorplan-studio.`,
    "It opens in Home Assistant's own editor once created, to finish or rename."]);
  if (!ok) return;
  ed.status = "Creating the automation..."; ed.requestUpdate();
  try {
    const cfg = motionLights(motionId, lightId, Math.round(minutes * 60));
    const id = await w.createAutomation(cfg);
    void loadHaList(ed); // S8.1: the Edit, Home Assistant button lists it
    ed.st.motionLightGroup = ""; ed.st.motionMinutes = "";
    let linked = devId === undefined; // the group-motion flow (no deviceIndex) never tries to link anything
    if (devId !== undefined) {
      const floor = ed.st.layout.floors[floorKey];
      const i = floor?.devices.findIndex((d) => d.id === devId) ?? -1;
      const d = i >= 0 ? floor!.devices[i] : undefined;
      if (d && d.type === "light") {
        if (ed.st.edit((f) => { f.devices[i].motion = motionId; })) ed.changed();
        ed.st.pendingMotion = "";
        linked = true;
      }
    }
    ed.status = linked
      ? `Created the automation. Opening it in Home Assistant...`
      : `Created the automation. The light was no longer there to record the link on. Opening it in Home Assistant...`;
    ed.requestUpdate();
    openAutomation(id);
  } catch (err) {
    ed.status = `Could not create the automation: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; ed.requestUpdate();
  }
}

/** S4.7: opens Home Assistant's own more-info dialog for an entity. Always present, even without a writer: it is a DOM
 * event, not a write, and the standalone build simply has nothing listening. */
export function moreInfo(ed: FloorplanStudioEditor, entityId: string) {
  ed.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
}

/** S4.7: the room box's "Run" button on a scene row. Not a write to the plan or the registry, so it asks nothing first — same as a card tap. */
export async function runScene(ed: FloorplanStudioEditor, entityId: string) {
  const w = ed.writer;
  if (!w) return;
  try {
    await w.runScene(entityId);
    ed.status = `Ran ${entityId}.`; ed.requestUpdate();
  } catch (err) {
    ed.status = `Could not run it: ${err instanceof Error ? err.message : String(err)}.`; ed.requestUpdate();
  }
}

/** S4.7: the room box's "Add to area..." — asks, then puts an area-less HA entity into the room's own area. */
export async function addToArea(ed: FloorplanStudioEditor, i: number, entityId: string) {
  const w = ed.writer, st = ed.st, r = st.f.rooms[i], ha = st.ha;
  if (!w || !r || !r.area || !ha) return;
  const e = ha.entities.find((x) => x.id === entityId);
  const ok = await askHa(ed.shadowRoot ?? ed, `Add ${e?.name ?? entityId} to ${r.name}?`, [
    `Home Assistant will put ${entityId} in the area ${r.name}.`]);
  if (!ok) return;
  try {
    await w.setEntityArea(entityId, r.area);
    ed.ha = { ...ha, entities: ha.entities.map((x) => (x.id === entityId ? { ...x, area: r.area } : x)) };
    ed.status = `Added ${e?.name ?? entityId} to ${r.name} in Home Assistant.`; ed.requestUpdate();
  } catch (err) {
    ed.status = `Could not add it: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; ed.requestUpdate();
  }
}

export async function loadHaList(ed: FloorplanStudioEditor) {
  if (!ed.writer) return;
  const seq = ++ed.haListSeq;
  ed.haListLoading = true; ed.haListErr = ""; ed.requestUpdate();
  try {
    const list = await ed.writer.listLabelled();
    if (seq !== ed.haListSeq) return;
    ed.haList = list;
  } catch (err) {
    if (seq !== ed.haListSeq) return;
    ed.haList = null;
    ed.haListErr = `Could not read Home Assistant: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    if (seq === ed.haListSeq) { ed.haListLoading = false; ed.requestUpdate(); }
  }
}

/** S4.10: asks, then deletes the HA-side thing and refreshes the list. Never touches the plan: a room or device that used it, if any, is untouched. */
export async function removeHaItem(ed: FloorplanStudioEditor, item: Labelled) {
  if (!ed.writer) return;
  const what = item.kind === "area" ? "the area" : item.kind === "helper" ? "the helper" : "the automation";
  const ok = await askHa(ed.shadowRoot ?? ed, `Remove ${item.name} from Home Assistant?`, [
    `Home Assistant will delete ${what} ${item.name}.`,
    "This does not touch the plan. If it is used on a room or device there, remove it from there separately."]);
  if (!ok) return;
  try {
    await ed.writer.removeLabelled(item);
    ed.status = `Removed ${item.name} from Home Assistant.`; ed.requestUpdate();
    await loadHaList(ed);
  } catch (err) {
    ed.status = `Could not remove ${item.name}: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; ed.requestUpdate();
  }
}

/** One row of the Home Assistant popover: its name opens the item where HA edits it (a helper's more-info dialog, the
 * automation editor, the area page), then Remove. */
export function haRow(ed: FloorplanStudioEditor, it: Labelled) {
  const name = it.kind === "helper" && it.entityId
    ? html`<button class="btn keep name" @click=${() => moreInfo(ed, it.entityId!)}>${it.name}</button>`
    : html`<a class="btn keep name" href=${(it.kind === "automation" ? "/config/automation/edit/" : "/config/areas/area/") + encodeURIComponent(it.id)} target="_top">${it.name}</a>`;
  return html`<div class="harow" data-ha=${it.id}>${name}<button class="btn warn keep" @click=${() => void removeHaItem(ed, it)}>Remove</button></div>`;
}

/** A floor operation of the state is one undo step; the host hears about it like any other edit. */
export function floorDone(ed: FloorplanStudioEditor, status: string) { stopDraw(ed); ed.floor = ed.st.floor; ed.changed(status); }
