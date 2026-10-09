import { css, html, nothing } from "lit";
import { WALL_KINDS, areaMenuEntities, deleteEdge, insertPoint, inside, layerOfType, onEdge, setEdgeKind, typeForEntity } from "../core";
import type { Floor, HaData, Pt, WallKind } from "../core";
import { lockDevices, removeDevices } from "./bulk";
import { ctxItems, type CtxFacts, type CtxItem, type CtxTargetKind } from "./ctx-items";
import { TYPE_LABELS, WALL_LABELS } from "./panels";
import { polyPts } from "./state";
import type { FloorplanStudioEditor } from "./editor-app";

/** S4.18/S4.27: what the right-click context menu opened on. */
export type CtxTarget = { k: "room"; i: number } | { k: "edge"; poly: string; i: number }
  | { k: "wall"; i: number } | { k: "door"; i: number } | { k: "opening"; i: number } | { k: "furn"; i: number } | { k: "unl"; i: number }
  | { k: "stairs"; i: number } | { k: "extra"; i: number } | { k: "dev"; i: number } | { k: "devs" } | { k: "canvas" };

/** The context menu's own styles. */
export const ctxMenuCss = css`
    .ctxmenu{position:fixed;z-index:30;max-height:calc(100vh - 16px);overflow:auto;min-width:200px;display:flex;flex-direction:column;gap:4px;padding:6px;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.3)}
    .ctxmenu .btn{width:100%;text-align:left}
    .ctxmenu .btn[data-cm]{display:flex;justify-content:space-between;align-items:baseline;gap:16px}
    .ctxmenu .cm-k{font-size:.8em;opacity:.65}
    .ctxmenu .cm-ent{display:flex;flex-direction:column;align-items:flex-start;gap:1px}
    .ctxmenu .cm-ent small{font-size:.78em;opacity:.7}
`;

function ctxDelete(h: FloorplanStudioEditor) {
  const t = h.ctxMenu?.target;
  if (!t) return;
  const gone = (fn: (f: Floor) => Floor | void) => { h.commit(fn); h.st.sel = null; h.closeCtxMenu(); };
  if (t.k === "room") return gone((f) => { f.rooms.splice(t.i, 1); });
  if (t.k === "wall") return gone((f) => { f.walls.splice(t.i, 1); });
  if (t.k === "door") return gone((f) => { f.doors.splice(t.i, 1); });
  if (t.k === "opening") return gone((f) => { f.openings.splice(t.i, 1); });
  if (t.k === "furn") return gone((f) => { f.furniture.splice(t.i, 1); });
  if (t.k === "unl") return gone((f) => { f.unlinked.splice(t.i, 1); });
  if (t.k === "stairs") return gone((f) => { f.stairs.splice(t.i, 1); });
  if (t.k === "extra") return gone((f) => { f.extras.splice(t.i, 1); });
  if (t.k === "dev") return gone((f) => removeDevices(f, [t.i]));
  if (t.k === "devs") { const is = selectedDevices(h); return gone((f) => removeDevices(f, is)); }
  if (t.k !== "edge") { h.closeCtxMenu(); return; }
  const pts = polyPts(h.st.f, t.poly);
  if (!pts) { h.closeCtxMenu(); return; }
  const a = pts[t.i], b = pts[(t.i + 1) % pts.length], key = `${t.poly}:${t.i}`, n = onEdge(h.st.f, a, b);
  if (n.doors.length + n.openings.length && h.st.confirmEdge !== key) { h.st.confirmEdge = key; h.requestUpdate(); return; }
  h.st.confirmEdge = null;
  gone((f) => deleteEdge(f, t.poly, t.i));
}

/** The device indices a "devs" menu acts on: the selection, as it is now. */
function selectedDevices(h: FloorplanStudioEditor): number[] {
  const s = h.st.sel;
  return s?.t === "devs" ? [...s.is] : s?.t === "dev" ? [s.i] : [];
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

/** Whether the ctx menu's target is currently locked: false for a room, an edge, stairs or a line, none of which has the field. For a selection, locked only when every member is. */
function lockedOf(h: FloorplanStudioEditor, t: CtxTarget): boolean {
  const f = h.st.f;
  if (t.k === "wall") return !!f.walls[t.i]?.locked;
  if (t.k === "door") return !!f.doors[t.i]?.locked;
  if (t.k === "opening") return !!f.openings[t.i]?.locked;
  if (t.k === "furn") return !!f.furniture[t.i]?.locked;
  if (t.k === "unl") return !!f.unlinked[t.i]?.locked;
  if (t.k === "dev") return f.devices[t.i]?.locked === true;
  if (t.k === "devs") { const is = selectedDevices(h); return is.length > 0 && is.every((i) => f.devices[i]?.locked === true); }
  return false;
}

/** Toggles the ctx menu's target between locked and unlocked, one undo step, then closes the menu. A wall or opening
 *  locked this way keeps its length on drag (S4.9); a device, furniture piece or unlinked object stops being draggable. */
function ctxToggleLock(h: FloorplanStudioEditor) {
  const t = h.ctxMenu?.target;
  if (!t) return;
  const next = !lockedOf(h, t);
  if (t.k === "wall") h.commit((f) => { if (f.walls[t.i]) f.walls[t.i].locked = next; });
  else if (t.k === "door") h.commit((f) => { if (f.doors[t.i]) f.doors[t.i].locked = next; });
  else if (t.k === "opening") h.commit((f) => { if (f.openings[t.i]) f.openings[t.i].locked = next; });
  else if (t.k === "furn") h.commit((f) => { if (f.furniture[t.i]) f.furniture[t.i].locked = next; });
  else if (t.k === "unl") h.commit((f) => { if (f.unlinked[t.i]) f.unlinked[t.i].locked = next; });
  else if (t.k === "dev") h.commit((f) => lockDevices(f, [t.i], next));
  else if (t.k === "devs") { const is = selectedDevices(h); h.commit((f) => lockDevices(f, is, next)); }
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

/** The twelve kinds of menu, one per `CtxTarget`. */
const kindOf = (t: CtxTarget): CtxTargetKind => t.k;

/** What `ctxItems` needs to know about the target right now. */
function factsOf(h: FloorplanStudioEditor, t: CtxTarget): CtxFacts {
  const f = h.st.f;
  const is = t.k === "dev" ? [t.i] : t.k === "devs" ? selectedDevices(h) : [];
  return { locked: lockedOf(h, t), hasLight: is.some((i) => f.devices[i]?.type === "light"), count: t.k === "devs" ? is.length : 1, ha: !!h.st.ha };
}

/** The indices of the devices on this floor that are drawn, matching `pred`: a hidden layer is not selectable. */
function visibleDevices(h: FloorplanStudioEditor, pred: (d: Floor["devices"][number]) => boolean): number[] {
  const f = h.st.f;
  return f.devices.map((d, i) => ({ d, i })).filter(({ d }) => pred(d) && !h.st.hidden.includes(layerOfType(d.type))).map(({ i }) => i);
}

/** Selects these devices: none clears, one is a plain device, more is a multi-selection. */
function selectDevices(h: FloorplanStudioEditor, is: number[]) {
  h.st.sel = is.length > 1 ? { t: "devs", is } : is.length === 1 ? { t: "dev", i: is[0] } : null;
}

/** The point a device is picked by, as the marquee takes it. */
const centreOf = (d: Floor["devices"][number]): Pt => ("a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y]);

/** Focuses the first of these panel fields once the selection's panel is drawn; said in the status line when none is.
 *  After the click has finished: the host hands focus to itself on every button click (`onButtonClick`), after this runs. */
function focusField(h: FloorplanStudioEditor, ids: string[], none: string) {
  void h.updateComplete.then(() => setTimeout(() => {
    const el = ids.map((id) => h.renderRoot.querySelector<HTMLElement>(`#${id}`)).find((e) => e);
    if (el) el.focus({ preventScroll: true }); else { h.status = none; h.requestUpdate(); }
  }, 0));
}

/** Runs one menu item. Every id `ctxItems` can return for `t` is handled here; the others do nothing. */
function runItem(h: FloorplanStudioEditor, t: CtxTarget, id: string) {
  const m = h.ctxMenu!, st = h.st;
  const done = () => h.closeCtxMenu();
  switch (id) {
    case "delete": return ctxDelete(h);
    case "lock": return ctxToggleLock(h);
    case "toFront": return ctxBringToFront(h);
    case "toBack": return ctxSendToBack(h);
    case "addPoint": return ctxAddPoint(h);
    case "addDoor": return ctxAddDoor(h, "door", 90);
    case "addWindow": return ctxAddDoor(h, "window", 120);
    case "addOpening": return ctxAddOpening(h);
    case "rename": {
      done();
      focusField(h, ["rn", "dn", "sn", "fun", "uun", "exn", "vname"], "This name comes from Home Assistant; rename it there.");
      return;
    }
    case "controlledBy": done(); return focusField(h, ["vbound"], "Select a light to set what powers it.");
    case "placeFromArea": if (t.k === "room") { done(); h.openPlace(t.i); } return;
    case "selectInside": {
      if (t.k !== "room") return;
      const r = st.f.rooms[t.i];
      selectDevices(h, r ? visibleDevices(h, (d) => inside(centreOf(d), r.pts)) : []);
      return done();
    }
    case "selectSameType": {
      const d = t.k === "dev" ? st.f.devices[t.i] : undefined;
      if (d) selectDevices(h, visibleDevices(h, (x) => x.type === d.type));
      return done();
    }
    case "hideType": {
      const d = t.k === "dev" ? st.f.devices[t.i] : undefined;
      if (d && !st.hidden.includes(layerOfType(d.type))) h.setLayers([...st.hidden, layerOfType(d.type)]);
      return done();
    }
    case "addDeviceHere": done(); return h.openAddDev(h.toSvg({ clientX: m.x, clientY: m.y }));
    case "selectAll": selectDevices(h, visibleDevices(h, () => true)); return done();
    case "zoomFit": st.fit(); return done();
  }
}

/** One menu item as a button: the label at the left, its key at the right edge. The id on it is the `ctxItems` id. */
function itemView(h: FloorplanStudioEditor, t: CtxTarget, it: CtxItem) {
  const dom = `cm${it.id[0].toUpperCase()}${it.id.slice(1)}`;
  return html`<button class="btn ${it.id === "delete" ? "warn" : ""}" id=${dom} data-cm=${it.id} ?disabled=${it.disabled === true} @click=${() => runItem(h, t, it.id)}><span class="cm-l">${it.label}</span>${it.key ? html`<span class="cm-k">${it.key}</span>` : nothing}</button>`;
}

/** S4.18/S4.27's menu markup, positioned at the click (`position:fixed`, so no container-relative math is needed). S26.20: the items and their order come from `ctxItems`; a wall's Change type is a heading with the kinds under it. */
export function ctxMenuView(h: FloorplanStudioEditor, m: { x: number; y: number; target: CtxTarget }) {
  const t = m.target;
  const confirm = (t.k === "edge" || t.k === "wall") ? edgeConfirm(h, t) : null;
  const items = confirm ?? ctxItems(kindOf(t), factsOf(h, t)).map((it) => it.id === "kind" && (t.k === "edge" || t.k === "wall") ? kindView(h, t, it) : itemView(h, t, it));
  const extra = t.k === "room" && !confirm ? roomEntities(h, t.i) : nothing;
  // Keep the menu on screen: it opens at the click, but not past the right edge; `fitCtxMenu` shifts it up once its height is known,
  // and a menu taller than the window scrolls.
  const left = Math.max(0, Math.min(m.x, window.innerWidth - 240)), top = Math.max(0, Math.min(m.y, window.innerHeight - 120));
  return html`<div class="ctxmenu" style="left:${left}px;top:${top}px;">${items}${extra}</div>`;
}

/** R5: after a render, moves an open menu up so its foot is inside the window (8 px spare), as far as the top allows. The height is only known now. */
export function fitCtxMenu(root: ParentNode) {
  const m = root.querySelector<HTMLElement>(".ctxmenu");
  if (!m) return;
  const r = m.getBoundingClientRect(), over = r.bottom - (window.innerHeight - 8);
  if (over > 0) m.style.top = `${Math.max(8, r.top - over)}px`;
}

/** The room's unplaced Home Assistant entities, one button each: a quick Place (S4.18, S8.6, S24.6), under the items. */
function roomEntities(h: FloorplanStudioEditor, i: number) {
  const st = h.st, r = st.f.rooms[i], ha = st.ha;
  // S8.6: one row per device (its main entity), not one per raw entity — a plug offers itself, not its power sensor.
  // S24.6 (U16): and only what Place offers (`areaMenuEntities`): no loose power sensor, scene or battery.
  const unplaced = r?.area ? areaMenuEntities(st.layout, ha, r.area) : [];
  return unplaced.length ? html`<div class="sep"></div><span class="grp">Add device from ${r!.name}</span>
      ${unplaced.map((e) => html`<button class="btn cm-ent" @click=${() => addFromArea(h, e)}><span>${e.name} (${TYPE_LABELS.find((t) => t[0] === typeForEntity(e, ha))?.[1] ?? typeForEntity(e, ha)})</span><small>${e.id}</small></button>`)}` : nothing;
}

/** The wall's kind, as `ctxItems` names it "Change type": a heading, then the other kinds. */
function kindView(h: FloorplanStudioEditor, t: Extract<CtxTarget, { k: "edge" | "wall" }>, it: CtxItem) {
  const f = h.st.f;
  let kind: WallKind;
  if (t.k === "edge") { const ek = h.edgeKind(t.poly, t.i); kind = ek === "none" ? "wall" : ek; } else kind = f.walls[t.i]?.kind ?? "wall";
  return html`<span class="grp" data-cm=${it.id}><span class="cm-l">${it.label}</span></span>
    ${WALL_KINDS.filter((k) => k !== kind).map((k) => html`<button class="btn" @click=${() => ctxSetKind(h, k)}>${WALL_LABELS[k]}</button>`)}
    <div class="sep"></div>`;
}

/** S4.27: the doors/windows confirm that replaces an edge's menu after its first Delete, same as the edge panel's own Delete. Null when there is nothing to confirm. */
function edgeConfirm(h: FloorplanStudioEditor, t: Extract<CtxTarget, { k: "edge" | "wall" }>) {
  const f = h.st.f;
  let a: Pt, b: Pt, key: string;
  if (t.k === "edge") {
    const pts = polyPts(f, t.poly);
    if (!pts) return null;
    a = pts[t.i]; b = pts[(t.i + 1) % pts.length]; key = `${t.poly}:${t.i}`;
  } else {
    const w = f.walls[t.i];
    if (!w) return null;
    a = w.a; b = w.b; key = `wall:${t.i}`;
  }
  if (h.st.confirmEdge !== key) return null;
  const n = t.k === "edge" ? onEdge(f, a, b) : { doors: [], openings: [] };
  const count = n.doors.length + n.openings.length;
  return html`<p class="hint">${count === 1 ? "A door or window is on this wall." : `${count} doors and windows are on this wall.`} They stay. Stop drawing it?</p>
      <div class="row"><button class="btn warn" @click=${() => ctxDelete(h)}>Delete</button><button class="btn" @click=${() => { h.st.confirmEdge = null; h.requestUpdate(); }}>Cancel</button></div>`;
}

/** What a hit on the plan opens: the menu's target, with the selection set to match (a right-click on a member of a
 *  multi-selection keeps it). Null when the hit has no menu (a corner handle, a room kind without one): the host closes. */
export function ctxTargetFor(h: FloorplanStudioEditor, hit: { k: string; i?: number; poly?: string }): CtxTarget | null {
  const st = h.st, f = st.f, i = hit.i ?? -1;
  switch (hit.k) {
    case "room": {
      const r = f.rooms[i];
      if (!r || (r.kind !== "room" && r.kind !== "zone" && r.kind !== "structure")) return { k: "canvas" };
      st.sel = { t: "room", i }; return { k: "room", i };
    }
    case "edge":
      if (h.edgeKind(hit.poly ?? "", i) === "none") return { k: "canvas" };
      st.sel = { t: "edge", poly: hit.poly ?? "", i }; return { k: "edge", poly: hit.poly ?? "", i };
    case "wall": case "door": case "opening": case "furn": case "unl": case "stairs": case "extra": {
      const list = { wall: f.walls, door: f.doors, opening: f.openings, furn: f.furniture, unl: f.unlinked, stairs: f.stairs, extra: f.extras }[hit.k]!;
      if (!list[i]) return null;
      st.sel = { t: hit.k as "wall", i }; return { k: hit.k as "wall", i };
    }
    case "dev": {
      if (!f.devices[i]) return null;
      if (st.sel?.t === "devs" && st.sel.is.includes(i)) return { k: "devs" };
      st.sel = { t: "dev", i }; return { k: "dev", i };
    }
    case "bg": return { k: "canvas" };
    default: return null;
  }
}
