import { layoutEntries, type SearchEntry } from "../core/search";
import { undo } from "./editor-actions";
import { setPlanLocked } from "./editor-changes";
import { startDraw } from "./editor-draw";
import { openAddDev } from "./editor-popups";
import { buildOutline, deviceNodeId, filterOutline, outlineKey, type OutlineNode, type OutlineRow, outlineView, visibleRows } from "./outline";
import { layerCounts, type LayerId, layerOfType, LAYERS, type Pt, soloLayer, toggleLayer, viewBoxFor } from "../core";
import { hasOwn } from "./editor-kit";
import { roomMiddle } from "./ops";
import { ctxTargetFor } from "./ctx-menu";
import { html, nothing } from "lit";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- S24.5: search and Outline ---------------------------------------------------------------------------

/** mdiEye and mdiEyeOff, for the Layers rows (S24.6). Here, not in core's UI_ICONS, so the card bundle does not carry them. */
const EYE = "M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z";

const EYE_OFF = "M11.83,9L15,12.16C15,12.11 15,12.05 15,12A3,3 0 0,0 12,9C11.94,9 11.89,9 11.83,9M7.53,9.8L9.08,11.35C9.03,11.56 9,11.77 9,12A3,3 0 0,0 12,15C12.22,15 12.44,14.97 12.65,14.92L14.2,16.47C13.53,16.8 12.79,17 12,17A5,5 0 0,1 7,12C7,11.21 7.2,10.47 7.53,9.8M2,4.27L4.28,6.55L4.73,7C3.08,8.3 1.78,10 1,12C2.73,16.39 7,19.5 12,19.5C13.55,19.5 15.03,19.2 16.38,18.66L16.81,19.08L19.73,22L21,20.73L3.27,3M12,7A5,5 0 0,1 17,12C17,12.64 16.87,13.26 16.64,13.82L19.57,16.75C21.07,15.5 22.27,13.86 23,12C21.27,7.61 17,4.5 12,4.5C10.6,4.5 9.26,4.75 8,5.2L10.17,7.35C10.74,7.13 11.35,7 12,7Z";

/** S24.5: how long the ring stays round what a search or the Outline went to: three beats of `fp-locate`. */
const LOCATE_MS = 2400;

/** A few editor actions the search offers. Each runs what its menu item or button runs. */
export function commands(ed: FloorplanStudioEditor): SearchEntry[] {
  const c = (id: string, name: string): SearchEntry => ({ kind: "command", id, name });
  return [c("cmd:fix", ed.st.planLocked ? "Unlock plan" : "Lock plan"), c("cmd:drawRoom", "Draw room"), c("cmd:addDevice", "Add device…"), c("cmd:fit", "Zoom to fit"), c("cmd:undo", "Undo"), c("cmd:save", "Save")];
}

export function runCommand(ed: FloorplanStudioEditor, id: string) {
  if (id === "cmd:fix") setPlanLocked(ed, !ed.st.planLocked);
  else if (id === "cmd:drawRoom") startDraw(ed, "room");
  else if (id === "cmd:addDevice") openAddDev(ed);
  else if (id === "cmd:fit") { ed.st.fit(); ed.requestUpdate(); }
  else if (id === "cmd:undo") undo(ed, true);
  else if (id === "cmd:save") ed.save();
}

/** The search entries (commands first) and the Outline, rebuilt only when what they are made of changed: an edit
 *  replaces the floor it touches, so the floors' identities are the key. */
export function findData(ed: FloorplanStudioEditor): { entries: SearchEntry[]; tree: OutlineNode[] } {
  const st = ed.st, key: unknown[] = [st.layout, st.layout.catalog, st.ha, ed._hassStates, st.planLocked, ...Object.keys(st.layout.floors), ...Object.values(st.layout.floors)];
  const c = ed.findCache;
  if (c && c.key.length === key.length && c.key.every((x, i) => x === key[i])) return c;
  const plan = layoutEntries(st.layout, ed._hassStates);
  ed.findCache = { key, entries: [...commands(ed), ...plan], tree: buildOutline(st.layout, ed._hassStates, st.ha, plan) };
  return ed.findCache;
}

/** Puts plan point `p` in the middle of the canvas, as close as it was but never further out than the whole floor (1:1). A view change: no undo step. */
export function centreOn(ed: FloorplanStudioEditor, p: Pt) {
  const st = ed.st, v = st.view, fit = viewBoxFor(st.f, 80, st.rotation);
  if (ed.turn) ed.turn.whole = false;
  const k = Math.max(1, v.w / fit.w, v.h / fit.h), w = v.w / k, h = v.h / k;
  st.views[st.floor] = { x: p[0] - w / 2, y: p[1] - h / 2, w, h };
}

/** Goes to what a search or the Outline picked: its floor, then the thing itself, selected, centred and ringed. A
 *  floor only switches; a command runs. Selecting is not an edit: no undo step. */
export function goTo(ed: FloorplanStudioEditor, e: SearchEntry) {
  if (e.kind === "command") { runCommand(ed, e.id); return; }
  const st = ed.st;
  if (typeof e.floor !== "string" || !hasOwn(st.layout.floors, e.floor)) return;
  if (e.floor !== st.floor) ed.setFloor(e.floor);
  const f = st.f;
  if (e.kind === "room" && e.room !== undefined && f.rooms[e.room]) {
    st.sel = { t: "room", i: e.room };
    const m = roomMiddle(f, st.sel, 0);
    if (m) centreOn(ed, m);
    revealInOutline(ed, `r:${e.floor}:${e.room}`);
  } else if (e.kind === "device" && e.device !== undefined) {
    const i = e.device;
    if (e.piece) {
      const m = f.furniture[i];
      if (m) { st.sel = { t: "furn", i }; centreOn(ed, [m.x, m.y]); pulse(ed, "furn", i); }
    } else {
      const d = f.devices[i];
      if (d) { st.sel = { t: "dev", i }; centreOn(ed, "a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y]); pulse(ed, "dev", i); }
    }
    revealInOutline(ed, deviceNodeId(e));
    // S24.6: search and the Outline do not follow Layers. The pick is selected and drawn; the banner says why the rest of its family is not.
    const fam: LayerId | undefined = e.piece ? (f.furniture[i] ? "furniture" : undefined) : f.devices[i] && layerOfType(f.devices[i].type);
    if (fam && st.hidden.includes(fam)) {
      const label = LAYERS.find((l) => l.id === fam)!.label.toLowerCase();
      ed.notify(`Hidden by Layers: ${label}`, "warning", { id: "layersShow", label: "Show", run: () => showLayers(ed, [fam]) });
    }
  } else if (e.kind === "floor") {
    revealInOutline(ed, `f:${e.floor}`);
  }
  if (ed.aligning) st.sel = null; // review 29: Align is read-only and nothing is selected in it; the pick is centred and ringed, not selected
  ed.requestUpdate();
}

/** Brings a row into the tree's own view. Only the tree scrolls: scrollIntoView would move the page and the canvas too. */
export function scrollRow(ed: FloorplanStudioEditor, row: HTMLElement) {
  const tree = row.closest<HTMLElement>("#outlineTree");
  if (!tree) return;
  const t = tree.getBoundingClientRect(), b = row.getBoundingClientRect();
  if (b.top < t.top) tree.scrollTop -= t.top - b.top;
  else if (b.bottom > t.bottom) tree.scrollTop += b.bottom - t.bottom;
}

/** Shows in the Outline where a pick went: the branches above it open, its row made the tree's tab stop and scrolled to. */
export function revealInOutline(ed: FloorplanStudioEditor, id: string) {
  const path: string[] = [];
  const walk = (list: OutlineNode[]): boolean => list.some((n) => {
    if (n.id === id) return true;
    if (n.children && walk(n.children)) { path.push(n.id); return true; }
    return false;
  });
  if (!walk(findData(ed).tree)) return;
  for (const p of path) ed.outlineOpen.add(p);
  ed.outlineActive = id;
  ed.outlineReveal = true;
}

export function pulse(ed: FloorplanStudioEditor, t: "dev" | "furn", i: number) {
  clearTimeout(ed.locateTimer);
  ed.locate = { floor: ed.st.floor, t, i };
  ed.locateTimer = setTimeout(() => { ed.locate = null; ed.requestUpdate(); }, LOCATE_MS);
}

/** A pick in the search box: go there, then hand the keys back to the editor (Delete, arrows, the next "/"). Add device… keeps its own focus. */
export const onSearchPick = (ed: FloorplanStudioEditor, ev: Event) => {
  const e = (ev as CustomEvent<SearchEntry>).detail;
  if (!e || typeof e !== "object") return;
  goTo(ed, e);
  if (e.id !== "cmd:addDevice") ed.focus({ preventScroll: true });
};

export const toggleSide = (ed: FloorplanStudioEditor) => { ed.sideOpen = !ed.sideOpen; ed.requestUpdate(); };

/** The Outline's rows on show, with the filter applied. */
export function outlineRows(ed: FloorplanStudioEditor, tree: OutlineNode[]): OutlineRow[] {
  if (!ed.outlineSeeded && Object.keys(ed.st.layout.floors).length) { ed.outlineSeeded = true; ed.outlineOpen.add(`f:${ed.st.floor}`); }
  return visibleRows(ed.outlineQuery.trim() ? filterOutline(tree, ed.outlineQuery).nodes : tree, ed.outlineOpen);
}

export const onOutlineQuery = (ed: FloorplanStudioEditor, q: string) => {
  ed.outlineQuery = q;
  // The branches that hold a match open, and stay open once the filter is cleared: what was found stays in view.
  for (const id of filterOutline(findData(ed).tree, q).open) ed.outlineOpen.add(id);
  ed.requestUpdate();
};

export const onOutlineToggle = (ed: FloorplanStudioEditor, id: string) => {
  if (ed.outlineOpen.has(id)) ed.outlineOpen.delete(id); else ed.outlineOpen.add(id);
  ed.requestUpdate();
};

/** Enter, Space or a click on a row: go to a floor, room or device; open Add > Device for an unplaced entity; open or close anything else. */
export function outlineGo(ed: FloorplanStudioEditor, row: OutlineRow) {
  const n = row.node;
  ed.outlineActive = n.id;
  if (n.entry) goTo(ed, n.entry);
  else if (n.kind === "entity" && n.entity) openUnplaced(ed, n.entity);
  else onOutlineToggle(ed, n.id);
}

export const onOutlineRow = (ed: FloorplanStudioEditor, row: OutlineRow) => outlineGo(ed, row);

/** S26.21 (U19): the plan's context menu for a device or room row, at `x`,`y`. Selects the row's object first, as a
 *  right-click on the plan does; a floor, an unplaced entity or a "No room" row has no menu and the browser's own shows. */
export function openCtxForRow(ed: FloorplanStudioEditor, row: OutlineRow, x: number, y: number): boolean {
  const e = row.node.entry;
  if (ed.aligning || !e || (e.kind !== "room" && e.kind !== "device")) return false; // review 29: the menu selects and deletes; Align is read-only
  // A row of the multi-selection keeps it, as a right-click on the plan does (Opus review).
  const sel = ed.st.sel;
  if (e.kind === "device" && !e.piece && e.floor === ed.st.floor && e.device !== undefined && sel?.t === "devs" && sel.is.includes(e.device)) {
    ed.outlineActive = row.node.id;
    ed.ctxMenu = { x, y, target: { k: "devs" } };
    ed.requestUpdate();
    return true;
  }
  goTo(ed, e);
  const s = ed.st.sel;
  if (!s || !("i" in s)) return false;
  const target = ctxTargetFor(ed, { k: s.t, i: s.i });
  if (!target || target.k === "canvas") return false;
  ed.outlineActive = row.node.id;
  ed.ctxMenu = { x, y, target };
  ed.requestUpdate();
  return true;
}

export const onOutlineCtx = (ed: FloorplanStudioEditor, row: OutlineRow, ev: MouseEvent) => {
  if (ed.aligning) { ev.preventDefault(); return; } // review 29: no plan menu while Align is open, and not the browser's either
  if (openCtxForRow(ed, row, ev.clientX, ev.clientY)) ev.preventDefault();
};

/** The tree's own keys (WAI-ARIA tree pattern). A key it uses goes no further, so the arrows move in the tree, not the plan. */
export const onOutlineKey = (ed: FloorplanStudioEditor, ev: KeyboardEvent) => {
  if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.isComposing) return;
  const t = ev.composedPath()[0];
  if (!(t instanceof HTMLElement) || t.getAttribute("role") !== "treeitem") return;
  const rows = outlineRows(ed, findData(ed).tree);
  if (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey)) { // the Menu key: beside the row, as the pointer would
    if (ed.aligning) { ev.preventDefault(); ev.stopPropagation(); return; } // review 29: Align is read-only
    const row = rows.find((x) => x.node.id === t.dataset.node), b = t.getBoundingClientRect();
    if (row && openCtxForRow(ed, row, b.left + 24, b.bottom)) { ev.preventDefault(); ev.stopPropagation(); }
    return;
  }
  const r = outlineKey(rows, t.dataset.node ?? null, ev.key);
  if (!r) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (r.open) ed.outlineOpen.add(r.open);
  if (r.close) ed.outlineOpen.delete(r.close);
  ed.outlineActive = r.active;
  ed.outlineFocus = true;
  const row = r.go ? rows.find((x) => x.node.id === r.active) : undefined;
  if (row) outlineGo(ed, row);
  ed.requestUpdate();
};

/** An unplaced HA entity: Add > Device opens with only that entity listed, its row focused, so Enter places it. */
export function openUnplaced(ed: FloorplanStudioEditor, entity: string) {
  openAddDev(ed);
  ed.addDevQuery = entity;
  void ed.updateComplete.then(() => ed.renderRoot.querySelector<HTMLElement>("#addDevPanel button[data-add]")?.focus({ preventScroll: true }));
}

/** The row of what the plan has selected, for `aria-selected`. */
export function outlineSelected(ed: FloorplanStudioEditor, rows: OutlineRow[]): string | null {
  const st = ed.st, s = st.sel;
  if (!s || !("i" in s)) return null;
  const hit = rows.find(({ node: { entry: e } }) => e && e.floor === st.floor && ((s.t === "room" && e.kind === "room" && e.room === s.i) || (e.kind === "device" && e.device === s.i && ((s.t === "dev" && !e.piece) || (s.t === "furn" && e.piece)))));
  return hit ? hit.node.id : null;
}

export function sideView(ed: FloorplanStudioEditor, tree: OutlineNode[]) {
  const open = ed.sideOpen, pressed = open ? "true" : "false", tab = ed.sideTab;
  let body: unknown = nothing;
  if (open && tab === "layers") body = layersView(ed);
  else if (open) {
    const rows = outlineRows(ed, tree);
    body = html`<div class="side-body" id="sideBody" role="tabpanel" aria-labelledby="tabOutline">${outlineView({ rows, open: ed.outlineOpen, active: ed.outlineActive, selected: outlineSelected(ed, rows), query: ed.outlineQuery, onQuery: ed.onOutlineQuery, onKey: ed.onOutlineKey, onRow: ed.onOutlineRow, onCtx: ed.onOutlineCtx, onToggle: ed.onOutlineToggle })}</div>`;
  }
  const tabBtn = (id: "outline" | "layers", label: string) =>
    html`<button class="tab" role="tab" id=${id === "outline" ? "tabOutline" : "tabLayers"} aria-selected=${tab === id ? "true" : "false"} aria-controls=${id === "outline" ? "sideBody" : "layersPanel"} @click=${() => { ed.sideTab = id; ed.requestUpdate(); }}>${label}</button>`;
  return html`<nav class="side ${open ? "open" : "shut"}" id="side" aria-label="Plan contents">
    <div class="side-head">
      <button class="btn side-x" id="sideToggle" aria-expanded=${pressed} aria-controls="side" aria-label=${open ? "Hide outline" : "Show outline"} title=${open ? "Hide the outline" : "Show the outline"} @click=${ed.toggleSide}>${open ? "«" : "»"}</button>
      ${open ? html`<div class="tabs" role="tablist" aria-label="Left column">${tabBtn("outline", "Outline")}${tabBtn("layers", "Layers")}</div>` : nothing}
    </div>
    ${body}
  </nav>`;
}

/** S24.6: one eye per family, its count on this floor. Click hides or shows it; alt-click shows only it (again: all). */
export function layersView(ed: FloorplanStudioEditor) {
  const st = ed.st, counts = layerCounts(st.f), hidden = st.hidden;
  const eye = (on: boolean) => html`<svg class="leye" viewBox="0 0 24 24" aria-hidden="true"><path d=${on ? EYE : EYE_OFF}/></svg>`;
  return html`<div class="side-body" id="layersPanel" role="tabpanel" aria-labelledby="tabLayers">
    <p class="lhint">Click hides a family. ${navigator.platform?.includes("Mac") ? "Option" : "Alt"}-click shows only that one.</p>
    <div class="layers">
      ${LAYERS.map((l) => { const on = !hidden.includes(l.id), n = counts[l.id];
        return html`<button class="lrow ${n ? "" : "empty"}" data-layer=${l.id} aria-pressed=${on ? "true" : "false"} title=${on ? `Hide ${l.label.toLowerCase()}` : `Show ${l.label.toLowerCase()}`} @click=${(e: MouseEvent) => setLayers(ed, e.altKey ? soloLayer(hidden, l.id) : toggleLayer(hidden, l.id))}>${eye(on)}<span class="ll">${l.label}</span><span class="lc">${n}</span></button>`; })}
    </div>
    <button class="btn" id="layersShowAll" ?disabled=${!hidden.length} @click=${() => setLayers(ed, [])}>Show all</button>
  </div>`;
}

/** The new hidden set. A selection on a family that just went out of sight is let go: an invisible handle helps nobody. A view change, not an edit. */
export function setLayers(ed: FloorplanStudioEditor, next: LayerId[]) {
  const st = ed.st;
  st.hidden = next;
  const s = st.sel, f = st.f;
  if (s && "i" in s) {
    const fam = s.t === "dev" ? f.devices[s.i] && layerOfType(f.devices[s.i].type) : s.t === "unl" ? f.unlinked[s.i] && layerOfType(f.unlinked[s.i].type) : s.t === "furn" ? "furniture" : undefined;
    if (fam && next.includes(fam)) st.sel = null;
  }
  ed.requestUpdate();
}

export const openLayers = (ed: FloorplanStudioEditor) => { ed.sideOpen = true; ed.sideTab = "layers"; ed.requestUpdate(); };

/** Shows the given families again; the action behind every "hidden by Layers" banner's Show. */
export function showLayers(ed: FloorplanStudioEditor, ids: Iterable<LayerId>) {
  const back = new Set(ids);
  ed.st.hidden = ed.st.hidden.filter((x) => !back.has(x));
  ed.closeBanner();
  ed.requestUpdate();
}

/** What each floor holds before a placement, so `placedNote` can tell the new things from the old. */
export function counted(ed: FloorplanStudioEditor) {
  return Object.fromEntries(Object.entries(ed.st.layout.floors).map(([k, f]) => [k, { d: f.devices.length, f: f.furniture.length, u: f.unlinked.length }]));
}

/**
 * S24.6 (U17): after a placement, says what it said before, unless some of what was just placed is on a hidden
 * layer: then "<head>; N hidden by Layers" with Show, so nothing vanishes without a word. The selected new thing is
 * still drawn (renderFloor's selection rule) but goes the moment it is let go.
 */
export function placedNote(ed: FloorplanStudioEditor, before: ReturnType<FloorplanStudioEditor["counted"]>, plain: string, head: string) {
  const st = ed.st, f = st.f, b = before[st.floor] ?? { d: 0, f: 0, u: 0 };
  const fams = [...f.devices.slice(b.d).map((d) => layerOfType(d.type)), ...f.unlinked.slice(b.u).map((u) => layerOfType(u.type)), ...f.furniture.slice(b.f).map((): LayerId => "furniture")];
  const hid = fams.filter((x) => st.hidden.includes(x));
  if (!hid.length) { ed.changed(plain); return; }
  const text = `${head}; ${fams.length === 1 ? "" : `${hid.length} `}hidden by Layers`;
  ed.changed(text);
  if (ed.status === text) ed.notify(text, "warning", { id: "layersShow", label: "Show", run: () => showLayers(ed, hid) });
}
