import { floorSwitch, MAX_VIEWS } from "../core";
import { stopDraw } from "./editor-draw";
import { closeAlign } from "./editor-align";
import { closeScene } from "./editor-popups";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- S33.7: saved views. Save, rename and delete are one undo step each (EditorState); applying is not an edit ---

/** Resets the form and the menu: the submenu closed, or a click went elsewhere. */
export function resetViews(ed: FloorplanStudioEditor) { if (ed.viewForm || ed.viewMenu) { ed.viewForm = null; ed.viewMenu = null; ed.requestUpdate(); } }

export async function startSaveView(ed: FloorplanStudioEditor, rename = "") {
  ed.viewMenu = null; ed.viewForm = { rename };
  ed.requestUpdate();
  await ed.updateComplete;
  const i = ed.renderRoot.querySelector<HTMLInputElement>("#viewName");
  if (rename) i?.select(); else i?.focus();
}

export const onViewFormKey = (ed: FloorplanStudioEditor, ev: KeyboardEvent) => {
  if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); ed.viewForm = null; ed.requestUpdate(); ed.renderRoot.querySelector<HTMLElement>("#saveView")?.focus({ preventScroll: true }); return; }
  if (ev.key === "Enter") { ev.preventDefault(); submitViewForm(ed); }
};

/** The control that held focus (the name field, the Delete item) leaves the DOM on the next render. Put focus on Save current
 * view, inside the open menu, so the keyboard keeps its place and Escape still closes the menu. */
export function keepViewFocus(ed: FloorplanStudioEditor) { void ed.updateComplete.then(() => ed.renderRoot.querySelector<HTMLElement>("#saveView")?.focus({ preventScroll: true })); }

export function submitViewForm(ed: FloorplanStudioEditor) {
  const form = ed.viewForm;
  if (!form) return;
  const name = ed.renderRoot.querySelector<HTMLInputElement>("#viewName")?.value.trim() ?? "";
  if (!name || name.length > 60) { ed.status = "Type a name for the view, up to 60 characters, or press Esc"; ed.requestUpdate(); return; }
  if (form.rename) {
    ed.viewForm = null;
    if (ed.st.renameView(form.rename, name)) ed.changed(`Renamed view to ${name}`); else ed.requestUpdate();
    keepViewFocus(ed);
    return;
  }
  if (ed.st.savedViews.length >= MAX_VIEWS) { ed.status = `A layout holds at most ${MAX_VIEWS} views: delete one first`; ed.requestUpdate(); return; }
  const mode = ed.renderRoot.querySelector<HTMLSelectElement>("#viewMode")?.value;
  ed.viewForm = null;
  if (ed.st.saveView(name, mode === "2d" || mode === "2.5d" || mode === "3d" ? mode : undefined)) ed.changed(`Saved view ${name}`); else ed.requestUpdate();
  keepViewFocus(ed);
}

export function applyView(ed: FloorplanStudioEditor, id: string) {
  const v = ed.st.savedViews.find((x) => x.id === id);
  if (!v) return;
  if (v.floor !== ed.st.floor) setFloorNow(ed, v.floor);
  if (ed.st.applyView(id)) { ed.status = `Showing view ${v.name}`; ed.requestUpdate(); }
}

export function openViewMenu(ed: FloorplanStudioEditor, ev: MouseEvent, id: string) {
  ev.preventDefault();
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(), pointer = ev.clientX || ev.clientY;
  ed.viewForm = null;
  ed.viewMenu = { id, x: Math.min(pointer ? ev.clientX : r.left + 24, window.innerWidth - 180), y: Math.min(pointer ? ev.clientY : r.bottom, window.innerHeight - 100) };
  ed.requestUpdate();
}

export function renameViewFromMenu(ed: FloorplanStudioEditor) { const id = ed.viewMenu?.id, v = ed.st.savedViews.find((x) => x.id === id); if (v) void startSaveView(ed, v.id); }

export function deleteViewFromMenu(ed: FloorplanStudioEditor) {
  const id = ed.viewMenu?.id, v = ed.st.savedViews.find((x) => x.id === id);
  ed.viewMenu = null;
  if (v && ed.st.deleteView(v.id)) ed.changed(`Deleted view ${v.name}`); else ed.requestUpdate();
  keepViewFocus(ed);
}

export function setFloor(ed: FloorplanStudioEditor, name: string) {
  const from = ed.st.floor, reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  setFloorNow(ed, name);
  ed.switchDir = floorSwitch(Object.keys(ed.st.layout.floors), from, ed.st.floor, reduced)?.dir ?? null; // S27.12: null for the same floor and for reduced motion
}

export function setFloorNow(ed: FloorplanStudioEditor, name: string) { stopDraw(ed); ed.traceMove = false; /* S40 review: Move belongs to the floor's image; it must not resume on another floor */ ed.st.setFloor(name); ed.floor = name; ed.placeRoom = null; if (ed.asideMode === "place" || ed.asideMode === "link") ed.asideMode = "selection"; closeAlign(ed, false); ed.linkScope = null; closeScene(ed); } // the Place popup belongs to a room of the floor it was opened on
