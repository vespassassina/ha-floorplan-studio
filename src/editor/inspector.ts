import { css, html, nothing } from "lit";
import { live } from "./live-keep";
import { addCandidates, typeForEntity } from "../core";
import type { AddCandidate, HaData } from "../core";
import { TYPE_LABELS, helpPanel, selectionPanel, typeOptions } from "./panels";
import type { EditorState } from "./state";
import type { FloorplanStudioEditor } from "./editor-app";

/** The Place and Add device popups, the Scene designer's frame, and the side panel's own styles. */
export const inspectorCss = css`
    .fpanel{position:fixed;z-index:30;width:440px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.35)}
    .fpanel-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--fp-idle);font-weight:600;cursor:move;touch-action:none}
    .fpanel-head button{width:auto;padding:0 8px;font-size:1.2em;line-height:1.6}
    .fpanel p{margin:8px 10px 0;font-size:13px}
    .fpanel .grp{padding:8px 10px 0}
    .fpanel .harow{padding:2px 10px}
    .fpanel .harow .name{flex:1;text-align:left;text-decoration:none}
    .fpanel .chips{display:flex;flex-wrap:wrap;gap:4px;padding:8px 10px 0}
    .fpanel .rows{overflow:auto;padding:6px 10px;display:flex;flex-direction:column;gap:2px}
    .prow{display:flex;align-items:center;gap:6px;cursor:pointer}
    /* S8.8: line 1 the name (ellipsis on overflow, title carries the full text), line 2 a smaller muted subtitle. */
    .prow-text{flex:1;display:flex;flex-direction:column;gap:0;min-width:0}
    .prow-name{display:block;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .prow small{opacity:.7}
    /* S22.3: only the list (.rows, overflow:auto) shrinks in a popup capped by the window; the action buttons stay in view. */
    .fpanel>.btn{margin:8px 10px 10px;width:auto;align-self:flex-start;flex:none}
    /* S8.8: 50% larger than the S8.5 baseline (520x642 / 440x642 measured at an 800px-tall viewport, panel maxed
       out): width and max-height both grow by half, clamped so a small screen still fits it — see docs/DECISIONS.md. */
    .add-dev-panel{width:min(780px, 100vw - 24px);max-height:min(963px, 100vh - 40px)}
    .add-dev-panel>input[type=search]{margin:8px 10px 0;box-sizing:border-box;width:calc(100% - 20px)}
    .add-dev-filters select{flex:1 1 45%;min-width:140px}
    .add-dev-panel .rows .btn{display:flex;flex-direction:column;align-items:flex-start;gap:0;min-width:0;text-align:left}
    .add-dev-panel .rows .btn .devrow-name{display:block;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .add-dev-panel .rows .btn small{opacity:.7}
    .scene-panel{width:min(760px, 100vw - 24px);max-height:min(900px, 100vh - 40px)}
    .sd-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--fp-idle)}
    .sd-dev{display:flex;align-items:center;gap:6px;flex:1 1 180px;min-width:0}
    .sd-row input[type=number],.sd-row input[type=text]{width:120px}
    #sceneName{width:260px}
    .sd-palette{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px}
    .sd-palette input[type=color]{width:36px;height:28px;padding:0}
    .sd-try{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 10px}
    .sd-actions{display:flex;gap:8px;padding:8px 10px 10px}
    .warn-text{color:var(--fp-warn,#c0392b)}
    .place-panel{width:min(660px, 100vw - 24px);max-height:min(963px, 100vh - 40px)}
    /* S22.6: the aside is its own scroll container, as tall as the canvas beside it (same height rule, same floor), so
       a long room panel scrolls inside it and the plan stays put; before, it grew the page and scrolling it moved the plan away. */
    aside{display:flex;flex-direction:column;gap:12px;overflow:auto;max-height:max(420px, var(--fp-editor-height,calc(100vh - 150px)))}
    aside label{display:block;font-size:.85em;margin-top:6px;opacity:.8}
    aside input:not([type=checkbox]),aside select{width:100%;box-sizing:border-box}
    /* S10.1: fp-combo sizes itself (its own :host rule); margin-top here only matches the spacing a select/input
       gets from the label above it. Since S22.6 the aside scrolls, so a combo's dropdown (position:absolute, inside
       its shadow root) that reaches past the aside's bottom extends the scroll area instead of spilling over the page. */
    aside fp-combo{margin-top:2px}
    .row{display:flex;gap:6px}
    /* S8.9.1 / Opus review of S8.9: hints are written to fit one line at the sidebar's own width; nowrap+ellipsis
       is a safety net only, and only for the sidebar's own static hints (.fit: the hint() helper's output and the
       fixed "Nothing selected." messages). A confirm prompt or the trace-image instructions build their own <p
       class="hint"> without .fit, and wrap normally: their text is never a tooltip fallback away from the user. */
    .hint{font-size:.85em;opacity:.75;margin:6px 0}
    .hint.fit{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    /* A hint that carries its own button (Help) never clips it: full width, wraps instead of ellipsising. */
    .hint.help-line{white-space:normal;overflow:visible;text-overflow:clip;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
    /* S8.9: a selection panel's section headings (Identity, Home Assistant, Links, Appearance, Automations, Danger),
       a divider above each except the first so the groups read apart without adding a new colour. */
    h4.pnl-h{margin:10px 0 2px;padding-top:8px;border-top:1px solid var(--fp-idle);font-size:.8em;font-weight:600;text-transform:uppercase;letter-spacing:.03em;opacity:.7}
    summary.pnl-h{cursor:pointer;margin:10px 0 2px;padding-top:8px;border-top:1px solid var(--fp-idle);font-size:.8em;font-weight:600;text-transform:uppercase;letter-spacing:.03em;list-style:none;display:flex;align-items:center;gap:4px}
    summary.pnl-h::-webkit-details-marker{display:none}
    summary.pnl-h::before{content:"▾";opacity:.6;width:1em}
    details.pnl-sec:not([open])>summary.pnl-h::before{content:"▸"}
    h4.pnl-h:first-child,strong+h4.pnl-h,strong+p+h4.pnl-h,strong+p+p+h4.pnl-h{margin-top:4px;padding-top:0;border-top:none}
`;

/** S8.1/S8.4: the room panel's Place popup: the area's placeable entities (`areaToPlace`, noise already left out), a chip
 * per type present to narrow the list, a tick per row (none ticked on open), a Select all/Deselect all above the rows
 * that acts only on the shown rows, and Place for the ticked rows that are shown. Draggable, X top-left. */
export function placeView(h: FloorplanStudioEditor, st: EditorState, i: number) {
  const room = st.f.rooms[i], p = h.placePos!;
  const all = st.areaToPlace(i);
  const types = TYPE_LABELS.filter(([t]) => all.some((e) => typeForEntity(e, st.ha) === t));
  const shown = h.placeType ? all.filter((e) => typeForEntity(e, st.ha) === h.placeType) : all;
  const picked = shown.filter((e) => h.placeOn.has(e.id));
  const allShownOn = shown.length > 0 && shown.every((e) => h.placeOn.has(e.id));
  const tick = (e: HaData["entities"][number]) => (ev: Event) => { if ((ev.target as HTMLInputElement).checked) h.placeOn.add(e.id); else h.placeOn.delete(e.id); h.requestUpdate(); };
  const toggleAll = () => { for (const e of shown) { if (allShownOn) h.placeOn.delete(e.id); else h.placeOn.add(e.id); } h.requestUpdate(); };
  // Opus review of S8.1: a ticked checkbox keeps focus and `onKey` ignores keys typed in an input, so Escape is handled here too.
  const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); h.closePlace(); } };
  return html`<div class="fpanel place-panel" id="placePanel" role="dialog" aria-label="Place devices" style="left:${p.x}px;top:${p.y}px" @keydown=${esc}>
    <div class="fpanel-head" @pointerdown=${h.placeHead.down} @pointermove=${h.placeHead.move} @pointerup=${h.placeHead.up} @pointercancel=${h.placeHead.up}>
      <button class="btn keep" id="placeClose" aria-label="Close" @click=${() => h.closePlace()}>&times;</button>
      <span>Place devices of ${room.name}</span>
    </div>
    <p>What Home Assistant has in this area and the plan does not show yet. Readings with no icon of their own (power, energy, battery…) are left out. Tick what to place; each placed device can then be dragged to its spot.</p>
    <div class="chips">${types.map(([t, label]) => html`<button class="chip keep" data-ptype=${t} aria-pressed=${h.placeType === t ? "true" : "false"} @click=${() => { h.placeType = h.placeType === t ? null : t; h.requestUpdate(); }}>${label}</button>`)}</div>
    <button class="btn keep" id="placeAll" ?disabled=${!shown.length} @click=${toggleAll}>${allShownOn ? "Deselect all" : "Select all"}</button>
    <div class="rows">${shown.map((e) => html`<label class="prow" data-pent=${e.id} title=${e.name}><input type="checkbox" .checked=${live(h.placeOn.has(e.id))} @change=${tick(e)}><span class="prow-text"><span class="prow-name">${e.name}</span><small>${TYPE_LABELS.find((t) => t[0] === typeForEntity(e, st.ha))?.[1] ?? typeForEntity(e, st.ha)} · ${room.name}</small></span></label>`)}</div>
    <button class="btn primary keep" id="placeGo" ?disabled=${!picked.length} @click=${() => h.placeGo(i, picked.map((e) => e.id))}>Place ${picked.length}</button>
  </div>`;
}

/**
 * S8.5: Add > Device — one floating, draggable panel (X top-left) merging the old Device and Entities submenus:
 * `addCandidates` for the source list, a search box, and four selects (Floor/Room/Area/Type). Each select's own
 * options are only the values present among candidates that pass the OTHER active filters and the search, so
 * picking one narrows the rest; the select's own current value always stays listed, even if it would otherwise
 * drop out. A select is left out entirely when no candidate in the whole list has a value for it (no Home
 * Assistant known yet → no Area select). Rows are grouped by type, as the old Device menu grouped its own list.
 * A pick places at once (switching floor first when the candidate's floor differs, `pickAddDev`); the panel stays
 * open, since the placed row simply drops out of `addCandidates` on the next render.
 */
export function addDevView(h: FloorplanStudioEditor, st: EditorState) {
  const p = h.addDevPos!;
  const all = addCandidates(st.layout, st.ha ?? null);
  const q = h.addDevQuery.trim().toLowerCase();
  const bySearch = q ? all.filter((c) => c.name.toLowerCase().includes(q) || c.entity.toLowerCase().includes(q)) : all;
  const passes = (c: AddCandidate, skip?: "floor" | "room" | "area" | "type") =>
    (skip === "floor" || !h.addDevFloor || (h.addDevFloor === "__none__" ? !c.floor : c.floor === h.addDevFloor)) &&
    (skip === "room" || !h.addDevRoom || (h.addDevRoom === "__none__" ? !c.room : c.room === h.addDevRoom)) &&
    (skip === "area" || !h.addDevArea || (h.addDevArea === "__none__" ? !c.area : c.area === h.addDevArea)) &&
    (skip === "type" || !h.addDevType || c.type === h.addDevType);
  const shown = bySearch.filter((c) => passes(c));
  const selectFor = (field: "floor" | "room" | "area", current: string) => {
    const pool = bySearch.filter((c) => passes(c, field));
    let values = [...new Set(pool.map((c) => c[field]).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
    let none = pool.some((c) => !c[field]);
    if (current && current !== "__none__" && !values.includes(current)) values = [...values, current].sort((a, b) => a.localeCompare(b));
    if (current === "__none__") none = true;
    return { values, none };
  };
  const selHtml = (id: string, field: "floor" | "room" | "area", allLabel: string, current: string, onSet: (v: string) => void) => {
    if (!all.some((c) => c[field])) return nothing; // no candidate in the whole list has a value: leave the select out entirely
    const { values, none } = selectFor(field, current);
    return html`<select id=${id} aria-label=${allLabel} .value=${live(current)} @change=${(e: Event) => { onSet((e.target as HTMLSelectElement).value); h.requestUpdate(); }}>
      <option value="">${allLabel}</option>
      ${values.map((v) => html`<option value=${v}>${v}</option>`)}
      ${none ? html`<option value="__none__">None</option>` : nothing}
    </select>`;
  };
  const typePool = bySearch.filter((c) => passes(c, "type"));
  let typeOpts = TYPE_LABELS.filter(([t]) => typePool.some((c) => c.type === t));
  if (h.addDevType && !typeOpts.some(([t]) => t === h.addDevType)) {
    const found = TYPE_LABELS.find(([t]) => t === h.addDevType);
    if (found) typeOpts = [...typeOpts, found];
  }
  // Opus review of S8.1's own place popup: an input or select swallows keys before `onKey` sees them, so Escape is handled here too.
  const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); h.closeAddDev(); } };
  return html`<div class="fpanel add-dev-panel" id="addDevPanel" role="dialog" aria-label="Add device" style="left:${p.x}px;top:${p.y}px" @keydown=${esc}>
    <div class="fpanel-head" @pointerdown=${h.addDevHead.down} @pointermove=${h.addDevHead.move} @pointerup=${h.addDevHead.up} @pointercancel=${h.addDevHead.up}>
      <button class="btn keep" id="addDevClose" aria-label="Close" @click=${() => h.closeAddDev()}>&times;</button>
      <span>Add device</span>
    </div>
    <input id="addDevSearch" type="search" autocomplete="off" aria-label="Search name or entity id" placeholder="Search name or entity" .value=${live(h.addDevQuery)} @input=${(e: Event) => { h.addDevQuery = (e.target as HTMLInputElement).value; h.requestUpdate(); }}>
    <div class="chips add-dev-filters">
      ${selHtml("addDevFloor", "floor", "All floors", h.addDevFloor, (v) => { h.addDevFloor = v; })}
      ${selHtml("addDevRoom", "room", "All rooms", h.addDevRoom, (v) => { h.addDevRoom = v; })}
      ${selHtml("addDevArea", "area", "All areas", h.addDevArea, (v) => { h.addDevArea = v; })}
      ${all.length ? html`<select id="addDevType" aria-label="All types" .value=${live(h.addDevType)} @change=${(e: Event) => { h.addDevType = (e.target as HTMLSelectElement).value; h.requestUpdate(); }}>
        <option value="">All types</option>
        ${typeOptions(typeOpts)}
      </select>` : nothing}
    </div>
    ${all.length === 0 ? html`<span class="grp" id="addDevNone">Everything is on the plan</span>`
      : shown.length === 0 ? html`<span class="grp" id="addDevNone">Nothing matches</span>`
      : html`<div class="rows">${TYPE_LABELS.map(([t, label]) => { const g = shown.filter((c) => c.type === t); return g.length ? html`<span class="grp">${label}</span>${g.map((c) => html`<button class="btn" data-add=${c.key} title=${c.name} @click=${() => h.pickAddDev(c)}><span class="devrow-name">${c.name}</span><small>${label}${c.room || c.area ? ` · ${c.room || c.area}` : ""}</small></button>`)}` : nothing; })}</div>`}
  </div>`;
}

/** The side panel: the Help text, or the selection's panel. */
export function asideView(h: FloorplanStudioEditor) {
  return html`<aside>
    <div id="panel">${h.st.helpOpen ? helpPanel(() => h.toggleHelp()) : selectionPanel(h.ctx())}</div>
  </aside>`;
}

