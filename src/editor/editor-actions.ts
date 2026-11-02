import { stopDraw } from "./editor-draw";
import { type DeviceType, type Pt, rotateAbout } from "../core";
import { applyLinks, linkScopeFor, linkSuggestions } from "./bulk";
import { roomMiddle, spawnInView, spawnPoint } from "./ops";
import { floorDone } from "./editor-ha";
import { hasOwn } from "./editor-kit";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- actions: undo, colour, link, rotate, floors ---------------------------------------------------------

export function undo(ed: FloorplanStudioEditor, back: boolean) {
  stopDraw(ed);
  if (back ? ed.st.undo() : ed.st.redo()) { ed.floor = ed.st.floor; ed.refreshNames(); ed.changed(back ? "Undone" : "Redone"); }
}

/** View, Rotate the plan: one undo step. The stored coordinates are not touched; only `layout.rotate` changes. */
export function setColour(ed: FloorplanStudioEditor, t: DeviceType, hex: string | null) {
  if (ed.st.setColour(t, hex)) ed.changed(hex ? `${t} colour set` : `${t} colour reset`);
}

/** S26.23: Edit, "Link lights to switches" opens the Link mode: the pairs (light, suggested switch) in the selection, else the selected room, else the floor, all ticked. Nothing is written until Apply. */
export function openLink(ed: FloorplanStudioEditor) {
  ed.linkScope = linkScopeFor(ed.st.sel); ed.linkFloor = ed.st.f; ed.linkOff = new Set(); ed.asideMode = "link";
  ed.closeMenus(); // a top-level Edit item is a one-shot action: it closes the menu
  ed.requestUpdate();
}

export function closeLink(ed: FloorplanStudioEditor) { ed.linkScope = null; if (ed.asideMode === "link") ed.asideMode = "selection"; ed.requestUpdate(); }

/** The pairs the Link mode shows now, from the live layout, so an Undo or an edit shows at once. */
export function linkRows(ed: FloorplanStudioEditor) { return ed.linkScope ? linkSuggestions(ed.st, ed.linkScope) : []; }

/** Apply: binds the ticked lights in one undo step (the layout is not touched when the plan lock or "nothing" refuses). */
export function applyLink(ed: FloorplanStudioEditor) {
  const links = linkRows(ed).filter((p) => !ed.linkOff.has(ed.st.f.devices[p.i].id));
  if (!links.length) return;
  if (ed.st.edit((f) => applyLinks(f, links))) ed.changed(`Linked ${links.length} light${links.length === 1 ? "" : "s"}`); else ed.refused();
  closeLink(ed);
}

export function rotatePlan(ed: FloorplanStudioEditor, step: number) {
  if (ed.st.setRotate((ed.st.layout.rotate ?? 0) + step)) ed.changed(`Plan rotated to ${ed.st.layout.rotate}°`);
  else ed.refused();
}

export function centre(ed: FloorplanStudioEditor): Pt { const v = ed.st.view; return [Math.round(v.x + v.w / 2), Math.round(v.y + v.h / 2)]; }

/** Where a new item (a wall, a structure, a zone, stairs, furniture) goes: outside the house, top right. */
export function spawn(ed: FloorplanStudioEditor, inRoom = false): Pt { return (inRoom ? middle(ed) : null) ?? spawnPoint(ed.st.f, centre(ed), ed.st.snapGrid); }

/** The middle of the selected room, or null (Diego, 2026-10-07: new things land there). */
export function middle(ed: FloorplanStudioEditor): Pt | null { return roomMiddle(ed.st.f, ed.st.sel, ed.st.snapGrid); }

/** Where a new device or unlinked appliance goes: the middle of the current viewport (Diego, 2026-09-28). */
export function spawnDevice(ed: FloorplanStudioEditor): Pt { return spawnInView(ed.st.f, ed.addAt ?? middle(ed) ?? centre(ed), ed.st.snapGrid); }

/** Brings all of `pts` into what the svg shows, with a 100 cm margin: pans by the least amount, and zooms out only when they do not fit. */
export function ensureVisible(ed: FloorplanStudioEditor, ...plan: Pt[]) {
  const st = ed.st, v = st.view, s = ed.scale, M = 100, r = st.rotation;
  // Work in what the screen shows: turn the points and the view centre by the plan's rotation, and the result back.
  const pts = r ? plan.map((q) => rotateAbout(q, r.deg, r.pivot)) : plan;
  const x0 = Math.min(...pts.map((q) => q[0])), x1 = Math.max(...pts.map((q) => q[0]));
  const y0 = Math.min(...pts.map((q) => q[1])), y1 = Math.max(...pts.map((q) => q[1]));
  const k = Math.max(1, (x1 - x0 + 2 * M) / (ed.rect.w / s), (y1 - y0 + 2 * M) / (ed.rect.h / s)); // >1: does not fit
  const w = v.w * k, h = v.h * k, hw = ed.rect.w / s * k / 2, hh = ed.rect.h / s * k / 2;
  const c0: Pt = [v.x + v.w / 2, v.y + v.h / 2], [cx, cy] = r ? rotateAbout(c0, r.deg, r.pivot) : c0;
  const shift = (c: number, half: number, lo: number, hi: number) => {
    if (hi - lo + 2 * M >= 2 * half) return (lo + hi) / 2 - c; // fills the view: centre on it
    if (lo - M < c - half) return lo - M - (c - half);
    if (hi + M > c + half) return hi + M - (c + half);
    return 0;
  };
  const dx = shift(cx, hw, x0, x1), dy = shift(cy, hh, y0, y1);
  if (!(dx || dy || k > 1)) return;
  const c1: Pt = r ? rotateAbout([cx + dx, cy + dy], -r.deg, r.pivot) : [cx + dx, cy + dy];
  st.views[st.floor] = { x: c1[0] - w / 2, y: c1[1] - h / 2, w, h };
}

export function renameFloor(ed: FloorplanStudioEditor, key: string, title: string) {
  if (ed.st.renameFloor(key, title)) floorDone(ed, `Renamed floor to ${title.trim()}`);
  else ed.refused();
}

export function moveFloor(ed: FloorplanStudioEditor, key: string, delta: number) { if (ed.st.moveFloor(key, delta)) floorDone(ed, delta > 0 ? "Moved floor up" : "Moved floor down"); else ed.refused(); }

export function deleteFloor(ed: FloorplanStudioEditor, key: string) {
  const title = (hasOwn(ed.st.layout.floors, key) ? ed.st.layout.floors[key].title : "") || key;
  if (ed.st.deleteFloor(key)) { floorDone(ed, `Deleted floor ${title}`); ed.focus({ preventScroll: true }); }
  else ed.refused();
}

/** S27.9: the Floors menu acts on the current floor. */
export function moveCurrentFloor(ed: FloorplanStudioEditor, delta: number) { moveFloor(ed, ed.st.floor, delta); }

/** Floors, Delete floor…: the floor panel asks first, as its own Delete floor button does. */
export function askDeleteFloor(ed: FloorplanStudioEditor) {
  if (Object.keys(ed.st.layout.floors).length < 2) return;
  stopDraw(ed); ed.st.sel = null; ed.asideMode = "selection"; ed.st.confirmDelete = true; ed.requestUpdate();
}

export async function startAddFloor(ed: FloorplanStudioEditor) {
  ed.addingFloor = true;
  await ed.updateComplete;
  ed.renderRoot.querySelector<HTMLInputElement>("#newFloor")?.focus();
}

export function cancelAddFloor(ed: FloorplanStudioEditor) { ed.addingFloor = false; ed.focus({ preventScroll: true }); }

export const onNewFloorKey = (ed: FloorplanStudioEditor, ev: KeyboardEvent) => {
  if (ev.key === "Escape") { ev.preventDefault(); cancelAddFloor(ed); return; }
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  const title = (ev.target as HTMLInputElement).value.trim();
  if (!title) { ed.status = "Type a name for the floor, or press Esc"; return; }
  ed.addingFloor = false;
  if (ed.st.addFloor(title)) { floorDone(ed, `Added floor ${title}`); ed.focus({ preventScroll: true }); }
  else ed.refused();
};
