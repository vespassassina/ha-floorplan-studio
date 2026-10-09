import { css, html, nothing } from "lit";
import { WALL_KINDS, areaMenuEntities, deleteEdge, insertPoint, onEdge, setEdgeKind, typeForEntity } from "../core";
import type { HaData, Pt, WallKind } from "../core";
import { TYPE_LABELS, WALL_LABELS } from "./panels";
import { polyPts } from "./state";
import type { FloorplanStudioEditor } from "./editor-app";

/** S4.18/S4.27: what the right-click context menu opened on. */
export type CtxTarget = { k: "room"; i: number } | { k: "edge"; poly: string; i: number }
  | { k: "wall"; i: number } | { k: "door"; i: number } | { k: "opening"; i: number } | { k: "furn"; i: number } | { k: "unl"; i: number };

/** The context menu's own styles. */
export const ctxMenuCss = css`
    .ctxmenu{position:fixed;z-index:30;max-height:70vh;overflow:auto;min-width:200px;display:flex;flex-direction:column;gap:4px;padding:6px;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.3)}
    .ctxmenu .btn{width:100%;text-align:left}
    .ctxmenu .cm-ent{display:flex;flex-direction:column;align-items:flex-start;gap:1px}
    .ctxmenu .cm-ent small{font-size:.78em;opacity:.7}
`;

function ctxDelete(h: FloorplanStudioEditor) {
  const t = h.ctxMenu?.target;
  if (!t) return;
  if (t.k === "room") {
    h.commit((f) => { f.rooms.splice(t.i, 1); });
    h.st.sel = null;
    h.closeCtxMenu();
    return;
  }
  if (t.k === "wall") {
    h.commit((f) => { f.walls.splice(t.i, 1); });
    h.st.sel = null;
    h.closeCtxMenu();
    return;
  }
  if (t.k !== "edge") return; // Delete lives only on the room, wall and edge menus
  const pts = polyPts(h.st.f, t.poly);
  if (!pts) { h.closeCtxMenu(); return; }
  const a = pts[t.i], b = pts[(t.i + 1) % pts.length], key = `${t.poly}:${t.i}`, n = onEdge(h.st.f, a, b);
  if (n.doors.length + n.openings.length && h.st.confirmEdge !== key) { h.st.confirmEdge = key; h.requestUpdate(); return; }
  h.st.confirmEdge = null;
  h.commit((f) => deleteEdge(f, t.poly, t.i));
  h.st.sel = null;
  h.closeCtxMenu();
}

/** Diego, 2026-09-28: moves the ctx menu's room to the end of `f.rooms`, so it paints on top of every other
 *  room's fill — a garden zone drawn after a garden house was covering the garden house's own pavement, with
 *  no way to fix it short of redrawing the shape. One undo step; already-last is a no-op. */
function ctxBringToFront(h: FloorplanStudioEditor) {
  const t = h.ctxMenu?.target;
  if (!t || t.k !== "room") return;
  const i = t.i;
  h.commit((f) => { const [r] = f.rooms.splice(i, 1); f.rooms.push(r); });
  if (h.st.sel?.t === "room" && h.st.sel.i === i) h.st.sel = { t: "room", i: h.st.f.rooms.length - 1 };
  h.closeCtxMenu();
}

/** Same as `ctxBringToFront`, moved to the start of `f.rooms` instead, so it paints under every other room. */
function ctxSendToBack(h: FloorplanStudioEditor) {
  const t = h.ctxMenu?.target;
  if (!t || t.k !== "room") return;
  const i = t.i;
  h.commit((f) => { const [r] = f.rooms.splice(i, 1); f.rooms.unshift(r); });
  if (h.st.sel?.t === "room" && h.st.sel.i === i) h.st.sel = { t: "room", i: 0 };
  h.closeCtxMenu();
}

/** Whether the ctx menu's target is currently locked (fixed): false for a room or an edge, neither of which has the field. */
function lockedOf(h: FloorplanStudioEditor, t: CtxTarget): boolean {
  const f = h.st.f;
  if (t.k === "wall") return !!f.walls[t.i]?.locked;
  if (t.k === "door") return !!f.doors[t.i]?.locked;
  if (t.k === "opening") return !!f.openings[t.i]?.locked;
  if (t.k === "furn") return !!f.furniture[t.i]?.locked;
  if (t.k === "unl") return !!f.unlinked[t.i]?.locked;
  return false;
}

/** Toggles the ctx menu's target between fixed and unfixed, one undo step, then closes the menu. A wall or opening
 *  fixed this way keeps its length on drag (S4.9); furniture and an unlinked device simply stop being draggable. */
function ctxToggleLock(h: FloorplanStudioEditor) {
  const t = h.ctxMenu?.target;
  if (!t) return;
  const next = !lockedOf(h, t);
  if (t.k === "wall") h.commit((f) => { if (f.walls[t.i]) f.walls[t.i].locked = next; });
  else if (t.k === "door") h.commit((f) => { if (f.doors[t.i]) f.doors[t.i].locked = next; });
  else if (t.k === "opening") h.commit((f) => { if (f.openings[t.i]) f.openings[t.i].locked = next; });
  else if (t.k === "furn") h.commit((f) => { if (f.furniture[t.i]) f.furniture[t.i].locked = next; });
  else if (t.k === "unl") h.commit((f) => { if (f.unlinked[t.i]) f.unlinked[t.i].locked = next; });
  else return;
  h.closeCtxMenu();
}

/** S4.27: sets a wall's kind (an edge's, on every room sharing it, or a free wall's own), one undo step, then closes the menu. */
function ctxSetKind(h: FloorplanStudioEditor, kind: WallKind) {
  const t = h.ctxMenu?.target;
  if (!t) return;
  if (t.k === "edge") h.commit((f) => setEdgeKind(f, t.poly, t.i, kind));
  else if (t.k === "wall") h.commit((f) => { f.walls[t.i].kind = kind; });
  else return;
  h.closeCtxMenu();
}

/** S4.27: inserts a point at an edge's own midpoint (never a free wall — it has no interior points), one undo step. */
function ctxAddPoint(h: FloorplanStudioEditor) {
  const t = h.ctxMenu?.target;
  if (!t || t.k !== "edge") return;
  const pts = polyPts(h.st.f, t.poly);
  if (!pts) return;
  const a = pts[t.i], b = pts[(t.i + 1) % pts.length];
  h.commit((f) => insertPoint(f, t.poly, t.i, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)]));
  h.closeCtxMenu();
}

/** S4.27: places a new opening (a gap) centred on the right-click point — the same `addOpeningGap` an Add-menu item uses, anchored at the click instead of the view's centre. */
function ctxAddOpening(h: FloorplanStudioEditor) {
  const m = h.ctxMenu;
  if (!m) return;
  h.addOpeningGap(120, h.toSvg({ clientX: m.x, clientY: m.y }));
  h.closeCtxMenu();
}

/** S4.27: places a new door or window centred on the right-click point, the same way `ctxAddOpening` places a gap. */
function ctxAddDoor(h: FloorplanStudioEditor, kind: "door" | "window" | "slit" | "open", len: number) {
  const m = h.ctxMenu;
  if (!m) return;
  h.addDoor(kind, len, h.toSvg({ clientX: m.x, clientY: m.y }));
  h.closeCtxMenu();
}

/** S4.18: places `e` (an entity of the menu's room's HA area) as a new device at the right-click point (S4.26), one undo step, then closes the menu. */
function addFromArea(h: FloorplanStudioEditor, e: HaData["entities"][number]) {
  const t = h.ctxMenu?.target;
  if (!t || t.k !== "room") return;
  const m = h.ctxMenu!;
  const before = h.counted();
  if (!h.st.addFromArea(t.i, e, h.toSvg({ clientX: m.x, clientY: m.y }))) return;
  h.closeCtxMenu();
  h.placedNote(before, `Added ${e.name}. Drag it to its spot.`, `Added ${e.name}`);
}

/** S4.18/S4.27's menu markup, positioned at the click (`position:fixed`, so no container-relative math is needed). */
export function ctxMenuView(h: FloorplanStudioEditor, m: { x: number; y: number; target: CtxTarget }) {
  const t = m.target;
  let items;
  if (t.k === "room") items = roomCtxItems(h, t.i);
  else if (t.k === "edge" || t.k === "wall") items = wallCtxItems(h, t);
  else items = fixCtxItems(h, t);
  return html`<div class="ctxmenu" style="left:${m.x}px;top:${m.y}px">${items}</div>`;
}

function roomCtxItems(h: FloorplanStudioEditor, i: number) {
  const st = h.st, r = st.f.rooms[i], ha = st.ha;
  // S8.6: one row per device (its main entity), not one per raw entity — a plug offers itself, not its power sensor.
  // S24.6 (U16): and only what Place offers (`areaMenuEntities`): no loose power sensor, scene or battery.
  const unplaced = r?.area ? areaMenuEntities(st.layout, ha, r.area) : [];
  return html`<button class="btn" id="cmColour" @click=${() => h.closeCtxMenu()}>Change colour</button>
    <button class="btn" id="cmToFront" @click=${() => ctxBringToFront(h)}>Bring to front</button>
    <button class="btn" id="cmToBack" @click=${() => ctxSendToBack(h)}>Send to back</button>
    <button class="btn warn" id="cmDelete" @click=${() => ctxDelete(h)}>Delete</button>
    ${unplaced.length ? html`<div class="sep"></div><span class="grp">Add device from ${r!.name}</span>
      ${unplaced.map((e) => html`<button class="btn cm-ent" @click=${() => addFromArea(h, e)}><span>${e.name} (${TYPE_LABELS.find((t) => t[0] === typeForEntity(e, ha))?.[1] ?? typeForEntity(e, ha)})</span><small>${e.id}</small></button>`)}` : nothing}`;
}

/** S4.27: Change type, Add a point (edges only), Add an opening, Delete — with the same doors/windows confirm dance as the edge panel's own Delete. */
function wallCtxItems(h: FloorplanStudioEditor, t: Extract<CtxTarget, { k: "edge" | "wall" }>) {
  const f = h.st.f;
  let kind: WallKind, a: Pt | undefined, b: Pt | undefined, key: string;
  if (t.k === "edge") {
    const pts = polyPts(f, t.poly);
    if (!pts) return nothing;
    a = pts[t.i]; b = pts[(t.i + 1) % pts.length];
    const ek = h.edgeKind(t.poly, t.i);
    kind = ek === "none" ? "wall" : ek;
    key = `${t.poly}:${t.i}`;
  } else {
    const w = f.walls[t.i];
    if (!w) return nothing;
    a = w.a; b = w.b; kind = w.kind; key = `wall:${t.i}`;
  }
  if (h.st.confirmEdge === key) {
    const n = t.k === "edge" ? onEdge(f, a, b) : { doors: [], openings: [] };
    const count = n.doors.length + n.openings.length;
    return html`<p class="hint">${count === 1 ? "A door or window is on this wall." : `${count} doors and windows are on this wall.`} They stay. Stop drawing it?</p>
      <div class="row"><button class="btn warn" @click=${() => ctxDelete(h)}>Delete</button><button class="btn" @click=${() => { h.st.confirmEdge = null; h.requestUpdate(); }}>Cancel</button></div>`;
  }
  return html`<span class="grp">Change type</span>
    ${WALL_KINDS.filter((k) => k !== kind).map((k) => html`<button class="btn" @click=${() => ctxSetKind(h, k)}>${WALL_LABELS[k]}</button>`)}
    <div class="sep"></div>
    ${t.k === "edge" ? html`<button class="btn" @click=${() => ctxAddPoint(h)}>Add a point</button>` : nothing}
    <details class="sub" id="cmAddOpening"><summary class="btn">Add an opening</summary>
      <button class="btn" @click=${() => ctxAddDoor(h, "door", 90)}>Door</button>
      <button class="btn" @click=${() => ctxAddDoor(h, "open", 90)}>Open doorway</button>
      <button class="btn" @click=${() => ctxAddDoor(h, "window", 120)}>Window</button>
      <button class="btn" @click=${() => ctxAddDoor(h, "slit", 120)}>Slit window</button>
      <button class="btn" @click=${() => ctxAddOpening(h)}>Opening</button>
    </details>
    ${t.k === "wall" ? html`<button class="btn" @click=${() => ctxToggleLock(h)}>${lockedOf(h, t) ? "Unfix" : "Fix"}</button>` : nothing}
    <button class="btn warn" @click=${() => ctxDelete(h)}>Delete</button>`;
}

/** S4.27/S4.29: a door, opening, furniture piece or unlinked device offers only Fix/Unfix — delete already lives on its own side panel. */
function fixCtxItems(h: FloorplanStudioEditor, t: Extract<CtxTarget, { k: "door" | "opening" | "furn" | "unl" }>) {
  return html`<button class="btn" @click=${() => ctxToggleLock(h)}>${lockedOf(h, t) ? "Unfix" : "Fix"}</button>`;
}
