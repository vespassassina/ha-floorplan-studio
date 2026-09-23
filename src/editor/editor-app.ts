import { LitElement, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { DEVICE_COLOURS, FLOORPLAN_CSS, applyHaNames, areaMove, inside, FURNITURE, WALL_KINDS, FURNITURE_SYMBOLS, UNLINKED_TYPES, deleteEdge, dist, edgeRooms, groupKind, insertPoint, nearestEdge, onEdge, placedEntities, polys, renderFloor, rotateAbout, setEdgeKind, snapPoint, snapped, stitch, typeForEntity, unplacedHaEntities, validate } from "../core";
import type { DeviceType, Floor, HaData, Layout, Pt, Stairs, WallKind } from "../core";
import { gridRound, looseEnds, movePointAll, pivotOnArc, pointsNear, scaleFurniture, segmentAt, snapRoomTo, spawnPoint, squareAt, stairsAt, type Corner } from "./ops";
import { Draw, applyShape, type AreaPreset, type DrawKind } from "./draw";
import { TYPE_LABELS, WALL_LABELS, helpPanel, selectionPanel, type PanelCtx } from "./panels";
import { confirm as askHa } from "./confirm";
import type { HaWriter, Labelled } from "./hass-write";
import { motionLights, openAutomation, schedule, switchControls } from "./automations";
import { EditorState, GRID_VALUES, THEME_VALUES, emptyLayout, isBlank, loadLayout, newId, polyPts, ptOf, slug, type LooseRef, type PtRef, type Sel, type View } from "./state";
import manifest from "../../custom_components/floorplan_studio/manifest.json";

/**
 * <floorplan-studio-editor>: draws and edits a layout.
 *   property `layout`  the layout to edit (validated; a bad one is refused and listed)
 *   property `floor`   the floor shown
 *   property `demo`    a demo home; File, Load demo puts it in, only while nothing is drawn (Reset first). No demo, no button.
 *   event `layout-changed`  detail: the Layout, after every edit
 *   event `save-request`    detail: the Layout, File, Save (host writes it somewhere)
 *   method saveDone(ok, message?)  the host calls it when the write is over; status stays "Saving…" until then.
 *                           With no save-request listener the editor says "Saved" itself. Listen on the element.
 */

type Hit =
  | { k: "corner"; poly: string; j: number }
  | { k: "loose"; ref: LooseRef }
  | { k: "dend"; i: number; end: "a" | "b" }
  | { k: "fscale"; i: number; corner: Corner }
  | { k: "door" | "opening" | "dev" | "furn" | "unl" | "wall" | "room" | "stairs" | "extra"; i: number }
  | { k: "edge"; poly: string; i: number }
  | { k: "bg" };

/** S4.18/S4.27: what the right-click context menu opened on. */
type CtxTarget = { k: "room"; i: number } | { k: "edge"; poly: string; i: number }
  | { k: "wall"; i: number } | { k: "door"; i: number } | { k: "opening"; i: number } | { k: "furn"; i: number } | { k: "unl"; i: number };

type Drag =
  | { type: "pan"; sx: number; sy: number; v: View; button: number; moved: boolean }
  | { type: "corner"; base: Floor; from: Pt; ref: PtRef; moved: boolean; to: Pt }
  | { type: "edge"; base: Floor; ends: { from: Pt; ref: PtRef }[]; start: Pt; moved: boolean; to: Pt[] }
  | { type: "dend"; base: Floor; i: number; end: "a" | "b"; moved: boolean }
  | { type: "door"; base: Floor; i: number; off: Pt; len: number; moved: boolean }
  | { type: "opening"; base: Floor; i: number; off: Pt; len: number; moved: boolean }
  | { type: "dev"; base: Floor; i: number; off: Pt; moved: boolean }
  | { type: "furn"; base: Floor; i: number; off: Pt; moved: boolean }
  | { type: "unl"; base: Floor; i: number; off: Pt; moved: boolean }
  | { type: "fscale"; base: Floor; i: number; corner: Corner; moved: boolean }
  | { type: "room"; base: Floor; list: "rooms" | "stairs"; i: number; start: Pt; moved: boolean; alt?: boolean };

const round = (p: Pt): Pt => [Math.round(p[0]), Math.round(p[1])];
const num = (n: number) => String(Math.round(n * 100) / 100);
/** Where the measure grid reads zero: the top-left corner of the floor's outline (lowest x, lowest y). A floor with no outline has none, so its zero is the layout's own. */
export const planZero = (f: Floor): Pt => (f.outline.length ? [Math.min(...f.outline.map((p) => p[0])), Math.min(...f.outline.map((p) => p[1]))] : [0, 0]);
const DRAW_HINT = "Click to add points, double-click or Enter to finish, Esc to cancel";
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
/** Does this point reference a corner of a zone? A zone never joins another polygon. */
const isZoneRef = (f: Floor, ref: PtRef) => "poly" in ref && ref.poly[0] === "r" && (f.rooms[+ref.poly.slice(1)]?.kind === "zone" || f.rooms[+ref.poly.slice(1)]?.free === true); // a zone or a free room is never stitched
/** A stand-in for "no dragged point": nothing is within reach of it. */
const NOWHERE: Pt = [-1e9, -1e9];
/** Where a door, window, opening or heater sits: a room, outline or water edge, or a free wall. Never a zone or stairs. */
const HOST = { walls: true } as const;
const NO_REF: PtRef = { k: "walls", i: -1, end: "a" };

/** The transform attribute that turns a stairs highlight like renderFloor turns the stairs: `rot` about the centre of the box. */
function stairsTurn(t: Stairs): string {
  const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
  return `transform="rotate(${num(t.rot)} ${num((Math.min(...xs) + Math.max(...xs)) / 2)} ${num((Math.min(...ys) + Math.max(...ys)) / 2)})"`;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** What the pointer is over. `el` is the real top element under the pointer. */
function hitOf(el: Element | null): Hit {
  if (!el?.closest) return { k: "bg" };
  const dev = el.closest("g[data-x]"), bar = el.closest("[data-xbar]");
  if (dev) return { k: "dev", i: +(dev.getAttribute("data-x") ?? -1) };
  if (bar) return { k: "dev", i: +(bar.getAttribute("data-xbar") ?? -1) };
  const h = el.closest("[data-h]");
  if (h) { const [poly, j] = (h.getAttribute("data-h") ?? "").split(":"); return { k: "corner", poly, j: +j }; }
  const hp = el.closest("[data-hp]");
  if (hp) { const [k, i, end] = (hp.getAttribute("data-hp") ?? "").split(":"); return { k: "loose", ref: { k: k as LooseRef["k"], i: +i, end: end as "a" | "b" } }; }
  const dh = el.closest("[data-dh]");
  if (dh) { const [i, end] = (dh.getAttribute("data-dh") ?? "").split(":"); return { k: "dend", i: +i, end: end as "a" | "b" }; }
  const fh = el.closest("[data-fh]");
  if (fh) { const [i, corner] = (fh.getAttribute("data-fh") ?? "").split(":"); return { k: "fscale", i: +i, corner: corner as Corner }; }
  const d = el.closest("[data-d]");
  if (d) return { k: "door", i: +(d.getAttribute("data-d") ?? -1) };
  // An opening line has no data attribute (core draws it, the card must not change): it is the n-th `line.opening` of the plan.
  const op = el.closest("line.opening");
  if (op) return { k: "opening", i: Array.from(op.parentNode?.children ?? []).filter((c) => c.matches("line.opening")).indexOf(op) };
  const fu = el.closest("g[data-f]");
  if (fu) return { k: "furn", i: +(fu.getAttribute("data-f") ?? -1) };
  const un = el.closest("g[data-u]");
  if (un) return { k: "unl", i: +(un.getAttribute("data-u") ?? -1) };
  const e = el.closest("[data-e]");
  if (e) { const [poly, i] = (e.getAttribute("data-e") ?? "").split(":"); return { k: "edge", poly, i: +i }; }
  const w = el.closest("[data-w]");
  if (w) return { k: "wall", i: +(w.getAttribute("data-w") ?? -1) };
  const ex = el.closest("[data-ex]");
  if (ex) return { k: "extra", i: +(ex.getAttribute("data-ex") ?? -1) };
  const r = el.closest("[data-r]");
  if (r) return { k: "room", i: +(r.getAttribute("data-r") ?? -1) };
  const st = el.closest("[data-s]");
  if (st) return { k: "stairs", i: +(st.getAttribute("data-s") ?? -1) };
  return { k: "bg" };
}

/** What each theme is called on its chip. `ha` says what it does rather than what it is. */
const THEME_LABELS: Record<(typeof THEME_VALUES)[number], string> = {
  blueprint: "Blueprint", midnight: "Midnight", light: "Light", slate: "Light Gray", terminal: "Terminal", solarized: "Solarized", ha: "Home Assistant",
};
/** S4.10: the Home Assistant menu's groups, in the order they are shown. */
const HA_KIND_LABELS: [Labelled["kind"], string][] = [["helper", "Helpers"], ["automation", "Automations"], ["area", "Areas"]];

export class FloorplanStudioEditor extends LitElement {
  static properties = {
    floor: { type: String },
    haDark: { attribute: false },
    demo: { attribute: false },
    errors: { state: true },
    status: { state: true },
    addingFloor: { state: true },
    devQuery: { state: true },
    entQuery: { state: true },
    haList: { state: true },
    haListLoading: { state: true },
    haListErr: { state: true },
  };
  declare floor: string;
  /** Home Assistant's dark mode, set by the panel host from `hass.themes.darkMode`. Read only by the `ha` theme; undefined (standalone) follows the OS instead. */
  declare haDark: boolean | undefined;
  declare demo: Layout | undefined;
  declare errors: string[];
  declare status: string;
  declare addingFloor: boolean;
  /** The text in the Device menu search field. Cleared when the menu closes. */
  declare devQuery: string;
  /** S4.14: the text in the Add > Entities search field. Cleared when the submenu closes. */
  declare entQuery: string;
  /** S4.10: everything floorplan-studio labelled in Home Assistant, loaded fresh each time the Home Assistant menu opens. `null` before the first load. */
  declare haList: Labelled[] | null;
  declare haListLoading: boolean;
  declare haListErr: string;

  private st = new EditorState();
  private drag: Drag | null = null;
  /** Draw mode: the shape being drawn, and where the pointer is (snapped) for the rubber band. */
  private draw: Draw | null = null;
  /** S4.22: the layout as it stood when the texture-rotation slider's drag began, or null between drags. */
  private textureRotGesture: Layout | null = null;
  /** S4.19: the same, for the texture-scale slider. */
  private textureScaleGesture: Layout | null = null;
  private hover: Pt | null = null;
  /**
   * S4.18: the right-click context menu — a room, zone or structure, or (S4.27) a wall: a room/outline edge or a
   * free-standing wall. Its screen position and its target. Closed (null) by an outside click, Escape or scroll.
   */
  private ctxMenu: { x: number; y: number; target: CtxTarget } | null = null;
  /** The Device colours popup's screen position; null when closed. Dragged by its header, closed by its own X or Escape. */
  private devColsPos: { x: number; y: number } | null = null;
  private dcDrag: { dx: number; dy: number } | null = null;
  private rect = { w: 800, h: 600 };
  private ro?: ResizeObserver;

  constructor() {
    super();
    this.floor = "";
    this.errors = [];
    this.status = "Ready";
    this.addingFloor = false;
    this.devQuery = "";
    this.entQuery = "";
    this.haList = null;
    this.haListLoading = false;
    this.haListErr = "";
  }

  /** What Home Assistant has (floors, areas, entities), set by the host. With it the name fields are dropdowns and linked names are refreshed once, without an undo step. */
  /** Writes to Home Assistant. Set by the panel host only, never imported here, so the standalone build has none and shows no button that needs one. */
  get writer(): HaWriter | undefined { return this._writer; }
  set writer(v: HaWriter | undefined) { const old = this._writer; this._writer = v; this.requestUpdate("writer", old); }
  private _writer?: HaWriter;
  get ha(): HaData | undefined { return this.st.ha; }
  set ha(v: HaData | undefined) {
    const old = this.st.ha;
    this.st.ha = v;
    this.refreshNames();
    this.requestUpdate("ha", old);
  }
  /** Copies HA's names into the linked floors and rooms. Not an edit: no undo step. Tells the host and the status line when something changed. */
  private refreshNames() {
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
    this.stopDraw();
    const r = loadLayout(v);
    if (!r.ok) { this.errors = r.errors; return; }
    this.errors = [];
    this.st.setLayout(r.layout, this.floor);
    this.floor = this.st.floor;
    this.refreshNames();
    this.requestUpdate("layout", old);
  }

  static styles = css`
    ${css([FLOORPLAN_CSS] as unknown as TemplateStringsArray)}
    :host{display:block;outline:none;background:var(--fp-bg);color:var(--fp-ink);font:14px/1.4 system-ui,sans-serif}
    .bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 0}
    .grow{flex:1}
    .btn,.chip,select,input{font:inherit;color:var(--fp-ink);background:var(--fp-room);border:1px solid var(--fp-idle);border-radius:4px;padding:4px 8px}
    .btn,.chip,summary{cursor:pointer}
    .chip[aria-pressed="true"],.btn[aria-pressed="true"]{background:var(--fp-ink);color:var(--fp-bg)}
    .btn.primary{background:var(--fp-primary);color:var(--fp-on-dark);border-color:var(--fp-primary)}
    .btn.danger{background:var(--fp-danger);color:var(--fp-on-dark);border-color:var(--fp-danger)}
    .btn.warn{background:var(--fp-warn);color:var(--fp-on-light);border-color:var(--fp-warn)}
    .menu{position:relative}
    .menu>summary{list-style:none;display:inline-block}
    .menu>summary::-webkit-details-marker{display:none}
    .menu>summary::after{content:" \\25BE"}
    .box{max-height:75vh;overflow:auto;position:absolute;right:0;top:calc(100% + 4px);z-index:20;min-width:210px;display:flex;flex-direction:column;gap:6px;padding:6px;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:4px}
    .box .btn,.box .chip,.box select{width:100%;text-align:left}
    .ctxmenu{position:fixed;z-index:30;max-height:70vh;overflow:auto;min-width:200px;display:flex;flex-direction:column;gap:4px;padding:6px;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.3)}
    .ctxmenu .btn{width:100%;text-align:left}
    .devcols-panel{position:fixed;z-index:30;width:560px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.35)}
    .devcols-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--fp-idle);font-weight:600;cursor:move;touch-action:none}
    .devcols-head button{width:auto;padding:0 8px;font-size:1.2em;line-height:1.6}
    .devcols-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 14px;padding:10px;overflow:auto}
    .devcols-panel>.btn{margin:0 10px 10px;width:auto;align-self:flex-start}
    .sub{display:flex;flex-direction:column;gap:6px}
    .sub>summary{list-style:none;display:inline-block}
    .sub>summary::-webkit-details-marker{display:none}
    .sub>summary::after{content:" \\25B8"}
    .sub>.btn:not(summary){padding-left:20px}
    .guide summary{cursor:pointer;font-weight:600}
    .guide summary::-webkit-details-marker{display:none}
    .guide summary::before{content:"\\25B8";display:inline-block;width:1em;transition:transform .15s ease}
    .guide details[open] summary::before{transform:rotate(90deg)}
    .sep{border-top:1px solid var(--fp-idle)}
    .vsep{align-self:stretch;border-left:1px solid var(--fp-idle);margin:2px 0}
    /* Lighter, not lower-contrast: opacity leaves .btn's own colour/background computed values untouched (S1.53's
       contrast pair still passes) and only changes how it blends against the page behind it. */
    .btn.light{opacity:.6}
    .btn.light:hover,.btn.light:focus-visible{opacity:1}
    .swatches{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0} .sw{width:28px;height:28px;padding:0;border:1px solid var(--fp-idle);border-radius:4px;cursor:pointer;position:relative;overflow:hidden} .sw.custom::after{content:"";position:absolute;top:0;right:0;width:0;height:0;border-style:solid;border-width:0 9px 9px 0;border-color:transparent var(--fp-ink) transparent transparent} .sw[aria-pressed="true"]{outline:2px solid var(--fp-ink);outline-offset:1px}
    .rot-val{display:inline-block;min-width:3em;text-align:right;font-variant-numeric:tabular-nums}
    .colrow{display:flex;justify-content:space-between;align-items:center;gap:6px;margin:2px 0} .colrow label{display:flex;flex:1;justify-content:space-between;gap:6px} .colrow input{padding:0;width:36px;height:24px} .colrow .btn{width:auto}
    .rangerow{display:flex;align-items:center;gap:8px;margin:2px 0} .rangerow input{flex:1;width:auto} .rangerow .rot-val{flex:none;min-width:3.5em;text-align:right}
    .rotrow{display:flex;flex-wrap:wrap;gap:6px} .rotrow>span{width:100%} .box .rotrow .btn{width:auto;flex:1;text-align:center}
    #snap.rotrow .chip{width:calc(50% - 3px);text-align:center}
    .ed{display:grid;grid-template-columns:1fr 300px;gap:12px;align-items:start}
    .canvas{position:relative;border:1px solid var(--fp-idle);height:var(--fp-editor-height,calc(100vh - 150px));min-height:420px;touch-action:none;background:var(--fp-bg)}
    .zoom{position:absolute;top:8px;right:8px;display:flex;flex-direction:column;gap:4px;z-index:2}
    .zoom .btn{width:24px;height:24px;padding:0;text-align:center;line-height:1;font-size:13px}
    .canvas svg{width:100%;height:100%;display:block;cursor:grab;user-select:none}
    .canvas svg.drawing,.canvas svg.drawing *{cursor:crosshair}
    .dr{fill:none;stroke:var(--fp-window);stroke-width:2;stroke-dasharray:6 4;vector-effect:non-scaling-stroke;pointer-events:none}
    .dp{fill:var(--fp-bg);stroke:var(--fp-window);stroke-width:2;vector-effect:non-scaling-stroke;pointer-events:none}
    .dp.first{fill:var(--fp-window)}
    .grp{font-size:.8em;opacity:.7}
    .box input[type=search]{width:100%;box-sizing:border-box}
    .harow{display:flex;align-items:center;gap:4px;flex-wrap:wrap} .harow>span:first-child{flex:1;min-width:80px} .harow .btn{width:auto}
    .habox-h{margin:8px 0 2px;font-size:.85em;font-weight:600;opacity:.8}
    .harow2{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:2px 0} .harow2>span:first-child{flex:1;min-width:80px} .harow2 .btn{width:auto}
    aside{display:flex;flex-direction:column;gap:12px}
    aside label{display:block;font-size:.85em;margin-top:6px;opacity:.8}
    aside input:not([type=checkbox]),aside select{width:100%;box-sizing:border-box}
    .row{display:flex;gap:6px}
    .hint{font-size:.85em;opacity:.75;margin:6px 0}
    .errors{border:1px solid var(--fp-motion);border-radius:4px;padding:6px 10px;margin:6px 0}
    .errors ul{margin:4px 0;padding-left:18px}
    .status{font-size:.85em;opacity:.75}
    .room{pointer-events:all}
    .opening{pointer-events:stroke}
    .furn{pointer-events:all}
    .hl{fill:none;stroke:var(--fp-window);stroke-width:2;vector-effect:non-scaling-stroke;pointer-events:none}
    .h{cursor:move} .h.on{fill:var(--fp-ink)}
    .len{fill:var(--fp-text);paint-order:stroke;stroke:var(--fp-outline);stroke-width:3;stroke-linejoin:round;pointer-events:none;user-select:none}
    .lbl{pointer-events:none;user-select:none}
    .dev,.door,.heater{cursor:move}
    @media (max-width:900px){.ed{grid-template-columns:1fr}}
  `;

  connectedCallback() {
    super.connectedCallback();
    // Keys are heard on the element only, so Delete or Ctrl+Z elsewhere in a page does nothing here.
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
    this.addEventListener("keydown", this.onKey);
    this.addEventListener("focusout", this.onFocusOut);
    this.addEventListener("click", this.onButtonClick);
    window.addEventListener("click", this.onWindowClick);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this.onKey);
    this.removeEventListener("focusout", this.onFocusOut);
    this.removeEventListener("click", this.onButtonClick);
    window.removeEventListener("click", this.onWindowClick);
    this.ro?.disconnect();
  }

  /** Whether the `ha` theme should use the dark set: the host's word when it gave one, the OS's otherwise. */
  private isDark(): boolean {
    if (this.haDark !== undefined) return this.haDark;
    try { return matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("floor") && this.floor && this.floor !== this.st.floor && hasOwn(this.st.layout.floors, this.floor)) { this.stopDraw(); this.st.setFloor(this.floor); }
    // Always named, never left to inherit: blueprint unless the viewer chose otherwise. Reflected on the host itself, not just the svg,
    // so the editor's own chrome (menus, panels, buttons) themes with the plan. data-mode is for the ha theme only.
    this.setAttribute("data-theme", this.st.theme);
    if (this.st.theme === "ha" && this.isDark()) this.setAttribute("data-mode", "dark");
    else this.removeAttribute("data-mode");
  }

  protected firstUpdated() {
    const s = this.svgEl;
    s?.addEventListener("wheel", this.onWheel, { passive: false });
    if (s && typeof ResizeObserver !== "undefined") { this.ro = new ResizeObserver(() => this.measure()); this.ro.observe(s); }
    this.measure();
  }

  private get svgEl(): SVGSVGElement | null { return this.renderRoot.querySelector("svg"); }
  private measure() {
    const r = this.svgEl?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0 && (Math.abs(r.width - this.rect.w) > 0.5 || Math.abs(r.height - this.rect.h) > 0.5)) {
      this.rect = { w: r.width, h: r.height };
      this.requestUpdate();
    }
  }
  /** Screen pixels per cm. */
  private get scale(): number {
    const v = this.st.view;
    return Math.min(this.rect.w / v.w, this.rect.h / v.h) || 1;
  }
  /** Plan coordinates of a pointer: the point in the svg's own space, turned back by the plan's rotation. The one place plan points are made from the screen. */
  private toSvg(ev: { clientX: number; clientY: number }): Pt {
    const s = this.svgEl, m = s?.getScreenCTM();
    if (!s || !m) return [0, 0];
    const p = s.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(m.inverse()), r = this.st.rotation;
    return r ? rotateAbout([q.x, q.y], -r.deg, r.pivot) : [q.x, q.y];
  }

  // ---- changes -------------------------------------------------------------

  private emit(name: "layout-changed" | "save-request") {
    this.dispatchEvent(new CustomEvent(name, { detail: this.st.layout, bubbles: true, composed: true }));
  }
  /** After any change: autosave, tell the host, redraw. */
  private changed(status = "Edited") {
    this.st.persist();
    this.status = status;
    this.emit("layout-changed");
    this.requestUpdate();
  }
  private commit = (fn: (f: Floor) => Floor | void) => { if (this.st.edit(fn)) this.changed(); };
  private select = (s: Sel) => { this.st.sel = s; this.requestUpdate(); };
  /** S4.22: the paint panel's rotation slider. `live` previews every tick via `replaceFloor` (no undo step, the same
   * pattern a mouse drag uses); `commit`, once at release, records the whole drag as one step — none if it ended back
   * where it started (mirrors `begin()`/`onUp` for a pointer drag). */
  private rotateTexture = (on: "rooms" | "stairs", i: number, rot: number, phase: "live" | "commit") => {
    // A commit with no prior live tick (a click on the track, or an arrow key) still needs a "before": take it now,
    // before the value below is applied.
    if (!this.textureRotGesture) this.textureRotGesture = structuredClone(this.st.layout);
    const g = structuredClone(this.st.f);
    const shape = g[on][i];
    const n = ((Math.trunc(rot) % 360) + 360) % 360; // 0 is never stored (matches paint()'s convention)
    if (shape) { if (n === 0) delete shape.textureRot; else shape.textureRot = n; }
    this.st.replaceFloor(g);
    if (phase === "live") { this.requestUpdate(); return; }
    const before = this.textureRotGesture;
    this.textureRotGesture = null;
    if (this.st.commitLiveEdit(before)) this.changed("Texture rotated");
    else this.requestUpdate();
  };
  /** S4.19: the paint panel's scale slider. Same live/commit gesture as `rotateTexture`. */
  private scaleTexture = (on: "rooms" | "stairs", i: number, scale: number, phase: "live" | "commit") => {
    if (!this.textureScaleGesture) this.textureScaleGesture = structuredClone(this.st.layout);
    const g = structuredClone(this.st.f);
    const shape = g[on][i];
    const n = Math.min(2, Math.max(0.25, scale)); // matches paint()'s clamp; 1 is never stored
    if (shape) { if (n === 1) delete shape.textureScale; else shape.textureScale = n; }
    this.st.replaceFloor(g);
    if (phase === "live") { this.requestUpdate(); return; }
    const before = this.textureScaleGesture;
    this.textureScaleGesture = null;
    if (this.st.commitLiveEdit(before)) this.changed("Texture scale changed");
    else this.requestUpdate();
  };
  private ctx(): PanelCtx {
    return { st: this.st, commit: this.commit, paint: (on, i, p) => { if (this.st.paint(on, i, p)) this.changed(); }, rotateTexture: this.rotateTexture, scaleTexture: this.scaleTexture, select: this.select, say: (m) => { this.status = m; this.requestUpdate(); }, refresh: () => this.requestUpdate(), areaDiff: (i) => { const a = this.areaDiff(i); return a ? { name: a.name } : null; }, moveArea: (i) => void this.offerAreaMove(i, true), createArea: this.writer && this.st.ha ? (i) => void this.createArea(i) : undefined, drawArea: (a) => this.startDraw("room", "wall", a), placeArea: (i) => { const n = this.st.placeArea(i); if (n) this.changed(`Placed ${n} device${n === 1 ? "" : "s"}. Drag each to its spot.`); }, makeLight: this.writer && this.st.ha ? (i) => void this.makeLight(i) : undefined, createGroup: this.writer && this.st.ha ? (is, kind, name) => void this.createGroup(is, kind, name) : undefined, controlsAutomation: this.writer ? (i, targets) => void this.controlsAutomation(i, targets) : undefined, scheduleAutomation: this.writer ? (i, on, off) => void this.scheduleAutomation(i, on, off) : undefined, moreInfo: (id) => this.moreInfo(id), runScene: this.writer ? (id) => void this.runScene(id) : undefined, addToArea: this.writer ? (i, id) => void this.addToArea(i, id) : undefined, floors: { rename: (k, t) => this.renameFloor(k, t), move: (k, d) => this.moveFloor(k, d), remove: (k) => this.deleteFloor(k) } };
  }

  // ---- pointer -------------------------------------------------------------

  private edgeNear(p: Pt): Hit | null {
    const th = 8 / this.scale, f = this.st.f;
    let best: { d: number; hit: Hit } | null = null;
    const ne = nearestEdge(f, p, th, { zones: true });
    if (ne) best = { d: ne.d, hit: { k: "edge", poly: ne.poly, i: ne.i } };
    f.walls.forEach((w, i) => { const d = segDist(p, w.a, w.b); if (d <= th && (!best || d < best.d)) best = { d, hit: { k: "wall", i } }; });
    return best ? (best as { hit: Hit }).hit : null;
  }

  /** `align`: extra points the result lines up with (the points of a shape being drawn).
   *  `zone`: the point belongs to a zone. One rule for draw and drag: it snaps to the grid and lines up with the other
   *  corners of its own zone, and to nothing else. A room, outline or stairs corner never attracts it. */
  private snapCorner(base: Floor, p: Pt, from: Pt, ref: PtRef, alt: boolean, align: Pt[] = [], zone = false): Pt {
    if (alt) return round(p);
    if (zone) {
      const own = "poly" in ref ? (polyPts(base, ref.poly) ?? []).filter((q) => q !== from && !(q[0] === from[0] && q[1] === from[1])) : [];
      const none: Floor = { ...base, outline: [], rooms: [], stairs: [], walls: [], openings: [], extras: [] };
      return round(snapPoint(none, p, { threshold: 14 / this.scale, grid: this.st.snapGrid, exclude: [], neighbours: [...own, ...align] }));
    }
    const th = 14 / this.scale, grp = pointsNear(base, from);
    // The two neighbours of the dragged corner are never snap targets: landing on one would leave an edge of zero length.
    let neighbours: Pt[] = [];
    if ("poly" in ref) {
      const pts = polyPts(base, ref.poly) ?? [], n = pts.length;
      neighbours = [pts[(ref.j + 1) % n], pts[(ref.j + n - 1) % n]];
    }
    const isNeighbour = (q: Pt) => neighbours.some((m) => m[0] === q[0] && m[1] === q[1]);
    // loose ends and polygon corners compete in one list: the nearest wins
    const cands: Pt[] = looseEnds(base).map((r) => base[r.k][r.i][r.end]);
    for (const P of polys(base)) if (P.room?.kind !== "zone") cands.push(...P.pts); // a zone corner is never a target
    let best: Pt | null = null;
    for (const q of cands)
      if (!grp.includes(q) && !isNeighbour(q) && dist(q, p) < th && (!best || dist(q, p) < dist(best, p))) best = q;
    if (best) return [best[0], best[1]];
    const snapped = round(snapPoint(base, p, { threshold: th, grid: this.st.snapGrid, exclude: grp, neighbours: [...neighbours, ...align] }));
    if (!isNeighbour(snapped)) return snapped;
    // snapPoint pulled it onto a neighbour (corner snap, or both axes lined up): keep it where the pointer is, on the grid if on
    const g = this.st.snapGrid || 1;
    const free: Pt = [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
    return isNeighbour(free) ? [from[0], from[1]] : free;
  }

  private onDown = (ev: PointerEvent) => {
    const svg = this.svgEl;
    if (!svg) return;
    const st = this.st, f = st.f;
    st.confirmDelete = false;
    const capture = () => { try { svg.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ } };
    if (ev.button === 1 || ev.button === 2 || ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      this.drag = { type: "pan", sx: ev.clientX, sy: ev.clientY, v: { ...st.view }, button: ev.button, moved: false };
      capture();
      return;
    }
    if (ev.button !== 0) return;
    this.focus({ preventScroll: true });
    const p = this.toSvg(ev);
    if (this.draw) { this.drawClick(p, ev.altKey, ev); return; }
    // A press elsewhere, or late, is not the second click of that pair; a third press means the user double-clicked on purpose.
    if (this.finished) { if (this.sameDouble(ev) && this.finished.presses === 0) this.finished.presses = 1; else this.finished = null; }
    let hit = hitOf(ev.target as Element);
    if (hit.k === "bg" || hit.k === "room" || hit.k === "stairs") hit = this.edgeNear(p) ?? hit;
    const base = structuredClone(f);
    this.drag = null;
    switch (hit.k) {
      case "corner": case "loose": {
        const ref: PtRef = hit.k === "corner" ? { poly: hit.poly, j: hit.j } : hit.ref;
        const from = ptOf(f, ref);
        if (!from) break;
        st.sel = { t: "v", ref };
        this.drag = { type: "corner", base, from: [from[0], from[1]], ref, moved: false, to: [from[0], from[1]] };
        break;
      }
      case "dend": st.sel = { t: "door", i: hit.i }; this.drag = { type: "dend", base, i: hit.i, end: hit.end, moved: false }; break;
      case "door": {
        const d = f.doors[hit.i];
        if (!d) break;
        st.sel = { t: "door", i: hit.i };
        this.drag = { type: "door", base, i: hit.i, off: [p[0] - (d.a[0] + d.b[0]) / 2, p[1] - (d.a[1] + d.b[1]) / 2], len: dist(d.a, d.b), moved: false };
        break;
      }
      case "dev": {
        const d = f.devices[hit.i];
        if (!d) break;
        // S4.5: Shift+click adds a light or motion sensor to a same-kind multi-selection, for "Create group"; toggles it back out if already in. No drag on a Shift+click.
        if (ev.shiftKey && (d.type === "light" || d.type === "motion")) {
          const prevIs = st.sel?.t === "devs" ? st.sel.is : st.sel?.t === "dev" ? [st.sel.i] : [];
          const prevDev = prevIs[0] !== undefined ? f.devices[prevIs[0]] : undefined;
          if (!prevDev || (!("a" in prevDev) && prevDev.type === d.type)) {
            const is = prevIs.includes(hit.i) ? prevIs.filter((i) => i !== hit.i) : [...prevIs, hit.i];
            st.sel = is.length > 1 ? { t: "devs", is } : is.length === 1 ? { t: "dev", i: is[0] } : null;
            break;
          }
        }
        st.sel = { t: "dev", i: hit.i };
        const c: Pt = "a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y];
        this.drag = { type: "dev", base, i: hit.i, off: [p[0] - c[0], p[1] - c[1]], moved: false };
        break;
      }
      case "furn": {
        const m = f.furniture[hit.i];
        if (!m) break;
        st.sel = { t: "furn", i: hit.i };
        if (!m.locked) this.drag = { type: "furn", base, i: hit.i, off: [p[0] - m.x, p[1] - m.y], moved: false };
        break;
      }
      case "fscale": {
        const m = f.furniture[hit.i];
        if (!m) break;
        st.sel = { t: "furn", i: hit.i };
        if (!m.locked) this.drag = { type: "fscale", base, i: hit.i, corner: hit.corner, moved: false };
        break;
      }
      case "unl": {
        const u = f.unlinked[hit.i];
        if (!u) break;
        st.sel = { t: "unl", i: hit.i };
        if (!u.locked) this.drag = { type: "unl", base, i: hit.i, off: [p[0] - u.x, p[1] - u.y], moved: false };
        break;
      }
      case "edge": case "wall": {
        let ends: { from: Pt; ref: PtRef }[];
        if (hit.k === "edge") {
          const pts = polyPts(f, hit.poly);
          if (!pts) break;
          const j = (hit.i + 1) % pts.length;
          st.sel = { t: "edge", poly: hit.poly, i: hit.i };
          ends = [{ from: [...pts[hit.i]], ref: { poly: hit.poly, j: hit.i } }, { from: [...pts[j]], ref: { poly: hit.poly, j } }];
        } else {
          const w = f.walls[hit.i];
          if (!w) break;
          st.sel = { t: "wall", i: hit.i };
          ends = [{ from: [...w.a], ref: { k: "walls", i: hit.i, end: "a" } }, { from: [...w.b], ref: { k: "walls", i: hit.i, end: "b" } }];
        }
        this.drag = { type: "edge", base, ends, start: p, moved: false, to: [] };
        break;
      }
      case "extra": {
        const x = f.extras[hit.i];
        if (!x) break;
        st.sel = { t: "extra", i: hit.i };
        const ends = [
          { from: [...x.a] as Pt, ref: { k: "extras", i: hit.i, end: "a" } as PtRef },
          { from: [...x.b] as Pt, ref: { k: "extras", i: hit.i, end: "b" } as PtRef },
        ];
        this.drag = { type: "edge", base, ends, start: p, moved: false, to: [] };
        break;
      }
      case "room": {
        st.sel = { t: "room", i: hit.i };
        const r = f.rooms[hit.i];
        if (r) {
          // A room snapped to a neighbour can't be dragged loose by accident: it must be unsnapped first. Dragging it pans instead.
          if (r.free !== true && snapped(f, `r${hit.i}`)) this.drag = { type: "pan", sx: ev.clientX, sy: ev.clientY, v: { ...st.view }, button: ev.button, moved: false };
          else this.drag = { type: "room", base, list: "rooms", i: hit.i, start: p, moved: false };
        }
        break;
      }
      case "stairs":
        st.sel = { t: "stairs", i: hit.i };
        if (f.stairs[hit.i]) this.drag = { type: "room", base, list: "stairs", i: hit.i, start: p, moved: false };
        break;
      case "opening": {
        const o = f.openings[hit.i];
        if (!o) break;
        st.sel = { t: "opening", i: hit.i };
        // S4.9: locked keeps an opening's length fixed for endpoint drags; it does not stop a whole-body slide, matching a door.
        this.drag = { type: "opening", base, i: hit.i, off: [p[0] - (o.a[0] + o.b[0]) / 2, p[1] - (o.a[1] + o.b[1]) / 2], len: dist(o.a, o.b), moved: false };
        break;
      }
      default:
        st.sel = null;
        this.drag = { type: "pan", sx: ev.clientX, sy: ev.clientY, v: { ...st.view }, button: ev.button, moved: false };
    }
    capture();
    this.requestUpdate();
  };

  /** First real change of a drag records the undo step. */
  private begin(d: { moved: boolean }) {
    if (!d.moved) { d.moved = true; this.st.snapshot(); }
  }

  private onMove = (ev: PointerEvent) => {
    const d = this.drag, st = this.st;
    if (!d && this.draw) { this.hover = this.snapDraw(this.draw, this.toSvg(ev), ev.altKey); this.requestUpdate(); return; }
    if (!d) return;
    if (d.type === "pan") {
      // Screen movement past a few pixels means this is a drag, not a (possibly right-button) click — same threshold "room" uses.
      if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) >= 4) d.moved = true;
      // The drag is on the screen; the view is in plan coordinates, so turn the shift back by the plan's rotation.
      const s = this.scale, r = st.rotation, shift: Pt = [(ev.clientX - d.sx) / s, (ev.clientY - d.sy) / s];
      const [dx, dy] = r ? rotateAbout(shift, -r.deg, [0, 0]) : shift;
      st.views[st.floor] = { x: d.v.x - dx, y: d.v.y - dy, w: d.v.w, h: d.v.h };
      this.requestUpdate();
      return;
    }
    const p = this.toSvg(ev), alt = ev.altKey, gs = alt ? 0 : st.snapGrid; // Alt: no grid for this gesture
    const g5 = (n: number) => gridRound(n, gs);
    let g: Floor | null = null;
    switch (d.type) {
      case "corner": {
        let to = this.snapCorner(d.base, p, d.from, d.ref, alt, [], isZoneRef(d.base, d.ref));
        // S4.9: a locked wall or opening keeps its length; the dragged end only pivots around the other, fixed end.
        if (!("poly" in d.ref) && (d.ref.k === "walls" || d.ref.k === "openings")) {
          const seg = d.base[d.ref.k][d.ref.i];
          if (seg?.locked) to = pivotOnArc(seg[d.ref.end === "a" ? "b" : "a"], to, dist(seg.a, seg.b), d.from);
        }
        if (!d.moved && dist(to, d.from) === 0) return;
        this.begin(d); d.to = to;
        // Shift: only the grabbed corner moves and leaves the others behind
        g = movePointAll(d.base, d.from, to, ev.shiftKey, d.ref);
        break;
      }
      case "edge": {
        let dx = p[0] - d.start[0], dy = p[1] - d.start[1];
        if (!d.moved && Math.hypot(dx, dy) * this.scale < 4) return;
        this.begin(d);
        if (gs) { dx = gridRound(dx, gs); dy = gridRound(dy, gs); }
        g = d.base; d.to = [];
        for (const e of d.ends) {
          const to = round([e.from[0] + dx, e.from[1] + dy]);
          d.to.push(to);
          g = movePointAll(g, e.from, to, ev.shiftKey, e.ref);
        }
        break;
      }
      case "dend": {
        const door = d.base.doors[d.i], other = door[d.end === "a" ? "b" : "a"], cur = door[d.end];
        this.begin(d);
        g = structuredClone(d.base);
        // S4.9: a locked door keeps its length; the dragged end only pivots around the other, fixed end.
        if (door.locked) g.doors[d.i][d.end] = pivotOnArc(other, p, dist(door.a, door.b), cur);
        else {
          const l = dist(cur, other) || 1, ux = (cur[0] - other[0]) / l, uy = (cur[1] - other[1]) / l;
          const t = Math.max(20, g5((p[0] - other[0]) * ux + (p[1] - other[1]) * uy));
          g.doors[d.i][d.end] = round([other[0] + ux * t, other[1] + uy * t]);
        }
        break;
      }
      case "door": {
        const c: Pt = [p[0] - d.off[0], p[1] - d.off[1]], e = nearestEdge(d.base, c, 60, HOST);
        if (!e) return;
        this.begin(d);
        g = structuredClone(d.base);
        Object.assign(g.doors[d.i], segmentAt(e.q, e.u, d.len));
        break;
      }
      case "opening": {
        const c: Pt = [p[0] - d.off[0], p[1] - d.off[1]], e = nearestEdge(d.base, c, 60, HOST);
        if (!e) return;
        this.begin(d);
        g = structuredClone(d.base);
        Object.assign(g.openings[d.i], segmentAt(e.q, e.u, d.len));
        break;
      }
      case "dev": {
        const dv = d.base.devices[d.i], c: Pt = [p[0] - d.off[0], p[1] - d.off[1]];
        this.begin(d);
        g = structuredClone(d.base);
        const t = g.devices[d.i];
        if ("a" in dv && "a" in t) {
          const len = dist(dv.a, dv.b), e = nearestEdge(d.base, c, 80, HOST);
          if (e) {
            // sit 16 cm beside the nearest wall, parallel to it, on the side of the pointer
            const nx = -e.u[1], ny = e.u[0], sd = (c[0] - e.q[0]) * nx + (c[1] - e.q[1]) * ny >= 0 ? 1 : -1;
            Object.assign(t, segmentAt([e.q[0] + nx * sd * 16, e.q[1] + ny * sd * 16], e.u, len));
          } else Object.assign(t, segmentAt(c, [(dv.b[0] - dv.a[0]) / (len || 1), (dv.b[1] - dv.a[1]) / (len || 1)], len));
        } else if ("x" in t) { t.x = g5(c[0]); t.y = g5(c[1]); }
        break;
      }
      case "furn": {
        this.begin(d);
        g = structuredClone(d.base);
        g.furniture[d.i].x = g5(p[0] - d.off[0]);
        g.furniture[d.i].y = g5(p[1] - d.off[1]);
        break;
      }
      case "unl": {
        this.begin(d);
        g = structuredClone(d.base);
        g.unlinked[d.i].x = g5(p[0] - d.off[0]);
        g.unlinked[d.i].y = g5(p[1] - d.off[1]);
        break;
      }
      case "fscale": {
        const m0 = d.base.furniture[d.i];
        if (!m0) break;
        const to: Pt = [g5(p[0]), g5(p[1])]; // the snap grid applies to the moving corner, like every other handle
        const next = scaleFurniture(m0, d.corner, to, { shift: ev.shiftKey });
        if (!d.moved && next.w === m0.w && next.h === m0.h && next.x === m0.x && next.y === m0.y) return;
        this.begin(d);
        g = structuredClone(d.base);
        g.furniture[d.i] = next;
        break;
      }
      case "room": {
        const dx = Math.round(p[0] - d.start[0]), dy = Math.round(p[1] - d.start[1]);
        if (!d.moved && Math.hypot(dx, dy) * this.scale < 4) return;
        this.begin(d);
        d.alt = alt;
        g = structuredClone(d.base);
        g[d.list][d.i].pts = d.base[d.list][d.i].pts.map((q): Pt => [q[0] + dx, q[1] + dy]);
        break;
      }
    }
    if (g) { st.replaceFloor(g); this.requestUpdate(); }
  };

  private onUp = (ev: PointerEvent) => {
    const d = this.drag, st = this.st;
    this.drag = null;
    if (!d) return;
    if (d.type === "pan") {
      // A right button pressed and released without a drag: not a pan, the context menu on whatever is under it.
      // (`ev.type === "pointercancel"` carries no useful position and is never this case.)
      if (d.button === 2 && !d.moved && ev.type === "pointerup") this.openCtxMenuAt(ev.clientX, ev.clientY);
      return;
    }
    if (d.moved) {
      // a corner dropped on another polygon's edge becomes a point of that polygon
      let f = st.f;
      // a zone corner is never stitched into a wall, even where another polygon has a corner at the same spot
      if (d.type === "corner") { if (!isZoneRef(d.base, d.ref)) f = stitch(f, d.to); }
      else if (d.type === "edge") { if (!d.ends.some((e) => isZoneRef(d.base, e.ref))) for (const q of d.to) f = stitch(f, q); }
      // a room dropped near where it belongs lands corner on corner and joins its neighbours again; Alt drops it as it is
      if (d.type === "room" && d.list === "rooms" && !d.alt) f = snapRoomTo(f, d.i, 14 / this.scale);
      st.replaceFloor(f);
      if (d.type === "fscale") { const m = f.furniture[d.i]; this.changed(`Scaled the ${m?.name || m?.symbol || "furniture"}`); }
      else this.changed();
      if (d.type === "dev") void this.offerAreaMove(d.i);
    } else this.requestUpdate();
  };

  private onDblClick = (ev: MouseEvent) => {
    if (this.draw) { this.finishDraw(); return; }
    // The click that finished a shape already did its work; Firefox and Safari still send the dblclick for the pair.
    // The phantom pair is the finishing press plus exactly one more; a deliberate double-click is that press plus two.
    if (this.finished) { const phantom = this.sameDouble(ev) && this.finished.presses === 1; this.finished = null; if (phantom) return; }
    const p = this.toSvg(ev);
    let hit = hitOf(ev.target as Element);
    if (hit.k !== "edge") hit = this.edgeNear(p) ?? hit;
    if (hit.k !== "edge") return;
    const pts = polyPts(this.st.f, hit.poly);
    if (!pts) return;
    const a = pts[hit.i], b = pts[(hit.i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0.05, Math.min(0.95, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const { poly, i } = hit;
    this.commit((f) => insertPoint(f, poly, i, round([a[0] + dx * t, a[1] + dy * t])));
    this.st.sel = null;
    this.requestUpdate();
  };

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    this.closeCtxMenu();
    const st = this.st, v = st.view, k = ev.deltaY > 0 ? 1.12 : 1 / 1.12, p = this.toSvg(ev);
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2, nx = p[0] + (cx - p[0]) * k, ny = p[1] + (cy - p[1]) * k;
    st.views[st.floor] = { x: nx - (v.w * k) / 2, y: ny - (v.h * k) / 2, w: v.w * k, h: v.h * k };
    this.requestUpdate();
  };

  private closeCtxMenu = () => { if (this.ctxMenu) { this.ctxMenu = null; this.requestUpdate(); } };

  private toggleDevCols = () => {
    this.devColsPos = this.devColsPos ? null : { x: Math.max(20, (window.innerWidth - 560) / 2), y: 90 };
    this.requestUpdate();
  };
  private onDevColsHeaderDown = (e: PointerEvent) => {
    if (!this.devColsPos || (e.target as Element).closest("button")) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    this.dcDrag = { dx: e.clientX - this.devColsPos.x, dy: e.clientY - this.devColsPos.y };
  };
  private onDevColsHeaderMove = (e: PointerEvent) => {
    if (!this.dcDrag) return;
    this.devColsPos = { x: e.clientX - this.dcDrag.dx, y: e.clientY - this.dcDrag.dy };
    this.requestUpdate();
  };
  private onDevColsHeaderUp = () => { this.dcDrag = null; };

  /** The kind a room/outline edge shows in its own panel: the first room's, or the outline's own, "wall" with no room and no outline. */
  private edgeKind(poly: string, i: number): WallKind | "none" {
    const rooms = edgeRooms(this.st.f, poly, i);
    if (rooms.length) return rooms[0].room.wk[rooms[0].i];
    return poly === "o" ? (this.st.f.owk?.[i] ?? "external") : "wall";
  }

  /**
   * S4.18/S4.27: right-click on a room, zone, structure or wall selects it (opening its side panel, already the
   * "change colour"/"kind" surface) and opens a small menu at the pointer. A room offers Change colour (closes the
   * menu, the panel is already showing), Delete, and — with a linked HA area — a section that places one of its
   * unplaced entities as a new device at the click point (S4.26). A wall (a room/outline edge, or a free-standing
   * wall) offers Change type, Add a point (edges only), Add an opening and Delete (S4.27). Any other target
   * (background, a device, furniture...) just closes a menu that might already be open. Called from `onUp`, not the
   * `contextmenu` DOM event: `onDown` already calls `preventDefault()` on every right-button pointerdown (so a
   * right-drag pans the canvas), and that suppresses the browser's own `contextmenu` event along with it — so there
   * is nothing to hook there. A stationary right-button press and release is the signal instead, exactly how a
   * left-button "room" drag already tells a click from a drag (`onUp`'s `d.moved`).
   */
  private openCtxMenuAt(clientX: number, clientY: number) {
    const el = (this.renderRoot as unknown as DocumentOrShadowRoot).elementFromPoint(clientX, clientY);
    let hit = hitOf(el);
    if (hit.k === "bg" || hit.k === "room" || hit.k === "stairs") hit = this.edgeNear(this.toSvg({ clientX, clientY })) ?? hit;
    if (hit.k === "room") {
      const r = this.st.f.rooms[hit.i];
      if (!r || (r.kind !== "room" && r.kind !== "zone" && r.kind !== "structure")) { this.closeCtxMenu(); return; }
      this.st.sel = { t: "room", i: hit.i };
      this.ctxMenu = { x: clientX, y: clientY, target: { k: "room", i: hit.i } };
    } else if (hit.k === "edge") {
      if (this.edgeKind(hit.poly, hit.i) === "none") { this.closeCtxMenu(); return; }
      this.st.sel = { t: "edge", poly: hit.poly, i: hit.i };
      this.ctxMenu = { x: clientX, y: clientY, target: { k: "edge", poly: hit.poly, i: hit.i } };
    } else if (hit.k === "wall" || hit.k === "door" || hit.k === "opening" || hit.k === "furn" || hit.k === "unl") {
      const list = hit.k === "wall" ? this.st.f.walls : hit.k === "door" ? this.st.f.doors : hit.k === "opening" ? this.st.f.openings : hit.k === "furn" ? this.st.f.furniture : this.st.f.unlinked;
      if (!list[hit.i]) { this.closeCtxMenu(); return; }
      this.st.sel = { t: hit.k, i: hit.i };
      this.ctxMenu = { x: clientX, y: clientY, target: { k: hit.k, i: hit.i } };
    } else { this.closeCtxMenu(); return; }
    this.focus({ preventScroll: true }); // a right click never focuses the host on its own; Escape needs it to
    this.requestUpdate();
  }

  private ctxDelete() {
    const t = this.ctxMenu?.target;
    if (!t) return;
    if (t.k === "room") {
      this.commit((f) => { f.rooms.splice(t.i, 1); });
      this.st.sel = null;
      this.closeCtxMenu();
      return;
    }
    if (t.k === "wall") {
      this.commit((f) => { f.walls.splice(t.i, 1); });
      this.st.sel = null;
      this.closeCtxMenu();
      return;
    }
    if (t.k !== "edge") return; // Delete lives only on the room, wall and edge menus
    const pts = polyPts(this.st.f, t.poly);
    if (!pts) { this.closeCtxMenu(); return; }
    const a = pts[t.i], b = pts[(t.i + 1) % pts.length], key = `${t.poly}:${t.i}`, n = onEdge(this.st.f, a, b);
    if (n.doors.length + n.openings.length && this.st.confirmEdge !== key) { this.st.confirmEdge = key; this.requestUpdate(); return; }
    this.st.confirmEdge = null;
    this.commit((f) => deleteEdge(f, t.poly, t.i));
    this.st.sel = null;
    this.closeCtxMenu();
  }

  /** Whether the ctx menu's target is currently locked (fixed): false for a room or an edge, neither of which has the field. */
  private lockedOf(t: CtxTarget): boolean {
    const f = this.st.f;
    if (t.k === "wall") return !!f.walls[t.i]?.locked;
    if (t.k === "door") return !!f.doors[t.i]?.locked;
    if (t.k === "opening") return !!f.openings[t.i]?.locked;
    if (t.k === "furn") return !!f.furniture[t.i]?.locked;
    if (t.k === "unl") return !!f.unlinked[t.i]?.locked;
    return false;
  }
  /** Toggles the ctx menu's target between fixed and unfixed, one undo step, then closes the menu. A wall or opening
   *  fixed this way keeps its length on drag (S4.9); furniture and an unlinked device simply stop being draggable. */
  private ctxToggleLock() {
    const t = this.ctxMenu?.target;
    if (!t) return;
    const next = !this.lockedOf(t);
    if (t.k === "wall") this.commit((f) => { if (f.walls[t.i]) f.walls[t.i].locked = next; });
    else if (t.k === "door") this.commit((f) => { if (f.doors[t.i]) f.doors[t.i].locked = next; });
    else if (t.k === "opening") this.commit((f) => { if (f.openings[t.i]) f.openings[t.i].locked = next; });
    else if (t.k === "furn") this.commit((f) => { if (f.furniture[t.i]) f.furniture[t.i].locked = next; });
    else if (t.k === "unl") this.commit((f) => { if (f.unlinked[t.i]) f.unlinked[t.i].locked = next; });
    else return;
    this.closeCtxMenu();
  }

  /** S4.27: sets a wall's kind (an edge's, on every room sharing it, or a free wall's own), one undo step, then closes the menu. */
  private ctxSetKind(kind: WallKind) {
    const t = this.ctxMenu?.target;
    if (!t) return;
    if (t.k === "edge") this.commit((f) => setEdgeKind(f, t.poly, t.i, kind));
    else if (t.k === "wall") this.commit((f) => { f.walls[t.i].kind = kind; });
    else return;
    this.closeCtxMenu();
  }

  /** S4.27: inserts a point at an edge's own midpoint (never a free wall — it has no interior points), one undo step. */
  private ctxAddPoint() {
    const t = this.ctxMenu?.target;
    if (!t || t.k !== "edge") return;
    const pts = polyPts(this.st.f, t.poly);
    if (!pts) return;
    const a = pts[t.i], b = pts[(t.i + 1) % pts.length];
    this.commit((f) => insertPoint(f, t.poly, t.i, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)]));
    this.closeCtxMenu();
  }

  /** S4.27: places a new opening (a gap) centred on the right-click point — the same `addOpeningGap` an Add-menu item uses, anchored at the click instead of the view's centre. */
  private ctxAddOpening() {
    const m = this.ctxMenu;
    if (!m) return;
    this.addOpeningGap(120, this.toSvg({ clientX: m.x, clientY: m.y }));
    this.closeCtxMenu();
  }
  /** S4.27: places a new door or window centred on the right-click point, the same way `ctxAddOpening` places a gap. */
  private ctxAddDoor(kind: "door" | "window", len: number) {
    const m = this.ctxMenu;
    if (!m) return;
    this.addDoor(kind, len, this.toSvg({ clientX: m.x, clientY: m.y }));
    this.closeCtxMenu();
  }

  /** S4.18: places `e` (an entity of the menu's room's HA area) as a new device at the right-click point (S4.26), one undo step, then closes the menu. */
  private addFromArea(e: HaData["entities"][number]) {
    const t = this.ctxMenu?.target;
    if (!t || t.k !== "room") return;
    const m = this.ctxMenu!;
    if (!this.st.addFromArea(t.i, e, this.toSvg({ clientX: m.x, clientY: m.y }))) return;
    this.closeCtxMenu();
    this.changed(`Added ${e.name}. Drag it to its spot.`);
  }

  /** S4.18/S4.27's menu markup, positioned at the click (`position:fixed`, so no container-relative math is needed). */
  private ctxMenuView(m: { x: number; y: number; target: CtxTarget }) {
    const t = m.target;
    let items;
    if (t.k === "room") items = this.roomCtxItems(t.i);
    else if (t.k === "edge" || t.k === "wall") items = this.wallCtxItems(t);
    else items = this.fixCtxItems(t);
    return html`<div class="ctxmenu" style="left:${m.x}px;top:${m.y}px">${items}</div>`;
  }

  /** Device colours: a floating, draggable panel (View > Device colours), a 3-column grid of every device type's colour and reset. */
  private devColsView(st: EditorState) {
    const p = this.devColsPos!;
    return html`<div class="devcols-panel" style="left:${p.x}px;top:${p.y}px">
      <div class="devcols-head" @pointerdown=${this.onDevColsHeaderDown} @pointermove=${this.onDevColsHeaderMove} @pointerup=${this.onDevColsHeaderUp} @pointercancel=${this.onDevColsHeaderUp}>
        <span>Device colours</span>
        <button class="btn keep" id="devcolsClose" aria-label="Close" @click=${() => this.toggleDevCols()}>&times;</button>
      </div>
      <div class="devcols-grid">
        ${TYPE_LABELS.map(([t, label]) => html`<div class="colrow" data-type=${t}><label>${label}<input type="color" .value=${live(st.layout.colors?.[t] ?? DEVICE_COLOURS[t])} @change=${(e: Event) => this.setColour(t, (e.target as HTMLInputElement).value)}></label>
          <button class="btn keep" aria-label=${`Reset ${label}`} ?disabled=${!(st.layout.colors && t in st.layout.colors)} @click=${() => this.setColour(t, null)}>Reset</button></div>`)}
      </div>
      <button class="btn keep" id="devcolsx" ?disabled=${!st.layout.colors} @click=${() => { if (st.resetColours()) this.changed("Device colours reset"); }}>Reset all</button>
    </div>`;
  }

  private roomCtxItems(i: number) {
    const st = this.st, r = st.f.rooms[i], ha = st.ha;
    const unplaced = r?.area && ha ? ha.entities.filter((e) => e.area === r.area && !placedEntities(st.layout).has(e.id)) : [];
    return html`<button class="btn" id="cmColour" @click=${() => this.closeCtxMenu()}>Change colour</button>
      <button class="btn warn" id="cmDelete" @click=${() => this.ctxDelete()}>Delete</button>
      ${unplaced.length ? html`<div class="sep"></div><span class="grp">Add device from ${r!.name}</span>
        ${unplaced.map((e) => html`<button class="btn" @click=${() => this.addFromArea(e)}>${e.name} (${TYPE_LABELS.find((t) => t[0] === typeForEntity(e))?.[1] ?? typeForEntity(e)})</button>`)}` : nothing}`;
  }

  /** S4.27: Change type, Add a point (edges only), Add an opening, Delete — with the same doors/windows confirm dance as the edge panel's own Delete. */
  private wallCtxItems(t: Extract<CtxTarget, { k: "edge" | "wall" }>) {
    const f = this.st.f;
    let kind: WallKind, a: Pt | undefined, b: Pt | undefined, key: string;
    if (t.k === "edge") {
      const pts = polyPts(f, t.poly);
      if (!pts) return nothing;
      a = pts[t.i]; b = pts[(t.i + 1) % pts.length];
      const ek = this.edgeKind(t.poly, t.i);
      kind = ek === "none" ? "wall" : ek;
      key = `${t.poly}:${t.i}`;
    } else {
      const w = f.walls[t.i];
      if (!w) return nothing;
      a = w.a; b = w.b; kind = w.kind; key = `wall:${t.i}`;
    }
    if (this.st.confirmEdge === key) {
      const n = t.k === "edge" ? onEdge(f, a, b) : { doors: [], openings: [] };
      const count = n.doors.length + n.openings.length;
      return html`<p class="hint">${count === 1 ? "A door or window is on this wall." : `${count} doors and windows are on this wall.`} They stay. Stop drawing it?</p>
        <div class="row"><button class="btn warn" @click=${() => this.ctxDelete()}>Delete</button><button class="btn" @click=${() => { this.st.confirmEdge = null; this.requestUpdate(); }}>Cancel</button></div>`;
    }
    return html`<span class="grp">Change type</span>
      ${WALL_KINDS.filter((k) => k !== kind).map((k) => html`<button class="btn" @click=${() => this.ctxSetKind(k)}>${WALL_LABELS[k]}</button>`)}
      <div class="sep"></div>
      ${t.k === "edge" ? html`<button class="btn" @click=${() => this.ctxAddPoint()}>Add a point</button>` : nothing}
      <details class="sub" id="cmAddOpening"><summary class="btn">Add an opening</summary>
        <button class="btn" @click=${() => this.ctxAddDoor("door", 90)}>Door</button>
        <button class="btn" @click=${() => this.ctxAddDoor("window", 120)}>Window</button>
        <button class="btn" @click=${() => this.ctxAddOpening()}>Opening</button>
      </details>
      ${t.k === "wall" ? html`<button class="btn" @click=${() => this.ctxToggleLock()}>${this.lockedOf(t) ? "Unfix" : "Fix"}</button>` : nothing}
      <button class="btn warn" @click=${() => this.ctxDelete()}>Delete</button>`;
  }

  /** S4.27/S4.29: a door, opening, furniture piece or unlinked device offers only Fix/Unfix — delete already lives on its own side panel. */
  private fixCtxItems(t: Extract<CtxTarget, { k: "door" | "opening" | "furn" | "unl" }>) {
    return html`<button class="btn" @click=${() => this.ctxToggleLock()}>${this.lockedOf(t) ? "Unfix" : "Fix"}</button>`;
  }

  /** Zoom by `k` (below 1 zooms in) about the middle of what is shown; 0 fits the whole floor again. A view change only: no layout edit, no undo step. */
  private zoomBy(k: number) {
    const st = this.st, v = st.view;
    if (!k) st.fit();
    else { const cx = v.x + v.w / 2, cy = v.y + v.h / 2; st.views[st.floor] = { x: cx - (v.w * k) / 2, y: cy - (v.h * k) / 2, w: v.w * k, h: v.h * k }; }
    this.requestUpdate();
  }

  private onKey = (ev: KeyboardEvent) => {
    const t = ev.composedPath()[0] as HTMLElement | undefined;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); this.undo(!ev.shiftKey); return; }
    if (ev.key === "Escape" && this.ctxMenu) { ev.preventDefault(); this.closeCtxMenu(); return; }
    if (ev.key === "Escape" && this.devColsPos) { ev.preventDefault(); this.toggleDevCols(); return; }
    if (ev.key === "Escape" && this.st.helpOpen) { ev.preventDefault(); this.toggleHelp(); return; }
    if (this.draw) {
      // Draw mode owns these keys: Delete must not remove the item that was selected before.
      if (ev.key === "Enter") { ev.preventDefault(); this.finishDraw(); }
      else if (ev.key === "Escape") { ev.preventDefault(); this.stopDraw("Drawing cancelled"); }
      else if (ev.key === "Backspace") { ev.preventDefault(); this.draw.backspace(); this.requestUpdate(); }
      return;
    }
    if (ev.key !== "Delete" && ev.key !== "Backspace") return;
    const s = this.st.sel;
    if (!s) return;
    const del = (fn: (f: Floor) => void) => { this.commit(fn); this.st.sel = null; this.requestUpdate(); };
    if (s.t === "door") del((f) => { f.doors.splice(s.i, 1); });
    else if (s.t === "opening") del((f) => { f.openings.splice(s.i, 1); });
    else if (s.t === "dev") del((f) => { f.devices.splice(s.i, 1); });
    else if (s.t === "wall") del((f) => { f.walls.splice(s.i, 1); });
    else if (s.t === "extra") del((f) => { f.extras.splice(s.i, 1); });
    else if (s.t === "furn") del((f) => { f.furniture.splice(s.i, 1); });
    else if (s.t === "unl") del((f) => { f.unlinked.splice(s.i, 1); });
    else if (s.t === "stairs") del((f) => { f.stairs.splice(s.i, 1); });
    else if (s.t === "v" && "poly" in s.ref && (polyPts(this.st.f, s.ref.poly)?.length ?? 0) > 3) {
      const { poly, j } = s.ref;
      del((f) => { const P = polys(f).find((x) => x.id === poly); if (P) { P.pts.splice(j, 1); P.room?.wk.splice(j, 1); } });
    }
  };

  /** A button (panel Delete, a menu item) keeps focus on itself and may vanish or hide: hand focus back so Ctrl+Z and Delete keep working. */
  private onButtonClick = (ev: Event) => {
    const el = ev.composedPath()[0] as Element;
    // "+" hands focus to its own input; helpClose hands focus to the #help toggle button (toggleHelp).
    if (el.closest?.("button") && !el.closest("#addFloor") && !el.closest("#helpClose")) this.focus({ preventScroll: true });
  };

  /** Keys only reach a focused editor, so a highlighted selection must mean Delete works: clear it when focus leaves for good. */
  private onFocusOut = (ev: FocusEvent) => {
    const next = ev.relatedTarget as Node | null;
    if (next && (next === this || this.contains(next))) return; // into the panel or a menu (retargeted to this host)
    const src = ev.composedPath()[0], sel = this.st.sel;
    setTimeout(() => {
      if (this.st.sel !== sel) return; // something was selected since: that is not the selection that lost focus
      if (src instanceof Node && !src.isConnected) return; // the focused control was replaced by a new panel, not left
      if (!document.hasFocus()) return; // the window lost focus; the user comes back to the same selection
      if (this.st.sel) { this.st.sel = null; this.requestUpdate(); }
    }, 0);
  };

  private onWindowClick = (ev: MouseEvent) => {
    const path = ev.composedPath();
    if (this.ctxMenu && !path.some((n) => (n as Element).classList?.contains?.("ctxmenu"))) this.closeCtxMenu();
    this.renderRoot.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((m) => {
      if (!path.includes(m)) { m.open = false; this.closeSubs(m); }
      else if ((path[0] as Element).closest?.("button:not(.keep)")) { m.open = false; this.closeSubs(m); } // .keep: a stepper, several clicks in a row
    });
  };
  /** S4.11: a submenu (Add's Openings/Wall/Areas) is nested `<details class="sub">`, so it keeps its own open state even while its
   * root menu is hidden. Whenever the root closes, collapse any submenu inside it too, so reopening the root starts collapsed. */
  private closeSubs(root: ParentNode) {
    root.querySelectorAll<HTMLDetailsElement>("details.sub[open]").forEach((s) => { s.open = false; });
  }

  // ---- actions -------------------------------------------------------------

  private undo(back: boolean) {
    this.stopDraw();
    if (back ? this.st.undo() : this.st.redo()) { this.floor = this.st.floor; this.refreshNames(); this.changed(back ? "Undone" : "Redone"); }
  }
  /** View, Rotate the plan: one undo step. The stored coordinates are not touched; only `layout.rotate` changes. */
  private setColour(t: DeviceType, hex: string | null) {
    if (this.st.setColour(t, hex)) this.changed(hex ? `${t} colour set` : `${t} colour reset`);
  }
  private rotatePlan(step: number) {
    if (this.st.setRotate((this.st.layout.rotate ?? 0) + step)) this.changed(`Plan rotated to ${this.st.layout.rotate}°`);
  }
  private centre(): Pt { const v = this.st.view; return [Math.round(v.x + v.w / 2), Math.round(v.y + v.h / 2)]; }
  /** Where a new item goes: outside the house, top right. */
  private spawn(): Pt { return spawnPoint(this.st.f, this.centre(), this.st.snapGrid); }
  /** Brings all of `pts` into what the svg shows, with a 100 cm margin: pans by the least amount, and zooms out only when they do not fit. */
  private ensureVisible(...plan: Pt[]) {
    const st = this.st, v = st.view, s = this.scale, M = 100, r = st.rotation;
    // Work in what the screen shows: turn the points and the view centre by the plan's rotation, and the result back.
    const pts = r ? plan.map((q) => rotateAbout(q, r.deg, r.pivot)) : plan;
    const x0 = Math.min(...pts.map((q) => q[0])), x1 = Math.max(...pts.map((q) => q[0]));
    const y0 = Math.min(...pts.map((q) => q[1])), y1 = Math.max(...pts.map((q) => q[1]));
    const k = Math.max(1, (x1 - x0 + 2 * M) / (this.rect.w / s), (y1 - y0 + 2 * M) / (this.rect.h / s)); // >1: does not fit
    const w = v.w * k, h = v.h * k, hw = this.rect.w / s * k / 2, hh = this.rect.h / s * k / 2;
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

  // ---- draw mode ----

  /** Enters draw mode. Whatever was being drawn is dropped; the selection is cleared so no shape looks selected while drawing. */
  private startDraw(kind: DrawKind, wall: WallKind = "wall", area?: AreaPreset) {
    this.draw = new Draw(kind, wall, area);
    this.hover = null;
    this.st.sel = null;
    this.st.confirmDelete = false;
    this.status = DRAW_HINT;
    this.closeMenus();
    this.requestUpdate();
  }
  /** Leaves draw mode and forgets the points and the rubber band. Nothing is written. */
  private stopDraw(status = "Drawing cancelled") {
    if (!this.draw) return;
    this.draw = null; this.hover = null;
    this.status = status;
    this.requestUpdate();
  }
  /** A snapped point for draw mode. A zone snaps to the grid only: its corners never join other shapes (S1.8). */
  private snapDraw(d: Draw, p: Pt, alt: boolean): Pt {
    return this.snapCorner(this.st.f, p, NOWHERE, NO_REF, alt, d.points, d.kind === "zone");
  }
  /** Where and when a pointer press finished a shape: its dblclick, if the browser sends one, must not edit the plan. */
  private finished: { t: number; x: number; y: number; presses: number } | null = null;
  /** Is `ev` the second half of a double-click that began at the press that finished a shape? Within 500 ms and 10 px. */
  private sameDouble(ev: { clientX: number; clientY: number }): boolean {
    const f = this.finished;
    return !!f && performance.now() - f.t <= 500 && Math.hypot(ev.clientX - f.x, ev.clientY - f.y) <= 10;
  }
  private drawClick(raw: Pt, alt: boolean, ev: { clientX: number; clientY: number }) {
    const d = this.draw;
    if (!d) return;
    const r = d.click(this.snapDraw(d, raw, alt), 14 / this.scale, raw);
    this.hover = null;
    if (r === "finish") { this.finishDraw(); this.finished = { t: performance.now(), x: ev.clientX, y: ev.clientY, presses: 0 }; } else this.requestUpdate();
  }
  /** Writes the shape as one undo step, or drops it when it has too few points. */
  private finishDraw() {
    const d = this.draw;
    if (!d) return;
    const shape = d.finish(), floor = this.st.floor;
    this.draw = null; this.hover = null;
    if (!shape) { this.status = "Drawing cancelled: too few points"; this.requestUpdate(); return; }
    let sel: Sel = null, note = "";
    if (this.st.edit((f) => { const r = applyShape(f, floor, shape); sel = r.sel; note = r.note ?? ""; return r.floor; })) {
      this.st.sel = sel;
      this.changed(note || "Added the shape");
      // A room made from walls asks for its name at once. The press that closed it still has its default focus move to come, so wait it out.
      if (note) void this.updateComplete.then(() => setTimeout(() => this.renderRoot.querySelector<HTMLInputElement>("#rn")?.focus(), 0));
    } else this.requestUpdate();
  }

  private addDoor(kind: "door" | "window", len: number, at?: Pt) {
    this.stopDraw();
    const c = at ?? this.centre(), e = nearestEdge(this.st.f, c, Infinity, HOST), floor = this.st.floor;
    this.commit((f) => { f.doors.push({ id: newId(f, floor, "door"), name: `new ${kind}`, kind, ...segmentAt(e ? e.q : c, e ? e.u : [1, 0], len) }); });
    this.st.sel = { t: "door", i: this.st.f.doors.length - 1 };
    this.requestUpdate();
  }
  /** An opening: a gap in a wall. Placed like a door on the edge nearest `at`, or the view centre when it is not given, else at that point. S4.27's wall context menu passes the right-click point. */
  private addOpeningGap(len = 120, at?: Pt) {
    this.stopDraw();
    const c = at ?? this.centre(), e = nearestEdge(this.st.f, c, Infinity, HOST), floor = this.st.floor;
    this.commit((f) => { f.openings.push({ id: newId(f, floor, "opening"), ...segmentAt(e ? e.q : c, e ? e.u : [1, 0], len) }); });
    this.st.sel = { t: "opening", i: this.st.f.openings.length - 1 };
    this.requestUpdate();
  }
  private addWall(kind: WallKind) {
    this.stopDraw();
    const p = this.spawn(), [x, y] = p, floor = this.st.floor;
    this.commit((f) => { f.walls.push({ id: newId(f, floor, "wall"), a: [x - 100, y], b: [x + 100, y], kind }); });
    this.ensureVisible([x - 100, y], [x + 100, y]);
    this.st.sel = { t: "wall", i: this.st.f.walls.length - 1 };
    this.requestUpdate();
  }
  private addStructure() {
    this.stopDraw();
    const p = this.spawn(), [x, y] = p, floor = this.st.floor; // top-left corner: 400 cm centred on the spawn point would reach into the house
    this.commit((f) => { f.rooms.push({ id: newId(f, floor, "room"), name: "New structure", area: slug("New structure"), label: "", kind: "structure", pts: [[x, y], [x + 400, y], [x + 400, y + 300], [x, y + 300]], wk: ["wall", "wall", "wall", "wall"] }); });
    this.ensureVisible([x, y], [x + 400, y + 300]);
    this.st.sel = { t: "room", i: this.st.f.rooms.length - 1 };
    this.requestUpdate();
  }
  private addArea(kind: "zone") {
    this.stopDraw();
    const p = this.spawn(), pts = squareAt(p, this.st.snapGrid), floor = this.st.floor, name = "New zone";
    this.commit((f) => { f.rooms.push({ id: newId(f, floor, "room"), name, area: slug(name), label: "", kind, pts, wk: pts.map((): WallKind => "boundary") }); });
    this.ensureVisible(...pts);
    this.st.sel = { t: "room", i: this.st.f.rooms.length - 1 };
    this.requestUpdate();
  }
  private addStairs() {
    this.stopDraw();
    const t = stairsAt(this.spawn(), this.st.snapGrid);
    this.st.addStairsEverywhere(t);
    this.changed("Added stairs to every floor");
    this.ensureVisible(...t.pts);
  }
  private addFurniture(symbol: string) {
    if (!(FURNITURE_SYMBOLS as readonly string[]).includes(symbol)) return;
    this.stopDraw();
    const sym = symbol as keyof typeof FURNITURE, p = this.spawn(), [x, y] = p, floor = this.st.floor;
    this.commit((f) => { f.furniture.push({ id: newId(f, floor, "furniture"), symbol: sym, x, y, rot: 0, w: FURNITURE[sym].w, h: FURNITURE[sym].h }); });
    this.ensureVisible([x - FURNITURE[sym].w / 2, y - FURNITURE[sym].h / 2], [x + FURNITURE[sym].w / 2, y + FURNITURE[sym].h / 2]);
    this.st.sel = { t: "furn", i: this.st.f.furniture.length - 1 };
    this.requestUpdate();
  }
  /** S4.25: places an unlinked appliance (a fixed icon by type, not tied to one entity's state). */
  private addUnlinked(type: string) {
    if (!(UNLINKED_TYPES as readonly string[]).includes(type)) return;
    this.stopDraw();
    const t = type as DeviceType, p = this.spawn(), [x, y] = p, floor = this.st.floor;
    this.commit((f) => { f.unlinked.push({ id: newId(f, floor, "unl"), type: t, x, y, rot: 0, scale: 1 }); });
    this.ensureVisible([x - 30, y - 30], [x + 30, y + 30]);
    this.st.sel = { t: "unl", i: this.st.f.unlinked.length - 1 };
    this.requestUpdate();
  }
  private placeDevice(id: string) {
    const st = this.st, c = st.layout.catalog.find((x) => x.id === id);
    if (!c) return;
    // The clicked item leaves the list on the next render; take focus first or the focus-out clears the new selection.
    this.focus({ preventScroll: true });
    this.stopDraw();
    const target = hasOwn(st.layout.floors, c.floor) ? c.floor : st.floor;
    st.snapshot();
    st.setFloor(target);
    this.floor = target;
    const room = st.f.rooms.find((r) => r.name === c.room);
    let ctr = spawnPoint(st.f, this.centre(), st.snapGrid);
    if (room) ctr = round([room.pts.reduce((s, p) => s + p[0], 0) / room.pts.length, room.pts.reduce((s, p) => s + p[1], 0) / room.pts.length]);
    const f = structuredClone(st.f);
    f.devices.push(c.type === "heater"
      ? { id: c.id, name: c.name, type: c.type, entity: c.entity, a: [ctr[0] - 50, ctr[1]], b: [ctr[0] + 50, ctr[1]] }
      : { id: c.id, name: c.name, type: c.type, entity: c.entity, x: ctr[0], y: ctr[1] });
    st.replaceFloor(f);
    st.sel = { t: "dev", i: f.devices.length - 1 };
    const v = st.view;
    st.views[st.floor] = { ...v, x: ctr[0] - v.w / 2, y: ctr[1] - v.h / 2 };
    this.changed(`Placed ${c.name}${room ? ` in ${room.name}` : ""}. Drag it to its spot.`);
  }

  /** Set when the person ticked "Don't ask again this session": device-to-area moves then go through without the dialog. Not stored. */
  private moveWithoutAsking = false;

  /** S4.3: the room a placed device sits in, when it has an HA area that differs from the one HA has the device in. */
  private areaDiff(i: number): { room: string; name: string; move: NonNullable<ReturnType<typeof areaMove>> } | null {
    const st = this.st, d = st.f.devices[i], ha = st.ha;
    if (!d || !ha || !this.writer) return null;
    const at: Pt = "a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y];
    const room = st.f.rooms.find((r) => r.area && (r.kind === "room" || r.kind === "structure") && inside(at, r.pts));
    const move = room && areaMove(ha, d.entity, room.area);
    return room && move ? { room: room.area, name: room.name, move } : null;
  }

  /** S4.3: after a device is dropped in a room, offers to put it in that room's HA area. Dropping outside every room asks nothing. */
  private async offerAreaMove(i: number, force = false) {
    const diff = this.areaDiff(i), d = this.st.f.devices[i];
    if (!diff || !d) return;
    if (!this.moveWithoutAsking || force) {
      const ok = await askHa(this.shadowRoot ?? this, `Move ${d.name ?? d.entity} to ${diff.name}?`, [
        `Home Assistant will put ${diff.move.kind === "device" ? "the device" : d.entity} in the area ${diff.name}.`], { okLabel: "Move", remember: "Don't ask again this session", onRemember: () => { this.moveWithoutAsking = true; } });
      if (!ok) return;
    }
    try {
      if (diff.move.kind === "device") await this.writer!.setDeviceArea(diff.move.id, diff.move.area);
      else await this.writer!.setEntityArea(diff.move.id, diff.move.area);
    } catch (err) {
      this.status = `Could not move it in Home Assistant: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; this.requestUpdate();
      return;
    }
    const ha = this.st.ha;
    if (ha) { // keep our copy in step, so the mismatch note goes away
      const ids = new Set(diff.move.kind === "device" ? ha.entities.filter((e) => e.dev === diff.move.id).map((e) => e.id) : [diff.move.id]);
      this.ha = { ...ha, entities: ha.entities.map((e) => (ids.has(e.id) ? { ...e, area: diff.move.area } : e)) };
    }
    this.status = `Moved ${d.name ?? d.entity} to ${diff.name} in Home Assistant.`; this.requestUpdate();
  }

  /** S4.2: asks, creates an HA area named after the room, then links the room to it (one undo step; the area stays in HA). A failure changes nothing. */
  private async createArea(i: number) {
    const w = this.writer, st = this.st, r = st.f.rooms[i];
    if (!w || !r) return;
    const name = r.name.trim(), id = r.id;
    const ok = await askHa(this.shadowRoot ?? this, `Create area ${name}`, [
      `Home Assistant will get a new area "${name}", labelled floorplan-studio.`, "This room is then linked to it."]);
    if (!ok) return;
    this.status = `Creating area ${name}...`; this.requestUpdate();
    try {
      const a = await w.createArea(name);
      const ha = st.ha;
      if (ha && !ha.areas.some((x) => x.id === a.id)) this.ha = { ...ha, areas: [...ha.areas, { id: a.id, name: a.name }] };
      // The plan may have changed while HA worked: find the room again by its id.
      const at = st.f.rooms.findIndex((x) => x.id === id);
      if (at < 0) { this.status = `Created area ${a.name} in Home Assistant, but the room is gone. Pick the area on another room.`; this.requestUpdate(); return; }
      if (st.edit((f) => { const room = f.rooms[at]; room.area = a.id; room.name = a.name; delete room.entity; })) this.changed(`Created area ${a.name} in Home Assistant. It stays there if you undo.`);
    } catch (err) {
      this.status = `Could not create the area: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; this.requestUpdate();
    }
  }

  /** S4.4: asks, has Home Assistant wrap the placed switch in a light, then swaps it on the plan. A failure changes nothing on the plan. */
  private async makeLight(i: number) {
    const w = this.writer, st = this.st, d = st.f.devices[i];
    if (!w || !d || !st.canMakeLight(i)) return;
    const name = d.name ?? d.entity;
    const ok = await askHa(this.shadowRoot ?? this, "Create a light from this switch", [
      `Home Assistant will create a light "${name}" that wraps ${d.entity}, and label it floorplan-studio.`,
      "The switch stays in Home Assistant. The plan shows the light, bound to the switch."]);
    if (!ok) return;
    this.status = `Creating a light from ${name}...`; this.requestUpdate();
    try {
      const { entity_id } = await w.createHelper("switch_as_x", [{ entity_id: d.entity, target_domain: "light" }]);
      // The plan may have changed while HA worked: find the switch again by its entity.
      const at = st.f.devices.findIndex((x) => x.entity === d.entity);
      if (at < 0 || !st.lightFromSwitch(at, entity_id, name)) { this.status = `Created ${entity_id} in Home Assistant, but the plan changed meanwhile. Place it from the Device menu.`; this.requestUpdate(); return; }
      const ha = st.ha;
      if (ha && !ha.entities.some((e) => e.id === entity_id)) this.ha = { ...ha, entities: [...ha.entities, { id: entity_id, name, domain: "light" }] };
      this.changed(`Created ${entity_id}. The helper stays in Home Assistant if you undo.`);
    } catch (err) {
      this.status = `Could not create the light: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; this.requestUpdate();
    }
  }

  /** S4.5: asks, has Home Assistant build a light or motion group of the selected devices, then remembers it for the Group menu. Nothing on the plan changes: the plan never stores group membership, HA does. */
  private async createGroup(is: number[], kind: "light" | "motion", name: string) {
    const w = this.writer, st = this.st, f = st.f;
    const n = name.trim();
    if (!w || !n || groupKind(f, is) !== kind) return;
    const entities = is.map((i) => f.devices[i]?.entity).filter((e): e is string => !!e);
    const ok = await askHa(this.shadowRoot ?? this, `Create group ${n}`, [
      `Home Assistant will get a new group "${n}" of ${entities.length} ${kind === "light" ? "lights" : "motion sensors"}, labelled floorplan-studio.`]);
    if (!ok) return;
    this.status = `Creating group ${n}...`; this.requestUpdate();
    try {
      const nextStep = kind === "light" ? "light" : "binary_sensor";
      const { entity_id } = await w.createHelper("group", [{ next_step_id: nextStep }, { name: n, entities, hide_members: false, all: false }]);
      const ha = st.ha;
      if (ha && !ha.entities.some((e) => e.id === entity_id)) this.ha = { ...ha, entities: [...ha.entities, { id: entity_id, name: n, domain: "group", members: entities }] };
      st.groupDraft = ""; st.sel = null;
      this.changed(`Created group ${entity_id} with ${entities.length} ${kind === "light" ? "lights" : "motion sensors"}. It stays in Home Assistant if you undo.`);
    } catch (err) {
      this.status = `Could not create the group: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; this.requestUpdate();
    }
  }

  /** S4.6: asks, has Home Assistant build the "switch controls..." automation, then opens it in HA's own editor. The plan never changes: nothing here is undoable. */
  private async controlsAutomation(i: number, targets: string[]) {
    const w = this.writer, d = this.st.f.devices[i];
    if (!w || !d || !targets.length) return;
    const ok = await askHa(this.shadowRoot ?? this, "Create automation", [
      `Home Assistant will get a new automation: ${d.entity} turns ${targets.length} thing${targets.length === 1 ? "" : "s"} on and off with it, labelled floorplan-studio.`,
      "It opens in Home Assistant's own editor once created, to finish or rename."]);
    if (!ok) return;
    this.status = "Creating the automation..."; this.requestUpdate();
    try {
      const cfg = switchControls(d.entity, targets);
      const id = await w.createAutomation(cfg);
      this.st.controlsDraft = [];
      this.status = `Created the automation. Opening it in Home Assistant...`; this.requestUpdate();
      openAutomation(id);
    } catch (err) {
      this.status = `Could not create the automation: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; this.requestUpdate();
    }
  }

  /** S4.6: asks, has Home Assistant build the "schedule" automation, then opens it in HA's own editor. */
  private async scheduleAutomation(i: number, on: string, off: string) {
    const w = this.writer, d = this.st.f.devices[i];
    if (!w || !d || !on || !off) return;
    const ok = await askHa(this.shadowRoot ?? this, "Create automation", [
      `Home Assistant will get a new automation: ${d.entity} on at ${on}, off at ${off}, every day, labelled floorplan-studio.`,
      "It opens in Home Assistant's own editor once created, to finish or rename."]);
    if (!ok) return;
    this.status = "Creating the automation..."; this.requestUpdate();
    try {
      const cfg = schedule(d.entity, on, off);
      const id = await w.createAutomation(cfg);
      this.st.scheduleOn = ""; this.st.scheduleOff = "";
      this.status = `Created the automation. Opening it in Home Assistant...`; this.requestUpdate();
      openAutomation(id);
    } catch (err) {
      this.status = `Could not create the automation: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; this.requestUpdate();
    }
  }

  /** S4.6: asks, has Home Assistant build the "turns on..." motion-group automation, then opens it in HA's own editor. */
  private async motionAutomation(motionGroupId: string, lightGroupId: string, minutes: number) {
    const w = this.writer;
    if (!w || !lightGroupId || !(minutes > 0)) return;
    const ok = await askHa(this.shadowRoot ?? this, "Create automation", [
      `Home Assistant will get a new automation: ${lightGroupId} turns on with ${motionGroupId}, off ${minutes} minute${minutes === 1 ? "" : "s"} after motion stops, labelled floorplan-studio.`,
      "It opens in Home Assistant's own editor once created, to finish or rename."]);
    if (!ok) return;
    this.status = "Creating the automation..."; this.requestUpdate();
    try {
      const cfg = motionLights(motionGroupId, lightGroupId, Math.round(minutes * 60));
      const id = await w.createAutomation(cfg);
      this.st.motionLightGroup = ""; this.st.motionMinutes = "";
      this.status = `Created the automation. Opening it in Home Assistant...`; this.requestUpdate();
      openAutomation(id);
    } catch (err) {
      this.status = `Could not create the automation: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; this.requestUpdate();
    }
  }

  /** S4.7: opens Home Assistant's own more-info dialog for an entity. Always present, even without a writer: it is a DOM
   * event, not a write, and the standalone build simply has nothing listening. */
  private moreInfo(entityId: string) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  /** S4.7: the room box's "Run" button on a scene row. Not a write to the plan or the registry, so it asks nothing first — same as a card tap. */
  private async runScene(entityId: string) {
    const w = this.writer;
    if (!w) return;
    try {
      await w.runScene(entityId);
      this.status = `Ran ${entityId}.`; this.requestUpdate();
    } catch (err) {
      this.status = `Could not run it: ${err instanceof Error ? err.message : String(err)}.`; this.requestUpdate();
    }
  }

  /** S4.7: the room box's "Add to area..." — asks, then puts an area-less HA entity into the room's own area. */
  private async addToArea(i: number, entityId: string) {
    const w = this.writer, st = this.st, r = st.f.rooms[i], ha = st.ha;
    if (!w || !r || !r.area || !ha) return;
    const e = ha.entities.find((x) => x.id === entityId);
    const ok = await askHa(this.shadowRoot ?? this, `Add ${e?.name ?? entityId} to ${r.name}?`, [
      `Home Assistant will put ${entityId} in the area ${r.name}.`]);
    if (!ok) return;
    try {
      await w.setEntityArea(entityId, r.area);
      this.ha = { ...ha, entities: ha.entities.map((x) => (x.id === entityId ? { ...x, area: r.area } : x)) };
      this.status = `Added ${e?.name ?? entityId} to ${r.name} in Home Assistant.`; this.requestUpdate();
    } catch (err) {
      this.status = `Could not add it: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; this.requestUpdate();
    }
  }

  /** S4.10: opening the Home Assistant menu loads everything floorplan-studio labelled, fresh each time (HA state moves on its own). */
  private onHaToggle = (ev: Event) => {
    if ((ev.currentTarget as HTMLDetailsElement).open) void this.loadHaList();
  };

  private async loadHaList() {
    if (!this.writer) return;
    this.haListLoading = true; this.haListErr = ""; this.requestUpdate();
    try {
      this.haList = await this.writer.listLabelled();
    } catch (err) {
      this.haList = null;
      this.haListErr = `Could not read Home Assistant: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.haListLoading = false; this.requestUpdate();
    }
  }

  /** S4.10: asks, then deletes the HA-side thing and refreshes the list. Never touches the plan: a room or device that used it, if any, is untouched. */
  private async removeHaItem(item: Labelled) {
    if (!this.writer) return;
    const what = item.kind === "area" ? "the area" : item.kind === "helper" ? "the helper" : "the automation";
    const ok = await askHa(this.shadowRoot ?? this, `Remove ${item.name} from Home Assistant?`, [
      `Home Assistant will delete ${what} ${item.name}.`,
      "This does not touch the plan. If it is used on a room or device there, remove it from there separately."]);
    if (!ok) return;
    try {
      await this.writer.removeLabelled(item);
      this.status = `Removed ${item.name} from Home Assistant.`; this.requestUpdate();
      await this.loadHaList();
    } catch (err) {
      this.status = `Could not remove ${item.name}: ${err instanceof Error ? err.message : String(err)}. Nothing was changed.`; this.requestUpdate();
    }
  }

  /** One row of the Home Assistant menu: its name, a link/button to open it in Home Assistant, and Remove. */
  private haRow(it: Labelled) {
    const open = it.entityId
      ? html`<button class="btn keep" @click=${() => this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: it.entityId }, bubbles: true, composed: true }))}>Open in Home Assistant</button>`
      : html`<a class="btn keep" href=${`/config/areas/area/${it.id}`} target="_top">Open in Home Assistant</a>`;
    return html`<div class="harow" data-ha=${it.id}><span>${it.name}</span>${open}<button class="btn warn keep" @click=${() => void this.removeHaItem(it)}>Remove from Home Assistant</button></div>`;
  }

  /** A floor operation of the state is one undo step; the host hears about it like any other edit. */
  private floorDone(status: string) { this.stopDraw(); this.floor = this.st.floor; this.changed(status); }
  private renameFloor(key: string, title: string) {
    if (this.st.renameFloor(key, title)) this.floorDone(`Renamed floor to ${title.trim()}`);
    else this.requestUpdate();
  }
  private moveFloor(key: string, delta: number) { if (this.st.moveFloor(key, delta)) this.floorDone(delta > 0 ? "Moved floor up" : "Moved floor down"); }
  private deleteFloor(key: string) {
    const title = (hasOwn(this.st.layout.floors, key) ? this.st.layout.floors[key].title : "") || key;
    if (this.st.deleteFloor(key)) { this.floorDone(`Deleted floor ${title}`); this.focus({ preventScroll: true }); }
    else this.requestUpdate();
  }
  private async startAddFloor() {
    this.addingFloor = true;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLInputElement>("#newFloor")?.focus();
  }
  private cancelAddFloor() { this.addingFloor = false; this.focus({ preventScroll: true }); }
  private onNewFloorKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") { ev.preventDefault(); this.cancelAddFloor(); return; }
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const title = (ev.target as HTMLInputElement).value.trim();
    if (!title) { this.status = "Type a name for the floor, or press Esc"; return; }
    this.addingFloor = false;
    if (this.st.addFloor(title)) { this.floorDone(`Added floor ${title}`); this.focus({ preventScroll: true }); }
  };

  private setFloor(name: string) { this.stopDraw(); this.st.setFloor(name); this.floor = name; this.requestUpdate(); }

  private save() {
    const v = validate(this.st.layout);
    if (!v.ok) { this.errors = v.errors; return; }
    this.errors = [];
    this.st.persist();
    this.status = "Saving…";
    const ev = new CustomEvent("save-request", { detail: this.st.layout, bubbles: true, composed: true, cancelable: true });
    this.dispatchEvent(ev);
    // A host that listens owns the outcome and answers with saveDone(). Nobody listening: nothing else will write it.
    if (this.saveListeners === 0 && !ev.defaultPrevented) this.saveDone(true);
    else this.requestUpdate();
  }
  /**
   * File, Export: downloads the current layout as JSON directly from the browser, regardless of host. Unlike Save
   * (`save-request`), no host is involved and nothing is asked to persist it — this is the only way to get the JSON
   * out of the HA panel, where Save writes to `.storage` instead of downloading (the standalone host's Save already
   * downloads, so this duplicates it there, which is fine: the button means the same thing everywhere).
   */
  private exportJson() {
    const blob = new Blob([JSON.stringify(this.st.layout, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `floorplan-studio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  /** The host calls this when it has written (or failed to write) the layout it got in `save-request`. */
  saveDone(ok: boolean, message?: string) {
    this.status = ok ? message || "Saved" : message || "Save failed";
    this.requestUpdate();
  }
  private saveListeners = 0;
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
  /** Wipes the plan to a blank one. In Home Assistant nothing stored changes until Save. */
  private reset() {
    if (!confirm("Erase everything and start from a blank plan? Nothing saved is touched until you Save. Undo brings it back.")) return;
    // Not through applyLayout: a blank plan is not a valid layout (an outline needs 3 points), so it would be refused.
    this.stopDraw();
    this.errors = [];
    this.st.setLayout(emptyLayout(), undefined, true);
    this.floor = this.st.floor;
    this.refreshNames();
    this.changed("Blank plan. Draw, then Save.");
  }
  /** Only on a blank plan, so it never asks: there is nothing to lose. */
  private loadDemo() {
    if (!this.demo || !isBlank(this.st.layout)) return;
    this.applyLayout(this.demo, "Demo home loaded");
  }
  /** Validates first; on any problem lists them and leaves the current layout untouched. */
  private applyLayout(x: unknown, status: string) {
    const r = loadLayout(x);
    if (!r.ok) { this.errors = r.errors; this.status = "Could not use that layout"; return; }
    this.stopDraw();
    this.errors = [];
    this.st.setLayout(structuredClone(r.layout), undefined, true);
    this.floor = this.st.floor;
    this.refreshNames();
    this.changed(status);
  }
  private async openFile(ev: Event) {
    const input = ev.target as HTMLInputElement, file = input.files?.[0];
    if (!file) return;
    try {
      this.applyLayout(JSON.parse(await file.text()), `Opened ${file.name}`);
    } catch (e) {
      this.errors = [`${file.name} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`];
      this.status = "Could not use that file";
    }
    input.value = "";
  }

  // ---- drawing -------------------------------------------------------------

  /**
   * The measure grid drawn behind the plan: faint lines every 50 cm (more on a huge floor, so no axis ever needs more
   * than 400), over the whole area the editor shows, not just the plan. Zero is the plan's top-left corner, the
   * lowest x and y of the outline, so a metre marker reads the distance from that corner and not from the layout's
   * origin. Numbered at every whole metre along the top and left edges of the shown area. Off, this returns "". A
   * viewer preference, never in the layout, never an undo step.
   */
  private measureGrid(k: number, box: { x: number; y: number; w: number; h: number }): string {
    const st = this.st;
    if (!st.measure) return "";
    const zero = planZero(st.f);
    const perAxis = (s: number) => Math.max(Math.ceil(box.w / s), Math.ceil(box.h / s));
    let step = 50;
    if (perAxis(step) > 400) step = 100;
    if (perAxis(step) > 400) step = 500;
    const numStep = step === 50 ? 100 : step; // at 50 cm, number only the whole metres; else every line already is one
    const deg = st.layout.rotate ?? 0;
    const upright = (x: number, y: number) => (deg % 360 ? ` transform="rotate(${num(-deg)} ${num(x)} ${num(y)})"` : "");
    const x1 = box.x + box.w, y1 = box.y + box.h;
    const first = (from: number, z: number, s: number) => z + Math.ceil((from - z) / s) * s;
    const o: string[] = [];
    for (let x = first(box.x, zero[0], step); x <= x1; x += step) {
      const m = Math.round(x - zero[0]) % 100 === 0;
      o.push(`<line class="mg${m ? " m" : ""}" stroke-opacity="${m ? "0.22" : "0.12"}" x1="${num(x)}" y1="${num(box.y)}" x2="${num(x)}" y2="${num(y1)}"/>`);
    }
    for (let y = first(box.y, zero[1], step); y <= y1; y += step) {
      const m = Math.round(y - zero[1]) % 100 === 0;
      o.push(`<line class="mg${m ? " m" : ""}" stroke-opacity="${m ? "0.22" : "0.12"}" x1="${num(box.x)}" y1="${num(y)}" x2="${num(x1)}" y2="${num(y)}"/>`);
    }
    // The unit is stated once: only the x-axis origin reads "0 m"; the y-axis one, and every other number, is bare.
    for (let x = first(box.x, zero[0], numStep); x <= x1; x += numStep) {
      const v = Math.round((x - zero[0]) / 100), ly = box.y + 12 * k;
      o.push(`<text class="lbl mg-n" x="${num(x)}" y="${num(ly)}"${upright(x, ly)} text-anchor="middle" font-size="${num(10 * k)}">${v === 0 ? "0 m" : num(v)}</text>`);
    }
    for (let y = first(box.y, zero[1], numStep); y <= y1; y += numStep) {
      const v = Math.round((y - zero[1]) / 100), lx = box.x + 2 * k, ly = y + 3 * k;
      o.push(`<text class="lbl mg-n" x="${num(lx)}" y="${num(ly)}"${upright(lx, ly)} text-anchor="start" font-size="${num(10 * k)}">${num(v)}</text>`);
    }
    return o.join("");
  }

  private overlay(k: number): string {
    const st = this.st, f = st.f, s = st.sel, o: string[] = [];
    const line = (a: Pt, b: Pt, cls: string, extra = "") => `<line class="${cls}" x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}" ${extra}/>`;
    const deg = st.layout.rotate ?? 0, upright = (x: number, y: number) => (deg % 360 ? ` transform="rotate(${num(-deg)} ${num(x)} ${num(y)})"` : "");
    const len = (a: Pt, b: Pt) => `<text class="len" x="${num((a[0] + b[0]) / 2)}" y="${num((a[1] + b[1]) / 2)}"${upright((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)} text-anchor="middle" font-size="${num(10 * k)}">${(dist(a, b) / 100).toFixed(2)} m</text>`;
    if (s?.t === "edge") { const pts = polyPts(f, s.poly); if (pts) { const a = pts[s.i], b = pts[(s.i + 1) % pts.length]; o.push(line(a, b, "hl", 'stroke-width="4"'), len(a, b)); } }
    if (s?.t === "opening" && f.openings[s.i]) o.push(line(f.openings[s.i].a, f.openings[s.i].b, "hl", 'stroke-width="4"'));
    if (s?.t === "wall" && f.walls[s.i]) o.push(line(f.walls[s.i].a, f.walls[s.i].b, "hl", 'stroke-width="4"'));
    if (s?.t === "extra" && f.extras[s.i]) o.push(line(f.extras[s.i].a, f.extras[s.i].b, "hl", 'stroke-width="4"'));
    if (s?.t === "room" && f.rooms[s.i]) o.push(`<polygon class="hl" points="${f.rooms[s.i].pts.map((p) => `${num(p[0])},${num(p[1])}`).join(" ")}"/>`);
    if (s?.t === "stairs" && f.stairs[s.i]) o.push(`<polygon class="hl" ${stairsTurn(f.stairs[s.i])} points="${f.stairs[s.i].pts.map((p) => `${num(p[0])},${num(p[1])}`).join(" ")}"/>`);
    if (s?.t === "furn" && f.furniture[s.i]) {
      const m = f.furniture[s.i];
      o.push(`<rect class="hl" x="-50" y="-50" width="100" height="100" transform="translate(${num(m.x)} ${num(m.y)}) rotate(${num(m.rot)}) scale(${num(m.w / 100)} ${num(m.h / 100)})"/>`);
      // S1.51: a corner handle at each of the box's four corners, turned by the piece's own rot like the highlight rect.
      const hw = m.w / 2, hh = m.h / 2, rad = (m.rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      const CORNERS: { c: Corner; lx: number; ly: number }[] = [
        { c: "nw", lx: -hw, ly: -hh }, { c: "ne", lx: hw, ly: -hh }, { c: "se", lx: hw, ly: hh }, { c: "sw", lx: -hw, ly: hh },
      ];
      for (const { c, lx, ly } of CORNERS) {
        const wx = m.x + lx * cos - ly * sin, wy = m.y + lx * sin + ly * cos;
        o.push(`<circle class="h" data-fh="${s.i}:${c}" cx="${num(wx)}" cy="${num(wy)}" r="${num(5 * k)}"/>`);
      }
    }
    if (st.showLen) {
      const P = f.outline;
      P.forEach((a, i) => o.push(len(a, P[(i + 1) % P.length])));
      f.walls.forEach((w) => o.push(len(w.a, w.b)));
    }
    f.stairs.forEach((t, i) => { if (t.shape === "straight" && !t.rot) t.pts.forEach((p, j) => o.push(`<circle class="h" data-h="s${i}:${j}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`)); });
    const open = st.openDoor && f.doors.find((d) => d.id === st.openDoor);
    if (open) o.push(line(open.a, open.b, "door open", 'stroke-width="22" pointer-events="none"'));
    for (const r of looseEnds(f)) { const p = f[r.k][r.i][r.end]; o.push(`<circle class="h" data-hp="${r.k}:${r.i}:${r.end}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(4.5 * k)}"/>`); }
    if (s?.t === "door" && f.doors[s.i]) for (const end of ["a", "b"] as const) { const p = f.doors[s.i][end]; o.push(`<circle class="h" data-dh="${s.i}:${end}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`); }
    if (s?.t === "v") { const p = ptOf(f, s.ref); if (p) o.push(`<circle class="h on" pointer-events="none" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`); }
    // Draw mode: the placed points and a dashed rubber band. Only the editor draws these; the card never sees them.
    const dr = this.draw;
    if (dr?.points.length) {
      const pt = (p: Pt) => `${num(p[0])},${num(p[1])}`, path = dr.rubber(this.hover ?? dr.points[dr.points.length - 1]) ?? [];
      o.push(`<polyline class="dr" data-draw="path" points="${path.map(pt).join(" ")}"/>`);
      if (dr.polygon && dr.points.length >= 2 && this.hover) o.push(`<line class="dr" data-draw="close" x1="${num(this.hover[0])}" y1="${num(this.hover[1])}" x2="${num(dr.points[0][0])}" y2="${num(dr.points[0][1])}"/>`);
      dr.points.forEach((p, i) => o.push(`<circle class="dp${i === 0 ? " first" : ""}" data-dp="${i}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num((i === 0 ? 6 : 4) * k)}"/>`));
    }
    return o.join("");
  }

  render() {
    const st = this.st, f = st.f, s = this.scale, k = 1 / s, v = st.view;
    const w = this.rect.w / s, h = this.rect.h / s;
    const rot = st.rotation, vc: Pt = rot ? rotateAbout([v.x + v.w / 2, v.y + v.h / 2], rot.deg, rot.pivot) : [v.x + v.w / 2, v.y + v.h / 2];
    const viewBox = `${num(vc[0] - w / 2)} ${num(vc[1] - h / 2)} ${num(w)} ${num(h)}`;
    const sel = st.sel && (st.sel.t === "door" || st.sel.t === "dev") ? { t: st.sel.t, i: st.sel.i } : null;
    // The grid covers everything on screen: the shown rectangle, taken back into the plan's own (unturned) space.
    const shown = [[vc[0] - w / 2, vc[1] - h / 2], [vc[0] + w / 2, vc[1] - h / 2], [vc[0] + w / 2, vc[1] + h / 2], [vc[0] - w / 2, vc[1] + h / 2]] as Pt[];
    const back = rot ? shown.map((p) => rotateAbout(p, -rot.deg, rot.pivot)) : shown;
    const bx = back.map((p) => p[0]), by = back.map((p) => p[1]);
    const region = { x: Math.min(...bx), y: Math.min(...by), w: Math.max(...bx) - Math.min(...bx), h: Math.max(...by) - Math.min(...by) };
    const overlay = this.overlay(k), grid = this.measureGrid(k, region);
    const turnG = (svg: string) => (rot ? `<g class="plan-turn" transform="rotate(${num(rot.deg)} ${num(rot.pivot[0])} ${num(rot.pivot[1])})">${svg}</g>` : svg);
    const ha = st.ha;
    // S4.5: HA groups with at least one member on this floor, for the Group menu; the chosen one dims every other device (class "dim").
    const floorEntities = new Set(f.devices.map((d) => d.entity).filter((e) => e));
    const groups = ha ? ha.entities.filter((e) => e.domain === "group" && (e.members ?? []).some((m) => floorEntities.has(m))) : [];
    const activeGroup = st.activeGroup ? groups.find((g) => g.id === st.activeGroup) : undefined;
    // S4.6: a group's kind (light or motion) read off its first member's domain, to offer "Turns on..." only for a motion group.
    const groupKindOf = (g: { members?: string[] }) => (g.members ?? [])[0]?.split(".")[0] === "binary_sensor" ? "motion" as const : (g.members ?? [])[0]?.split(".")[0] === "light" ? "light" as const : undefined;
    const dimmed = activeGroup ? new Set(f.devices.filter((d) => d.entity && !(activeGroup.members ?? []).includes(d.entity)).map((d) => d.entity)) : undefined;
    // The grid is placed before renderFloor's own output, so the plan draws over it; a turned plan turns grid and overlay the same way.
    const body = turnG(grid) + renderFloor(f, { scale: s, selection: sel, showNames: st.showNames, filter: st.filter, editor: true, rotate: rot, colors: st.layout.colors, theme: st.theme, dark: this.isDark(), dimmed }) + turnG(overlay);
    const counts: Record<string, number> = {};
    for (const d of f.devices) counts[d.type] = (counts[d.type] ?? 0) + 1;
    const unplaced = st.unplaced(), q = this.devQuery.trim().toLowerCase();
    const matches = q ? unplaced.filter((c) => c.name.toLowerCase().includes(q) || c.entity.toLowerCase().includes(q)) : unplaced;
    // S4.14: the Add > Entities palette — every HA entity not yet on the plan or in the catalog, filtered the same way the Device menu filters its own list.
    const palette = ha ? unplacedHaEntities(st.layout, ha) : [];
    const eq = this.entQuery.trim().toLowerCase();
    const entMatches = eq ? palette.filter((e) => e.name.toLowerCase().includes(eq) || e.id.toLowerCase().includes(eq)) : palette;
    const areaName = (id: string | null | undefined) => (id ? ha?.areas.find((a) => a.id === id)?.name : undefined);
    const pressed = (b: boolean) => (b ? "true" : "false");
    return html`
      <div class="bar">
        ${Object.entries(st.layout.floors).map(([name, fl]) => html`<button class="chip" data-f=${name} aria-pressed=${pressed(name === st.floor)} @click=${() => this.setFloor(name)}>${fl.title || name}</button>`)}
        ${this.addingFloor
          ? html`<input id="newFloor" type="text" aria-label="Title of the new floor" placeholder="Floor title" @keydown=${this.onNewFloorKey} @blur=${() => { if (document.hasFocus()) this.addingFloor = false; }}>`
          : html`<button class="chip" id="addFloor" title="Add a floor" aria-label="Add a floor" @click=${() => this.startAddFloor()}>+</button>`}
        <span class="grow"></span>
        <details class="menu" id="filter"><summary class="btn" aria-label="Filter devices">${st.filter.length ? `Devices: ${st.filter.length} type${st.filter.length > 1 ? "s" : ""}` : `Devices: all (${f.devices.length})`}</summary><div class="box">
          <button class="btn keep" id="filterAll" ?disabled=${!st.filter.length} @click=${() => { st.filter = []; st.sel = null; this.requestUpdate(); }}>All</button>
          ${TYPE_LABELS.map(([t, label]) => html`<button class="btn keep" data-filter=${t} aria-pressed=${pressed(st.filter.includes(t))} @click=${() => { st.filter = st.filter.includes(t) ? st.filter.filter((x) => x !== t) : [...st.filter, t]; st.sel = null; this.requestUpdate(); }}>${label} (${counts[t] ?? 0})</button>`)}
        </div></details>
        <button class="chip" id="names" aria-pressed=${pressed(st.showNames)} title="Show every visible device's name on the plan" @click=${() => { st.showNames = !st.showNames; this.requestUpdate(); }}>Names</button>
        <details class="menu" id="mAdd"><summary class="btn">Add</summary><div class="box">
          <details class="sub" id="addOpenings"><summary class="btn">Openings</summary>
            <button class="btn" id="addDoor" @click=${() => this.addDoor("door", 90)}>Door</button>
            <button class="btn" id="addWin" @click=${() => this.addDoor("window", 120)}>Window</button>
            <button class="btn" id="addGap" title="A gap in a wall: the wall is not drawn there" @click=${() => this.addOpeningGap()}>Opening</button>
          </details>
          <details class="sub" id="addWallSub"><summary class="btn">Wall</summary>
            ${WALL_KINDS.map((k) => html`<button class="btn" id=${`addWall-${k}`} @click=${() => this.addWall(k)}>${WALL_LABELS[k]}</button>`)}
          </details>
          <details class="sub" id="addAreas"><summary class="btn">Areas</summary>
            <button class="btn" id="addStr" @click=${() => this.addStructure()}>Structure</button>
            <button class="btn" id="addZone" @click=${() => this.addArea("zone")}>Zone</button>
            <button class="btn" id="addStairs" @click=${() => this.addStairs()}>Stairs</button>
          </details>
          <details class="sub" id="mDev" @toggle=${this.onDevToggle}><summary class="btn">Device</summary>
            <input id="devSearch" type="search" autocomplete="off" aria-label="Search devices by name or entity id" placeholder="Search name or entity" .value=${live(this.devQuery)} @input=${(e: Event) => { this.devQuery = (e.target as HTMLInputElement).value; }} @keydown=${this.onDevSearchKey}>
            ${unplaced.length === 0 ? html`<span class="grp" id="devNone">Every device in the catalog is on the plan</span>` : nothing}
            ${unplaced.length > 0 && matches.length === 0 ? html`<span class="grp" id="devNone">No device matches</span>` : nothing}
            ${TYPE_LABELS.map(([t, label]) => { const g = matches.filter((c) => c.type === t); return g.length ? html`<span class="grp">${label}</span>${g.map((c) => html`<button class="btn" data-dev=${c.id} @click=${() => this.placeDevice(c.id)}>${c.name}${c.room ? ` — ${c.room}` : ""}</button>`)}` : nothing; })}
          </details>
          ${ha ? html`<details class="sub" id="addEntSub" @toggle=${this.onAddEntToggle}><summary class="btn">Entities</summary>
            <input id="entSearch" type="search" autocomplete="off" aria-label="Search Home Assistant entities by name or entity id" placeholder="Search name or entity" .value=${live(this.entQuery)} @input=${(e: Event) => { this.entQuery = (e.target as HTMLInputElement).value; }} @keydown=${this.onAddEntSearchKey}>
            ${palette.length === 0 ? html`<span class="grp" id="addEntNone">Nothing new in Home Assistant</span>` : nothing}
            ${palette.length > 0 && entMatches.length === 0 ? html`<span class="grp" id="addEntNone">No entity matches</span>` : nothing}
            ${TYPE_LABELS.map(([t, label]) => { const g = entMatches.filter((e) => typeForEntity(e) === t); return g.length ? html`<span class="grp">${label}</span>${g.map((e) => html`<button class="btn" data-ent=${e.id} @click=${() => this.addHaEntity(e)}>${e.name}${areaName(e.area) ? ` — ${areaName(e.area)}` : ""}</button>`)}` : nothing; })}
          </details>` : nothing}
          <div class="sep"></div>
          <select id="addFurn" aria-label="Add furniture" @change=${(e: Event) => { const el = e.target as HTMLSelectElement; if (el.value) this.addFurniture(el.value); el.value = ""; this.closeMenus(); }}>
            <option value="">Furniture…</option>
            ${FURNITURE_SYMBOLS.map((y) => html`<option value=${y}>${y}</option>`)}
          </select>
          <select id="addUnlDev" aria-label="Add unlinked device" @change=${(e: Event) => { const el = e.target as HTMLSelectElement; if (el.value) this.addUnlinked(el.value); el.value = ""; this.closeMenus(); }}>
            <option value="">Unlinked device…</option>
            ${UNLINKED_TYPES.map((t) => html`<option value=${t}>${TYPE_LABELS.find((x) => x[0] === t)?.[1] ?? t}</option>`)}
          </select>
        </div></details>
        <details class="menu" id="mDraw"><summary class="btn">Draw</summary><div class="box">
          <details class="sub" id="drawOpenings"><summary class="btn">Openings</summary>
            <button class="btn" id="drawOpening" @click=${() => this.startDraw("opening")}>Draw opening</button>
          </details>
          <details class="sub" id="drawWallSub"><summary class="btn">Wall</summary>
            ${WALL_KINDS.map((k) => html`<button class="btn" id=${`drawWall-${k}`} @click=${() => this.startDraw("wall", k)}>${WALL_LABELS[k]}</button>`)}
          </details>
          <details class="sub" id="drawAreas"><summary class="btn">Areas</summary>
            <button class="btn" id="drawRoom" @click=${() => this.startDraw("room")}>Draw room</button>
            <button class="btn" id="drawZone" @click=${() => this.startDraw("zone")}>Draw zone</button>
            <button class="btn" id="drawWater" @click=${() => this.startDraw("water")}>Draw water</button>
            <button class="btn" id="drawOutline" title="Replaces the outline of this floor" @click=${() => this.startDraw("outline")}>Draw outline</button>
            <button class="btn" id="drawExtra" @click=${() => this.startDraw("extra")}>Draw structure line</button>
          </details>
        </div></details>
        ${ha ? html`<details class="menu" id="mGroup"><summary class="btn">Group</summary><div class="box">
          <button class="btn" id="groupAll" aria-pressed=${pressed(!st.activeGroup)} @click=${() => { st.activeGroup = null; this.requestUpdate(); }}>All</button>
          ${groups.length === 0 ? html`<span class="grp" id="groupNone">No Home Assistant group has a member on this floor</span>` : nothing}
          ${groups.map((g) => html`<button class="btn" data-group=${g.id} aria-pressed=${pressed(st.activeGroup === g.id)} @click=${() => { st.activeGroup = g.id; this.requestUpdate(); }}>${g.name}</button>`)}
          ${this.writer && activeGroup && groupKindOf(activeGroup) === "motion" ? html`<div class="sep"></div>
            <label for="motLightGrp">Turns on</label>
            <select id="motLightGrp" .value=${live(st.motionLightGroup)} @change=${(e: Event) => { st.motionLightGroup = (e.target as HTMLSelectElement).value; this.requestUpdate(); }}>
              <option value="" ?selected=${!st.motionLightGroup}>choose a light group...</option>
              ${groups.filter((g) => groupKindOf(g) === "light").map((g) => html`<option value=${g.id} ?selected=${g.id === st.motionLightGroup}>${g.name}</option>`)}
            </select>
            <label for="motMinutes">off after (minutes)</label>
            <input id="motMinutes" type="number" min="1" step="1" .value=${live(st.motionMinutes)} @change=${(e: Event) => { st.motionMinutes = (e.target as HTMLInputElement).value; this.requestUpdate(); }}>
            <p><button class="btn" id="motGo" @click=${() => { const min = Number(st.motionMinutes); if (st.motionLightGroup && min > 0) void this.motionAutomation(activeGroup.id, st.motionLightGroup, min); }}>Create automation</button></p>` : nothing}
        </div></details>` : nothing}
        <details class="menu" id="mOpt" @toggle=${this.onOptToggle}><summary class="btn">View</summary><div class="box">
          <span class="grp" id="version">Floorplan Studio ${manifest.version}</span>
          <div class="rotrow" id="snap" role="group" aria-label="Snap"><span>Snap</span>
            ${GRID_VALUES.map((g) => html`<button class="chip keep" data-grid=${g} aria-pressed=${pressed(st.snapGrid === g)} @click=${() => { st.setGrid(g); this.requestUpdate(); }}>${g ? `${g} cm` : "None"}</button>`)}</div>
          <button class="chip" id="mgrid" aria-pressed=${pressed(st.measure)} title="A faint 50 cm grid with metre markers, behind the plan" @click=${() => { st.setMeasure(!st.measure); this.requestUpdate(); }}>Measure grid</button>
          <button class="chip" id="lens" aria-pressed=${pressed(st.showLen)} @click=${() => { st.showLen = !st.showLen; this.requestUpdate(); }}>Lengths</button>
          <details class="sub" id="thSub"><summary class="btn">Theme: ${THEME_LABELS[st.theme]}</summary>
            ${THEME_VALUES.map((t) => html`<button class="btn keep" data-th=${t} aria-pressed=${pressed(st.theme === t)} @click=${() => { st.setTheme(t); this.requestUpdate(); }}>${THEME_LABELS[t]}</button>`)}
          </details>
          <button class="btn" id="recenter" @click=${() => { st.recenter(); this.requestUpdate(); }}>Re-center</button>
          <button class="btn" id="fit" @click=${() => { st.fit(); this.requestUpdate(); }}>Fit to window</button>
          <button class="btn" id="devcols" aria-expanded=${pressed(!!this.devColsPos)} @click=${() => this.toggleDevCols()}>Device colours</button>
          <div class="rotrow"><span id="rotv">Rotate the plan: ${st.layout.rotate ?? 0}°</span>
            <button class="btn keep" id="rotl" aria-label="Rotate the plan 45 degrees left" @click=${() => this.rotatePlan(-45)}>&#8630; 45°</button>
            <button class="btn keep" id="rotr" aria-label="Rotate the plan 45 degrees right" @click=${() => this.rotatePlan(45)}>45° &#8631;</button></div>
        </div></details>
        <details class="menu" id="mFile"><summary class="btn">File</summary><div class="box">
          <button class="btn" id="imp" @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#file")?.click()}>Open…</button>
          <button class="btn" id="exp" title="Download the current layout as JSON" @click=${() => this.exportJson()}>Export…</button>
          ${this.demo ? html`<button class="btn" id="loaddemo" ?disabled=${!isBlank(st.layout)} title=${isBlank(st.layout) ? "Load the demo home" : "Reset first: loading the demo would overwrite your plan."} @click=${() => this.loadDemo()}>Load demo</button>` : nothing}
          <button class="btn danger" id="reset" title="Erase everything and start from a blank plan" @click=${() => this.reset()}>Reset</button>
          <button class="btn primary" id="save" @click=${() => this.save()}>Save</button>
        </div></details>
        ${this.writer ? html`<details class="menu" id="mHA" @toggle=${this.onHaToggle}><summary class="btn">Home Assistant</summary><div class="box">
          ${this.haListLoading ? html`<span class="grp" id="haLoading">Loading…</span>` : nothing}
          ${this.haListErr ? html`<span class="grp" id="haErr">${this.haListErr}</span>` : nothing}
          ${!this.haListLoading && !this.haListErr && this.haList?.length === 0 ? html`<span class="grp" id="haNone">Nothing floorplan-studio made is labelled in Home Assistant.</span>` : nothing}
          ${HA_KIND_LABELS.map(([k, label]) => { const g = (this.haList ?? []).filter((x) => x.kind === k); return g.length ? html`<span class="grp">${label}</span>${g.map((it) => this.haRow(it))}` : nothing; })}
        </div></details>` : nothing}
        <button class="btn" id="help" aria-expanded=${pressed(st.helpOpen)} @click=${() => this.toggleHelp()}>Help</button>
        <div class="vsep"></div>
        <button class="btn light" id="undo" ?disabled=${!st.canUndo} @click=${() => this.undo(true)}>Undo</button>
        <button class="btn light" id="redo" ?disabled=${!st.canRedo} @click=${() => this.undo(false)}>Redo</button>
        <input type="file" id="file" accept=".json,application/json" hidden @change=${(e: Event) => this.openFile(e)}>
      </div>
      ${this.errors.length ? html`<div class="errors" id="errors" role="alert"><strong>That layout was not used.</strong><ul>${this.errors.map((e) => html`<li>${e}</li>`)}</ul><button class="btn" id="errclose" @click=${() => { this.errors = []; }}>Dismiss</button></div>` : nothing}
      <div class="ed">
        <div class="canvas">
          <div class="zoom" role="group" aria-label="Zoom">
            <button class="btn" id="zin" title="Zoom in" aria-label="Zoom in" @click=${() => this.zoomBy(1 / 1.25)}>+</button>
            <button class="btn" id="zout" title="Zoom out" aria-label="Zoom out" @click=${() => this.zoomBy(1.25)}>&minus;</button>
            <button class="btn" id="zreset" title="Reset zoom: fit the whole floor" aria-label="Reset zoom" @click=${() => this.zoomBy(0)}>0</button>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" class=${this.draw ? "drawing" : ""} viewBox=${viewBox} @pointerdown=${this.onDown} @pointermove=${this.onMove} @pointerup=${this.onUp} @pointercancel=${this.onUp} @dblclick=${this.onDblClick} @contextmenu=${(e: Event) => e.preventDefault()}>${unsafeSVG(body)}</svg>
          ${this.ctxMenu ? this.ctxMenuView(this.ctxMenu) : nothing}
          ${this.devColsPos ? this.devColsView(st) : nothing}
        </div>
        <aside>
          <div id="panel">${st.helpOpen ? helpPanel(() => this.toggleHelp()) : selectionPanel(this.ctx())}</div>
          <p class="hint">Snapping: corners jump to other corners, snap onto other walls and line up with their neighbours. Hold Alt to move freely. Drag a wall to move it with its neighbours. Hold Shift while dragging a corner or a wall to move it alone. Drag a room, zone or stairs by the middle to move it. Delete removes the selected corner, wall, door, opening, device, furniture or stairs. Ctrl/Cmd+Z undoes. Scroll to zoom. Pan by dragging the background, or drag anywhere with the middle button, right button or Ctrl/Cmd held.</p>
          <span class="status" id="status" role="status">${this.status}</span>
        </aside>
      </div>`;
  }

  /** View's Theme submenu keeps its own open state (S4.11 pattern); a "keep" theme button never closes the menu on
   * click, so closing View by clicking its own summary again — the one route `onWindowClick` does not cover — must
   * collapse the submenu itself, or reopening View leaves Theme already open. */
  private onOptToggle = (ev: Event) => {
    const m = ev.currentTarget as HTMLDetailsElement;
    if (!m.open) this.closeSubs(m);
  };
  /** Opening the Device menu focuses the search; closing it, by any route, forgets the text. */
  private onDevToggle = (ev: Event) => {
    const m = ev.currentTarget as HTMLDetailsElement;
    if (m.open) this.renderRoot.querySelector<HTMLInputElement>("#devSearch")?.focus({ preventScroll: true });
    else if (this.devQuery) this.devQuery = "";
  };
  /** Keys typed in the search field belong to the field (onKey ignores inputs); only Escape is ours: close the menu. */
  private onDevSearchKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") { ev.preventDefault(); this.closeMenus(); }
  };
  /** S4.14: Add > Entities' own search, the same pattern as Device's (`onDevToggle`/`onDevSearchKey`). */
  private onAddEntToggle = (ev: Event) => {
    const m = ev.currentTarget as HTMLDetailsElement;
    if (m.open) this.renderRoot.querySelector<HTMLInputElement>("#entSearch")?.focus({ preventScroll: true });
    else if (this.entQuery) this.entQuery = "";
  };
  private onAddEntSearchKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") { ev.preventDefault(); this.closeMenus(); }
  };
  /**
   * S4.14: places `e` from the Add > Entities palette — the room its HA area names, when one is drawn on the current
   * floor, else a spawn point clear of everything already there (the same fallback `placeDevice`/`addFurniture` use).
   * One undo step, via `EditorState.addEntity`.
   */
  private addHaEntity(e: HaData["entities"][number]) {
    this.focus({ preventScroll: true }); // the clicked item leaves the list on the next render; see placeDevice's own note
    if (!this.st.addEntity(e, this.spawn())) return;
    this.closeMenus();
    this.changed(`Added ${e.name}. Drag it to its spot.`);
  }

  /**
   * S5.5: opens or closes the Help panel. Closing hands focus back to the toolbar's own #help button — the same
   * rule Escape follows for a menu (closeMenus): a keyboard user must not lose their place when a panel disappears.
   */
  private toggleHelp() {
    const wasOpen = this.st.helpOpen;
    this.st.setHelp(!wasOpen);
    this.requestUpdate();
    if (wasOpen) this.renderRoot.querySelector<HTMLButtonElement>("#help")?.focus({ preventScroll: true });
  }

  private closeMenus() {
    const open = this.renderRoot.querySelectorAll<HTMLDetailsElement>("details.menu[open]");
    open.forEach((m) => { m.open = false; this.closeSubs(m); });
    if (open.length) this.focus({ preventScroll: true }); // the focused item just hid
  }
}

if (!customElements.get("floorplan-studio-editor")) customElements.define("floorplan-studio-editor", FloorplanStudioEditor);
declare global { interface HTMLElementTagNameMap { "floorplan-studio-editor": FloorplanStudioEditor } }
