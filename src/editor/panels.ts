import { html, nothing, type TemplateResult } from "lit";
import { DOOR_KINDS, FURNITURE_SYMBOLS, ROOM_KINDS, dist, edgeRooms, insertPoint, removePoint, toggleWall } from "../core";
import type { DeviceType, Floor } from "../core";
import { movePointAll, resizeSegment, setSecondEnd } from "./ops";
import { polyPts, ptOf, type EditorState, type Sel } from "./state";

/** Selection panels: one function per kind of selection, all pure views over the state. */

export const TYPE_LABELS: [DeviceType, string][] = [
  ["heater", "Heaters"], ["light", "Lights"], ["switch", "Wall switches"], ["plug", "Plugs"], ["temp", "Temperature"],
  ["humidity", "Humidity"], ["motion", "Motion"], ["contact", "Window / door sensor"], ["camera", "Cameras"],
  ["climate", "Climate"], ["media", "Media players"], ["cover", "Covers"], ["other", "Other"],
];

export interface PanelCtx {
  st: EditorState;
  /** One undoable edit of the current floor; autosaves and notifies the host. */
  commit(fn: (f: Floor) => Floor | void): void;
  select(s: Sel): void;
  /** Redraw without an edit. */
  refresh(): void;
}

type Input = HTMLInputElement | HTMLSelectElement;
const val = (e: Event) => (e.target as Input).value;
const numVal = (e: Event): number | null => {
  const v = (e.target as Input).value;
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

function text(label: string, id: string, value: string, on: (v: string) => void) {
  return html`<label for=${id}>${label}</label><input id=${id} type="text" .value=${value} @change=${(e: Event) => on(val(e))}>`;
}
function number(label: string, id: string, value: number | string, on: (v: number) => void) {
  return html`<label for=${id}>${label}</label><input id=${id} type="number" .value=${String(value)} @change=${(e: Event) => { const n = numVal(e); if (n !== null) on(n); }}>`;
}
function select(label: string, id: string, value: string, options: readonly string[], on: (v: string) => void) {
  return html`<label for=${id}>${label}</label><select id=${id} .value=${value} @change=${(e: Event) => on(val(e))}>${options.map((o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`)}</select>`;
}
const button = (id: string, label: string, on: () => void) => html`<button class="btn" id=${id} @click=${on}>${label}</button>`;
const hint = (t: string) => html`<p class="hint">${t}</p>`;

export function selectionPanel(c: PanelCtx): TemplateResult {
  const { st } = c, f = st.f, s = st.sel;
  if (!s) return html`<p class="hint">Nothing selected.</p>`;
  switch (s.t) {
    case "v": return cornerPanel(c, s);
    case "edge": return edgePanel(c, s);
    case "wall": return wallPanel(c, s.i);
    case "door": return f.doors[s.i] ? doorPanel(c, s.i) : html`<p class="hint">Nothing selected.</p>`;
    case "room": return f.rooms[s.i] ? roomPanel(c, s.i) : html`<p class="hint">Nothing selected.</p>`;
    case "dev": return f.devices[s.i] ? devicePanel(c, s.i) : html`<p class="hint">Nothing selected.</p>`;
    case "furn": return f.furniture[s.i] ? furniturePanel(c, s.i) : html`<p class="hint">Nothing selected.</p>`;
    case "stairs": return f.stairs[s.i] ? stairsPanel(c, s.i) : html`<p class="hint">Nothing selected.</p>`;
  }
}

function cornerPanel(c: PanelCtx, s: Extract<Sel, { t: "v" }>) {
  const p = ptOf(c.st.f, s.ref);
  if (!p) return html`<p class="hint">Nothing selected.</p>`;
  const move = (to: [number, number]) => c.commit((f) => movePointAll(f, p, to));
  const canDelete = "poly" in s.ref && (polyPts(c.st.f, s.ref.poly)?.length ?? 0) > 3;
  return html`<strong>Corner</strong>
    ${number("x (cm)", "px", p[0], (x) => move([x, p[1]]))}
    ${number("y (cm)", "py", p[1], (y) => move([p[0], y]))}
    ${"poly" in s.ref && canDelete ? html`<p>${button("delv", "Delete corner", () => { const ref = s.ref as { poly: string; j: number }; c.commit((f) => removePoint(f, ref.poly, ref.j)); c.select(null); })}</p>` : nothing}`;
}

function edgePanel(c: PanelCtx, s: Extract<Sel, { t: "edge" }>) {
  const pts = polyPts(c.st.f, s.poly);
  if (!pts) return html`<p class="hint">Nothing selected.</p>`;
  const a = pts[s.i], b = pts[(s.i + 1) % pts.length];
  const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const rooms = edgeRooms(c.st.f, s.poly, s.i);
  const set = (how: Parameters<typeof setSecondEnd>[3]) => c.commit((f) => setSecondEnd(f, a, b, how));
  return html`<strong>Wall</strong>
    ${number("length (m)", "elen", (dist(a, b) / 100).toFixed(2), (m) => set({ length: m }))}
    ${hint(`angle ${ang.toFixed(1)}°`)}
    <div class="row">${button("mkh", "Make horizontal", () => set({ axis: "h" }))}${button("mkv", "Make vertical", () => set({ axis: "v" }))}</div>
    <p>${button("addpt", "Add a point in the middle", () => { c.commit((f) => insertPoint(f, s.poly, s.i, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)])); c.select(null); })}</p>
    ${rooms.length ? html`<p>${button("wallt", rooms.some((m) => m.room.w[m.i]) ? "Make this edge a dotted boundary" : "Make this edge a wall", () => c.commit((f) => toggleWall(f, s.poly, s.i)))}</p>` : nothing}
    ${hint("The second end moves. Corners shared with other rooms move with it.")}`;
}

function wallPanel(c: PanelCtx, i: number) {
  const w = c.st.f.walls[i];
  if (!w) return html`<p class="hint">Nothing selected.</p>`;
  const set = (how: Parameters<typeof setSecondEnd>[3]) => c.commit((f) => setSecondEnd(f, w.a, w.b, how));
  return html`<strong>${w.kind === "boundary" ? "Boundary (dotted)" : "Wall"}</strong>
    ${number("length (m)", "wlen", (dist(w.a, w.b) / 100).toFixed(2), (m) => set({ length: m }))}
    <div class="row">${button("wh", "Make horizontal", () => set({ axis: "h" }))}${button("wv", "Make vertical", () => set({ axis: "v" }))}</div>
    <p>${button("wk", w.kind === "boundary" ? "Make this a wall" : "Make this a dotted boundary", () => c.commit((f) => { f.walls[i].kind = w.kind === "boundary" ? "wall" : "boundary"; }))}</p>
    <p>${button("wdel", "Delete", () => { c.commit((f) => { f.walls.splice(i, 1); }); c.select(null); })}</p>
    ${hint("Drag its ends to place it. Ends snap to corners.")}`;
}

function doorPanel(c: PanelCtx, i: number) {
  const d = c.st.f.doors[i];
  const sensors = c.st.sensorChoices(d.id);
  return html`<strong>Door / window</strong>
    ${text("name", "dn", d.name, (v) => c.commit((f) => { f.doors[i].name = v; }))}
    ${select("type", "dk", d.kind, DOOR_KINDS, (v) => c.commit((f) => { f.doors[i].kind = v as typeof d.kind; }))}
    ${number("length (cm)", "dl", Math.round(dist(d.a, d.b)), (n) => c.commit((f) => { Object.assign(f.doors[i], resizeSegment(d.a, d.b, Math.max(20, n))); }))}
    <label for="dsens">contact sensor</label>
    <select id="dsens" .value=${d.sensor ?? ""} @change=${(e: Event) => c.commit((f) => { const v = val(e); if (v) f.doors[i].sensor = v; else delete f.doors[i].sensor; })}>
      <option value="" ?selected=${!d.sensor}>none</option>
      ${sensors.map((s) => html`<option value=${s.entity} ?selected=${s.entity === d.sensor}>${s.room ? `${s.room} - ` : ""}${s.name}</option>`)}
      ${d.sensor && !sensors.some((s) => s.entity === d.sensor) ? html`<option value=${d.sensor} selected>${d.sensor}</option>` : nothing}
    </select>
    ${text("cover entity (optional)", "dcover", d.cover ?? "", (v) => c.commit((f) => { if (v.trim()) f.doors[i].cover = v.trim(); else delete f.doors[i].cover; }))}
    <label><input type="checkbox" id="dopen" .checked=${c.st.openDoor === d.id} @change=${(e: Event) => { c.st.openDoor = (e.target as HTMLInputElement).checked ? d.id : null; c.refresh(); }}> preview open</label>
    <p>${button("deld", "Delete", () => { c.commit((f) => { f.doors.splice(i, 1); }); c.select(null); })}</p>
    ${hint("Drag it along a wall. Drag an end to resize.")}`;
}

function roomPanel(c: PanelCtx, i: number) {
  const r = c.st.f.rooms[i];
  return html`<strong>Room</strong>
    ${text("name", "rn", r.name, (v) => c.commit((f) => { f.rooms[i].name = v; }))}
    ${text("area id", "ra", r.area, (v) => c.commit((f) => { f.rooms[i].area = v; }))}
    ${text("plan label", "rl", r.label, (v) => c.commit((f) => { f.rooms[i].label = v; }))}
    ${select("kind", "rk", r.kind, ROOM_KINDS, (v) => c.commit((f) => { f.rooms[i].kind = v as typeof r.kind; }))}
    <p>${button("rdel", "Delete", () => { c.commit((f) => { f.rooms.splice(i, 1); }); c.select(null); })}</p>
    ${r.kind === "structure" ? hint("Drag the body to move it. Drag corners to reshape. Click an edge to switch it between wall and dotted.") : nothing}`;
}

function devicePanel(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  const label = TYPE_LABELS.find((t) => t[0] === d.type)?.[1] ?? d.type;
  return html`<strong>${d.name ?? d.id}</strong>
    ${hint(`${label.toLowerCase()}. Its name comes from Home Assistant.`)}
    ${text("Home Assistant entity", "ve", d.entity, (v) => c.commit((f) => { f.devices[i].entity = v.trim(); }))}
    ${"a" in d ? number("length (cm)", "vl", Math.round(dist(d.a, d.b)), (n) => c.commit((f) => { Object.assign(f.devices[i], resizeSegment(d.a, d.b, Math.max(10, n))); })) : nothing}
    <p>${button("vdel", "Remove from plan", () => { c.commit((f) => { f.devices.splice(i, 1); }); c.select(null); })}</p>
    ${hint(("a" in d ? "Drag it next to a wall; it lines up parallel to it." : "Drag it to place it. Alt disables the grid.") + " Removed devices go back to Add, Device.")}`;
}

function furniturePanel(c: PanelCtx, i: number) {
  const m = c.st.f.furniture[i];
  const set = (k: "w" | "h" | "rot", min: number) => (n: number) => c.commit((f) => { f.furniture[i][k] = Math.max(min, n); });
  return html`<strong>Furniture</strong>
    ${select("symbol", "fs", m.symbol, FURNITURE_SYMBOLS, (v) => c.commit((f) => { f.furniture[i].symbol = v as typeof m.symbol; }))}
    ${number("width (cm)", "fw", m.w, set("w", 5))}
    ${number("depth (cm)", "fh", m.h, set("h", 5))}
    ${number("rotation (deg)", "fr", m.rot, (n) => c.commit((f) => { f.furniture[i].rot = ((n % 360) + 360) % 360; }))}
    <p>${button("fdel", "Delete", () => { c.commit((f) => { f.furniture.splice(i, 1); }); c.select(null); })}</p>
    ${hint("Drag it to move it. Alt disables the grid.")}`;
}

function stairsPanel(c: PanelCtx, i: number) {
  const t = c.st.f.stairs[i];
  return html`<strong>Stairs</strong>
    ${text("name", "sn", t.name, (v) => c.commit((f) => { f.stairs[i].name = v; }))}
    <p>${button("sdel", "Delete", () => { c.commit((f) => { f.stairs.splice(i, 1); }); c.select(null); })}</p>
    ${hint("Drag a corner to reshape. Click an edge to add a point in the middle.")}`;
}
