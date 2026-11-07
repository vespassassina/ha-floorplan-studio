import { LitElement, css, html, nothing } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { type DetailMode, type Layout, type Pt, type Floor, alignCandidates, type DeviceType, type SceneItem, type HaData, type StateOverlay, TempWatch, DEFAULT_MOTION_FADE_S, applyHaNames, FLOORPLAN_CSS, ThumbFeed, floorBelow, rotateAbout, type AddCandidate, type Trace, type WallKind, type LayerId, areaMove, renderFloor, badgeInfo, bindBadgeBubble, plugThreshold, type Bubble, detailFor, viewBoxFor, floorsAroundKey, UI_ICONS, heatLegend, anyRoomHeated } from "../core";
import { ROTATION_STEP } from "../card/view-state";
import { type BannerLevel, isQuiet, bannerLevel, BANNER_MS } from "./banner";
import { statusFacts } from "./status-bar";
import type { LinkScope } from "./bulk";
import type { SearchEntry } from "../core/search";
import type { OutlineNode, OutlineRow } from "./outline";
import { readViewMemory } from "./view-memory";
import { Draw, type DrawKind, type AreaPreset } from "./draw";
import { roomSceneTargets } from "./room-scenes-ops";
import { type SceneDraft, sceneDesigner } from "./scene-designer";
import type { PanelCtx } from "./panels";
import type { TempUnit } from "./temp-range-ops";
import type { Labelled, HaWriter } from "./hass-write";
import { EditorState, loadLayout, isBlank, type Sel } from "./state";
import { toolbarCss, floorGroups, toolbarView } from "./toolbar";
import { type AsideMode, inspectorCss, type AlignSteps, readAlignSteps, asideView } from "./inspector";
import { firstRunCss, firstRunView } from "./first-run";
import { type CtxTarget, fitCtxMenu, ctxMenuCss, ctxMenuView } from "./ctx-menu";
import { type Drag, hasOwn, DRAW_HINT, type Hit, num } from "./editor-kit";
import { loadHaList, areaDiff, offerAreaMove, createArea, makeLight, createGroup, controlsAutomation, scheduleAutomation, motionAutomation, moreInfo, runScene, addToArea } from "./editor-ha";
import { stopDraw, startDraw, placeTyped, addDoor, addOpeningGap, addWall, addStructure, addArea, addStairs, addFurniture, addUnlinked, placeDevice } from "./editor-draw";
import { viewKey, onSwitchEnd, startSwitch, flushView, onVisibility, stopTurn, zoomBy, tickTurn, resetView, turnBy } from "./editor-view";
import { scrollRow, pulse, onSearchPick, toggleSide, onOutlineQuery, onOutlineToggle, onOutlineRow, onOutlineCtx, onOutlineKey, setLayers, openLayers, counted, placedNote, findData, sideView } from "./editor-search";
import { renameFloor, moveFloor, deleteFloor, undo, setColour, openLink, closeLink, linkRows, applyLink, rotatePlan, centre, moveCurrentFloor, askDeleteFloor, startAddFloor, onNewFloorKey, spawnDevice } from "./editor-actions";
import { closeAlign, openAlign, alignPreview, applyAlign, alignStairInfo, alignStairs, setAlignStep, moveAlign, turnAlign, setAlignOffset, setAlignRotation, resetAlignOffset, ghostOpts } from "./editor-align";
import { save, exportJson, saveDone, reset, loadDemo, roomsFromAreas, adoptLayout, openFile, firstRunDemo, firstRunBlank } from "./editor-file";
import { planFixed, setPlanLocked, attachEntity, attachToRoom, rotateTexture, rotateItem, scaleTexture } from "./editor-changes";
import { openPlace, openScene, closeCtxMenu, toggleDevCols, dragHead, toggleHa, closePlace, placeIndex, setAsideMode, placeGo, openAddDev, closeAddDev, pickAddDev, toggleInstallCode, copyCardView, devColsView, haView, closeScene, saveSceneDraft, trySceneDraft, restoreSceneDraft, installCodeView } from "./editor-popups";
import { edgeNear, onDown, onMove, onUp, onDblClick, onWheel, edgeKind } from "./editor-pointer";
import { toggleTrace, setTrace, traceView } from "./editor-trace";
import { onKeyUp, onBlur, onKey, onButtonClick, onFocusOut, onWindowPointerDown, onWindowClick, closeSubs } from "./editor-keys";
import { resetViews, startSaveView, onViewFormKey, submitViewForm, applyView, openViewMenu, renameViewFromMenu, deleteViewFromMenu, setFloor } from "./editor-views";
import { planOverlay, measureGrid } from "./editor-overlay";
import { outdoorShade } from "../core/daylight";
import "../card/search-box";

export { planZero } from "./editor-kit";

/** A view change is written this long after the last one. Short, so a reload right after a touch still finds it. */
const VIEW_SAVE_MS = 150;

/** S37.3: under this width (px, the Studio's own) the Studio shows a message instead of the editor. Docs: DECISIONS 2026-10-25. */
const NARROW_PX = 700;

/**
 * <floorplan-studio-editor>: draws and edits a layout.
 *   property `layout`  the layout to edit (validated; a bad one is refused and listed)
 *   property `floor`   the floor shown
 *   property `demo`    a demo home; File, Load demo puts it in, only while nothing is drawn (Reset first). No demo, no button.
 *   property `firstRun` the host found no saved plan: while the plan is blank, three choices show (Load the demo, areas, Blank)
 *   event `layout-changed`  detail: the Layout, after every edit
 *   event `save-request`    detail: the Layout, File, Save (host writes it somewhere)
 *   method saveDone(ok, message?)  the host calls it when the write is over; status stays "Saving…" until then.
 *                           With no save-request listener the editor says "Saved" itself. Listen on the element.
 */
export class FloorplanStudioEditor extends LitElement {
  /** S25.7: the detail mode, kept by the editor state (View, Detail). */
  get detailMode(): DetailMode { return this.st.detail; }
  set detailMode(m: DetailMode) { this.st.detail = m; this.requestUpdate(); }
  static properties = {
    floor: { type: String },
    dashboardHref: { type: String, attribute: "dashboard-href" },
    narrow: { state: true },
    haDark: { attribute: false },
    tempUnit: { attribute: false },
    demo: { attribute: false },
    firstRun: { type: Boolean, attribute: false },
    errors: { state: true },
    status: { state: true },
    banner: { state: true },
    addingFloor: { state: true },
    haList: { state: true },
    haListLoading: { state: true },
    haListErr: { state: true },
  };
  declare floor: string;
  /** S37.3: where the "too narrow" message sends the person: the host (the panel) sets it to the dashboard. Unset on the standalone page, which has none. */
  declare dashboardHref: string | undefined;
  /** S37.3: the Studio's own width is under NARROW_PX. The editor stays drawn underneath (display:none), so nothing is lost; keys are ignored meanwhile. */
  declare narrow: boolean;
  /** Home Assistant's dark mode, set by the panel host from `hass.themes.darkMode`. Read only by the `ha` theme; undefined (standalone) follows the OS instead. */
  declare haDark: boolean | undefined;
  /** S42.5: the unit of the temperature range fields, set by the panel host from `hass.config.unit_system.temperature`. Standalone: °C. */
  declare tempUnit: TempUnit | undefined;
  declare demo: Layout | undefined;
  /** S37.1: set by the host when nothing is stored (the panel, on `{ layout: null }`). The standalone page never sets it: it always opens on a plan. Any choice, or drawing anything, ends it. */
  declare firstRun: boolean;
  declare errors: string[];
  declare status: string;
  /** `action`: one button in the banner that undoes what the message is about (S22.4: Untick Fix plan). */
  declare banner: { text: string; level: BannerLevel; action?: { id: string; label: string; run: () => void } } | null;
  bannerTimer: ReturnType<typeof setTimeout> | undefined;
  declare addingFloor: boolean;
  /** S4.10: everything floorplan-studio labelled in Home Assistant, loaded fresh each time the Home Assistant menu opens. `null` before the first load. */
  declare haList: Labelled[] | null;
  declare haListLoading: boolean;
  declare haListErr: string;

  st = new EditorState();
  drag: Drag | null = null;
  /** Draw mode: the shape being drawn, and where the pointer is (snapped) for the rubber band. */
  draw: Draw | null = null;
  /** S4.22: the layout as it stood when the texture-rotation slider's drag began, or null between drags. */
  textureRotGesture: Layout | null = null;
  itemRotGesture: Layout | null = null;
  /** S4.19: the same, for the texture-scale slider. */
  textureScaleGesture: Layout | null = null;
  hover: Pt | null = null;
  /** S26.12: the last aim of the pointer while drawing; a typed length goes this way even after a click cleared `hover`. */
  aim: Pt | null = null;
  /**
   * S4.18: the right-click context menu — a room, zone or structure, or (S4.27) a wall: a room/outline edge or a
   * free-standing wall. Its screen position and its target. Closed (null) by an outside click, Escape or scroll.
   */
  ctxMenu: { x: number; y: number; target: CtxTarget } | null = null;
  /** The Device colours popup's screen position; null when closed. Dragged by its header, closed by its own X or Escape. */
  devColsPos: { x: number; y: number } | null = null;
  /** S8.1: Edit, Home Assistant: the popover's screen position; null when closed. Dragged by its head, closed by its X or Escape. */
  haPos: { x: number; y: number } | null = null;
  /** S8.1/S8.4: the room panel's Place popup: the room's id (null when closed), its position, the rows ticked, the type chip pressed. */
  placeRoom: string | null = null;
  /** S26.14: which mode of the aside is on show (Place and Add are modes, not floating panels). */
  asideMode: AsideMode = "selection";
  placeOn = new Set<string>();
  /** S26.23: what the Link mode looks at (fixed when it opens), and the ids of the lights whose tick was taken off. */
  linkScope: LinkScope | null = null;
  /** The floor object Link mode was opened on. Its scope is device indices, so any edit, Undo or Redo (a new floor object) closes the mode. */
  linkFloor: Floor | null = null;
  linkOff = new Set<string>();
  /** S27.10: the key of the floor the Align mode was opened on (null when closed), and its memoised preview. */
  alignKey: string | null = null;
  /** How many times the Align preview has run `alignCandidates` (a test reads it: a drag must not search on every pointer move). */
  alignSearches = 0;
  alignMemo: { key: string; fits: ReturnType<typeof alignCandidates> } | null = null;
  placeType: DeviceType | null = null;
  sceneDraft: SceneDraft | null = null;
  scenePos: { x: number; y: number } | null = null;
  /** S17.7: what the devices were doing before the first Try of this popup; empty when nothing is tried. */
  sceneBackup: SceneItem[] = [];
  /** S18.2: what each device was doing before the designer's first Try; kept across Restore, so a later Try cannot record a stale state as the original. */
  sceneOrigin: SceneItem[] = [];
  sceneBusy = false;
  /** S8.5: Add > Device's floating panel: position (null when closed), the search text, and the four filter selects
   * (a value of "" is "All…"; "__none__" is the added "None" option). Reset every time the panel opens. */
  /** S26.20: where the canvas menu's "Add device here…" was clicked; the next device the Add panel places goes there. */
  addAt: Pt | null = null;
  addDevQuery = "";
  addDevFloor = "";
  addDevRoom = "";
  addDevArea = "";
  addDevType = "";
  /** File, Install code: whether the panel with the ready-to-paste card YAML is open. Fixed, not draggable; closed by its own X or Escape. */
  installCodeOpen = false;
  /** S24.5: the left column (the Outline tab; S24.6 adds Layers). Open or collapsed by its own button; starts collapsed under 1100 px. */
  sideOpen = (() => { try { return matchMedia("(min-width:1100px)").matches; } catch { return true; } })();
  /** S24.6: which tab of the left column is on show. Not remembered: the column opens on Outline. */
  sideTab: "outline" | "layers" = "outline";
  /** The Outline's open branches (the floor on show at first), its filter, the row in the tab order, and whether that row takes focus after the next render. */
  outlineOpen = new Set<string>();
  outlineSeeded = false;
  outlineQuery = "";
  outlineActive: string | null = null;
  outlineFocus = false;
  /** Scroll the active row into the tree's view after the next render, without taking focus (a search pick). */
  outlineReveal = false;
  /** The thing a search or the Outline just went to, ringed for a moment (renderFloor's `locate`). */
  locate: { floor: string; t: "dev" | "furn"; i: number } | null = null;
  locateTimer: ReturnType<typeof setTimeout> | undefined;
  /** The search entries and the Outline, built again only when a floor, the HA data, the states or Fix plan change. */
  findCache: { key: unknown[]; entries: SearchEntry[]; tree: OutlineNode[] } | null = null;
  /** S7.11: Edit, Trace image: whether its panel is open; the two points of a Scale step (null when not scaling); the Export tick, for this session only. */
  traceOpen = false;
  traceScale: Pt[] | null = null;
  /** S40.2: Move is on, so a drag on the plan moves the trace image and the arrows nudge it. Off on Hide, Remove, Scale, a closed panel and Escape. */
  traceMove = false;
  exportTrace = false;
  rect = { w: 800, h: 600 };
  ro?: ResizeObserver;
  /** The turn in flight, if any. `whole`: the floor was shown whole when it began, so it is refitted every frame. */
  turn: { from: number; to: number; t0: number; dur: number; whole: boolean; raf: number } | null = null;
  /** The remembered view is read once, with the first layout; before that nothing is written. */
  viewRestored = false;
  memKey: string | null = null;
  memSig = "";
  memTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.floor = "";
    this.firstRun = false;
    this.narrow = false;
    this.errors = [];
    this.status = "Ready";
    this.banner = null;
    this.addingFloor = false;
    this.haList = null;
    this.haListLoading = false;
    this.haListErr = "";
  }

  /** What Home Assistant has (floors, areas, entities), set by the host. With it the name fields are dropdowns and linked names are refreshed once, without an undo step. */
  /** Writes to Home Assistant. Set by the panel host only, never imported here, so the standalone build has none and shows no button that needs one. */
  get writer(): HaWriter | undefined { return this._writer; }
  set writer(v: HaWriter | undefined) {
    const old = this._writer; this._writer = v; this.requestUpdate("writer", old);
    if (v) void loadHaList(this); else { this.haList = null; this.haPos = null; } // S8.1: the Edit, Home Assistant button is disabled until the list has something
  }
  _writer?: HaWriter;
  get ha(): HaData | undefined { return this.st.ha; }
  set ha(v: HaData | undefined) {
    const old = this.st.ha;
    this.st.ha = v;
    this.refreshNames();
    this.requestUpdate("ha", old);
  }
  /** Live Home Assistant device state (on/off, attributes, last_changed), set by the panel host on every state
   * change, the same way `ha` is. Never a template binding (would need the render `guard` in panel.ts to depend on
   * it, defeating the point of that guard — see CLAUDE.md's "the panel must never re-run the editor's layout
   * setter"). Drives the same fade timer as the card (`_syncTimer`) so a motion device keeps fading between pushes. */
  get hassState(): StateOverlay | undefined { return this._hassStates; }
  set hassState(v: StateOverlay | undefined) {
    this._hassStates = v;
    this.syncFadeTimer();
    this.requestUpdate();
  }
  _hassStates: StateOverlay | undefined;
  temps = new TempWatch(() => this.requestUpdate());
  _fadeTimer: ReturnType<typeof setInterval> | null = null;
  /** The states the render reads: a motion sensor's own `last_changed` is when it went off, which is when its fade starts. */
  stateForRender(): StateOverlay | undefined { return this._hassStates; }
  /** True while a motion sensor of the shown floor (device or room list) is off and inside the fade window, plus one tick (card's `_motionFading`, mirrored). */
  motionFading(): boolean {
    const state = this._hassStates, f = this.st.f;
    if (!state) return false;
    const now = Date.now();
    const ids = [...f.devices.filter((d) => d.type === "motion").map((d) => d.entity), ...f.rooms.flatMap((r) => r.motion ?? [])];
    return ids.some((id) => {
      const s = state[id];
      if (!s || s.state === "on") return false;
      const t = Date.parse(s.last_changed);
      return !Number.isNaN(t) && now - t < DEFAULT_MOTION_FADE_S * 1000 + 1000;
    });
  }
  stopFadeTimer(): void {
    if (this._fadeTimer !== null) {
      globalThis.clearInterval(this._fadeTimer);
      this._fadeTimer = null;
    }
  }
  /** Starts a 1 s re-render timer while a motion device is fading, stops it the moment none is (card's `_syncTimer`, mirrored). */
  syncFadeTimer(): void {
    const active = this.motionFading();
    if (active && this._fadeTimer === null) {
      this._fadeTimer = globalThis.setInterval(() => {
        if (this.motionFading()) this.requestUpdate();
        else this.stopFadeTimer();
      }, 1000);
    } else if (!active) {
      this.stopFadeTimer();
    }
  }
  /** Copies HA's names into the linked floors and rooms. Not an edit: no undo step. Tells the host and the status line when something changed. */
  refreshNames() {
    if (!this.st.ha) return;
    const r = applyHaNames(this.st.layout, this.st.ha);
    if (!r.changed) return;
    this.st.layout = r.layout;
    this.st.persist();
    this.status = `${r.changed} names updated from Home Assistant`;
    this.emit("layout-changed");
  }

  get layout(): Layout { return this.st.layout; }
  set layout(v: Layout | undefined) {
    if (!v) return;
    const old = this.st.layout;
    stopDraw(this);
    const r = loadLayout(v);
    if (!r.ok) { this.errors = r.errors; return; }
    this.errors = [];
    this.st.setLayout(r.layout, this.floor);
    // Opening a plan that already has something drawn starts with the plan fixed; a blank one is for drawing.
    if (isBlank(old) && !isBlank(r.layout)) this.st.planLocked = true;
    if (!this.viewRestored) {
      this.viewRestored = true;
      // A floor the host asked for wins over the remembered one.
      const m = readViewMemory();
      if (this.floor) delete m.floor;
      this.st.importView(m);
      this.memSig = JSON.stringify(this.st.exportView());
      this.memKey = viewKey(this);
    }
    this.floor = this.st.floor;
    this.refreshNames();
    this.st.markSaved(); // the host's layout, names refreshed, is the saved state
    this.requestUpdate("layout", old);
  }
  /** True when the plan differs from the last load or successful save. The HA panel asks before the tab closes. */
  get dirty(): boolean { return this.st.dirty; }
  /** The host has made the plan current (it just loaded the stored one) without a save-request. */
  markSaved() { this.st.markSaved(); }

  // ---- the remembered view -------------------------------------------------

  /** S27.12: the direction of a floor switch waiting to start on the next render; the attribute itself is set by hand (see `startSwitch`), never bound in the template. */
  switchDir: "up" | "down" | null = null;
  onSwitchEnd = (ev: AnimationEvent) => onSwitchEnd(this, ev); // editor-view.ts

  /** B55.4: the same bubble as the card's, over the live view's states. The Studio's badges take no click, so it finds them by position. */
  private bubble: Bubble | null = null;
  private bindBubble() {
    const svg = this.svgEl, canvas = svg?.parentElement;
    if (!svg || !canvas || this.bubble) return;
    this.bubble = bindBadgeBubble({
      svg, mount: canvas, rect: () => canvas.getBoundingClientRect(),
      info: (ri, kind) => badgeInfo(this.st.f, ri, { state: this.stateForRender(), now: Date.now(), plugWatts: plugThreshold(undefined) }).find((b) => b.kind === kind),
    });
  }

  protected updated() {
    this.bindBubble();
    this.bubble?.refresh();
    this.thumbs.want(this.isConnected && this.st.cam.on);
    if (this.switchDir) { const d = this.switchDir; this.switchDir = null; startSwitch(this, d); }
    if (this.ctxMenu) fitCtxMenu(this.renderRoot);
    if (this.outlineFocus) {
      this.outlineFocus = false;
      const row = this.outlineActive === null ? null : this.renderRoot.querySelector<HTMLElement>(`#outlineTree [data-node="${CSS.escape(this.outlineActive)}"]`);
      if (row) { row.focus({ preventScroll: true }); scrollRow(this, row); }
    }
    if (this.outlineReveal) {
      this.outlineReveal = false;
      const row = this.outlineActive === null ? null : this.renderRoot.querySelector<HTMLElement>(`#outlineTree [data-node="${CSS.escape(this.outlineActive)}"]`);
      if (row) scrollRow(this, row);
    }
    if (this.memKey === null || this.st.turning !== null) return; // not loaded yet, or a frame of a turn
    const key = viewKey(this);
    if (key === this.memKey) return;
    this.memKey = key;
    if (JSON.stringify(this.st.exportView()) === this.memSig) return;
    clearTimeout(this.memTimer);
    this.memTimer = setTimeout(this.flushView, VIEW_SAVE_MS);
  }

  flushView = () => flushView(this); // editor-view.ts
  onVisibility = () => onVisibility(this); // editor-view.ts

  static styles = [
    css`
    ${css([FLOORPLAN_CSS] as unknown as TemplateStringsArray)}
    :host{display:block;outline:none;background:var(--fp-bg);color:var(--fp-ink);font:14px/1.4 system-ui,sans-serif}
    /* S37.3: under 700 px (the host's own width) the toolbar and the editor are hidden, not removed: the state underneath lives on. */
    .narrow-note{display:none;padding:24px 16px}
    :host([data-narrow]) .narrow-note{display:block}
    :host([data-narrow]) :is(.bar,.errors,.ed){display:none}
    .narrow-note a{color:var(--fp-ink);font-weight:600}
  `,
    toolbarCss,
    ctxMenuCss,
    firstRunCss,
    css`
    .btn,.chip,select,input{font:inherit;color:var(--fp-ink);background:var(--fp-room);border:1px solid var(--fp-idle);border-radius:4px;padding:4px 8px}
    .btn,.chip,summary{cursor:pointer}
    .btn:disabled{opacity:.5;cursor:not-allowed}
    .chip[aria-pressed="true"],.btn[aria-pressed="true"]{background:var(--fp-ink);color:var(--fp-bg)}
    .btn.primary{background:var(--fp-primary);color:var(--fp-on-dark);border-color:var(--fp-primary)}
    .btn.danger{background:var(--fp-danger);color:var(--fp-on-dark);border-color:var(--fp-danger)}
    .btn.warn{background:var(--fp-warn);color:var(--fp-on-light);border-color:var(--fp-warn)}
    /* Round red X, icon only: the room Sensors section's Remove. Square box so 50% is a circle. */
    .btn.rm-x{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:26px;height:26px;padding:0;border-radius:50%;background:var(--fp-danger);color:var(--fp-on-dark);border-color:var(--fp-danger);vertical-align:middle}
    .btn.rm-x svg{width:16px;height:16px;fill:currentColor;pointer-events:none}
    /* The room Sensors section: one framed box per kind round its picker and its list, names smaller than the form text. */
    .sens-box{border:1px solid var(--fp-primary);border-radius:6px;padding:6px 8px;margin:6px 0;background:color-mix(in srgb,var(--fp-primary) 7%,transparent)}
    .sens-box .attach-row{font-size:11px}
    .attach-row .eid{font-size:.8em;opacity:.7}
    .devcols-panel{position:fixed;z-index:30;width:560px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.35)}
    .devcols-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--fp-idle);font-weight:600;cursor:move;touch-action:none}
    .devcols-head button{width:auto;padding:0 8px;font-size:1.2em;line-height:1.6}
    .devcols-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 14px;padding:10px;overflow:auto}
    .devcols-sub{padding:6px 10px 0;font-weight:600} .devcols-walls{padding:4px 10px 8px;overflow:auto}
    .devcols-panel>.btn{margin:0 10px 10px;width:auto;align-self:flex-start}
    /* top:90px is only the fallback: installCodeView() always sets an inline top from panelTop(), which wins. */
    .installcode-panel{position:fixed;left:50%;top:90px;transform:translateX(-50%);z-index:30;width:520px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.35)}
    .installcode-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--fp-idle);font-weight:600}
    .installcode-head button{width:auto;padding:0 8px;font-size:1.2em;line-height:1.6}
    .installcode-panel p{margin:8px 10px 0;font-size:13px}
    .installcode-panel textarea{margin:8px 10px;padding:8px;font:12px/1.4 ui-monospace,monospace;border:1px solid var(--fp-idle);border-radius:4px;background:var(--fp-room);color:var(--fp-ink);resize:vertical}
    .installcode-panel>.btn{margin:0 10px 10px;width:auto;align-self:flex-start}
    .trace-panel{position:absolute;left:8px;bottom:8px;z-index:3;width:260px;max-width:calc(100% - 16px);display:flex;flex-direction:column;gap:6px;padding:0 10px 10px;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.35)}
    .trace-panel .installcode-head{margin:0 -10px}
    .trace-panel .row .btn{flex:1}
    .trace-panel .rotrow{display:flex;align-items:center;justify-content:space-between;gap:6px}
    .trace-panel .hint{margin:0}
    .trace-panel input[type=number]{width:6em}
    .stepper{display:flex;gap:2px;align-items:stretch} .stepper input{flex:1;min-width:0} .btn.step{padding:0 6px;min-width:26px}
    .controls{border-collapse:collapse;width:100%;margin:8px 0}
    .controls th,.controls td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--fp-line,#8884);vertical-align:top;font-weight:400}
    .controls kbd{font:600 12px ui-monospace,monospace;white-space:nowrap}
    .guide summary{cursor:pointer;font-weight:600;list-style:none}
    .guide summary::-webkit-details-marker{display:none}
    .guide summary::before{content:"\\25B8";display:inline-block;width:1em;transition:transform .15s ease}
    .guide details[open] summary::before{transform:rotate(90deg)}
    .sep{border-top:1px solid var(--fp-idle)}
    .mh{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--fp-ink);opacity:.6;padding:6px 8px 2px}
    /* Lighter, not lower-contrast: opacity leaves .btn's own colour/background computed values untouched (S1.53's
       contrast pair still passes) and only changes how it blends against the page behind it. */
    .btn.light{opacity:.6}
    .btn.light:not(:disabled):hover,.btn.light:not(:disabled):focus-visible{opacity:1}
    /* A disabled .btn.light is dimmer than an enabled one: .btn:disabled has the same specificity as .btn.light and comes first. */
    .btn.light:disabled{opacity:.35}
    .swatches{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0} .sw{width:28px;height:28px;padding:0;border:1px solid var(--fp-idle);border-radius:4px;cursor:pointer;position:relative;overflow:hidden} .sw.custom::after{content:"";position:absolute;top:0;right:0;width:0;height:0;border-style:solid;border-width:0 9px 9px 0;border-color:transparent var(--fp-ink) transparent transparent} .sw[aria-pressed="true"]{outline:2px solid var(--fp-ink);outline-offset:1px}
    /* S35.7: the car panel's top-view swatch. The plan's own car rules live with the plan; this one is the panel's, scoped to .car-sw. */
    .car-model{display:flex;align-items:flex-end;gap:8px} .car-model>label{flex:1}
    .car-sw{flex:none;width:72px;height:auto;margin-bottom:4px;--car-fill:var(--car-body,var(--fp-idle))}
    .car-sw .car-body,.car-sw .car-mirror{fill:var(--car-fill);stroke:var(--fp-ink);stroke-width:1}
    .car-sw .car-roof{fill:color-mix(in srgb,var(--car-fill) 80%,#000)} .car-sw .car-bed{fill:color-mix(in srgb,var(--car-fill) 55%,#000)}
    .car-sw .car-glass{fill:#14181d} .car-sw .car-tyre{fill:#000} .car-sw .car-grille{fill:#14181d}
    .rot-val{display:inline-block;min-width:3em;text-align:right;font-variant-numeric:tabular-nums}
    .colrow{display:flex;justify-content:space-between;align-items:center;gap:6px;margin:2px 0} .colrow label{display:flex;flex:1;justify-content:space-between;gap:6px} .colrow input{padding:0;width:36px;height:24px} .colrow .btn{width:auto}
    .rangerow{display:flex;align-items:center;gap:8px;margin:2px 0} .rangerow input{flex:1;width:auto} .rangerow .rot-val{flex:none;min-width:3.5em;text-align:right}
    /* S24.5: the left column (Outline; S24.6 Layers), the plan, the panel. The column only changes the plan's width:
       same top, same height, and the view keeps its centre and zoom. */
    .ed{display:grid;grid-template-columns:auto minmax(0,1fr) 300px;gap:12px;align-items:start}
    .side{display:flex;flex-direction:column;box-sizing:border-box;height:var(--fp-editor-height,calc(100vh - 150px));min-height:420px;border:1px solid var(--fp-idle);background:var(--fp-bg)}
    .side.open{width:260px}
    .side.shut{width:36px}
    .side-head{display:flex;align-items:center;gap:6px;padding:4px;flex:none}
    .side.open .side-head{border-bottom:1px solid var(--fp-idle)}
    .side-x{flex:none;width:26px;height:26px;padding:0;line-height:1}
    .tabs{display:flex;gap:2px;min-width:0}
    .tab{font:inherit;color:var(--fp-ink);background:transparent;border:0;border-bottom:2px solid transparent;padding:3px 8px;cursor:pointer}
    .tab[aria-selected="true"]{border-bottom-color:var(--fp-ink);font-weight:600}
    .side-body{display:flex;flex-direction:column;gap:6px;padding:6px;flex:1;min-height:0}
    /* S24.6: Layers rows. A hidden family is struck through with its eye shut; one with nothing on this floor is dimmed, still listed. */
    .lhint{margin:0;font-size:.82em;opacity:.75}
    .layers{display:flex;flex-direction:column;gap:2px;overflow:auto;min-height:0}
    .lrow{display:flex;align-items:center;gap:8px;font:inherit;font-size:.92em;color:var(--fp-ink);background:transparent;border:0;border-radius:4px;padding:4px 6px;cursor:pointer;text-align:left}
    .lrow:hover{background:color-mix(in srgb,var(--fp-ink) 10%,transparent)}
    .lrow:focus-visible{outline:2px solid var(--fp-ink);outline-offset:-2px}
    .lrow.empty{opacity:.5}
    .lrow[aria-pressed="false"] .ll{text-decoration:line-through}
    .lrow[aria-pressed="false"] .leye{opacity:.6}
    .leye{flex:none;width:18px;height:18px;fill:currentColor}
    .ll{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .lc{flex:none;font-size:.85em;opacity:.75;font-variant-numeric:tabular-nums}
    #outlineFilter{width:100%;box-sizing:border-box;flex:none}
    .tree{flex:1;min-height:0;overflow:auto}
    .ti{display:flex;align-items:center;gap:4px;padding:2px 6px 2px calc(2px + var(--lvl,0) * 14px);border-radius:4px;cursor:pointer;white-space:nowrap;font-size:.92em}
    .ti:hover{background:color-mix(in srgb,var(--fp-ink) 10%,transparent)}
    .ti:focus-visible{outline:2px solid var(--fp-ink);outline-offset:-2px}
    .ti[aria-selected="true"]{background:var(--fp-ink);color:var(--fp-bg)}
    .tw{flex:none;width:1em;text-align:center;opacity:.75}
    .tl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
    .via{opacity:.7}
    .tc{flex:none;font-size:.8em;opacity:.75;font-variant-numeric:tabular-nums}
    .k-floor .tl,.k-unplaced .tl{font-weight:600}
    .k-unplaced{margin-top:6px}
    .statusbar{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;position:absolute;left:0;right:0;bottom:0;z-index:1;padding:3px 8px;font-size:12px;line-height:1.5;color:var(--fp-ink);background:var(--fp-room);border-top:1px solid var(--fp-idle)}
    .statusbar{pointer-events:none}
    .sb-ramp{display:inline-block;width:5em;height:.7em;border-radius:3px;border:1px solid var(--fp-idle)}
    .statusbar .btn{padding:0 8px;font-size:12px;pointer-events:auto}
    .canvas{position:relative;border:1px solid var(--fp-idle);height:var(--fp-editor-height,calc(100vh - 150px));min-height:420px;touch-action:none;background:var(--fp-bg)}
    .zoom{position:absolute;top:8px;right:8px;display:flex;flex-direction:column;gap:4px;z-index:2}
    .zoom .btn{width:24px;height:24px;padding:0;text-align:center;line-height:1;font-size:13px}
    .zoom .btn svg{width:16px;height:16px;display:block;margin:0 auto}
    .canvas svg{width:100%;height:100%;display:block;cursor:grab;user-select:none}
    .canvas svg.drawing,.canvas svg.drawing *{cursor:crosshair}
    /* S7.11: the scan is drawn under everything; see-through room fills keep it visible where a room is already traced. Editor only. */
    .canvas svg.tracing .room{fill-opacity:.4}
    .dr{fill:none;stroke:var(--fp-window);stroke-width:2;stroke-dasharray:6 4;vector-effect:non-scaling-stroke;pointer-events:none}
    .dp{fill:var(--fp-bg);stroke:var(--fp-window);stroke-width:2;vector-effect:non-scaling-stroke;pointer-events:none}
    .dp.first{fill:var(--fp-window)}
    /* S26.12: the typed length at the rubber band. A halo so it reads over a fill; never takes a click. */
    .dr-typed{fill:var(--fp-window);stroke:var(--fp-bg);stroke-width:4px;paint-order:stroke;font-weight:600;pointer-events:none;user-select:none}
    /* S26.10: the Shift+drag rectangle. See-through, dashed, never takes a click (a class rule: an attribute would lose to .canvas svg rules, finding 18). */
    .marquee{fill:var(--fp-window);fill-opacity:.12;stroke:var(--fp-window);stroke-width:1.5;stroke-dasharray:5 3;vector-effect:non-scaling-stroke;pointer-events:none}
    .grp{font-size:.8em;opacity:.7}
    .box input[type=search]{width:100%;box-sizing:border-box}
    .harow{display:flex;align-items:center;gap:4px;flex-wrap:wrap} .harow>span:first-child{flex:1;min-width:80px} .harow .btn{width:auto}
    .habox-h{margin:8px 0 2px;font-size:.85em;font-weight:600;opacity:.8}
    /* S8.10: the room box's Devices/Helpers/Automations/Scripts/Scenes headings, and the Devices group's own
       per-type sub-groups, are collapsible <details>, closed by default (findings 2, 10). */
    .habox-group,.habox-sub{display:flex;flex-direction:column;gap:2px}
    .habox-group>summary,.habox-sub>summary{list-style:none}
    .habox-group>summary::-webkit-details-marker,.habox-sub>summary::-webkit-details-marker{display:none}
    .habox-group>summary::before,.habox-sub>summary::before{content:"\\25B8";display:inline-block;width:1em;transition:transform .15s ease}
    .habox-group[open]>summary::before,.habox-sub[open]>summary::before{transform:rotate(90deg)}
    .habox-sub{padding-left:14px}
    .scene{border:1px solid var(--line,#8884);border-radius:6px;padding:4px 6px;margin:4px 0} .scene-item{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:2px 0} .scene-item>span:first-child{flex:1;min-width:80px} .scene-item .btn,.scene-item select,.scene-item input{width:auto} .scene-item input[type=number]{width:90px} .scene-item .tag{opacity:.7}
    .harow2{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:2px 0} .harow2>span:first-child{flex:1;min-width:80px} .harow2 .btn{width:auto}
  `,
    inspectorCss,
    css`
    .errors{border:1px solid var(--fp-motion);border-radius:4px;padding:6px 10px;margin:6px 0}
    .errors ul{margin:4px 0;padding-left:18px}
    .banner{position:absolute;bottom:40px;left:50%;transform:translateX(-50%);z-index:50;display:flex;align-items:center;gap:10px;max-width:min(40em,calc(100% - 24px));padding:8px 8px 8px 14px;border:1px solid;border-radius:6px;font-size:.9em;box-shadow:0 2px 10px rgba(0,0,0,.25);pointer-events:none}
    .banner.info{background:#e8f1fb;color:#123a63;border-color:#6c9bd1}
    .banner.warning{background:#fff4d6;color:#5c4200;border-color:#d9a400}
    .banner.error{background:#fde4e1;color:#7a1410;border-color:#d4483f}
    .banner-act{pointer-events:auto;flex:none;border:1px solid currentColor;border-radius:4px;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;padding:2px 8px}
    .banner-x{pointer-events:auto;flex:none;border:0;background:transparent;color:inherit;font-size:1.3em;line-height:1;cursor:pointer;padding:0 6px}
    .status{flex:0 1 auto;max-width:16em;font-size:.85em;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .room{pointer-events:all}
    .opening{pointer-events:stroke}
    .door-hit-open:hover{stroke:var(--fp-door);stroke-opacity:.3}
    .furn{pointer-events:all}
    .hl{fill:none;stroke:var(--fp-window);stroke-width:2;vector-effect:non-scaling-stroke;pointer-events:none}
    /* S36.5: a selected zone keeps reading as a zone: heavier and dashed. A class rule, not attributes, so it outranks nothing by accident (finding 18). */
    .hl.hl-zone{stroke-width:3;stroke-dasharray:6 4}
    .h{cursor:move} .h.on{fill:var(--fp-ink)}
    .we{fill:none;stroke:transparent;stroke-width:14px;vector-effect:non-scaling-stroke;pointer-events:stroke;cursor:copy}
    .align-pivot{pointer-events:none} .align-pivot line{stroke:var(--fp-window);stroke-width:2;vector-effect:non-scaling-stroke}
    .len{fill:var(--fp-text);paint-order:stroke;stroke:var(--fp-outline);stroke-width:3;stroke-linejoin:round;pointer-events:none;user-select:none}
    .lbl{pointer-events:none;user-select:none}
    .dev,.door,.heater{cursor:move}
    /* 700 to 900 px keeps the single column; under 700 px the notice above takes over (S37.3). */
    @media (max-width:900px){.ed{grid-template-columns:1fr}.side{height:auto;min-height:0}.side.open,.side.shut{width:auto}.side .tree{max-height:40vh}}
  `,
  ];

  /** S16.3: the camera pictures' refresh clock, running while they are on and the editor is on the page (core/camera-thumb.ts). */
  thumbs = new ThumbFeed(() => this.requestUpdate());
  /** An <image> that fails to load fires `error` on itself, which does not bubble: heard on the way down, it is dropped until the next refresh. */
  onThumbError = (e: Event) => {
    const i = Number((e.target as Element | null)?.closest?.("g[data-camx]")?.getAttribute("data-camx")), entity = this.st.f.devices[i]?.entity;
    if (entity) this.thumbs.fail(entity);
  };

  connectedCallback() {
    super.connectedCallback();
    this.renderRoot.addEventListener("error", this.onThumbError, true);
    // Keys are heard on the element only, so Delete or Ctrl+Z elsewhere in a page does nothing here.
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
    this.addEventListener("keydown", this.onKey);
    this.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("pagehide", this.flushView);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.addEventListener("focusout", this.onFocusOut);
    this.addEventListener("click", this.onButtonClick);
    window.addEventListener("click", this.onWindowClick);
    window.addEventListener("pointerdown", this.onWindowPointerDown, true);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.bubble?.destroy();
    this.bubble = null;
    this.temps.stop();
    this.thumbs.want(false);
    this.renderRoot.removeEventListener("error", this.onThumbError, true);
    this.removeEventListener("keydown", this.onKey);
    this.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("pagehide", this.flushView);
    document.removeEventListener("visibilitychange", this.onVisibility);
    stopTurn(this);
    flushView(this);
    this.removeEventListener("focusout", this.onFocusOut);
    this.removeEventListener("click", this.onButtonClick);
    window.removeEventListener("click", this.onWindowClick);
    window.removeEventListener("pointerdown", this.onWindowPointerDown, true);
    this.ro?.disconnect();
    this.roHost?.disconnect();
    this.stopFadeTimer();
    clearTimeout(this.locateTimer);
  }

  /** Whether the `ha` theme should use the dark set: the host's word when it gave one, the OS's otherwise. */
  isDark(): boolean {
    if (this.haDark !== undefined) return this.haDark;
    try { return matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
  }

  /** Shows a message as a banner low in the plan for 20 s, coloured by its situation. `level` overrides the guess from the text. */
  notify(text: string, level?: BannerLevel, action?: { id: string; label: string; run: () => void }) {
    clearTimeout(this.bannerTimer);
    if (isQuiet(text)) { this.banner = null; return; }
    this.banner = { text, level: level ?? bannerLevel(text), action };
    this.bannerTimer = setTimeout(() => { this.banner = null; }, BANNER_MS);
  }
  closeBanner() { clearTimeout(this.bannerTimer); this.banner = null; this.status = ""; }

  protected willUpdate(changed: Map<string, unknown>) {
    this.temps.sync(this.st.layout, this._hassStates, Date.now()); // S42.4: the live view's warning, the same onset memory as the card's
    if (this.linkScope && this.st.f !== this.linkFloor) { this.linkScope = null; if (this.asideMode === "link") this.asideMode = "selection"; } // R2
    if (changed.has("status") && this.banner?.text !== this.status) this.notify(this.status); // already shown by an explicit notify, with its level and action
    if (changed.has("floor") && this.floor && this.floor !== this.st.floor && hasOwn(this.st.layout.floors, this.floor)) { stopDraw(this); this.st.setFloor(this.floor); }
    if (this.alignKey !== null && (this.st.floor !== this.alignKey || floorBelow(this.st.layout, this.alignKey) === null)) closeAlign(this, false); // after the host's floor change above, so one render never shows the panel on the old floor: the mode belongs to one floor with a floor below
    // Always named, never left to inherit: blueprint unless the viewer chose otherwise. Reflected on the host itself, not just the svg,
    // so the editor's own chrome (menus, panels, buttons) themes with the plan. data-mode is for the ha theme only.
    this.setAttribute("data-theme", this.st.theme);
    this.toggleAttribute("data-narrow", this.narrow);
    if (this.st.theme === "ha" && this.isDark()) this.setAttribute("data-mode", "dark");
    else this.removeAttribute("data-mode");
  }

  protected firstUpdated() {
    const s = this.svgEl;
    s?.addEventListener("wheel", this.onWheel, { passive: false });
    if (s && typeof ResizeObserver !== "undefined") { this.ro = new ResizeObserver(() => this.measure()); this.ro.observe(s); }
    if (typeof ResizeObserver !== "undefined") { this.roHost = new ResizeObserver(() => this.measureHost()); this.roHost.observe(this); }
    this.measureHost();
    this.measure();
  }
  roHost?: ResizeObserver;
  /** S37.3: the Studio's own width, not the window's: in Home Assistant the panel sits beside the sidebar. A width of 0 (not laid out) is not narrow. */
  measureHost() {
    const w = this.getBoundingClientRect().width;
    const narrow = w > 0 && w < NARROW_PX;
    if (narrow !== this.narrow) this.narrow = narrow;
  }

  get svgEl(): SVGSVGElement | null { return this.renderRoot.querySelector(".canvas > svg"); } // the plan, not the icons inside the buttons
  measure() {
    const r = this.svgEl?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0 && (Math.abs(r.width - this.rect.w) > 0.5 || Math.abs(r.height - this.rect.h) > 0.5)) {
      this.rect = { w: r.width, h: r.height };
      this.requestUpdate();
    }
  }
  /** Screen pixels per cm. */
  get scale(): number {
    const v = this.st.view;
    return Math.min(this.rect.w / v.w, this.rect.h / v.h) || 1;
  }
  /** Plan coordinates of a pointer: the point in the svg's own space, turned back by the plan's rotation. The one place plan points are made from the screen. */
  toSvg(ev: { clientX: number; clientY: number }): Pt {
    const s = this.svgEl, m = s?.getScreenCTM();
    if (!s || !m) return [0, 0];
    const p = s.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(m.inverse()), r = this.st.rotation;
    return r ? rotateAbout([q.x, q.y], -r.deg, r.pivot) : [q.x, q.y];
  }

  // ---- changes -------------------------------------------------------------

  emit(name: "layout-changed" | "save-request") {
    this.dispatchEvent(new CustomEvent(name, { detail: this.st.layout, bubbles: true, composed: true }));
  }
  /** After any change: autosave, tell the host, redraw. */
  changed(status = "Edited") {
    // S7.11 / Opus review 2026-09-25: the autosave may have dropped the trace image for lack of room; say so, or a
    // reload before Save loses the scan without a word.
    const kept = this.st.persist();
    this.status = kept ? status : `${status}. The browser has no room for the trace image in the autosave: Save to keep it`;
    this.emit("layout-changed");
    this.temps.stop(); // edits mutate the layout in place, so the watch would see the same reference; forget it, keep the onsets
    this.requestUpdate();
  }
  commit = (fn: (f: Floor) => Floor | void) => { if (this.st.edit(fn)) this.changed(); else this.refused(); };
  /** A writer said no. When the plan lock is why, say so and offer the way out; otherwise redraw, so a field shows the layout again. */
  refused() { if (this.st.planLocked && this.st.planBlocked) this.planFixed(); else this.requestUpdate(); }
  /** A slider refused by the lock warns once per drag: while its banner shows, a later tick only snaps the slider back. */
  slideRefused() { if (this.banner?.action?.id === "bannerUnfix") this.requestUpdate(); else this.planFixed(); }
  planFixed(): boolean { return planFixed(this); } // editor-changes.ts
  setPlanLocked(on: boolean) { return setPlanLocked(this, on); } // editor-changes.ts
  attachEntity = (entity: string | string[], apply: (f: Floor) => void, label: string, keepDeviceId?: string) => attachEntity(this, entity, apply, label, keepDeviceId); // editor-changes.ts
  attachToRoom = (i: number) => attachToRoom(this, i); // editor-changes.ts
  select = (s: Sel) => { this.st.sel = s; this.requestUpdate(); };
  rotateTexture = (on: "rooms" | "stairs" | "furniture", i: number, rot: number, phase: "live" | "commit") => rotateTexture(this, on, i, rot, phase); // editor-changes.ts
  rotateItem = (on: "furniture" | "unlinked", i: number, rot: number, phase: "live" | "commit") => rotateItem(this, on, i, rot, phase); // editor-changes.ts
  scaleTexture = (on: "rooms" | "stairs" | "furniture", i: number, scale: number, phase: "live" | "commit") => scaleTexture(this, on, i, scale, phase); // editor-changes.ts
  ctx(): PanelCtx {
    return { st: this.st, tempUnit: this.tempUnit, commit: this.commit, attachEntity: this.attachEntity, attachToRoom: this.attachToRoom, paint: (on, i, p) => { if (this.st.paint(on, i, p)) this.changed(); else this.refused(); }, edited: (ok) => { if (ok) this.changed(); else this.refused(); }, rotateTexture: this.rotateTexture, rotateItem: this.rotateItem, scaleTexture: this.scaleTexture, select: this.select, say: (m) => { this.status = m; this.requestUpdate(); }, refresh: () => this.requestUpdate(), help: () => { if (!this.st.helpOpen) this.toggleHelp(); }, areaDiff: (i) => { const a = areaDiff(this, i); return a ? { name: a.name } : null; }, moveArea: (i) => void offerAreaMove(this, i, true), createArea: this.writer && this.st.ha ? (i) => void createArea(this, i) : undefined, drawArea: (a) => { startDraw(this, "room", "wall", a); if (this.draw) this.status = `Drawing a room for ${a.name}. ${DRAW_HINT}`; }, placeArea: (i) => openPlace(this, i), designScene: (i, id) => openScene(this, i, id), makeLight: this.writer && this.st.ha ? (i) => void makeLight(this, i) : undefined, createGroup: this.writer && this.st.ha ? (is, kind, name) => void createGroup(this, is, kind, name) : undefined, controlsAutomation: this.writer ? (i, targets) => void controlsAutomation(this, i, targets) : undefined, scheduleAutomation: this.writer ? (i, on, off) => void scheduleAutomation(this, i, on, off) : undefined, linkMotion: this.writer && this.st.ha ? (i, motionEntity, minutes) => void motionAutomation(this, motionEntity, this.st.f.devices[i].entity, minutes, i) : undefined, moreInfo: (id) => moreInfo(this, id), runScene: this.writer ? (id) => void runScene(this, id) : undefined, addToArea: this.writer ? (i, id) => void addToArea(this, i, id) : undefined, floors: { rename: (k, t) => renameFloor(this, k, t), move: (k, d) => moveFloor(this, k, d), remove: (k) => deleteFloor(this, k) } };
  }

  // ---- pointer -------------------------------------------------------------

  edgeNear(p: Pt): Hit | null { return edgeNear(this, p); } // editor-pointer.ts

  onDown = (ev: PointerEvent) => onDown(this, ev); // editor-pointer.ts

  onMove = (ev: PointerEvent) => onMove(this, ev); // editor-pointer.ts

  onUp = (ev: PointerEvent) => onUp(this, ev); // editor-pointer.ts

  onDblClick = (ev: MouseEvent) => onDblClick(this, ev); // editor-pointer.ts

  onWheel = (ev: WheelEvent) => onWheel(this, ev); // editor-pointer.ts

  closeCtxMenu = () => closeCtxMenu(this); // editor-popups.ts

  toggleDevCols = () => toggleDevCols(this); // editor-popups.ts
  devColsHead = dragHead(this, () => this.devColsPos, (p) => { this.devColsPos = p; });
  haHead = dragHead(this, () => this.haPos, (p) => { this.haPos = p; });
  sceneHead = dragHead(this, () => this.scenePos, (p) => { this.scenePos = p; });

  toggleHa() { return toggleHa(this); } // editor-popups.ts

  // ---- S8.1: the room panel's Place popup ----------------------------------------------------------------------------

  openPlace(i: number) { return openPlace(this, i); } // editor-popups.ts
  closePlace() { return closePlace(this); } // editor-popups.ts
  placeIndex(): number { return placeIndex(this); } // editor-popups.ts
  setAsideMode(m: AsideMode) { return setAsideMode(this, m); } // editor-popups.ts
  placeGo(i: number, ids: string[]) { return placeGo(this, i, ids); } // editor-popups.ts

  // ---- S8.5: Add > Device — one floating panel over the catalog and HA entities ---------------------------------------

  openAddDev(at?: Pt) { return openAddDev(this, at); } // editor-popups.ts
  closeAddDev() { return closeAddDev(this); } // editor-popups.ts
  pickAddDev(c: AddCandidate) { return pickAddDev(this, c); } // editor-popups.ts

  toggleInstallCode = () => toggleInstallCode(this); // editor-popups.ts

  // ---- S7.11: trace image ----------------------------------------------------

  toggleTrace() { return toggleTrace(this); } // editor-trace.ts
  setTrace(t: Trace | null, status: string) { return setTrace(this, t, status); } // editor-trace.ts
  /** S40.2: Move is on and there is an image to move. */
  get moving(): boolean { return this.traceMove && this.traceOpen && this.st.f.trace?.on === true; }

  copyCardView(): void { return copyCardView(this); } // editor-popups.ts

  edgeKind(poly: string, i: number): WallKind | "none" { return edgeKind(this, poly, i); } // editor-pointer.ts

  zoomBy(k: number) { return zoomBy(this, k); } // editor-view.ts

  tickTurn = () => tickTurn(this); // editor-view.ts

  /** S26.22: Alt held, for the status bar ("Snap off"). Heard on the host like every key; a lost window forgets it. */
  altDown = false;
  onKeyUp = (ev: KeyboardEvent) => onKeyUp(this, ev); // editor-keys.ts
  onBlur = () => onBlur(this); // editor-keys.ts
  onKey = (ev: KeyboardEvent) => onKey(this, ev); // editor-keys.ts

  onButtonClick = (ev: Event) => onButtonClick(this, ev); // editor-keys.ts

  onFocusOut = (ev: FocusEvent) => onFocusOut(this, ev); // editor-keys.ts

  onWindowPointerDown = (ev: PointerEvent) => onWindowPointerDown(this, ev); // editor-keys.ts

  onWindowClick = (ev: MouseEvent) => onWindowClick(this, ev); // editor-keys.ts

  // ---- S24.5: search and Outline ------------------------------------------------------------------------------------

  pulse(t: "dev" | "furn", i: number) { return pulse(this, t, i); } // editor-search.ts

  onSearchPick = (ev: Event) => onSearchPick(this, ev); // editor-search.ts

  toggleSide = () => toggleSide(this); // editor-search.ts

  onOutlineQuery = (q: string) => onOutlineQuery(this, q); // editor-search.ts
  onOutlineToggle = (id: string) => onOutlineToggle(this, id); // editor-search.ts
  onOutlineRow = (row: OutlineRow) => onOutlineRow(this, row); // editor-search.ts
  onOutlineCtx = (row: OutlineRow, ev: MouseEvent) => onOutlineCtx(this, row, ev); // editor-search.ts
  onOutlineKey = (ev: KeyboardEvent) => onOutlineKey(this, ev); // editor-search.ts

  setLayers(next: LayerId[]) { return setLayers(this, next); } // editor-search.ts
  openLayers = () => openLayers(this); // editor-search.ts

  counted() { return counted(this); } // editor-search.ts
  placedNote(before: ReturnType<FloorplanStudioEditor["counted"]>, plain: string, head: string) { return placedNote(this, before, plain, head); } // editor-search.ts

  // ---- actions -------------------------------------------------------------

  undo(back: boolean) { return undo(this, back); } // editor-actions.ts
  setColour(t: DeviceType, hex: string | null) { return setColour(this, t, hex); } // editor-actions.ts
  openLink() { return openLink(this); } // editor-actions.ts
  closeLink() { return closeLink(this); } // editor-actions.ts
  linkRows() { return linkRows(this); } // editor-actions.ts
  applyLink() { return applyLink(this); } // editor-actions.ts
  rotatePlan(step: number) { return rotatePlan(this, step); } // editor-actions.ts
  centre(): Pt { return centre(this); } // editor-actions.ts

  // ---- draw mode ----

  startDraw(kind: DrawKind, wall: WallKind = "wall", area?: AreaPreset) { return startDraw(this, kind, wall, area); } // editor-draw.ts
  /** The unrounded 15 degree ray point of the last pointer move, or null when no ray caught it. Only the direction of a typed length uses it. */
  rayAim: Pt | null = null;
  placeTyped() { return placeTyped(this); } // editor-draw.ts
  /** Where and when a pointer press finished a shape: its dblclick, if the browser sends one, must not edit the plan. */
  finished: { t: number; x: number; y: number; presses: number } | null = null;

  addDoor(kind: "door" | "window" | "slit" | "open", len: number, at?: Pt) { return addDoor(this, kind, len, at); } // editor-draw.ts
  addOpeningGap(len = 120, at?: Pt) { return addOpeningGap(this, len, at); } // editor-draw.ts
  addWall(kind: WallKind) { return addWall(this, kind); } // editor-draw.ts
  addStructure() { return addStructure(this); } // editor-draw.ts
  addArea(kind: "zone") { return addArea(this, kind); } // editor-draw.ts
  addStairs() { return addStairs(this); } // editor-draw.ts
  addFurniture(symbol: string) { return addFurniture(this, symbol); } // editor-draw.ts
  addUnlinked(type: string) { return addUnlinked(this, type); } // editor-draw.ts
  placeDevice(id: string) { return placeDevice(this, id); } // editor-draw.ts

  /** Set when the person ticked "Don't ask again this session": device-to-area moves then go through without the dialog. Not stored. */
  moveWithoutAsking = false;

  areaDiff(i: number): { room: string; name: string; move: NonNullable<ReturnType<typeof areaMove>> } | null { return areaDiff(this, i); } // editor-ha.ts

  createArea(i: number) { return createArea(this, i); } // editor-ha.ts

  makeLight(i: number) { return makeLight(this, i); } // editor-ha.ts

  createGroup(is: number[], kind: "light" | "motion", name: string) { return createGroup(this, is, kind, name); } // editor-ha.ts

  controlsAutomation(i: number, targets: string[]) { return controlsAutomation(this, i, targets); } // editor-ha.ts

  scheduleAutomation(i: number, on: string, off: string) { return scheduleAutomation(this, i, on, off); } // editor-ha.ts

  motionAutomation(motionId: string, lightId: string, minutes: number, deviceIndex?: number) { return motionAutomation(this, motionId, lightId, minutes, deviceIndex); } // editor-ha.ts

  moreInfo(entityId: string) { return moreInfo(this, entityId); } // editor-ha.ts

  runScene(entityId: string) { return runScene(this, entityId); } // editor-ha.ts

  addToArea(i: number, entityId: string) { return addToArea(this, i, entityId); } // editor-ha.ts

  /** Opus review of S8.1: loads overlap (the writer setter, then a create's reload); only the latest reply counts. */
  haListSeq = 0;

  renameFloor(key: string, title: string) { return renameFloor(this, key, title); } // editor-actions.ts
  moveFloor(key: string, delta: number) { return moveFloor(this, key, delta); } // editor-actions.ts
  deleteFloor(key: string) { return deleteFloor(this, key); } // editor-actions.ts
  moveCurrentFloor(delta: number) { return moveCurrentFloor(this, delta); } // editor-actions.ts
  askDeleteFloor() { return askDeleteFloor(this); } // editor-actions.ts
  /** True while the Align mode is open on the floor being edited: the plan is then read-only (review 29). */
  get aligning() { return this.asideMode === "align" && this.alignKey === this.st.floor; }
  openAlign() { return openAlign(this); } // editor-align.ts
  closeAlign(update = true) { return closeAlign(this, update); } // editor-align.ts
  alignPreview() { return alignPreview(this); } // editor-align.ts
  applyAlign() { return applyAlign(this); } // editor-align.ts
  alignStairInfo() { return alignStairInfo(this); } // editor-align.ts
  alignStairs() { return alignStairs(this); } // editor-align.ts
  /** S29.9: the two remembered step choices (move in cm, turn in degrees), read from `localStorage` on first use. */
  stepsNow: AlignSteps | null = null;
  get alignSteps(): AlignSteps { return (this.stepsNow ??= readAlignSteps()); }
  setAlignStep(kind: "move" | "turn", n: number) { return setAlignStep(this, kind, n); } // editor-align.ts
  moveAlign(dir: Pt) { return moveAlign(this, dir); } // editor-align.ts
  turnAlign(sign: 1 | -1) { return turnAlign(this, sign); } // editor-align.ts
  setAlignOffset(axis: 0 | 1, text: string) { return setAlignOffset(this, axis, text); } // editor-align.ts
  setAlignRotation(text: string) { return setAlignRotation(this, text); } // editor-align.ts
  resetAlignOffset() { return resetAlignOffset(this); } // editor-align.ts
  startAddFloor() { return startAddFloor(this); } // editor-actions.ts
  onNewFloorKey = (ev: KeyboardEvent) => onNewFloorKey(this, ev); // editor-actions.ts

  // ---- S33.7: saved views. Save, rename and delete are one undo step each (EditorState); applying is not an edit. ----
  /** The Saved views form: null while closed, else the id of the view being renamed ("" when saving a new one). */
  viewForm: { rename: string } | null = null;
  /** The context menu of one saved view (right-click, or the menu key), in client coordinates. */
  viewMenu: { id: string; x: number; y: number } | null = null;
  resetViews() { return resetViews(this); } // editor-views.ts
  startSaveView(rename = "") { return startSaveView(this, rename); } // editor-views.ts
  onViewFormKey = (ev: KeyboardEvent) => onViewFormKey(this, ev); // editor-views.ts
  submitViewForm() { return submitViewForm(this); } // editor-views.ts
  applyView(id: string) { return applyView(this, id); } // editor-views.ts
  openViewMenu(ev: MouseEvent, id: string) { return openViewMenu(this, ev, id); } // editor-views.ts
  renameViewFromMenu() { return renameViewFromMenu(this); } // editor-views.ts
  deleteViewFromMenu() { return deleteViewFromMenu(this); } // editor-views.ts

  setFloor(name: string) { return setFloor(this, name); } // editor-views.ts

  save() { return save(this); } // editor-file.ts
  exportJson() { return exportJson(this); } // editor-file.ts
  saveDone(ok: boolean, message?: string) { return saveDone(this, ok, message); } // editor-file.ts
  saveListeners = 0;
  // Counted so save() can tell whether a host is listening. A listener on an ancestor is not counted; it can preventDefault() instead.
  addEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    if (type === "save-request") this.saveListeners++;
    super.addEventListener(type, listener, options);
  }
  removeEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => unknown, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
    if (type === "save-request" && this.saveListeners > 0) this.saveListeners--;
    super.removeEventListener(type, listener, options);
  }
  reset() { return reset(this); } // editor-file.ts
  loadDemo() { return loadDemo(this); } // editor-file.ts
  roomsFromAreas() { return roomsFromAreas(this); } // editor-file.ts
  adoptLayout(x: unknown, status: string): boolean { return adoptLayout(this, x, status); } // editor-file.ts
  openFile(ev: Event) { return openFile(this, ev); } // editor-file.ts

  // ---- drawing -------------------------------------------------------------

  render() {
    const st = this.st, f = st.f, s = this.scale, k = 1 / s, v = st.view;
    const w = this.rect.w / s, h = this.rect.h / s;
    const rot = st.rotation, vc: Pt = rot ? rotateAbout([v.x + v.w / 2, v.y + v.h / 2], rot.deg, rot.pivot) : [v.x + v.w / 2, v.y + v.h / 2];
    const viewBox = `${num(vc[0] - w / 2)} ${num(vc[1] - h / 2)} ${num(w)} ${num(h)}`;
    const sel = st.sel && (st.sel.t === "door" || st.sel.t === "dev") ? { t: st.sel.t, i: st.sel.i } : st.sel?.t === "devs" ? { t: "devs" as const, is: st.sel.is } : null;
    // The grid covers everything on screen: the shown rectangle, taken back into the plan's own (unturned) space.
    const shown = [[vc[0] - w / 2, vc[1] - h / 2], [vc[0] + w / 2, vc[1] - h / 2], [vc[0] + w / 2, vc[1] + h / 2], [vc[0] - w / 2, vc[1] + h / 2]] as Pt[];
    const back = rot ? shown.map((p) => rotateAbout(p, -rot.deg, rot.pivot)) : shown;
    const bx = back.map((p) => p[0]), by = back.map((p) => p[1]);
    const region = { x: Math.min(...bx), y: Math.min(...by), w: Math.max(...bx) - Math.min(...bx), h: Math.max(...by) - Math.min(...by) };
    const overlay = planOverlay(this, k), grid = measureGrid(this, k, region);
    const turnG = (svg: string) => (rot ? `<g class="plan-turn" transform="rotate(${num(rot.deg)} ${num(rot.pivot[0])} ${num(rot.pivot[1])})">${svg}</g>` : svg);
    // S4.5: the chosen HA group dims every other device (class "dim").
    const { activeGroup } = floorGroups(st);
    const dimmed = activeGroup ? new Set(f.devices.filter((d) => d.entity && !(activeGroup.members ?? []).includes(d.entity)).map((d) => d.entity)) : undefined;
    // The grid is placed before renderFloor's own output, so the plan draws over it; a turned plan turns grid and overlay the same way.
    const body = turnG(grid) + renderFloor(f, { scale: s, selection: sel, keep: st.sel && (st.sel.t === "furn" || st.sel.t === "unl") ? { t: st.sel.t, i: st.sel.i } : null, hiddenLayers: st.hidden, detail: detailFor(viewBoxFor(f, 80, st.rotation), v, this.detailMode), showNames: st.showNames, editor: true, handles: !(this.asideMode === "align" && this.alignKey === st.floor), trace: true, rotate: rot, colors: st.layout.colors, wallColors: st.layout.wallColors, theme: st.theme, dark: this.isDark(), dimmed, night: st.night, daylight: outdoorShade(this.stateForRender()?.["weather.home"]?.state, new Date().getHours()), state: this.stateForRender(), tempWarn: this.temps.warnFor(st.floor), now: Date.now(), roomGlow: true, ghost: ghostOpts(this), labels: st.labels, heat: st.heat, camThumb: st.cam.on ? { ...st.cam, bust: this.thumbs.bust, failed: this.thumbs.failed } : undefined, around: floorsAroundKey(st.layout, st.floor), locate: this.locate?.floor === st.floor ? { t: this.locate.t, i: this.locate.i } : null }) + turnG(overlay);
    const find = findData(this);
    return html`
      <div class="narrow-note" id="narrowNote" role="status"><p>The Studio needs a wider screen.</p>${this.dashboardHref ? html`<p><a href=${this.dashboardHref}>Open the dashboard</a></p>` : nothing}</div>
      ${toolbarView(this, find.entries)}
      ${this.errors.length ? html`<div class="errors" id="errors" role="alert"><strong>That layout was not used.</strong><ul>${this.errors.map((e) => html`<li>${e}</li>`)}</ul><button class="btn" id="errclose" @click=${() => { this.errors = []; }}>Dismiss</button></div>` : nothing}
      <div class="ed">
        ${sideView(this, find.tree)}
        <div class="canvas">
          <svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label=${`Floor plan, ${f.title || st.floor}`} class=${[this.draw ? "drawing" : "", f.trace?.on === true ? "tracing" : ""].filter(Boolean).join(" ")} viewBox=${viewBox} @pointerdown=${this.onDown} @pointermove=${this.onMove} @pointerup=${this.onUp} @pointercancel=${this.onUp} @animationend=${this.onSwitchEnd} @dblclick=${this.onDblClick} @contextmenu=${(e: Event) => e.preventDefault()}>${unsafeSVG(body)}</svg>
          <!-- After the plan svg in the DOM, not before: specs and code that ask for "the first svg" must get the plan, not a button icon. It sits on top by z-index. -->
          <div class="zoom" role="group" aria-label="Zoom">
            <button class="btn" id="zin" title="Zoom in" aria-label="Zoom in" @click=${() => zoomBy(this, 1 / 1.25)}>+</button>
            <button class="btn" id="zout" title="Zoom out" aria-label="Zoom out" @click=${() => zoomBy(this, 1.25)}>&minus;</button>
            <button class="btn" id="zreset" title="Reset view: fit the whole floor, plan upright (Space)" aria-label="Reset view, 0" @click=${() => resetView(this)}>0</button>
            <button class="btn" id="vrotl" title="Rotate view left" aria-label="Rotate view left" @click=${() => turnBy(this, -ROTATION_STEP)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d=${UI_ICONS.rotateLeft} fill="currentColor"/></svg></button>
            <button class="btn" id="vrotr" title="Rotate view right" aria-label="Rotate view right" @click=${() => turnBy(this, ROTATION_STEP)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d=${UI_ICONS.rotateRight} fill="currentColor"/></svg></button>
          </div>
          <!-- S37.7: the message sits low in the plan, above the status bar. At the top it covered the open menus (Floors, Add floor) and, when the toolbar wraps, the search box. -->
          ${this.banner ? html`<div class="banner ${this.banner.level}"><span class="banner-text" id="status" role=${this.banner.level === "error" ? "alert" : "status"}>${this.banner.text}</span>${this.banner.action ? html`<button class="banner-act" id=${this.banner.action.id} @click=${this.banner.action.run}>${this.banner.action.label}</button>` : nothing}<button class="banner-x" id="bannerClose" aria-label="Close message" @click=${() => this.closeBanner()}>×</button></div>` : nothing}
          ${this.statusBarView()}
          ${this.firstRun && isBlank(st.layout) ? firstRunView({ hasAreas: !!this.ha?.areas?.length, hasHa: !!this.ha, demo: () => firstRunDemo(this), areas: () => roomsFromAreas(this), blank: () => firstRunBlank(this) }) : nothing}
          ${this.ctxMenu ? ctxMenuView(this, this.ctxMenu) : nothing}
          ${this.devColsPos ? devColsView(this, st) : nothing}
          ${this.haPos && this.writer ? haView(this) : nothing}
          ${(() => { const d = this.sceneDraft, i = d ? st.f.rooms.findIndex((r) => r.id === d.room) : -1; return d && i >= 0 && this.scenePos ? sceneDesigner({ draft: d, pos: this.scenePos, head: this.sceneHead, roomName: st.f.rooms[i].name, targets: roomSceneTargets(st.f, i), refresh: () => this.requestUpdate(), close: () => closeScene(this), save: () => saveSceneDraft(this), preview: this.writer ? { hasBackup: this.sceneBackup.length > 0, busy: this.sceneBusy, run: () => void trySceneDraft(this), restore: () => void restoreSceneDraft(this) } : undefined }) : nothing; })()}
          ${this.installCodeOpen ? installCodeView(this) : nothing}
          ${this.traceOpen ? traceView(this) : nothing}
        </div>
        ${asideView(this)}
      </div>`;
  }

  /** S34.10: what the status bar says of the heat map: the scale while any room of this floor is heated, else that nothing is. The same `roomHeat` the plan is drawn from, so the words and the colours agree. */
  heatText(): string | undefined {
    const { f, heat } = this.st, legend = heatLegend(heat);
    if (!legend) return undefined;
    return anyRoomHeated(f, heat, this._hassStates) ? `Heat map: ${legend.from} to ${legend.to}` : "Heat map: no readings";
  }

  /** S26.22: the facts under the canvas (selection, room, snap, floor, zoom); messages and refusals keep the banner. */
  statusBarView() {
    const s = statusFacts(this.st, { alt: this.altDown, drawing: !!this.draw, heat: this.heatText(), move: this.moving });
    const legend = heatLegend(this.st.heat);
    const ramp = legend ? `linear-gradient(to right in oklch,${legend.stops.map((t) => `var(${t.token}) ${t.at * 100}%`).join(",")})` : "";
    return html`<div class="statusbar" id="statusBar" aria-label="Status"><span class="sb-text">${s.text}</span>${legend ? html`<span class="sb-ramp" aria-hidden="true" style=${`background:${ramp}`}></span>` : nothing}${s.locked ? html`<button class="btn" id="statusUnlock" @click=${() => setPlanLocked(this, false)}>Unlock</button>` : nothing}</div>`;
  }

  /**
   * S8.10 follow-up (Opus review): every menu's box is `right:0` (anchored to its own button, not the viewport —
   * see the `.box` comment), so a mid-toolbar button whose box is wider than the room to its left runs off-screen.
   * On open, clamp it back on: reset to the default first (so a stale clamp from a previous, wider viewport never
   * compounds), measure, and if the left edge is still negative, shift the box right by exactly that overflow —
   * `left` is relative to `.menu` (its containing block), so `-menuRect.left` places the box's real left edge at
   * the viewport's own left edge (0), regardless of the box's width.
   * Also View's Theme submenu keeps its own open state (S4.11 pattern); a "keep" theme button never closes View on
   * click, so closing View by clicking its own summary again — the one route `onWindowClick` does not cover — must
   * collapse the submenu itself, or reopening View leaves Theme already open.
   */
  onMenuToggle = (ev: Event) => {
    const details = ev.currentTarget as HTMLDetailsElement;
    if (details.id === "mOpt" && !details.open) closeSubs(this, details);
    const box = details.querySelector<HTMLElement>(":scope > .box");
    if (!box) return;
    box.style.left = "";
    box.style.right = "0";
    if (!details.open) return;
    const overflowLeft = -box.getBoundingClientRect().left;
    if (overflowLeft > 0) {
      box.style.right = "auto";
      box.style.left = `${-details.getBoundingClientRect().left}px`;
    }
  };
  /**
   * S4.14: places `e` from the Add > Entities palette — the room its HA area names, when one is drawn on the current
   * floor, else the middle of the current viewport, clear of everything already there (the same fallback
   * `placeDevice` uses, `spawnDevice`, 2026-09-28). One undo step, via `EditorState.addEntity`.
   */
  addHaEntity(e: HaData["entities"][number]) {
    this.focus({ preventScroll: true }); // the clicked item leaves the list on the next render; see placeDevice's own note
    const before = counted(this);
    if (!this.st.addEntity(e, spawnDevice(this))) return;
    this.closeMenus();
    placedNote(this, before, `Added ${e.name}. Drag it to its spot.`, `Added ${e.name}`);
  }

  /**
   * S5.5: opens or closes the Help panel. Closing hands focus back to the toolbar's own #help button — the same
   * rule Escape follows for a menu (closeMenus): a keyboard user must not lose their place when a panel disappears.
   */
  toggleHelp() {
    const wasOpen = this.st.helpOpen;
    this.st.setHelp(!wasOpen);
    this.requestUpdate();
    if (wasOpen) this.renderRoot.querySelector<HTMLButtonElement>("#help")?.focus({ preventScroll: true });
  }

  /** Closes every open toolbar menu and its submenus, and focuses the button of the first one. False when none was open. */
  closeMenuByKey(): boolean {
    const open = [...this.renderRoot.querySelectorAll<HTMLDetailsElement>("details.menu[open]")];
    open.forEach((m) => { m.open = false; closeSubs(this, m); });
    open[0]?.querySelector<HTMLElement>(":scope > summary")?.focus({ preventScroll: true });
    return open.length > 0;
  }

  closeMenus() {
    const open = this.renderRoot.querySelectorAll<HTMLDetailsElement>("details.menu[open]");
    open.forEach((m) => { m.open = false; closeSubs(this, m); });
    if (open.length) this.focus({ preventScroll: true }); // the focused item just hid
  }
}

if (!customElements.get("floorplan-studio-editor")) customElements.define("floorplan-studio-editor", FloorplanStudioEditor);
declare global { interface HTMLElementTagNameMap { "floorplan-studio-editor": FloorplanStudioEditor } }
