import { emptyLayout, isBlank, loadLayout } from "./state";
import { availableEntities, type Floor, MAX_LAYOUT_BYTES, validate } from "../core";
import { stopDraw } from "./editor-draw";
import { layoutFromAreas } from "./from-areas";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- save, export, reset, load the demo, open a file -----------------------------------------------------

/** Cmd/Ctrl+S: the Save button's action, except that an empty plan says so instead of writing nothing useful. */
export function saveByKey(ed: FloorplanStudioEditor) {
  if (isBlank(ed.st.layout)) { ed.status = "Nothing to save yet: the plan is empty. Draw something, then press Cmd/Ctrl+S."; ed.requestUpdate(); return; }
  ed.save();
}

export function save(ed: FloorplanStudioEditor) {
  const v = validate(ed.st.layout);
  if (!v.ok) { ed.errors = v.errors; return; }
  const bytes = JSON.stringify(ed.st.layout).length;
  if (bytes > MAX_LAYOUT_BYTES) {
    const traced = Object.values(ed.st.layout.floors).filter((f) => f.trace).map((f) => f.title).join(", ") || "none";
    ed.errors = [`The plan is ${(bytes / 1048576).toFixed(1)} MB and Home Assistant takes at most ${(MAX_LAYOUT_BYTES / 1048576).toFixed(1)} MB in one save. Floors with a trace image: ${traced}. Remove one (Edit, Trace image…, Remove) or load a smaller scan, then Save again.`];
    return;
  }
  ed.errors = [];
  ed.st.persist();
  ed.status = "Saving…";
  ed.st.saveSent();
  const ev = new CustomEvent("save-request", { detail: ed.st.layout, bubbles: true, composed: true, cancelable: true });
  ed.dispatchEvent(ev);
  // A host that listens owns the outcome and answers with saveDone(). Nobody listening: nothing else will write it.
  if (ed.saveListeners === 0 && !ev.defaultPrevented) ed.saveDone(true);
  else ed.requestUpdate();
}

/**
 * File, Export: downloads the current layout as JSON directly from the browser, regardless of host. Unlike Save
 * (`save-request`), no host is involved and nothing is asked to persist it — this is the only way to get the JSON
 * out of the HA panel, where Save writes to `.storage` instead of downloading (the standalone host's Save already
 * downloads, so this duplicates it there, which is fine: the button means the same thing everywhere).
 *
 * S6.7: when HA is connected, the download also carries `available` — a snapshot of every entity HA knows about,
 * so an agent working from the file alone can add and position devices with no live connection of its own. Save
 * and the live editor state never get this field, only this one download, since a snapshot goes stale the moment
 * anything changes in HA; `migrate()` drops it again if the file is re-opened.
 */
export function exportJson(ed: FloorplanStudioEditor) {
  // S7.11: a trace image is megabytes an agent cannot read; it goes only when File, Include trace image is ticked.
  const own = ed.exportTrace ? ed.st.layout
    : { ...ed.st.layout, floors: Object.fromEntries(Object.entries(ed.st.layout.floors).map(([k, f]) => { const rest: Partial<Floor> = { ...f }; delete rest.trace; return [k, rest]; })) };
  const layout = ed.ha ? { ...own, available: availableEntities(ed.st.layout, ed.ha) } : own;
  const blob = new Blob([JSON.stringify(layout, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `floorplan-studio-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** The host calls this when it has written (or failed to write) the layout it got in `save-request`. */
export function saveDone(ed: FloorplanStudioEditor, ok: boolean, message?: string) {
  if (ok) ed.st.saveWritten();
  ed.status = ok ? message || "Saved" : message || "Save failed";
  ed.requestUpdate();
}

/** Wipes the plan to a blank one. In Home Assistant nothing stored changes until Save. */
export function reset(ed: FloorplanStudioEditor) {
  if (ed.st.planLocked) { ed.planFixed(); return; }
  if (!confirm("Erase everything and start from a blank plan? Nothing saved is touched until you Save. Undo brings it back.")) return;
  // Not through applyLayout: a blank plan is not a valid layout (an outline needs 3 points), so it would be refused.
  stopDraw(ed);
  ed.errors = [];
  ed.st.setLayout(emptyLayout(), undefined, true);
  ed.floor = ed.st.floor;
  ed.refreshNames();
  ed.changed("Blank plan. Draw, then Save.");
}

/** Only on a blank plan, so it never asks: there is nothing to lose. */
export function loadDemo(ed: FloorplanStudioEditor) {
  if (!ed.demo || !isBlank(ed.st.layout)) return;
  applyLayout(ed, ed.demo, "Demo home loaded");
}

/** S37.1: the three first-run choices. Each one ends it; the demo and the areas go through `applyLayout` (validate, one undo step, nothing changes on failure). */
export function firstRunDemo(ed: FloorplanStudioEditor) { ed.firstRun = false; loadDemo(ed); }

export function firstRunBlank(ed: FloorplanStudioEditor) { ed.firstRun = false; }

/** S37.2: one room per Home Assistant area. The plan stays unlocked, so the corners can be dragged next. */
export function roomsFromAreas(ed: FloorplanStudioEditor) {
  if (!isBlank(ed.st.layout)) return;
  const built = layoutFromAreas(ed.ha);
  if (!built) { ed.status = "No Home Assistant area has anything the plan can draw"; ed.requestUpdate(); return; }
  ed.firstRun = false;
  applyLayout(ed, built, `Drew ${built.floors.ground.rooms.length} rooms from your Home Assistant areas. Drag a corner to shape one`, false);
}

/** Validates first; on any problem lists them and leaves the current layout untouched. */
export function applyLayout(ed: FloorplanStudioEditor, x: unknown, status: string, lock = true): boolean {
  const r = loadLayout(x);
  if (!r.ok) { ed.errors = r.errors; ed.status = "Could not use that layout"; return false; }
  stopDraw(ed);
  ed.errors = [];
  ed.st.setLayout(structuredClone(r.layout), undefined, true);
  if (lock) ed.st.planLocked = !isBlank(r.layout);
  ed.floor = ed.st.floor;
  ed.refreshNames();
  ed.changed(status);
  return true;
}

/** For a host that has another version of the plan (a draft, the copy saved elsewhere): through validate, one undo step, nothing changes when it fails. The lock stays as it is. */
export function adoptLayout(ed: FloorplanStudioEditor, x: unknown, status: string): boolean { return applyLayout(ed, x, status, false); }

export async function openFile(ed: FloorplanStudioEditor, ev: Event) {
  const input = ev.target as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  try {
    applyLayout(ed, JSON.parse(await file.text()), `Opened ${file.name}`);
  } catch (e) {
    ed.errors = [`${file.name} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`];
    ed.status = "Could not use that file";
  }
  input.value = "";
}
