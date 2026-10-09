import { css, html, nothing } from "lit";
import { live } from "./live-keep";
import { DETAIL_LABELS, DETAIL_MODES, FURNITURE_SYMBOLS, UI_ICONS, UNLINKED_TYPES, WALL_KINDS, layersSummary } from "../core";
import type { FurnitureSymbol, HaData } from "../core";
import "../card/search-box";
import { TYPE_LABELS, WALL_LABELS, typeMenu } from "./panels";
import { DEFAULT_DETAIL, GRID_VALUES, THEME_VALUES, isBlank, type EditorState } from "./state";
import type { SearchEntry } from "../core/search";
import { MENU_KEYS, chordLabel } from "./guide";
import type { FloorplanStudioEditor } from "./editor-app";

/** The toolbar's own styles: the bar, its menus and submenus, the Lock plan pill, the search box slot. */
export const toolbarCss = css`
    .bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 0}
    /* S8.10: the floor chips stay left (in normal flow, no longer followed by a .grow spacer — that span's own
       zero flex-basis let the menu cluster after it wrap onto a line of its own with nothing to push it right,
       "floating in the middle", the maintainer's original report). Everything else — status, Filter through File,
       Help, Undo/Redo — is one flex item that wraps its OWN contents (never the floor chips) when the toolbar is
       too narrow, each wrapped row right-aligned in turn (justify-content, since a wrapped row may start with any
       of its items, not always the same one an auto-margin child could anchor). */
    /* S8.10: flex:1 1 0 (not margin-left:auto on a shrink-to-fit box) so this fills whatever room is left on its
       own line, a plain size the outer .bar resolves once. A shrink-to-fit width instead left a flex item that is
       itself flex-wrap ambiguous — Chromium settled on two different equilibrium widths (668px and 740px) for the
       same content depending on what triggered the last layout pass, so the toolbar's height (one row or two) and
       right cluster's own wrapping flipped on a reflow that had nothing to do with its content, such as a status
       message changing. min-width:0 lets it shrink below its content's natural width instead of overflowing. */
    .bar-right{flex:1 1 0%;min-width:0;display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-end}
    /* S8.10 follow-up: below this width the cluster can no longer fit beside the floor chips on one line without
       squeezing itself down to a narrow column (min-width:0 lets it shrink that far). A fixed flex-basis forces it
       onto its own full-width row instead — a plain value the outer .bar resolves once, not a shrink-to-fit result,
       so it carries none of the width-instability risk the .bar-right rule above already had to design around. */
    @media (max-width:768px){.bar-right{flex-basis:100%}}
    /* S8.10 follow-up (Opus review): Undo and Redo as a single flex item of .bar-right, nowrap inside it, so a
       wrap ever carries the whole pair to the next row together, never splitting them. */
    .btnpair{display:flex;flex-wrap:nowrap;gap:6px}
    .menu{position:relative}
    .menu>summary{list-style:none;display:inline-block}
    .menu>summary::-webkit-details-marker{display:none}
    .menu>summary::after{content:" \\25BE"}
    /* z-index above the floating panels (Device colours, Install code: 30): a menu just opened is on top, wherever the
       toolbar puts it. S7.2 moved the menus left to make room for the status line, onto the centred panels. */
    /* S8.10 follow-up (Opus review): right:0 anchors the box to its OWN button (.menu is its containing block), not
       to the viewport. A button in the middle of the toolbar (View, Edit, Filter) can carry a box wide enough to run
       off the left edge — onMenuToggle below clamps it back on open. max-width is a plain backstop so a box can
       never exceed the viewport even before that clamp runs. */
    .box{max-height:75vh;overflow:auto;position:absolute;right:0;top:calc(100% + 4px);z-index:40;min-width:210px;max-width:calc(100vw - 16px);display:flex;flex-direction:column;gap:6px;padding:6px;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:4px}
    .box .btn,.box .chip,.box select{width:100%;text-align:left}
    .sub{display:flex;flex-direction:column;gap:6px}
    .sub>summary{list-style:none;display:inline-block}
    .sub>summary::-webkit-details-marker{display:none}
    .sub>summary::after{content:" \\25B8"}
    .sub>.btn:not(summary){padding-left:20px}
    .rotrow{display:flex;flex-wrap:wrap;gap:6px} .rotrow>span{width:100%} .box .rotrow .btn{width:auto;flex:1;text-align:center}
    #snap.rotrow .chip{width:calc(50% - 3px);text-align:center}
    /* S26.18: a key at the right edge of its item. In a menu the button is a full-width row, so the key is pushed to the far
       edge; in the bar the button is as wide as its label and the key follows it. */
    .keyed{display:inline-flex;align-items:baseline;gap:10px}
    .box .keyed{display:flex}
    .kbd{margin-left:auto;padding-left:6px;font:600 .8em ui-monospace,monospace;opacity:.7;white-space:nowrap}
    .layers-note{font-size:.85em;max-width:16em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bar-search{flex:0 1 260px;min-width:160px}
    /* S7.2: the status line sits in the toolbar. A long message is cut with an ellipsis (the full text is in
       title) and never wraps the toolbar. */
    /* S8.10 follow-up: status is the cluster's first item, no flex-grow and no fixed flex-basis reserving space
       for it — a basis of 12em always held that much room even for "Ready", leaving an empty gap before Help.
       flex-basis:auto sizes the box to its own text, so there is no reserved space anywhere in the cluster; growing
       or shrinking that text changes only status's own left edge (justify-content:flex-end on .bar-right anchors
       the packed block's right edge, and every item after status keeps a fixed distance from that right edge, so
       Filter's x never moves when the status text changes — see the "moves no button" acceptance test). max-width
       still caps an extreme message so text-overflow:ellipsis clips it instead of ever forcing a wrap. */
    /* S26.19: the plan lock is the normal state, so it is quiet: a pill with a drawn lock, ink-filled when locked like any
       pressed button, the warning colour only under the pointer. The checkbox stays in the page (tests and screen readers
       reach it) but draws nothing of its own. */
    .lockplan{position:relative;display:inline-flex;align-items:center;gap:6px;margin:0;padding:3px 10px;border:1px solid var(--fp-idle);border-radius:999px;font-size:.9em;font-weight:600;background:transparent;color:inherit;white-space:nowrap;cursor:pointer}
    .lockplan .lk{flex:none;width:14px;height:14px;background:currentColor;-webkit-mask:var(--lk) center/contain no-repeat;mask:var(--lk) center/contain no-repeat}
    .lockplan>input{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;cursor:pointer}
    .lockplan.on{background:var(--fp-ink);border-color:var(--fp-ink);color:var(--fp-bg)}
    .lockplan:hover{background:var(--fp-warn);border-color:var(--fp-warn);color:var(--fp-on-light)}
    .lockplan:has(>input:focus-visible){outline:2px solid var(--fp-primary);outline-offset:2px}
`;


/** What each theme is called on its chip. `ha` says what it does rather than what it is. */
const THEME_LABELS: Record<(typeof THEME_VALUES)[number], string> = {
  blueprint: "Blueprint", midnight: "Midnight", light: "Light", slate: "Light Gray", terminal: "Terminal", solarized: "Solarized", ha: "Home Assistant",
  coffee: "Coffee", "a-team": "A-Team", space: "Space", cyberpunk: "Cyberpunk", "carpenter-brut": "Carpenter Brut", "beach-house": "Beach House",
};

/** The HA groups with a member on this floor, and the one chosen (it dims every other device). */
export function floorGroups(st: EditorState): { groups: HaData["entities"]; activeGroup: HaData["entities"][number] | undefined } {
  const ha = st.ha;
  const floorEntities = new Set(st.f.devices.map((d) => d.entity).filter((e) => e));
  const groups = ha ? ha.entities.filter((e) => e.domain === "group" && (e.members ?? []).some((m) => floorEntities.has(m))) : [];
  return { groups, activeGroup: st.activeGroup ? groups.find((g) => g.id === st.activeGroup) : undefined };
}

/** S4.6: a group's kind (light or motion) read off its first member's domain, to offer "Turns on..." only for a motion group. */
const groupKindOf = (g: { members?: string[] }) => (g.members ?? [])[0]?.split(".")[0] === "binary_sensor" ? "motion" as const : (g.members ?? [])[0]?.split(".")[0] === "light" ? "light" as const : undefined;

/** S26.17: what each piece of furniture is called in the Add menu. A table, not the symbol with its hyphen swapped, so a
 *  new symbol fails the iterating test until someone writes its name. */
export const FURNITURE_LABELS: Record<FurnitureSymbol, string> = {
  table: "Table", sofa: "Sofa", bed: "Bed", cabinet: "Cabinet", chair: "Chair", sink: "Sink", toilet: "Toilet", shower: "Shower", bathtub: "Bathtub",
  tv: "TV", computer: "Computer", speaker: "Speaker", tree: "Tree", "patio-wood": "Patio, wood", "patio-concrete": "Patio, concrete", car: "Car",
};

/** S26.17: opening a submenu closes the ones beside it, so a menu never grows past what one submenu needs. */
const onSubToggle = (ev: Event) => {
  const d = ev.currentTarget as HTMLDetailsElement;
  if (!d.open) return;
  d.parentElement?.querySelectorAll<HTMLDetailsElement>(":scope > details.sub[open]").forEach((o) => { if (o !== d) o.open = false; });
};
/** The unlinked device types as buttons: the popular ones, a rule, the rest A to Z (the order the select had). */
function unlinkedItems(h: FloorplanStudioEditor) {
  const { popular, rest } = typeMenu(TYPE_LABELS.filter(([t]) => (UNLINKED_TYPES as readonly string[]).includes(t)));
  const item = ([t, label]: [(typeof TYPE_LABELS)[number][0], string]) => html`<button class="btn" id=${`addUnlDev-${t}`} @click=${() => { h.addUnlinked(t); h.closeMenus(); }}>${label}</button>`;
  return html`${popular.map(item)}${popular.length && rest.length ? html`<div class="sep"></div>` : nothing}${rest.map(item)}`;
}
/** One submenu: a summary and its items. */
const sub = (id: string, label: unknown, items: unknown) => html`<details class="sub" id=${id} @toggle=${onSubToggle}><summary class="btn">${label}</summary>${items}</details>`;

/** S26.17: the box never runs past the bottom of the window: it takes the room below its button, and scrolls past that. */
const fitBox = (ev: Event) => {
  const d = ev.currentTarget as HTMLDetailsElement;
  const box = d.querySelector<HTMLElement>(":scope > .box");
  if (!box) return;
  if (!d.open) { box.style.maxHeight = ""; return; }
  const cs = getComputedStyle(box), frame = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"].reduce((n, k) => n + (parseFloat(cs[k as "paddingTop"]) || 0), 0); // max-height is the content box
  const room = Math.floor(window.innerHeight - box.getBoundingClientRect().top - 8 - frame);
  box.style.maxHeight = `min(75vh, ${Math.max(60, room)}px)`;
};

/** The toolbar template (floor chips, search, the Add/Draw/View/Edit/File menus, Help, Undo/Redo). Handlers stay on the host `h`. */
/** An icon drawn as a CSS mask, not as an inline <svg>: the plan must stay the first <svg> of the editor's shadow root, which
 * tests and helpers rely on. The path is one of our own constants, so the data URI needs no further escaping. */
const maskOf = (d: string) => `--lk:url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='${d}'/></svg>`)}")`;

export function toolbarView(h: FloorplanStudioEditor, entries: SearchEntry[]) {
  const st = h.st, ha = st.ha;
  const { groups, activeGroup } = floorGroups(st);
  const hiddenNote = layersSummary(st.hidden);
  const pressed = (b: boolean) => (b ? "true" : "false");
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const kbd = (chord: string) => html`<span class="kbd">${chordLabel(chord, mac)}</span>`;
  return html`
      <div class="bar">
        ${Object.entries(st.layout.floors).map(([name, fl]) => html`<button class="chip" data-f=${name} aria-pressed=${pressed(name === st.floor)} @click=${() => h.setFloor(name)}>${fl.title || name}</button>`)}
        ${h.addingFloor
          ? html`<input id="newFloor" type="text" aria-label="Title of the new floor" placeholder="Floor title" @keydown=${h.onNewFloorKey} @blur=${() => { if (document.hasFocus()) h.addingFloor = false; }}>`
          : nothing}
        <fp-search id="search" class="bar-search" .entries=${entries} label="Search or run a command" placeholder=${`Search or run a command ${mac ? "⌘K" : "Ctrl+K"}`} @fp-pick=${h.onSearchPick}></fp-search>
        <div class="bar-right">
        <!-- S8.10 follow-up: status is the cluster's first item; growing it moves only its own left edge, never
             a button after it (see .status's own comment above). -->
        <label class="lockplan ${st.planLocked ? "on" : ""}" title=${st.planLocked ? "The plan is locked: walls, rooms, doors, windows, stairs and furniture stay as they are. Click to unlock it. Devices and objects can still be added, moved and removed" : "The plan is editable. Click to lock it: walls, rooms, doors, windows, stairs and furniture then stay as they are"}><input type="checkbox" id="fixPlan" aria-label="Lock plan" .checked=${live(st.planLocked)} @change=${(e: Event) => h.setPlanLocked((e.target as HTMLInputElement).checked)}><span class="lk" aria-hidden="true" style=${maskOf(st.planLocked ? UI_ICONS.lock : UI_ICONS.lockOpen)}></span><span>${st.planLocked ? "Plan locked" : "Plan editable"}</span></label>
        ${hiddenNote ? html`<button class="btn layers-note" id="layersNote" title="Open the Layers tab" @click=${h.openLayers}>${hiddenNote}</button>` : nothing}
        <details class="menu" id="mAdd" @toggle=${(e: Event) => { h.onMenuToggle(e); fitBox(e); }}><summary class="btn">Add</summary><div class="box">
          <details class="sub" id="addOpenings" @toggle=${onSubToggle}><summary class="btn">Openings</summary>
            <button class="btn" id="addDoor" @click=${() => h.addDoor("door", 90)}>Door</button>
            <button class="btn" id="addOpenDoor" title="A doorway in a wall, with nothing drawn in it. Unlike Opening it can have a name and sensors" @click=${() => h.addDoor("open", 90)}>Open doorway</button>
            <button class="btn" id="addWin" @click=${() => h.addDoor("window", 120)}>Window</button>
            <button class="btn" id="addSlit" title="A window 60 cm high, from the ceiling down" @click=${() => h.addDoor("slit", 120)}>Slit window</button>
            <button class="btn" id="addGap" title="A gap in a wall: the wall is not drawn there" @click=${() => h.addOpeningGap()}>Opening</button>
          </details>
          <details class="sub" id="addWallSub" @toggle=${onSubToggle}><summary class="btn">Wall</summary>
            ${WALL_KINDS.map((k) => html`<button class="btn" id=${`addWall-${k}`} @click=${() => h.addWall(k)}>${WALL_LABELS[k]}</button>`)}
          </details>
          <details class="sub" id="addAreas" @toggle=${onSubToggle}><summary class="btn">Areas</summary>
            <button class="btn" id="addStr" @click=${() => h.addStructure()}>Structure</button>
            <button class="btn" id="addZone" @click=${() => h.addArea("zone")}>Zone</button>
            <button class="btn" id="addStairs" @click=${() => h.addStairs()}>Stairs</button>
          </details>
          <button class="btn" id="addDevBtn" @click=${() => h.openAddDev()}>Device…</button>
          ${sub("addFurn", "Furniture", FURNITURE_SYMBOLS.map((y) => html`<button class="btn" id=${`addFurn-${y}`} @click=${() => { h.addFurniture(y); h.closeMenus(); }}>${FURNITURE_LABELS[y]}</button>`))}
          ${sub("addUnlDev", "Unlinked device", unlinkedItems(h))}
        </div></details>
        <details class="menu" id="mDraw" @toggle=${(e: Event) => { h.onMenuToggle(e); fitBox(e); }}><summary class="btn">Draw</summary><div class="box">
          <details class="sub" id="drawOpenings" @toggle=${onSubToggle}><summary class="btn">Openings</summary>
            <button class="btn" id="drawOpening" @click=${() => h.startDraw("opening")}>Draw opening</button>
          </details>
          <details class="sub" id="drawWallSub" @toggle=${onSubToggle}><summary class="btn">Wall</summary>
            ${WALL_KINDS.map((k) => html`<button class="btn" id=${`drawWall-${k}`} @click=${() => h.startDraw("wall", k)}>${WALL_LABELS[k]}</button>`)}
          </details>
          <details class="sub" id="drawAreas" @toggle=${onSubToggle}><summary class="btn">Areas</summary>
            <button class="btn" id="drawRoom" @click=${() => h.startDraw("room")}>Draw room</button>
            <button class="btn" id="drawZone" @click=${() => h.startDraw("zone")}>Draw zone</button>
            <button class="btn" id="drawWater" @click=${() => h.startDraw("water")}>Draw water</button>
            <button class="btn" id="drawOutline" title="Replaces the outline of this floor" @click=${() => h.startDraw("outline")}>Draw outline</button>
            <button class="btn" id="drawExtra" @click=${() => h.startDraw("extra")}>Draw structure line</button>
          </details>
        </div></details>
        <details class="menu" id="mOpt" @toggle=${(e: Event) => { h.onMenuToggle(e); fitBox(e); }}><summary class="btn">View</summary><div class="box">
          <div class="rotrow" id="snap" role="group" aria-label="Snap"><span>Snap</span>
            ${GRID_VALUES.map((g) => html`<button class="chip keep" data-grid=${g} aria-pressed=${pressed(st.snapGrid === g)} @click=${() => { st.setGrid(g); h.requestUpdate(); }}>${g ? `${g} cm` : "None"}</button>`)}</div>
          <button class="chip" id="mgrid" aria-pressed=${pressed(st.measure)} title="A faint 50 cm grid with metre markers, behind the plan" @click=${() => { st.setMeasure(!st.measure); h.requestUpdate(); }}>Measure grid</button>
          <button class="chip" id="lens" aria-pressed=${pressed(st.showLen)} @click=${() => { st.showLen = !st.showLen; h.requestUpdate(); }}>Lengths</button>
          ${sub("labelsSub", "Labels", html`
            <button class="chip" id="names" aria-pressed=${pressed(st.showNames)} title="Show every visible device's name on the plan" @click=${() => { st.showNames = !st.showNames; h.requestUpdate(); }}>Device names</button>
            <button class="chip" id="labels" aria-pressed=${pressed(st.labels)} title="Show the names and values on the plan. Off leaves only the items and sensors." @click=${() => { st.setLabels(!st.labels); h.requestUpdate(); }}>Names and values</button>`)}
          <button class="chip" id="night" aria-pressed=${pressed(st.night)} title="Draw the plan as the card does after sunset. The editor has no live lights, so every room is dark." @click=${() => { st.setNight(!st.night); h.requestUpdate(); }}>Preview night</button>
          <details class="sub" id="thSub" @toggle=${onSubToggle}><summary class="btn">Theme: ${THEME_LABELS[st.theme]}</summary>
            ${THEME_VALUES.map((t) => html`<button class="btn keep" data-th=${t} aria-pressed=${pressed(st.theme === t)} @click=${() => { st.setTheme(t); h.requestUpdate(); }}>${THEME_LABELS[t]}</button>`)}
          </details>
          <details class="sub" id="detailSub" @toggle=${onSubToggle}><summary class="btn">Detail: ${DETAIL_LABELS[st.detail]}</summary>
            ${DETAIL_MODES.map((m) => html`<button class="btn keep" data-detail=${m} aria-pressed=${pressed(st.detail === m)} title=${m === "auto" ? "Follow the zoom: rooms far out, devices closer in" : m === "full" ? "Always draw everything (the default while editing)" : "Always draw only rooms and what needs attention"} @click=${() => { st.setDetail(m); h.requestUpdate(); }}>${DETAIL_LABELS[m]}</button>`)}
          </details>
          <button class="btn" id="recenter" @click=${() => { st.recenter(); h.requestUpdate(); }}>Re-center</button>
          <button class="btn keyed" id="fit" title="Fit the whole floor in the window" @click=${() => { st.fit(); h.requestUpdate(); }}>Fit to window${kbd(MENU_KEYS.fit)}</button>
          <button class="btn" id="copyCardView" title="Copies center and zoom_level for a card pinned to what's on screen now" @click=${() => h.copyCardView()}>Copy card view</button>
        </div></details>
        <details class="menu" id="mEdit" @toggle=${(e: Event) => { h.onMenuToggle(e); fitBox(e); }}><summary class="btn">Edit</summary><div class="box">
          <button class="btn" id="addFloor" title="Add a floor" @click=${() => h.startAddFloor()}>Add floor</button>
          ${h.writer ? html`<button class="btn" id="mHA" ?disabled=${!h.haList?.length && !h.haListErr} aria-expanded=${pressed(!!h.haPos)} title=${h.haListErr || (h.haList?.length ? "What Floorplan Studio made in Home Assistant" : "Nothing Floorplan Studio made is labelled in Home Assistant yet")} @click=${() => h.toggleHa()}>Home Assistant</button>` : nothing}
          ${ha ? html`<details class="sub" id="mGroup" @toggle=${onSubToggle}><summary class="btn">Group</summary>
            <button class="btn" id="groupAll" aria-pressed=${pressed(!st.activeGroup)} @click=${() => { st.activeGroup = null; h.requestUpdate(); }}>All</button>
            ${groups.length === 0 ? html`<span class="grp" id="groupNone">No Home Assistant group has a member on this floor</span>` : nothing}
            ${groups.map((g) => html`<button class="btn" data-group=${g.id} aria-pressed=${pressed(st.activeGroup === g.id)} @click=${() => { st.activeGroup = g.id; h.requestUpdate(); }}>${g.name}</button>`)}
            ${h.writer && activeGroup && groupKindOf(activeGroup) === "motion" ? html`<div class="sep"></div>
              <details class="sub" id="motLightGrp" @toggle=${onSubToggle}><summary class="btn">Turns on: ${groups.find((g) => g.id === st.motionLightGroup)?.name ?? "choose a light group..."}</summary>
                ${groups.filter((g) => groupKindOf(g) === "light").map((g) => html`<button class="btn keep" data-light-group=${g.id} aria-pressed=${pressed(g.id === st.motionLightGroup)} @click=${(e: Event) => { st.motionLightGroup = g.id; (e.currentTarget as HTMLElement).closest("details")!.open = false; h.requestUpdate(); }}>${g.name}</button>`)}
              </details>
              <label for="motMinutes">off after (minutes)</label>
              <input id="motMinutes" type="number" min="1" step="1" .value=${live(st.motionMinutes)} @change=${(e: Event) => { st.motionMinutes = (e.target as HTMLInputElement).value; h.requestUpdate(); }}>
              <p><button class="btn" id="motGo" @click=${() => { const min = Number(st.motionMinutes); if (st.motionLightGroup && min > 0) void h.motionAutomation(activeGroup.id, st.motionLightGroup, min); }}>Create automation</button></p>` : nothing}
          </details>
          <button class="btn" id="linkLights" title="Link every unbound light on this floor to its uniquely matched switch" @click=${() => h.autoLinkLights()}>Link lights to switches</button>` : nothing}
          <div class="rotrow"><span id="rotv">Rotate the plan: ${st.layout.rotate ?? 0}°</span>
            <button class="btn keep" id="rotl" aria-label="Rotate the plan 45 degrees left" @click=${() => h.rotatePlan(-45)}>&#8630; 45°</button>
            <button class="btn keep" id="rotr" aria-label="Rotate the plan 45 degrees right" @click=${() => h.rotatePlan(45)}>45° &#8631;</button></div>
          <button class="btn" id="devcols" aria-expanded=${pressed(!!h.devColsPos)} @click=${() => h.toggleDevCols()}>Device colours</button>
          <button class="btn" id="traceBtn" aria-expanded=${pressed(h.traceOpen)} @click=${() => h.toggleTrace()}>Trace image…</button>
        </div></details>
        <details class="menu" id="mFile" @toggle=${(e: Event) => { h.onMenuToggle(e); fitBox(e); }}><summary class="btn">File</summary><div class="box">
          <button class="btn" id="imp" @click=${() => h.renderRoot.querySelector<HTMLInputElement>("#file")?.click()}>Open…</button>
          <button class="btn" id="exp" title="Download the current layout as JSON" @click=${() => h.exportJson()}>Export…</button>
          <label class="grp"><input type="checkbox" id="expTrace" .checked=${live(h.exportTrace)} @change=${(e: Event) => { h.exportTrace = (e.target as HTMLInputElement).checked; }}> Include trace image</label>
          <button class="btn" id="installcode" aria-expanded=${pressed(h.installCodeOpen)} @click=${() => h.toggleInstallCode()}>Install code…</button>
          ${h.demo ? html`<button class="btn" id="loaddemo" ?disabled=${!isBlank(st.layout)} title=${isBlank(st.layout) ? "Load the demo home" : "Reset first: loading the demo would overwrite your plan."} @click=${() => h.loadDemo()}>Load demo</button>` : nothing}
          <button class="btn danger" id="reset" title="Erase everything and start from a blank plan" @click=${() => h.reset()}>Reset</button>
          <button class="btn primary keyed" id="save" @click=${() => h.save()}>Save${kbd(MENU_KEYS.save)}</button>
        </div></details>
        <!-- S8.10 follow-up: Help, then Undo and Redo as the cluster's last items, so Redo's own right edge is
             the one the toolbar-alignment acceptance test pins. -->
        ${st.detail !== DEFAULT_DETAIL ? html`<span class="grp" id="detailMode" title="Set in View, Detail">Detail: ${DETAIL_LABELS[st.detail]}</span>` : nothing}
        <button class="btn" id="help" aria-expanded=${pressed(st.helpOpen)} title="Controls and a step-by-step guide" @click=${() => h.toggleHelp()}>? Help</button>
        <!-- S8.10 follow-up (Opus review): Undo and Redo as one flex item (nowrap inside), so wrapping ever moves
             the pair together onto the next row — two separate items let the row that fit Undo split Redo onto
             its own row alone. -->
        <div class="btnpair">
        <button class="btn light keyed" id="undo" ?disabled=${!st.canUndo} @click=${() => h.undo(true)}>Undo${kbd(MENU_KEYS.undo)}</button>
        <button class="btn light keyed" id="redo" ?disabled=${!st.canRedo} @click=${() => h.undo(false)}>Redo${kbd(MENU_KEYS.redo)}</button>
        </div>
        </div>
        <input type="file" id="file" accept=".json,application/json" hidden @change=${(e: Event) => h.openFile(e)}>
      </div>`;
}
