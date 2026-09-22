import { html, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { entitiesForType, inside, placedEntities } from "../core";
import { DOOR_KINDS, FLOOR_COLOURS, TEXTURES, FURNITURE_SYMBOLS, ROOM_KINDS, STAIR_SHAPES, WALL_KINDS, EDGE_KINDS, dist, edgeRooms, deleteEdge, onEdge, insertPoint, removePoint, rotatePoly, setEdgeKind, snapped, stairSteps } from "../core";
import type { CatalogEntry, DeviceType, EdgeKind, Floor, HaData, Room, RoomKind, WallKind } from "../core";
import { movePointAll, openingToWall, resizeSegment, roundStairs, rotateSegment, setSecondEnd, stairsAt, wallToOpening } from "./ops";
import { polyPts, ptOf, type EditorState, type Sel } from "./state";

/** Selection panels: one function per kind of selection, all pure views over the state. */

export const TYPE_LABELS: [DeviceType, string][] = [
  ["heater", "Heaters"], ["light", "Lights"], ["switch", "Wall switches"], ["plug", "Plugs"], ["temp", "Temperature"],
  ["humidity", "Humidity"], ["motion", "Motion"], ["contact", "Window / door sensor"], ["camera", "Cameras"],
  ["climate", "Climate"], ["ac", "Air conditioning / heat pump"], ["tv", "TV"], ["computer", "Computers"],
  ["media", "Media players"], ["cover", "Covers"], ["battery", "Batteries"], ["inverter", "Inverters"], ["server", "Servers"],
  ["access_point", "Access points"], ["lock", "Door locks"], ["vibration", "Vibration sensors"], ["other", "Other"],
];

export const WALL_LABELS: Record<EdgeKind, string> = { wall: "Internal wall", boundary: "Dotted boundary", external: "External wall", fence: "Fence", edge: "Outdoor edge", none: "Not drawn" };

export interface PanelCtx {
  st: EditorState;
  /** One undoable edit of the current floor; autosaves and notifies the host. */
  commit(fn: (f: Floor) => Floor | void): void;
  select(s: Sel): void;
  /** Paints a room, zone or staircase (colour, texture or default): one undo step; a new custom colour joins `layout.palette`. */
  paint(on: "rooms" | "stairs", i: number, paint: { color: string } | { texture: string } | null): void;
  /** S4.22: the paint panel's texture-rotation slider. `live` previews every tick, no undo step; `commit`, once at
   * release, records the whole drag as one step (none if it ended back where it started). */
  rotateTexture(on: "rooms" | "stairs", i: number, rot: number, phase: "live" | "commit"): void;
  /** S4.19: the paint panel's texture-scale slider, 25–200%. Same live/commit gesture as `rotateTexture`. */
  scaleTexture(on: "rooms" | "stairs", i: number, scale: number, phase: "live" | "commit"): void;
  /** S4.4: create a light from the selected switch or plug. Absent when there is no Home Assistant to write to. */
  makeLight?: (devIndex: number) => void;
  /** S4.3: the room whose HA area differs from the device's, when there is one, and the action that moves it there. */
  areaDiff?: (devIndex: number) => { name: string } | null;
  moveArea?: (devIndex: number) => void;
  /** Say something in the status line. */
  say(msg: string): void;
  /** Redraw without an edit. */
  refresh(): void;
  /** Floor operations of the editor: each is one undo step and reports in the status line. */
  floors: { rename(key: string, title: string): void; move(key: string, delta: number): void; remove(key: string): void };
}

type Input = HTMLInputElement | HTMLSelectElement;
const val = (e: Event) => (e.target as Input).value;
const numVal = (e: Event): number | null => {
  const v = (e.target as Input).value;
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

/** CSS that hints at a texture on its swatch: board lines for wood, a grid for stone, over the texture's base colour. */
const texturePreview = (t: { id: string; preview: string }) =>
  t.id.startsWith("wood")
    ? `background:repeating-linear-gradient(0deg,transparent 0 7px,rgba(0,0,0,.35) 7px 8px),${t.preview}`
    : `background:linear-gradient(90deg,rgba(0,0,0,.35) 1px,transparent 1px) 0 0/14px 14px,linear-gradient(rgba(0,0,0,.35) 1px,transparent 1px) 0 0/14px 14px,${t.preview}`;

/**
 * Colour, custom colours, textures and "default" for a room, zone or staircase. A colour picked on the input that is not a swatch
 * yet is added to the swatches (kept in `layout.palette`, so it is still there after a reload). `id` prefixes the element ids.
 */
function paintControls(c: PanelCtx, on: "rooms" | "stairs", i: number, id: string, shape: { color?: string; texture?: string; textureRot?: number; textureScale?: number }) {
  const cur = (shape.color ?? "").toLowerCase(), custom = c.st.layout.palette ?? [];
  const swatch = (hex: string, name: string, extra = "") => html`<button class=${`sw${extra}`} type="button" title=${name} aria-label=${name} aria-pressed=${String(!shape.texture && cur === hex)} style="background:${hex}" @click=${() => c.paint(on, i, { color: hex })}></button>`;
  return html`<label for=${`${id}col`}>colour</label><input id=${`${id}col`} type="color" .value=${shape.color ?? "#ffffff"} @change=${(e: Event) => c.paint(on, i, { color: val(e) })}>
    <div class="swatches" role="group" aria-label="Colours">${FLOOR_COLOURS.map((k) => swatch(k.hex, k.name))}${custom.map((hex) => swatch(hex, `Custom ${hex}`, " custom"))}</div>
    <div class="swatches" role="group" aria-label="Textures">${TEXTURES.map((t) => html`<button class="sw tex" type="button" title=${t.name} aria-label=${t.name} aria-pressed=${String(shape.texture === t.id)} style=${texturePreview(t)} @click=${() => c.paint(on, i, { texture: t.id })}></button>`)}</div>
    ${shape.texture ? html`<label for=${`${id}rot`}>texture rotation</label>
      <input id=${`${id}rot`} type="range" min="0" max="359" step="1" .value=${live(String(shape.textureRot ?? 0))}
        @input=${(e: Event) => c.rotateTexture(on, i, Number(val(e)), "live")}
        @change=${(e: Event) => c.rotateTexture(on, i, Number(val(e)), "commit")}>
      <span class="rot-val">${shape.textureRot ?? 0}°</span>
      <label for=${`${id}scale`}>texture scale</label>
      <input id=${`${id}scale`} type="range" min="25" max="200" step="5" .value=${live(String(Math.round((shape.textureScale ?? 1) * 100)))}
        @input=${(e: Event) => c.scaleTexture(on, i, Number(val(e)) / 100, "live")}
        @change=${(e: Event) => c.scaleTexture(on, i, Number(val(e)) / 100, "commit")}>
      <span class="rot-val">${Math.round((shape.textureScale ?? 1) * 100)}%</span>` : nothing}
    <p>${button(`${id}colx`, "Use the default colour", () => c.paint(on, i, null))}</p>`;
}

function text(label: string, id: string, value: string, on: (v: string) => void) {
  return html`<label for=${id}>${label}</label><input id=${id} type="text" .value=${value} @change=${(e: Event) => on(val(e))}>`;
}
/** A number field. It always shows what the state holds: `refresh` re-renders it after every change, so a refused or clamped value snaps back. */
function number(c: PanelCtx, label: string, id: string, value: number | string, on: (v: number) => void) {
  return html`<label for=${id}>${label}</label><input id=${id} type="number" .value=${live(String(value))} @change=${(e: Event) => { const n = numVal(e); if (n !== null) on(n); c.refresh(); }}>`;
}
/** Rotation as buttons: 30, 45, 60 or 90 more degrees in the chosen direction, and Reset to 0 when `reset` is given. `turn` gets the signed degrees. */
function rotateButtons(c: PanelCtx, id: string, turn: (deg: number) => void, opts: { reset?: () => void; disabled?: boolean } = {}) {
  const cw = c.st.turnDir === 1;
  return html`<div class="rotrow" role="group" aria-label="Turn by degrees"><span>rotation</span>
    <button class="btn" id=${`${id}dir`} aria-pressed=${cw ? "false" : "true"} @click=${() => { c.st.turnDir = cw ? -1 : 1; c.refresh(); }}>${cw ? "clockwise" : "counter-clockwise"}</button>
    ${[30, 45, 60, 90].map((n) => html`<button class="btn" id=${`${id}${n}`} ?disabled=${opts.disabled} aria-label=${`Turn ${n} degrees ${cw ? "clockwise" : "counter-clockwise"}`} @click=${() => turn(c.st.turnDir * n)}>${n}</button>`)}
    ${opts.reset ? html`<button class="btn" id=${`${id}reset`} @click=${opts.reset}>Reset</button>` : nothing}</div>`;
}
function select(label: string, id: string, value: string, options: readonly string[], on: (v: string) => void) {
  return html`<label for=${id}>${label}</label><select id=${id} .value=${value} @change=${(e: Event) => on(val(e))}>${options.map((o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`)}</select>`;
}
export const ROOM_LABELS: Record<RoomKind, string> = { room: "Room", garden: "Garden", pavement: "Pavement", fill: "Fill", terrace: "Terrace", structure: "Structure", zone: "Zone", water: "Water" };
const kindSelect = (value: string, on: (v: string) => void) =>
  html`<label for="rk">kind</label><select id="rk" .value=${value} @change=${(e: Event) => on(val(e))}>${ROOM_KINDS.map((k) => html`<option value=${k} ?selected=${k === value}>${ROOM_LABELS[k]}</option>`)}</select>`;
/** `cls` adds a style: `warn` (orange) for what deletes an item, `danger` (red) for what deletes a floor or resets everything. */
const button = (id: string, label: string, on: () => void, cls = "") => html`<button class=${cls ? `btn ${cls}` : "btn"} id=${id} @click=${on}>${label}</button>`;
/** The angle of a segment a-b in degrees, 0 to 360, clockwise on screen, to 0.1. */
const angleOf = (a: [number, number], b: [number, number]) => Math.round((((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 360) % 360) * 10) / 10 % 360;
const hint = (t: string) => html`<p class="hint">${t}</p>`;

// ---- Home Assistant pickers (S1.38): with HA data a name is chosen, not typed ----
const byName = <T extends { name: string }>(l: readonly T[]) => [...l].sort((a, b) => a.name.localeCompare(b.name));
const NOT_IN_HA = "Home Assistant does not have this one. Pick another, or leave it.";
/** The id the layout holds but HA does not know: kept as the selected option, never cleared. */
const missingOpt = (id: string) => html`<option value=${id} selected>${id} (not in Home Assistant)</option>`;
/** A select of "(none)" plus every HA entity, grouped by domain; without HA data, a text field that takes an entity id or nothing. */
function entityField(c: PanelCtx, id: string, label: string, cur: string | undefined, none: string, on: (v: string | undefined) => void) {
  const ha = c.st.ha;
  if (!ha) {
    return text(label, id, cur ?? "", (v) => {
      const t = v.trim();
      if (!t) on(undefined);
      else if (t.includes(".")) on(t);
      else { c.say("An entity id looks like sensor.pond"); c.refresh(); }
    });
  }
  const domains = [...new Set(ha.entities.map((e) => e.domain))].sort();
  const unknown = !!cur && !ha.entities.some((e) => e.id === cur);
  return html`<label for=${id}>${label}</label><select id=${id} .value=${live(cur ?? "")} @change=${(e: Event) => on(val(e) || undefined)}>
      <option value="" ?selected=${!cur}>${none}</option>
      ${domains.map((d) => html`<optgroup label=${d}>${byName(ha.entities.filter((e) => e.domain === d)).map((e) => html`<option value=${e.id} title=${e.id} ?selected=${e.id === cur}>${e.name}</option>`)}</optgroup>`)}
      ${unknown ? missingOpt(cur!) : nothing}
    </select>${unknown ? hint(NOT_IN_HA) : nothing}`;
}

export function selectionPanel(c: PanelCtx): TemplateResult {
  const { st } = c, f = st.f, s = st.sel;
  if (!s) return floorPanel(c);
  switch (s.t) {
    case "v": return cornerPanel(c, s);
    case "edge": return edgePanel(c, s);
    case "wall": return wallPanel(c, s.i);
    case "extra": return f.extras[s.i] ? extraPanel(c, s.i) : html`<p class="hint">Nothing selected.</p>`;
    case "opening": return f.openings[s.i] ? openingPanel(c, s.i) : html`<p class="hint">Nothing selected.</p>`;
    case "door": return f.doors[s.i] ? doorPanel(c, s.i) : html`<p class="hint">Nothing selected.</p>`;
    case "room": return f.rooms[s.i] ? roomPanel(c, s.i) : html`<p class="hint">Nothing selected.</p>`;
    case "dev": return f.devices[s.i] ? devicePanel(c, s.i) : html`<p class="hint">Nothing selected.</p>`;
    case "furn": return f.furniture[s.i] ? furniturePanel(c, s.i) : html`<p class="hint">Nothing selected.</p>`;
    case "stairs": return f.stairs[s.i] ? stairsPanel(c, s.i) : html`<p class="hint">Nothing selected.</p>`;
  }
}

/** Shown when nothing is selected: the current floor. */
function floorPanel(c: PanelCtx) {
  const { st } = c, key = st.floor, keys = Object.keys(st.layout.floors), i = keys.indexOf(key), title = st.f.title || key;
  return html`<strong>Floor</strong>
    ${hint("Nothing selected. Click something on the plan to edit it.")}
    ${st.ha ? floorLink(c, st.ha) : nothing}
    ${!st.ha || !st.f.ha ? html`<label for="ft">floor title</label>
    <input id="ft" type="text" .value=${live(st.f.title)} @change=${(e: Event) => { c.floors.rename(key, val(e)); c.refresh(); }}>` : nothing}
    <div class="row">
      <button class="btn" id="fup" title="Higher floor: later in the chips" ?disabled=${i < 0 || i >= keys.length - 1} @click=${() => c.floors.move(key, 1)}>Move up</button>
      <button class="btn" id="fdown" title="Lower floor: earlier in the chips" ?disabled=${i <= 0} @click=${() => c.floors.move(key, -1)}>Move down</button>
    </div>
    ${st.confirmDelete
      ? html`<p id="fconfirm" role="alert">Delete floor ${title} and everything on it?</p>
        <div class="row">${button("fdelyes", "Delete", () => c.floors.remove(key), "danger")}${button("fdelno", "Cancel", () => { st.confirmDelete = false; c.refresh(); })}</div>`
      : html`<p><button class="btn danger" id="fdel" ?disabled=${keys.length < 2} title=${keys.length < 2 ? "The last floor cannot be deleted" : "Delete this floor"} @click=${() => { st.confirmDelete = true; c.refresh(); }}>Delete floor</button></p>`}
    ${hint("A new floor starts with the outline and the stairs of the first floor. Delete a floor to start again with a clean one.")}
    ${hint("Devices on a deleted floor stay in the catalog and go back to the Device menu.")}
    ${unboundList(c)}`;
}

/** Devices of this floor with no entity, as buttons that select them; nothing when there are none. */
function unboundList(c: PanelCtx) {
  const list = c.st.f.devices.map((d, i) => ({ d, i })).filter((x) => x.d.entity === "");
  if (!list.length) return nothing;
  return html`<div id="unbound"><strong>Needs an entity (${list.length})</strong>
    <div class="row">${list.map(({ d, i }) => html`<button class="btn" data-unbound=${i} @click=${() => c.select({ t: "dev", i })}>${d.name ?? d.id}</button>`)}</div></div>`;
}

/** The HA floor this floor is. Choosing one writes the id and the name HA gave it; "(not linked)" keeps the title and brings the text field back. */
function floorLink(c: PanelCtx, ha: HaData) {
  const cur = c.st.f.ha ?? "", unknown = !!cur && !ha.floors.some((x) => x.id === cur);
  const pick = (id: string) => c.commit((f) => {
    const hit = ha.floors.find((x) => x.id === id);
    if (hit) { f.ha = hit.id; f.title = hit.name; } else delete f.ha;
  });
  return html`<label for="fha">Home Assistant floor</label><select id="fha" .value=${live(cur)} @change=${(e: Event) => pick(val(e))}>
      <option value="" ?selected=${!cur}>(not linked)</option>
      ${byName(ha.floors).map((x) => html`<option value=${x.id} ?selected=${x.id === cur}>${x.name}</option>`)}
      ${unknown ? missingOpt(cur) : nothing}
    </select>${unknown ? hint(NOT_IN_HA) : nothing}`;
}

function cornerPanel(c: PanelCtx, s: Extract<Sel, { t: "v" }>) {
  const p = ptOf(c.st.f, s.ref);
  if (!p) return html`<p class="hint">Nothing selected.</p>`;
  const move = (to: [number, number]) => c.commit((f) => movePointAll(f, p, to, false, s.ref));
  const canDelete = "poly" in s.ref && (polyPts(c.st.f, s.ref.poly)?.length ?? 0) > 3;
  return html`<strong>Corner</strong>
    ${number(c, "x (cm)", "px", p[0], (x) => move([x, p[1]]))}
    ${number(c, "y (cm)", "py", p[1], (y) => move([p[0], y]))}
    ${"poly" in s.ref && canDelete ? html`<p>${button("delv", "Delete corner", () => { const ref = s.ref as { poly: string; j: number }; c.commit((f) => removePoint(f, ref.poly, ref.j)); c.select(null); }, "warn")}</p>` : nothing}`;
}

/** Delete for a room edge: it stops being drawn, on every room that shares it. A door or window on it asks first. */
function edgeDelete(c: PanelCtx, s: Extract<Sel, { t: "edge" }>, a: [number, number], b: [number, number]) {
  const key = `${s.poly}:${s.i}`, on = onEdge(c.st.f, a, b), n = on.doors.length + on.openings.length;
  const remove = () => { c.st.confirmEdge = null; c.commit((f) => deleteEdge(f, s.poly, s.i)); };
  if (c.st.confirmEdge === key && n)
    return html`<p class="hint">${n === 1 ? "A door or window is on this edge." : `${n} doors and windows are on this edge.`} They stay. Stop drawing the edge?</p>
      <div class="row">${button("edelyes", "Delete", remove, "warn")}${button("edelno", "Cancel", () => { c.st.confirmEdge = null; c.refresh(); })}</div>`;
  return html`<p>${button("edel", "Delete", n ? () => { c.st.confirmEdge = key; c.refresh(); } : remove, "warn")}</p>`;
}

function edgePanel(c: PanelCtx, s: Extract<Sel, { t: "edge" }>) {
  const pts = polyPts(c.st.f, s.poly);
  if (!pts) return html`<p class="hint">Nothing selected.</p>`;
  const a = pts[s.i], b = pts[(s.i + 1) % pts.length];
  const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const rooms = edgeRooms(c.st.f, s.poly, s.i);
  const isOutline = s.poly === "o"; // S1.52: the house perimeter has its own kind, editable even with no room on it
  const end = { poly: s.poly, j: (s.i + 1) % pts.length };
  const set = (how: Parameters<typeof setSecondEnd>[3]) => c.commit((f) => setSecondEnd(f, a, b, how, end));
  const kind = rooms[0]?.room.wk[rooms[0].i] ?? (isOutline ? (c.st.f.owk?.[s.i] ?? "external") : "wall"); // rooms that disagree show the first one's kind
  const editable = rooms.length > 0 || isOutline;
  return html`<strong>${WALL_LABELS[kind] ?? "Wall"}</strong>
    ${number(c, "length (m)", "elen", (dist(a, b) / 100).toFixed(2), (m) => set({ length: m }))}
    ${hint(`angle ${ang.toFixed(1)}°`)}
    <div class="row">${button("mkh", "Make horizontal", () => set({ axis: "h" }))}${button("mkv", "Make vertical", () => set({ axis: "v" }))}</div>
    <p>${button("addpt", "Add a point in the middle", () => { c.commit((f) => insertPoint(f, s.poly, s.i, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)])); c.select(null); })}</p>
    ${editable ? html`<label for="ek">kind</label><select id="ek" .value=${kind} @change=${(e: Event) => c.commit((f) => setEdgeKind(f, s.poly, s.i, val(e) as EdgeKind))}>${EDGE_KINDS.map((k) => html`<option value=${k} ?selected=${k === kind}>${WALL_LABELS[k]}</option>`)}</select>` : nothing}
    ${editable && kind !== "none" ? edgeDelete(c, s, a, b) : nothing}
    ${hint("The second end moves. Corners shared with other rooms move with it.")}`;
}

function wallPanel(c: PanelCtx, i: number) {
  const w = c.st.f.walls[i];
  if (!w) return html`<p class="hint">Nothing selected.</p>`;
  const set = (how: Parameters<typeof setSecondEnd>[3]) => c.commit((f) => {
    const g = setSecondEnd(f, w.a, w.b, how, { k: "walls", i, end: "b" });
    if ("length" in how) g.walls[i].locked = true; // typing a length locks the wall, by default
    return g;
  });
  return html`<strong>${WALL_LABELS[w.kind] ?? "Wall"}</strong>
    ${number(c, "length (m)", "wlen", (dist(w.a, w.b) / 100).toFixed(2), (m) => set({ length: m }))}
    <div class="row">${button("wh", "Make horizontal", () => set({ axis: "h" }))}${button("wv", "Make vertical", () => set({ axis: "v" }))}</div>
    ${lockField(c, "wlock", "walls", i)}
    ${angleField(c, "wrot", "walls", i)}
    <label for="wk">kind</label><select id="wk" .value=${live(w.kind)} @change=${(e: Event) => {
      const v = val(e);
      if (v !== "opening") { c.commit((f) => { f.walls[i].kind = v as WallKind; }); return; }
      if (dist(w.a, w.b) === 0) { c.say("A wall of zero length cannot become an opening"); c.refresh(); return; }
      c.commit((f) => wallToOpening(f, i, c.st.floor));
      c.select({ t: "opening", i: c.st.f.openings.length - 1 });
    }}>${WALL_KINDS.map((k) => html`<option value=${k} ?selected=${k === w.kind}>${WALL_LABELS[k]}</option>`)}<option value="opening">Opening (a gap in the wall)</option></select>
    <p>${button("wdel", "Delete", () => { c.commit((f) => { f.walls.splice(i, 1); }); c.select(null); }, "warn")}</p>
    ${hint("Drag its ends to place it. Ends snap to corners.")}`;
}

/** S4.13: a structure line (a free-standing annotation like "boiler + tank" - not a wall, not a room edge). Name and length only; no kind. */
function extraPanel(c: PanelCtx, i: number) {
  const x = c.st.f.extras[i];
  if (!x) return html`<p class="hint">Nothing selected.</p>`;
  return html`<strong>Structure line</strong>
    ${text("name", "exn", x.name, (v) => c.commit((f) => { f.extras[i].name = v; }))}
    ${hint(`length ${(dist(x.a, x.b) / 100).toFixed(2)} m`)}
    <p>${button("exdel", "Delete", () => { c.commit((f) => { f.extras.splice(i, 1); }); c.select(null); }, "warn")}</p>
    ${hint("Drag its ends to resize it, or drag the middle to move it.")}`;
}

/**
 * "length locked" (S4.9): a wall, door or opening whose length is fixed. Dragging one of its ends then only
 * pivots it, on an arc of that length, around the other end. Typing a length (see `number` callers below)
 * locks a segment that was not locked yet; unticking frees it for an ordinary, length-changing drag.
 */
function lockField(c: PanelCtx, id: string, list: "walls" | "doors" | "openings", i: number) {
  const locked = !!c.st.f[list][i].locked;
  return html`<label><input type="checkbox" id=${id} .checked=${locked} @change=${(e: Event) => c.commit((f) => { f[list][i].locked = (e.target as HTMLInputElement).checked; })}> length locked</label>`;
}

/** "angle (deg)": turns wall, door or opening `i` about its midpoint to the typed angle. Same angle, or rubbish: nothing. */
function angleField(c: PanelCtx, id: string, list: "walls" | "doors" | "openings", i: number) {
  const o = c.st.f[list][i], cur = angleOf(o.a, o.b);
  return number(c, "angle (deg)", id, cur, (n) => {
    const delta = n - cur;
    if (Math.abs(delta) < 0.05) return;
    c.commit((f) => { Object.assign(f[list][i], rotateSegment(o.a, o.b, delta)); });
  });
}

/**
 * S4.24: "attach several entities, filtered by type" — one add-select of catalog entries not yet attached, plus
 * one row with a remove button per entity already attached. Shared by door sensors/vibration/locks and the
 * heater/ac bindings below, so this UI is written once and every caller stays in step.
 */
function multiAttachField(c: PanelCtx, id: string, label: string, cur: string[], choices: CatalogEntry[], set: (next: string[]) => void) {
  const nameOf = (entity: string) => { const e = c.st.layout.catalog.find((x) => x.entity === entity); return e ? (e.room ? `${e.room} - ${e.name}` : e.name) : entity; };
  const avail = choices.filter((s) => !cur.includes(s.entity));
  const add = (e: Event) => { const v = val(e); if (v) set([...cur, v]); };
  return html`<label for=${id}>${label}</label>
    <select id=${id} .value=${live("")} @change=${add}>
      <option value="" selected>add...</option>
      ${avail.map((s) => html`<option value=${s.entity}>${s.room ? `${s.room} - ` : ""}${s.name}</option>`)}
    </select>
    ${cur.map((en, k) => html`<p class="attach-row">${nameOf(en)} ${button(`${id}-rm${k}`, "Remove", () => set(cur.filter((x) => x !== en)), "warn")}</p>`)}`;
}

function doorPanel(c: PanelCtx, i: number) {
  const d = c.st.f.doors[i];
  const setList = (field: "sensors" | "vibration" | "locks") => (next: string[]) => c.commit((f) => { if (next.length) f.doors[i][field] = next; else delete f.doors[i][field]; });
  // `cover` is general purpose (a garage door's roller shutter is one too, kind "door") and stays offered on
  // every kind, same as before S4.24 — it doubles as the electric-curtain dropdown on a glass door or window.
  const coverLabel = d.kind === "glass" || d.kind === "window" ? "electric curtain" : "cover";
  return html`<strong>Door / window</strong>
    ${text("name", "dn", d.name, (v) => c.commit((f) => { f.doors[i].name = v; }))}
    ${select("type", "dk", d.kind, DOOR_KINDS, (v) => c.commit((f) => { f.doors[i].kind = v as typeof d.kind; }))}
    ${number(c, "length (cm)", "dl", Math.round(dist(d.a, d.b)), (n) => c.commit((f) => { Object.assign(f.doors[i], resizeSegment(d.a, d.b, Math.max(20, n))); f.doors[i].locked = true; }))}
    ${lockField(c, "dlock", "doors", i)}
    ${angleField(c, "drot", "doors", i)}
    ${multiAttachField(c, "dsens", "contact sensors", d.sensors ?? [], c.st.doorAttachChoices(d.id, "sensors"), setList("sensors"))}
    ${multiAttachField(c, "dvibr", "vibration sensors", d.vibration ?? [], c.st.doorAttachChoices(d.id, "vibration"), setList("vibration"))}
    ${multiAttachField(c, "dlocks", "smart locks", d.locks ?? [], c.st.doorAttachChoices(d.id, "locks"), setList("locks"))}
    <label for="dcover">${coverLabel}</label>
    <select id="dcover" .value=${d.cover ?? ""} @change=${(e: Event) => c.commit((f) => { const v = val(e); if (v) f.doors[i].cover = v; else delete f.doors[i].cover; })}>
      <option value="" ?selected=${!d.cover}>none</option>
      ${c.st.coverChoices(d.id).map((s) => html`<option value=${s.entity} ?selected=${s.entity === d.cover}>${s.room ? `${s.room} - ` : ""}${s.name}</option>`)}
      ${d.cover && !c.st.coverChoices(d.id).some((s) => s.entity === d.cover) ? html`<option value=${d.cover} selected>${d.cover}</option>` : nothing}
    </select>
    <label><input type="checkbox" id="dopen" .checked=${c.st.openDoor === d.id} @change=${(e: Event) => { c.st.openDoor = (e.target as HTMLInputElement).checked ? d.id : null; c.refresh(); }}> preview open</label>
    <p>${button("deld", "Delete", () => { c.commit((f) => { f.doors.splice(i, 1); }); c.select(null); }, "warn")}</p>
    ${hint("Drag it along a wall. Drag an end to resize.")}`;
}

function openingPanel(c: PanelCtx, i: number) {
  const o = c.st.f.openings[i];
  const toWall = (e: Event) => {
    const v = val(e);
    if (v === "opening") return;
    if (dist(o.a, o.b) === 0) { c.say("An opening of zero length cannot become a wall"); c.refresh(); return; }
    c.commit((f) => openingToWall(f, i, v as WallKind, c.st.floor));
    c.select({ t: "wall", i: c.st.f.walls.length - 1 });
  };
  return html`<strong>Opening</strong>
    <label for="ok">kind</label><select id="ok" .value=${live("opening")} @change=${toWall}><option value="opening" selected>Opening</option>${WALL_KINDS.map((k) => html`<option value=${k}>${WALL_LABELS[k]}</option>`)}</select>
    ${number(c, "length (cm)", "ol", Math.round(dist(o.a, o.b)), (n) => c.commit((f) => { Object.assign(f.openings[i], resizeSegment(o.a, o.b, Math.max(20, n))); f.openings[i].locked = true; }))}
    ${lockField(c, "olock", "openings", i)}
    ${angleField(c, "orot", "openings", i)}
    <p>${button("odel", "Delete", () => { c.commit((f) => { f.openings.splice(i, 1); }); c.select(null); }, "warn")}</p>
    ${hint("Drag an end to resize or move it. A gap hides the wall under it.")}`;
}

function roomPanel(c: PanelCtx, i: number) {
  const r = c.st.f.rooms[i];
  return html`<strong>Room</strong>
    ${c.st.ha ? roomLink(c, c.st.ha, i) : html`${text("name", "rn", r.name, (v) => c.commit((f) => { f.rooms[i].name = v; }))}
    ${text("area id", "ra", r.area, (v) => c.commit((f) => { f.rooms[i].area = v; }))}
    ${r.area ? nothing : entityField(c, "rent", "shows the state of", r.entity, "(none)", (v) => c.commit((f) => { setOrDelete(f.rooms[i], "entity", v); }))}`}
    ${text("plan label", "rl", r.label, (v) => c.commit((f) => { f.rooms[i].label = v; }))}
    ${kindSelect(r.kind, (v) => c.commit((f) => {
      const room = f.rooms[i];
      if (room.kind === v) return;
      room.kind = v as typeof r.kind;
      if (v === "zone") room.wk = room.pts.map((): WallKind => "boundary"); // a zone has no wall edge
    }))}
    ${roomTurn(c, i)}
    ${paintControls(c, "rooms", i, "r", r)}
    <p>${button("rdel", "Delete", () => { c.commit((f) => { f.rooms.splice(i, 1); }); c.select(null); }, "warn")}</p>
    ${r.kind === "zone" ? hint("A zone is a dotted area inside a room. Give it an area id to map it to a Home Assistant area. Drag corners to reshape.") : nothing}
    ${r.kind === "structure" ? hint("Drag the body to move it. Drag corners to reshape. Select an edge and choose its kind.") : nothing}`;
}

const setOrDelete = <T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined) => { if (v === undefined || v === "") delete o[k]; else o[k] = v; };

/** Room, zone or water name: an HA area (id and name written together), or a custom shape with a plan name and maybe one entity. */
function roomLink(c: PanelCtx, ha: HaData, i: number) {
  const r = c.st.f.rooms[i], key = c.st.floor;
  const used = new Set<string>();
  for (const [fk, fl] of Object.entries(c.st.layout.floors)) fl.rooms.forEach((o: Room, j: number) => { if (o.area && !(fk === key && j === i)) used.add(o.area); });
  const areas = byName(ha.areas), free = areas.filter((a) => !used.has(a.id)), taken = areas.filter((a) => used.has(a.id));
  const unknown = !!r.area && !areas.some((a) => a.id === r.area);
  const norm = (t: string) => t.trim().toLowerCase();
  const hits = !r.area || unknown ? areas.filter((a) => r.name.trim() && norm(a.name) === norm(r.name)) : [];
  const pick = (id: string) => {
    const hit = ha.areas.find((a) => a.id === id);
    c.commit((f) => {
      const room = f.rooms[i];
      if (hit) { room.area = hit.id; room.name = hit.name; delete room.entity; } else room.area = "";
    });
    if (hit && used.has(hit.id)) c.say(`${hit.name} is already on the plan`);
  };
  const opt = (a: { id: string; name: string }) => html`<option value=${a.id} ?selected=${a.id === r.area}>${a.name}</option>`;
  return html`${hits.length === 1 ? html`<p><button class="btn" id="rmatch" @click=${() => pick(hits[0].id)}>Link to the Home Assistant area ${hits[0].name}</button></p>` : nothing}
    <label for="ra">area</label><select id="ra" .value=${live(r.area)} @change=${(e: Event) => pick(val(e))}>
      <option value="" ?selected=${!r.area}>(no area — custom)</option>
      ${free.map(opt)}
      ${taken.length ? html`<optgroup label="Already on the plan">${taken.map(opt)}</optgroup>` : nothing}
      ${unknown ? missingOpt(r.area) : nothing}
    </select>${unknown ? hint(NOT_IN_HA) : nothing}
    ${r.area ? nothing : html`${text("plan name", "rn", r.name, (v) => c.commit((f) => { f.rooms[i].name = v; }))}
    ${entityField(c, "rent", "shows the state of", r.entity, "(none)", (v) => c.commit((f) => { setOrDelete(f.rooms[i], "entity", v); }))}`}`;
}

/** Rotation of a room or zone (a turn, in degrees, about its middle) and the Unsnap toggle. A room that still shares a corner cannot turn. */
function roomTurn(c: PanelCtx, i: number) {
  const r = c.st.f.rooms[i], id = `r${i}`;
  const free = r.free === true, locked = !free && snapped(c.st.f, id);
  return html`${rotateButtons(c, "rrot", (n) => c.commit((f) => rotatePoly(f, id, n)), { disabled: locked })}
    <p>${button("runsnap", free ? "Snap back" : "Unsnap", () => c.commit((f) => { if (free) delete f.rooms[i].free; else f.rooms[i].free = true; }))}</p>
    ${free ? hint("Unsnapped: this room no longer joins its neighbours.") : locked ? hint("This room shares a corner with a neighbour. Unsnap it to rotate.") : nothing}`;
}

function devicePanel(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  const label = TYPE_LABELS.find((t) => t[0] === d.type)?.[1] ?? d.type;
  return html`<strong>${d.name ?? d.id}</strong>
    ${hint(`${label.toLowerCase()}. Its name comes from Home Assistant.`)}
    ${deviceTypeField(c, i)}
    ${deviceEntity(c, i)}
    ${rotateButtons(c, "vrot", (n) => c.commit((f) => { const r = (((d.rot ?? 0) + n) % 360 + 360) % 360; if (r) f.devices[i].rot = r; else delete f.devices[i].rot; }), { reset: () => { if (d.rot) c.commit((f) => { delete f.devices[i].rot; }); } })}
    ${d.type === "camera" ? hint("The cone shows a 120 degree field of view, 1 m deep.") : nothing}
    ${d.type === "light" ? boundField(c, i) : nothing}
    ${d.type === "heater" ? heaterFields(c, i) : nothing}
    ${d.type === "ac" ? acField(c, i) : nothing}
    ${"a" in d ? number(c, "length (cm)", "vl", Math.round(dist(d.a, d.b)), (n) => c.commit((f) => { Object.assign(f.devices[i], resizeSegment(d.a, d.b, Math.max(10, n))); })) : nothing}
    ${areaDiffField(c, i)}
    ${c.makeLight && c.st.canMakeLight(i) ? html`<p>${button("vmklight", "Create a light from this switch", () => c.makeLight!(i))}</p>${hint("Home Assistant gets a new light that wraps this switch. The plan then shows the light.")}` : nothing}
    <p>${button("vdel", "Remove from plan", () => { c.commit((f) => { f.devices.splice(i, 1); }); c.select(null); }, "warn")}</p>
    ${hint(("a" in d ? "Drag it next to a wall; it lines up parallel to it." : "Drag it to place it. Alt disables the grid.") + " Removed devices go back to the Device menu.")}`;
}

/**
 * S4.18: corrects a device's type, whatever set it wrong (a guess from the area's entity list, or a bad catalog
 * entry) — there was previously no way to fix one once placed. Changing away from a type drops the fields only that
 * type uses (`bound` for light, `trvs`/`tempSensors` for heater, `linked` for ac), in the same undo step, so the
 * layout stays valid and the panel never shows a field for the wrong type.
 */
function deviceTypeField(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  const set = (t: string) => c.commit((f) => {
    const dv = f.devices[i];
    dv.type = t as DeviceType;
    if (t !== "light") delete dv.bound;
    if (t !== "heater") { delete dv.trvs; delete dv.tempSensors; }
    if (t !== "ac") delete dv.linked;
  });
  return html`<label for="vtype">type</label><select id="vtype" .value=${d.type} @change=${(e: Event) => set(val(e))}>
    ${TYPE_LABELS.map(([t, lbl]) => html`<option value=${t} ?selected=${t === d.type}>${lbl}</option>`)}
  </select>`;
}

/** The device sits in a room whose HA area is not the one HA has it in: say so, and offer the move (asked again even after "don't ask"). */
function areaDiffField(c: PanelCtx, i: number) {
  const diff = c.areaDiff?.(i);
  return diff && c.moveArea ? html`${hint(`Home Assistant has it in another area than ${diff.name}.`)}<p>${button("vmovearea", `Move it to ${diff.name} in Home Assistant`, () => c.moveArea!(i))}</p>` : nothing;
}

/**
 * The device's Home Assistant entity. With HA data it is a select: the entities that suit the device's type, those in the room's area first,
 * then everything else, so nothing is out of reach. Entities already placed on the plan are left out. It can attach an unbound device, switch a bound one to another, and go back to
 * "not connected" (entity ""). An id HA does not know stays as the selected option. Without HA data it stays a text field.
 */
function deviceEntity(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i], ha = c.st.ha;
  const set = (v: string) => c.commit((f) => { f.devices[i].entity = v.trim(); });
  if (!ha) return text("Home Assistant entity", "ve", d.entity, set);
  const at: [number, number] = "a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y];
  const room = c.st.f.rooms.find((r) => r.area && (r.kind === "room" || r.kind === "structure") && inside(at, r.pts));
  // An entity already on the plan is not offered again, except this device's own.
  const placed = placedEntities(c.st.layout);
  const { match, rest } = entitiesForType({ ...ha, entities: ha.entities.filter((e) => e.id === d.entity || !placed.has(e.id)) }, d.type);
  const here = room ? match.filter((e) => e.area === room.area) : [], elsewhere = match.filter((e) => !here.includes(e));
  const opts = (l: HaData["entities"]) => byName(l).map((e) => html`<option value=${e.id} title=${e.id} ?selected=${e.id === d.entity}>${e.name}</option>`);
  const unknown = !!d.entity && !ha.entities.some((e) => e.id === d.entity);
  const label = TYPE_LABELS.find((t) => t[0] === d.type)?.[1] ?? d.type;
  return html`<label for="ve">Home Assistant entity</label>
    <select id="ve" .value=${live(d.entity)} @change=${(e: Event) => set(val(e))}>
      <option value="" ?selected=${!d.entity}>(not connected)</option>
      ${here.length ? html`<optgroup label=${`In ${room!.name}`}>${opts(here)}</optgroup>` : nothing}
      ${elsewhere.length ? html`<optgroup label=${here.length ? "Elsewhere" : label}>${opts(elsewhere)}</optgroup>` : nothing}
      ${rest.length ? html`<optgroup label="Everything else">${opts(rest)}</optgroup>` : nothing}
      ${unknown ? missingOpt(d.entity) : nothing}
    </select>${unknown ? hint(NOT_IN_HA) : nothing}${d.entity ? nothing : hint("Not connected to Home Assistant yet. Pick its entity.")}`;
}

/** "Controlled by": the switch or plug that powers a light. Written as `bound`, the key is deleted for none. */
function boundField(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  const choices = c.st.bindChoices(i);
  const nameOf = (entity: string) => c.st.layout.catalog.find((x) => x.entity === entity)?.name ?? entity;
  const set = (e: Event) => c.commit((f) => { const v = val(e); if (v) f.devices[i].bound = v; else delete f.devices[i].bound; });
  return html`<label for="vbound">Controlled by</label>
    <select id="vbound" .value=${d.bound ?? ""} @change=${set}>
      <option value="" ?selected=${!d.bound}>(none)</option>
      ${choices.map((s) => html`<option value=${s.entity} ?selected=${s.entity === d.bound}>${s.room ? `${s.room} - ` : ""}${s.name}</option>`)}
      ${d.bound && !choices.some((s) => s.entity === d.bound) ? html`<option value=${d.bound} selected>${d.bound}</option>` : nothing}
    </select>
    ${d.bound ? hint(`${d.name ?? nameOf(d.entity)} + ${nameOf(d.bound)}`) : nothing}`;
}

/** S4.24: a heater attaches several TRV/climate entities and several temperature sensors — design interview,
 * 2026-09-22: this is the whole scope, no open-window cutoff. */
function heaterFields(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  const setList = (field: "trvs" | "tempSensors") => (next: string[]) => c.commit((f) => { if (next.length) f.devices[i][field] = next; else delete f.devices[i][field]; });
  return html`${multiAttachField(c, "htrv", "TRVs", d.trvs ?? [], c.st.deviceAttachChoices(i, "trvs"), setList("trvs"))}
    ${multiAttachField(c, "hsens", "temperature sensors", d.tempSensors ?? [], c.st.deviceAttachChoices(i, "tempSensors"), setList("tempSensors"))}`;
}

/** S4.24: an ac attaches several AC-or-TRV entities to one list. */
function acField(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  const set = (next: string[]) => c.commit((f) => { if (next.length) f.devices[i].linked = next; else delete f.devices[i].linked; });
  return multiAttachField(c, "aclink", "AC / TRV entities", d.linked ?? [], c.st.deviceAttachChoices(i, "linked"), set);
}

function furniturePanel(c: PanelCtx, i: number) {
  const m = c.st.f.furniture[i];
  // S1.51: width and depth are clamped to the same 5..2000 cm bounds the corner drag and validate() hold.
  const setSize = (k: "w" | "h") => (n: number) => c.commit((f) => { f.furniture[i][k] = Math.min(2000, Math.max(5, n)); });
  return html`<strong>Furniture</strong>
    ${text("plan name", "fun", m.name ?? "", (v) => c.commit((f) => { setOrDelete(f.furniture[i], "name", v.trim()); }))}
    ${entityField(c, "fuent", "shows the state of", m.entity, "(none)", (v) => c.commit((f) => { setOrDelete(f.furniture[i], "entity", v); }))}
    ${select("symbol", "fs", m.symbol, FURNITURE_SYMBOLS, (v) => c.commit((f) => { f.furniture[i].symbol = v as typeof m.symbol; }))}
    ${number(c, "width (cm)", "fw", m.w, setSize("w"))}
    ${number(c, "depth (cm)", "fh", m.h, setSize("h"))}
    ${rotateButtons(c, "fr", (n) => c.commit((f) => { f.furniture[i].rot = ((m.rot + n) % 360 + 360) % 360; }), { reset: () => { if (m.rot) c.commit((f) => { f.furniture[i].rot = 0; }); } })}
    <p>${button("fudel", "Delete", () => { c.commit((f) => { f.furniture.splice(i, 1); }); c.select(null); }, "warn")}</p>
    ${hint("Drag it to move it. Alt disables the grid.")}`;
}

function stairsPanel(c: PanelCtx, i: number) {
  const t = c.st.f.stairs[i], round = t.shape === "round";
  const centre = (): [number, number] => {
    const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  };
  // Shape and diameter regenerate the polygon about the centre it has now; name, steps and rotation stay.
  const replace = (n: Pick<typeof t, "pts" | "shape" | "dia" | "inner">) => c.commit((f) => { const o = f.stairs[i]; for (const k of ["dia", "inner"] as const) delete o[k]; Object.assign(o, n); });
  const setShape = (v: string) => {
    if (v === t.shape || !(STAIR_SHAPES as readonly string[]).includes(v)) return;
    const { pts, shape, dia, inner } = v === "round" ? roundStairs(centre(), 200) : stairsAt(centre(), c.st.snapGrid);
    replace({ pts, shape, dia, inner });
  };
  const setDia = (n: number) => {
    const d = Math.max(40, Math.round(n));
    const { pts, shape, inner } = roundStairs(centre(), d, Math.min(t.inner ?? 0, d - 40));
    replace({ pts, shape, dia: d, inner });
  };
  const setInner = (n: number) => c.commit((f) => { const o = f.stairs[i]; if (o.shape === "round") o.inner = Math.max(0, Math.min(Math.round(n), (o.dia ?? 40) - 40)); });
  return html`<strong>Stairs</strong>
    ${text("name", "sn", t.name, (v) => c.commit((f) => { f.stairs[i].name = v; }))}
    ${select("shape", "ss", t.shape, STAIR_SHAPES, setShape)}
    <p><span>steps</span> <span id="sstn">${stairSteps(t)}</span> <span class="hint">one every 40 cm</span></p>
    ${rotateButtons(c, "srot", (n) => c.commit((f) => { f.stairs[i].rot = ((t.rot + n) % 360 + 360) % 360; }), { reset: () => { if (t.rot) c.commit((f) => { f.stairs[i].rot = 0; }); } })}
    ${round ? html`${number(c, "outer diameter (cm)", "sdia", t.dia ?? 0, setDia)}${number(c, "inner diameter (cm)", "sinner", t.inner ?? 0, setInner)}` : nothing}
    ${paintControls(c, "stairs", i, "s", t)}
    <p>${button("sdel", "Delete", () => { c.commit((f) => { f.stairs.splice(i, 1); }); c.select(null); }, "warn")}</p>
    ${hint("Stairs are added to every floor and deleted from one.")}
    ${hint(round ? "Drag it to move it. Set the diameters and the rotation here." : "Drag a corner to reshape. Click an edge to add a point in the middle. A rotated flight has no corner handles: set the rotation to 0 to reshape it.")}`;
}
