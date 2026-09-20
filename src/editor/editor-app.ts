import { LitElement, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { FLOORPLAN_CSS, FURNITURE, WALL_KINDS, FURNITURE_SYMBOLS, dist, insertPoint, nearestEdge, polys, renderFloor, snapPoint, stitch, validate } from "../core";
import type { DeviceType, Floor, Layout, Pt, WallKind } from "../core";
import { looseEnds, movePointAll, pointsNear, segmentAt, spawnPoint, squareAt, stairsAt } from "./ops";
import { Draw, applyShape, type DrawKind } from "./draw";
import { TYPE_LABELS, WALL_LABELS, selectionPanel, type PanelCtx } from "./panels";
import { EditorState, loadLayout, newId, polyPts, ptOf, slug, type LooseRef, type PtRef, type Sel, type View } from "./state";

/**
 * <floorplan-studio-editor>: draws and edits a layout.
 *   property `layout`  the layout to edit (validated; a bad one is refused and listed)
 *   property `floor`   the floor shown
 *   property `seed`    what File, Reset returns to (default: the first layout set)
 *   event `layout-changed`  detail: the Layout, after every edit
 *   event `save-request`    detail: the Layout, File, Save (host writes it somewhere)
 *   method saveDone(ok, message?)  the host calls it when the write is over; status stays "Saving…" until then.
 *                           With no save-request listener the editor says "Saved" itself. Listen on the element.
 */

type Hit =
  | { k: "corner"; poly: string; j: number }
  | { k: "loose"; ref: LooseRef }
  | { k: "dend"; i: number; end: "a" | "b" }
  | { k: "door" | "opening" | "dev" | "furn" | "wall" | "room" | "stairs"; i: number }
  | { k: "edge"; poly: string; i: number }
  | { k: "bg" };

type Drag =
  | { type: "pan"; sx: number; sy: number; v: View }
  | { type: "corner"; base: Floor; from: Pt; ref: PtRef; moved: boolean; to: Pt }
  | { type: "edge"; base: Floor; ends: { from: Pt; ref: PtRef }[]; start: Pt; moved: boolean; to: Pt[] }
  | { type: "dend"; base: Floor; i: number; end: "a" | "b"; moved: boolean }
  | { type: "door"; base: Floor; i: number; off: Pt; len: number; moved: boolean }
  | { type: "dev"; base: Floor; i: number; off: Pt; moved: boolean }
  | { type: "furn"; base: Floor; i: number; off: Pt; moved: boolean }
  | { type: "room"; base: Floor; list: "rooms" | "stairs"; i: number; start: Pt; moved: boolean };

const round = (p: Pt): Pt => [Math.round(p[0]), Math.round(p[1])];
const num = (n: number) => String(Math.round(n * 100) / 100);
const DRAW_HINT = "Click to add points, double-click or Enter to finish, Esc to cancel";
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
/** Does this point reference a corner of a zone? A zone never joins another polygon. */
const isZoneRef = (f: Floor, ref: PtRef) => "poly" in ref && ref.poly[0] === "r" && f.rooms[+ref.poly.slice(1)]?.kind === "zone";
/** A stand-in for "no dragged point": nothing is within reach of it. */
const NOWHERE: Pt = [-1e9, -1e9];
/** Where a door, window, opening or heater sits: a room, outline or water edge, or a free wall. Never a zone or stairs. */
const HOST = { walls: true } as const;
const NO_REF: PtRef = { k: "walls", i: -1, end: "a" };

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
  const d = el.closest("[data-d]");
  if (d) return { k: "door", i: +(d.getAttribute("data-d") ?? -1) };
  // An opening line has no data attribute (core draws it, the card must not change): it is the n-th `line.opening` of the plan.
  const op = el.closest("line.opening");
  if (op) return { k: "opening", i: Array.from(op.parentNode?.children ?? []).filter((c) => c.matches("line.opening")).indexOf(op) };
  const fu = el.closest("g[data-f]");
  if (fu) return { k: "furn", i: +(fu.getAttribute("data-f") ?? -1) };
  const e = el.closest("[data-e]");
  if (e) { const [poly, i] = (e.getAttribute("data-e") ?? "").split(":"); return { k: "edge", poly, i: +i }; }
  const w = el.closest("[data-w]");
  if (w) return { k: "wall", i: +(w.getAttribute("data-w") ?? -1) };
  const r = el.closest("[data-r]");
  if (r) return { k: "room", i: +(r.getAttribute("data-r") ?? -1) };
  const st = el.closest("[data-s]");
  if (st) return { k: "stairs", i: +(st.getAttribute("data-s") ?? -1) };
  return { k: "bg" };
}

export class FloorplanStudioEditor extends LitElement {
  static properties = {
    floor: { type: String },
    seed: { attribute: false },
    errors: { state: true },
    status: { state: true },
    addingFloor: { state: true },
    devQuery: { state: true },
  };
  declare floor: string;
  declare seed: Layout | undefined;
  declare errors: string[];
  declare status: string;
  declare addingFloor: boolean;
  /** The text in the Device menu search field. Cleared when the menu closes. */
  declare devQuery: string;

  private st = new EditorState();
  private drag: Drag | null = null;
  /** Draw mode: the shape being drawn, and where the pointer is (snapped) for the rubber band. */
  private draw: Draw | null = null;
  private hover: Pt | null = null;
  private rect = { w: 800, h: 600 };
  private ro?: ResizeObserver;

  constructor() {
    super();
    this.floor = "";
    this.errors = [];
    this.status = "Ready";
    this.addingFloor = false;
    this.devQuery = "";
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
    this.seed ??= structuredClone(r.layout);
    this.floor = this.st.floor;
    this.requestUpdate("layout", old);
  }

  static styles = css`
    ${css([FLOORPLAN_CSS] as unknown as TemplateStringsArray)}
    :host{display:block;outline:none;background:var(--fp-bg);color:var(--fp-ink);font:14px/1.4 system-ui,sans-serif}
    .bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 0}
    .grow{flex:1}
    .btn,.chip,select,input{font:inherit;color:var(--fp-ink);background:var(--fp-room);border:1px solid var(--fp-idle);border-radius:4px;padding:4px 8px}
    .btn,.chip,summary{cursor:pointer}
    .chip[aria-pressed="true"]{background:var(--fp-ink);color:var(--fp-bg)}
    .btn.primary{background:var(--fp-window);color:var(--fp-bg);border-color:var(--fp-window)}
    .menu{position:relative}
    .menu>summary{list-style:none;display:inline-block}
    .menu>summary::-webkit-details-marker{display:none}
    .menu>summary::after{content:" \\25BE"}
    .box{max-height:75vh;overflow:auto;position:absolute;right:0;top:calc(100% + 4px);z-index:20;min-width:210px;display:flex;flex-direction:column;gap:6px;padding:6px;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:4px}
    .box .btn,.box .chip,.box select{width:100%;text-align:left}
    .sep{border-top:1px solid var(--fp-idle)}
    .ed{display:grid;grid-template-columns:1fr 300px;gap:12px;align-items:start}
    .canvas{border:1px solid var(--fp-idle);height:var(--fp-editor-height,calc(100vh - 150px));min-height:420px;touch-action:none;background:var(--fp-bg)}
    .canvas svg{width:100%;height:100%;display:block;cursor:grab;user-select:none}
    .canvas svg.drawing,.canvas svg.drawing *{cursor:crosshair}
    .dr{fill:none;stroke:var(--fp-window);stroke-width:2;stroke-dasharray:6 4;vector-effect:non-scaling-stroke;pointer-events:none}
    .dp{fill:var(--fp-bg);stroke:var(--fp-window);stroke-width:2;vector-effect:non-scaling-stroke;pointer-events:none}
    .dp.first{fill:var(--fp-window)}
    .grp{font-size:.8em;opacity:.7}
    .box input[type=search]{width:100%;box-sizing:border-box}
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
    .len{fill:var(--fp-window);pointer-events:none;user-select:none}
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

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("floor") && this.floor && this.floor !== this.st.floor && hasOwn(this.st.layout.floors, this.floor)) { this.stopDraw(); this.st.setFloor(this.floor); }
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
  private toSvg(ev: { clientX: number; clientY: number }): Pt {
    const s = this.svgEl, m = s?.getScreenCTM();
    if (!s || !m) return [0, 0];
    const p = s.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(m.inverse());
    return [q.x, q.y];
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
  private ctx(): PanelCtx {
    return { st: this.st, commit: this.commit, select: this.select, say: (m) => { this.status = m; this.requestUpdate(); }, refresh: () => this.requestUpdate(), floors: { rename: (k, t) => this.renameFloor(k, t), move: (k, d) => this.moveFloor(k, d), remove: (k) => this.deleteFloor(k) } };
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
      return round(snapPoint(none, p, { threshold: 14 / this.scale, grid: this.st.snapGrid ? 5 : 0, exclude: [], neighbours: [...own, ...align] }));
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
    const snapped = round(snapPoint(base, p, { threshold: th, grid: this.st.snapGrid ? 5 : 0, exclude: grp, neighbours: [...neighbours, ...align] }));
    if (!isNeighbour(snapped)) return snapped;
    // snapPoint pulled it onto a neighbour (corner snap, or both axes lined up): keep it where the pointer is, on the grid if on
    const g = this.st.snapGrid ? 5 : 1;
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
      this.drag = { type: "pan", sx: ev.clientX, sy: ev.clientY, v: { ...st.view } };
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
        st.sel = { t: "dev", i: hit.i };
        const c: Pt = "a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y];
        this.drag = { type: "dev", base, i: hit.i, off: [p[0] - c[0], p[1] - c[1]], moved: false };
        break;
      }
      case "furn": {
        const m = f.furniture[hit.i];
        if (!m) break;
        st.sel = { t: "furn", i: hit.i };
        this.drag = { type: "furn", base, i: hit.i, off: [p[0] - m.x, p[1] - m.y], moved: false };
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
      case "room": {
        st.sel = { t: "room", i: hit.i };
        if (f.rooms[hit.i]) this.drag = { type: "room", base, list: "rooms", i: hit.i, start: p, moved: false };
        break;
      }
      case "stairs":
        st.sel = { t: "stairs", i: hit.i };
        if (f.stairs[hit.i]) this.drag = { type: "room", base, list: "stairs", i: hit.i, start: p, moved: false };
        break;
      case "opening": st.sel = { t: "opening", i: hit.i }; break;
      default:
        st.sel = null;
        this.drag = { type: "pan", sx: ev.clientX, sy: ev.clientY, v: { ...st.view } };
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
      const s = this.scale;
      st.views[st.floor] = { x: d.v.x - (ev.clientX - d.sx) / s, y: d.v.y - (ev.clientY - d.sy) / s, w: d.v.w, h: d.v.h };
      this.requestUpdate();
      return;
    }
    const p = this.toSvg(ev), alt = ev.altKey, grid = st.snapGrid && !alt;
    const g5 = (n: number) => (grid ? Math.round(n / 5) * 5 : Math.round(n));
    let g: Floor | null = null;
    switch (d.type) {
      case "corner": {
        const to = this.snapCorner(d.base, p, d.from, d.ref, alt, [], isZoneRef(d.base, d.ref));
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
        if (grid) { dx = Math.round(dx / 5) * 5; dy = Math.round(dy / 5) * 5; }
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
        const l = dist(cur, other) || 1, ux = (cur[0] - other[0]) / l, uy = (cur[1] - other[1]) / l;
        const t = Math.max(20, g5((p[0] - other[0]) * ux + (p[1] - other[1]) * uy));
        this.begin(d);
        g = structuredClone(d.base);
        g.doors[d.i][d.end] = round([other[0] + ux * t, other[1] + uy * t]);
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
      case "room": {
        const dx = Math.round(p[0] - d.start[0]), dy = Math.round(p[1] - d.start[1]);
        if (!d.moved && Math.hypot(dx, dy) * this.scale < 4) return;
        this.begin(d);
        g = structuredClone(d.base);
        g[d.list][d.i].pts = d.base[d.list][d.i].pts.map((q): Pt => [q[0] + dx, q[1] + dy]);
        break;
      }
    }
    if (g) { st.replaceFloor(g); this.requestUpdate(); }
  };

  private onUp = () => {
    const d = this.drag, st = this.st;
    this.drag = null;
    if (!d || d.type === "pan") return;
    if (d.moved) {
      // a corner dropped on another polygon's edge becomes a point of that polygon
      let f = st.f;
      // a zone corner is never stitched into a wall, even where another polygon has a corner at the same spot
      if (d.type === "corner") { if (!isZoneRef(d.base, d.ref)) f = stitch(f, d.to); }
      else if (d.type === "edge") { if (!d.ends.some((e) => isZoneRef(d.base, e.ref))) for (const q of d.to) f = stitch(f, q); }
      st.replaceFloor(f);
      this.changed();
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
    const st = this.st, v = st.view, k = ev.deltaY > 0 ? 1.12 : 1 / 1.12, p = this.toSvg(ev);
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2, nx = p[0] + (cx - p[0]) * k, ny = p[1] + (cy - p[1]) * k;
    st.views[st.floor] = { x: nx - (v.w * k) / 2, y: ny - (v.h * k) / 2, w: v.w * k, h: v.h * k };
    this.requestUpdate();
  };

  private onKey = (ev: KeyboardEvent) => {
    const t = ev.composedPath()[0] as HTMLElement | undefined;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); this.undo(!ev.shiftKey); return; }
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
    else if (s.t === "furn") del((f) => { f.furniture.splice(s.i, 1); });
    else if (s.t === "stairs") del((f) => { f.stairs.splice(s.i, 1); });
    else if (s.t === "v" && "poly" in s.ref && (polyPts(this.st.f, s.ref.poly)?.length ?? 0) > 3) {
      const { poly, j } = s.ref;
      del((f) => { const P = polys(f).find((x) => x.id === poly); if (P) { P.pts.splice(j, 1); P.room?.wk.splice(j, 1); } });
    }
  };

  /** A button (panel Delete, a menu item) keeps focus on itself and may vanish or hide: hand focus back so Ctrl+Z and Delete keep working. */
  private onButtonClick = (ev: Event) => {
    const el = ev.composedPath()[0] as Element;
    if (el.closest?.("button") && !el.closest("#addFloor")) this.focus({ preventScroll: true }); // "+" hands focus to its own input
  };

  /** Keys only reach a focused editor, so a highlighted selection must mean Delete works: clear it when focus leaves for good. */
  private onFocusOut = (ev: FocusEvent) => {
    const next = ev.relatedTarget as Node | null;
    if (next && (next === this || this.contains(next))) return; // into the panel or a menu (retargeted to this host)
    if (!document.hasFocus()) return; // the window lost focus; the user comes back to the same selection
    if (this.st.sel) { this.st.sel = null; this.requestUpdate(); }
  };

  private onWindowClick = (ev: MouseEvent) => {
    const path = ev.composedPath();
    this.renderRoot.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((m) => {
      if (!path.includes(m)) m.open = false;
      else if ((path[0] as Element).closest?.("button")) m.open = false;
    });
  };

  // ---- actions -------------------------------------------------------------

  private undo(back: boolean) {
    this.stopDraw();
    if (back ? this.st.undo() : this.st.redo()) { this.floor = this.st.floor; this.changed(back ? "Undone" : "Redone"); }
  }
  private centre(): Pt { const v = this.st.view; return [Math.round(v.x + v.w / 2), Math.round(v.y + v.h / 2)]; }
  /** Where a new item goes: outside the house, top right. */
  private spawn(): Pt { return spawnPoint(this.st.f, this.centre()); }
  /** Pans, without zooming, until `p` is inside what the svg shows with a 100 cm margin. */
  private ensureVisible(p: Pt) {
    const st = this.st, v = st.view, s = this.scale, hw = this.rect.w / s / 2, hh = this.rect.h / s / 2, M = 100;
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const shift = (c: number, half: number, q: number) => {
      if (half <= M) return q - c; // the view is smaller than the margin: centre on it
      if (q - M < c - half) return q - M - (c - half);
      if (q + M > c + half) return q + M - (c + half);
      return 0;
    };
    const dx = shift(cx, hw, p[0]), dy = shift(cy, hh, p[1]);
    if (dx || dy) st.views[st.floor] = { ...v, x: v.x + dx, y: v.y + dy };
  }

  // ---- draw mode ----

  /** Enters draw mode. Whatever was being drawn is dropped; the selection is cleared so no shape looks selected while drawing. */
  private startDraw(kind: DrawKind, wall: WallKind = "wall") {
    this.draw = new Draw(kind, wall);
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
    let sel: Sel = null;
    if (this.st.edit((f) => { const r = applyShape(f, floor, shape); sel = r.sel; return r.floor; })) {
      this.st.sel = sel;
      this.changed("Added the shape");
    } else this.requestUpdate();
  }

  private addDoor(kind: "door" | "window", len: number) {
    this.stopDraw();
    const c = this.centre(), e = nearestEdge(this.st.f, c, Infinity, HOST), floor = this.st.floor;
    this.commit((f) => { f.doors.push({ id: newId(f, floor, "door"), name: `new ${kind}`, kind, ...segmentAt(e ? e.q : c, e ? e.u : [1, 0], len) }); });
    this.st.sel = { t: "door", i: this.st.f.doors.length - 1 };
    this.requestUpdate();
  }
  /** An opening: a gap in a wall. Placed like a door on the edge nearest the view centre, else at the centre. */
  private addOpeningGap(len = 120) {
    this.stopDraw();
    const c = this.centre(), e = nearestEdge(this.st.f, c, Infinity, HOST), floor = this.st.floor;
    this.commit((f) => { f.openings.push({ id: newId(f, floor, "opening"), ...segmentAt(e ? e.q : c, e ? e.u : [1, 0], len) }); });
    this.st.sel = { t: "opening", i: this.st.f.openings.length - 1 };
    this.requestUpdate();
  }
  private addWall(kind: WallKind) {
    this.stopDraw();
    const p = this.spawn(), [x, y] = p, floor = this.st.floor;
    this.commit((f) => { f.walls.push({ id: newId(f, floor, "wall"), a: [x - 100, y], b: [x + 100, y], kind }); });
    this.ensureVisible(p);
    this.st.sel = { t: "wall", i: this.st.f.walls.length - 1 };
    this.requestUpdate();
  }
  private addStructure() {
    this.stopDraw();
    const p = this.spawn(), [x, y] = p, floor = this.st.floor; // top-left corner: 400 cm centred on the spawn point would reach into the house
    this.commit((f) => { f.rooms.push({ id: newId(f, floor, "room"), name: "New structure", area: slug("New structure"), label: "", kind: "structure", pts: [[x, y], [x + 400, y], [x + 400, y + 300], [x, y + 300]], wk: ["wall", "wall", "wall", "wall"] }); });
    this.ensureVisible([x + 400, y + 300]); // the whole structure, not only its corner
    this.ensureVisible(p);
    this.st.sel = { t: "room", i: this.st.f.rooms.length - 1 };
    this.requestUpdate();
  }
  private addArea(kind: "zone") {
    this.stopDraw();
    const p = this.spawn(), pts = squareAt(p), floor = this.st.floor, name = "New zone";
    this.commit((f) => { f.rooms.push({ id: newId(f, floor, "room"), name, area: slug(name), label: "", kind, pts, wk: pts.map((): WallKind => "boundary") }); });
    this.ensureVisible(p);
    this.st.sel = { t: "room", i: this.st.f.rooms.length - 1 };
    this.requestUpdate();
  }
  private addStairs() {
    this.stopDraw();
    const p = this.spawn(), floor = this.st.floor, t = stairsAt(p);
    this.commit((f) => { f.stairs.push({ id: newId(f, floor, "stairs"), ...t }); });
    this.ensureVisible(p);
    this.st.sel = { t: "stairs", i: this.st.f.stairs.length - 1 };
    this.requestUpdate();
  }
  private addFurniture(symbol: string) {
    if (!(FURNITURE_SYMBOLS as readonly string[]).includes(symbol)) return;
    this.stopDraw();
    const sym = symbol as keyof typeof FURNITURE, p = this.spawn(), [x, y] = p, floor = this.st.floor;
    this.commit((f) => { f.furniture.push({ id: newId(f, floor, "furniture"), symbol: sym, x, y, rot: 0, w: FURNITURE[sym].w, h: FURNITURE[sym].h }); });
    this.ensureVisible(p);
    this.st.sel = { t: "furn", i: this.st.f.furniture.length - 1 };
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
    let ctr = spawnPoint(st.f, this.centre());
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
  private reset() {
    if (!this.seed) return;
    if (!confirm("Discard the autosaved edit in this browser and load the starting layout? Save first if you want to keep it.")) return;
    this.applyLayout(this.seed, "Reset to the starting layout");
  }
  /** Validates first; on any problem lists them and leaves the current layout untouched. */
  private applyLayout(x: unknown, status: string) {
    const r = loadLayout(x);
    if (!r.ok) { this.errors = r.errors; this.status = "Could not use that layout"; return; }
    this.stopDraw();
    this.errors = [];
    this.st.setLayout(structuredClone(r.layout), undefined, true);
    this.floor = this.st.floor;
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

  private overlay(k: number): string {
    const st = this.st, f = st.f, s = st.sel, o: string[] = [];
    const line = (a: Pt, b: Pt, cls: string, extra = "") => `<line class="${cls}" x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}" ${extra}/>`;
    const len = (a: Pt, b: Pt) => `<text class="len" x="${num((a[0] + b[0]) / 2)}" y="${num((a[1] + b[1]) / 2)}" text-anchor="middle" font-size="${num(10 * k)}" paint-order="stroke" stroke="var(--fp-bg)" stroke-width="${num(3 * k)}">${(dist(a, b) / 100).toFixed(2)} m</text>`;
    if (s?.t === "edge") { const pts = polyPts(f, s.poly); if (pts) { const a = pts[s.i], b = pts[(s.i + 1) % pts.length]; o.push(line(a, b, "hl", 'stroke-width="4"'), len(a, b)); } }
    if (s?.t === "opening" && f.openings[s.i]) o.push(line(f.openings[s.i].a, f.openings[s.i].b, "hl", 'stroke-width="4"'));
    if (s?.t === "wall" && f.walls[s.i]) o.push(line(f.walls[s.i].a, f.walls[s.i].b, "hl", 'stroke-width="4"'));
    if (s?.t === "room" && f.rooms[s.i]) o.push(`<polygon class="hl" points="${f.rooms[s.i].pts.map((p) => `${num(p[0])},${num(p[1])}`).join(" ")}"/>`);
    if (s?.t === "stairs" && f.stairs[s.i]) o.push(`<polygon class="hl" points="${f.stairs[s.i].pts.map((p) => `${num(p[0])},${num(p[1])}`).join(" ")}"/>`);
    if (s?.t === "furn" && f.furniture[s.i]) { const m = f.furniture[s.i]; o.push(`<rect class="hl" x="-50" y="-50" width="100" height="100" transform="translate(${num(m.x)} ${num(m.y)}) rotate(${num(m.rot)}) scale(${num(m.w / 100)} ${num(m.h / 100)})"/>`); }
    if (st.showLen) {
      const P = f.outline;
      P.forEach((a, i) => o.push(len(a, P[(i + 1) % P.length])));
      f.walls.forEach((w) => o.push(len(w.a, w.b)));
    }
    f.stairs.forEach((t, i) => t.pts.forEach((p, j) => o.push(`<circle class="h" data-h="s${i}:${j}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`)));
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
    const viewBox = `${num(v.x + v.w / 2 - w / 2)} ${num(v.y + v.h / 2 - h / 2)} ${num(w)} ${num(h)}`;
    const sel = st.sel && (st.sel.t === "door" || st.sel.t === "dev") ? { t: st.sel.t, i: st.sel.i } : null;
    const body = renderFloor(f, { scale: s, selection: sel, showNames: st.showNames, filter: st.filter, editor: true }) + this.overlay(k);
    const counts: Record<string, number> = {};
    for (const d of f.devices) counts[d.type] = (counts[d.type] ?? 0) + 1;
    const unplaced = st.unplaced(), q = this.devQuery.trim().toLowerCase();
    const matches = q ? unplaced.filter((c) => c.name.toLowerCase().includes(q) || c.entity.toLowerCase().includes(q)) : unplaced;
    const pressed = (b: boolean) => (b ? "true" : "false");
    return html`
      <div class="bar">
        ${Object.entries(st.layout.floors).map(([name, fl]) => html`<button class="chip" data-f=${name} aria-pressed=${pressed(name === st.floor)} @click=${() => this.setFloor(name)}>${fl.title || name}</button>`)}
        ${this.addingFloor
          ? html`<input id="newFloor" type="text" aria-label="Title of the new floor" placeholder="Floor title" @keydown=${this.onNewFloorKey} @blur=${() => { if (document.hasFocus()) this.addingFloor = false; }}>`
          : html`<button class="chip" id="addFloor" title="Add a floor" aria-label="Add a floor" @click=${() => this.startAddFloor()}>+</button>`}
        <span class="grow"></span>
        <select id="filter" aria-label="Filter devices" .value=${st.filter} @change=${(e: Event) => { st.filter = (e.target as HTMLSelectElement).value as DeviceType | ""; st.sel = null; this.requestUpdate(); }}>
          <option value="" ?selected=${!st.filter}>Devices: all (${f.devices.length})</option>
          ${TYPE_LABELS.map(([t, label]) => html`<option value=${t} ?selected=${st.filter === t}>${label} (${counts[t] ?? 0})</option>`)}
        </select>
        <button class="chip" id="names" aria-pressed=${pressed(st.showNames)} title="Show every visible device's name on the plan" @click=${() => { st.showNames = !st.showNames; this.requestUpdate(); }}>Names</button>
        <details class="menu" id="mAdd"><summary class="btn">Add</summary><div class="box">
          <button class="btn" id="addDoor" @click=${() => this.addDoor("door", 90)}>Door</button>
          <button class="btn" id="addWin" @click=${() => this.addDoor("window", 120)}>Window</button>
          <button class="btn" id="addGap" title="A gap in a wall: the wall is not drawn there" @click=${() => this.addOpeningGap()}>Opening</button>
          ${WALL_KINDS.map((k) => html`<button class="btn" id=${`addWall-${k}`} @click=${() => this.addWall(k)}>Wall: ${WALL_LABELS[k]}</button>`)}
          <button class="btn" id="addStr" @click=${() => this.addStructure()}>Structure</button>
          <button class="btn" id="addZone" @click=${() => this.addArea("zone")}>Zone</button>
          <button class="btn" id="addStairs" @click=${() => this.addStairs()}>Stairs</button>
          <div class="sep"></div>
          <select id="addFurn" aria-label="Add furniture" @change=${(e: Event) => { const el = e.target as HTMLSelectElement; if (el.value) this.addFurniture(el.value); el.value = ""; this.closeMenus(); }}>
            <option value="">Furniture…</option>
            ${FURNITURE_SYMBOLS.map((y) => html`<option value=${y}>${y}</option>`)}
          </select>
        </div></details>
        <details class="menu" id="mDraw"><summary class="btn">Draw</summary><div class="box">
          <button class="btn" id="drawRoom" @click=${() => this.startDraw("room")}>Draw room</button>
          <button class="btn" id="drawZone" @click=${() => this.startDraw("zone")}>Draw zone</button>
          <button class="btn" id="drawWater" @click=${() => this.startDraw("water")}>Draw water</button>
          <button class="btn" id="drawOutline" title="Replaces the outline of this floor" @click=${() => this.startDraw("outline")}>Draw outline</button>
          ${WALL_KINDS.map((k) => html`<button class="btn" id=${`drawWall-${k}`} @click=${() => this.startDraw("wall", k)}>Draw wall: ${WALL_LABELS[k]}</button>`)}
          <button class="btn" id="drawOpening" @click=${() => this.startDraw("opening")}>Draw opening</button>
          <button class="btn" id="drawExtra" @click=${() => this.startDraw("extra")}>Draw structure line</button>
        </div></details>
        <details class="menu" id="mDev" @toggle=${this.onDevToggle}><summary class="btn">Device</summary><div class="box">
          <input id="devSearch" type="search" autocomplete="off" aria-label="Search devices by name or entity id" placeholder="Search name or entity" .value=${live(this.devQuery)} @input=${(e: Event) => { this.devQuery = (e.target as HTMLInputElement).value; }} @keydown=${this.onDevSearchKey}>
          ${unplaced.length === 0 ? html`<span class="grp" id="devNone">Every device in the catalog is on the plan</span>` : nothing}
          ${unplaced.length > 0 && matches.length === 0 ? html`<span class="grp" id="devNone">No device matches</span>` : nothing}
          ${TYPE_LABELS.map(([t, label]) => { const g = matches.filter((c) => c.type === t); return g.length ? html`<span class="grp">${label}</span>${g.map((c) => html`<button class="btn" data-dev=${c.id} @click=${() => this.placeDevice(c.id)}>${c.name}${c.room ? ` — ${c.room}` : ""}</button>`)}` : nothing; })}
        </div></details>
        <details class="menu" id="mOpt"><summary class="btn">View</summary><div class="box">
          <button class="chip" id="grid" aria-pressed=${pressed(st.snapGrid)} @click=${() => { st.snapGrid = !st.snapGrid; this.requestUpdate(); }}>Snap 5 cm</button>
          <button class="chip" id="lens" aria-pressed=${pressed(st.showLen)} @click=${() => { st.showLen = !st.showLen; this.requestUpdate(); }}>Lengths</button>
          <button class="btn" id="fit" @click=${() => { st.fit(); this.requestUpdate(); }}>Fit to window</button>
        </div></details>
        <details class="menu" id="mFile"><summary class="btn">File</summary><div class="box">
          <button class="btn" id="undo" ?disabled=${!st.canUndo} @click=${() => this.undo(true)}>Undo</button>
          <button class="btn" id="redo" ?disabled=${!st.canRedo} @click=${() => this.undo(false)}>Redo</button>
          <div class="sep"></div>
          <button class="btn" id="imp" @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#file")?.click()}>Open…</button>
          <button class="btn" id="reset" title="Discard the autosaved edit and go back to the starting layout" @click=${() => this.reset()}>Reset</button>
          <button class="btn primary" id="save" @click=${() => this.save()}>Save</button>
        </div></details>
        <input type="file" id="file" accept=".json,application/json" hidden @change=${(e: Event) => this.openFile(e)}>
      </div>
      ${this.errors.length ? html`<div class="errors" id="errors" role="alert"><strong>That layout was not used.</strong><ul>${this.errors.map((e) => html`<li>${e}</li>`)}</ul><button class="btn" id="errclose" @click=${() => { this.errors = []; }}>Dismiss</button></div>` : nothing}
      <div class="ed">
        <div class="canvas">
          <svg xmlns="http://www.w3.org/2000/svg" class=${this.draw ? "drawing" : ""} viewBox=${viewBox} @pointerdown=${this.onDown} @pointermove=${this.onMove} @pointerup=${this.onUp} @pointercancel=${this.onUp} @dblclick=${this.onDblClick} @contextmenu=${(e: Event) => e.preventDefault()}>${unsafeSVG(body)}</svg>
        </div>
        <aside>
          <div id="panel">${selectionPanel(this.ctx())}</div>
          <p class="hint">Snapping: corners jump to other corners, snap onto other walls and line up with their neighbours. Hold Alt to move freely. Drag a wall to move it with its neighbours. Hold Shift while dragging a corner or a wall to move it alone. Drag a room, zone or stairs by the middle to move it. Delete removes the selected corner, wall, door, opening, device, furniture or stairs. Ctrl/Cmd+Z undoes. Scroll to zoom. Pan by dragging the background, or drag anywhere with the middle button, right button or Ctrl/Cmd held.</p>
          <span class="status" id="status" role="status">${this.status}</span>
        </aside>
      </div>`;
  }

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

  private closeMenus() {
    const open = this.renderRoot.querySelectorAll<HTMLDetailsElement>("details.menu[open]");
    open.forEach((m) => { m.open = false; });
    if (open.length) this.focus({ preventScroll: true }); // the focused item just hid
  }
}

if (!customElements.get("floorplan-studio-editor")) customElements.define("floorplan-studio-editor", FloorplanStudioEditor);
declare global { interface HTMLElementTagNameMap { "floorplan-studio-editor": FloorplanStudioEditor } }
