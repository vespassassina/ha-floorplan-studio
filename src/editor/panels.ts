import { html, nothing, type TemplateResult } from "lit";
import { live } from "./live-keep";
import { repeat } from "lit/directives/repeat.js";
import { DEFAULT_FLOOR_HEIGHT, drawsEffect, FX_MAX, FX_MIN, DEFAULT_SLAB, DEVICE_Z, FURNITURE_HEIGHTS, FURNITURE_Z, UNLINKED_BASE, furnitureHeight, unlinkedHeight, MAX_HEIGHT, ROOM_OWNS, UNLINKED_HEIGHTS, wallHeight, doorCeiling, doorSpan, entitiesForType, groupKind, inside, mainEntitiesByDevice, placedEntities, roomHaBox, typeForEntity, UI_ICONS } from "../core";
import { STAIR_DIRECTIONS, STAIR_DIRECTION_LABELS, floorsAroundKey, resolveStairDirection } from "../core";
import { DOOR_KINDS, FLOOR_COLOURS, TEXTURES, FURNITURE_SYMBOLS, ROOM_KINDS, STAIR_SHAPES, WALL_KINDS, EDGE_KINDS, dist, edgeRooms, deleteEdge, onEdge, insertPoint, removePoint, rotatePoly, setEdgeKind, snapped, stairSteps } from "../core";
import type { CatalogEntry, DeviceType, Door, EdgeKind, Floor, StairDirection, HaBoxRow, HaData, Room, RoomKind, WallKind } from "../core";
import { setRoomList, type RoomSensorField, movePointAll, openingToWall, resizeSegment, roundStairs, rotateSegment, setSecondEnd, stairsAt, wallToOpening } from "./ops";
import { polyPts, ptOf, type EditorState, type Sel } from "./state";
import { removeScene, setRoomHaScenes } from "./room-scenes-ops";
import { GUIDE_STEPS, CONTROLS } from "./guide";
import "./combo";
import type { ComboOption } from "./combo";
import { groupSensorChoices, type GroupedChoice } from "./sensor-order";

/** Selection panels: one function per kind of selection, all pure views over the state. */

export const TYPE_LABELS: [DeviceType, string][] = [
  ["heater", "Heaters"], ["light", "Lights"], ["switch", "Wall switches"], ["plug", "Plugs"], ["temp", "Temperature"],
  ["humidity", "Humidity"], ["motion", "Motion"], ["contact", "Window / door sensor"], ["camera", "Cameras"],
  ["climate", "Climate"], ["ac", "Air conditioning / heat pump"], ["tv", "TV"], ["computer", "Computers"],
  ["media", "Media players"], ["cover", "Covers"], ["battery", "Batteries"], ["inverter", "Inverters"], ["server", "Servers"],
  ["access_point", "Access points"], ["lock", "Door locks"], ["vibration", "Vibration sensors"], ["other", "Other"],
  ["boiler", "Boiler"], ["car", "Car"], ["ups", "UPS"], ["printer", "3D printer"], ["speaker", "Speaker"], ["person", "People"],
  ["radar", "mmWave radar"], ["vacuum", "Vacuums"], ["siren", "Siren"], ["alarm", "Alarm"],
];

/** S18.14: the types people place most, in the order the menu shows them. The rest follow a separator, A to Z. */
export const POPULAR_TYPES: readonly DeviceType[] = ["light", "switch", "motion", "contact", "temp", "speaker", "tv"];

/** The `pairs` split for a type menu: the popular ones first, in `POPULAR_TYPES` order, then the others A to Z by the label shown. Nothing is dropped or doubled. */
export function typeMenu(pairs: readonly [DeviceType, string][] = TYPE_LABELS): { popular: [DeviceType, string][]; rest: [DeviceType, string][] } {
  const popular = POPULAR_TYPES.flatMap((t) => pairs.filter(([x]) => x === t));
  const rest = pairs.filter(([t]) => !POPULAR_TYPES.includes(t)).sort((a, b) => a[1].localeCompare(b[1], "en"));
  return { popular, rest };
}

/** The `<option>`s of every device type select: popular, one `<hr>` (not an option, so it can be neither picked nor reached by keyboard), the rest. `selected` marks the current type. */
export function typeOptions(pairs: readonly [DeviceType, string][] = TYPE_LABELS, selected?: string) {
  const { popular, rest } = typeMenu(pairs);
  const opt = ([t, label]: [DeviceType, string]) => html`<option value=${t} ?selected=${t === selected}>${label}</option>`;
  return html`${popular.map(opt)}${popular.length && rest.length ? html`<hr>` : nothing}${rest.map(opt)}`;
}

export const WALL_LABELS: Record<EdgeKind, string> = { wall: "Internal wall", boundary: "Dotted boundary", external: "External wall", fence: "Fence", edge: "Outdoor edge", parapet: "Balcony wall (parapet)", none: "Not drawn" };

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
  /** A piece of furniture or an unlinked object turned to any angle with a slider: same live/commit gesture as `rotateTexture`. */
  rotateItem(on: "furniture" | "unlinked", i: number, rot: number, phase: "live" | "commit"): void;
  /** S4.19: the paint panel's texture-scale slider, 25–200%. Same live/commit gesture as `rotateTexture`. */
  scaleTexture(on: "rooms" | "stairs", i: number, scale: number, phase: "live" | "commit"): void;
  /** S4.4: create a light from the selected switch or plug. Absent when there is no Home Assistant to write to. */
  makeLight?: (devIndex: number) => void;
  /** S4.2: create an HA area named after room `roomIndex` and link the room to it, after asking. Absent without a writer. */
  createArea?: (roomIndex: number) => void;
  /** S4.2: start drawing a room for an HA area no room uses yet. */
  drawArea(area: { id: string; name: string }): void;
  /** S4.15: place the unplaced entities of room `roomIndex`'s HA area; S8.1: opens a popup to pick which. */
  placeArea(roomIndex: number): void;
  /** S17.3: opens the scene designer on scene `id` of room `roomIndex` (null: a new scene). */
  designScene(roomIndex: number, id: string | null): void;
  /** S4.5: create an HA group of the devices at `is` (all one kind), named `name`, after asking. Absent without a writer. */
  createGroup?: (is: number[], kind: "light" | "motion", name: string) => void;
  /** S4.6: build and create the "switch controls..." automation for the switch at `devIndex`, after asking, then open it in HA. Absent without a writer. */
  controlsAutomation?: (devIndex: number, targets: string[]) => void;
  /** S4.6: build and create the "schedule" automation for the device at `devIndex`, after asking, then open it in HA. Absent without a writer. */
  scheduleAutomation?: (devIndex: number, on: string, off: string) => void;
  /** S8.7: build and create the "turns on with motion" automation for the light at `devIndex`, off `minutes` after
   *  motion stops, after asking, then open it in HA and record `motion` on the light — one undo step. Absent without a writer. */
  linkMotion?: (devIndex: number, motionEntity: string, minutes: number) => void;
  /** S4.7: opens Home Assistant's own more-info dialog for an entity. Always present; harmless when nothing is listening (standalone build). */
  moreInfo(entityId: string): void;
  /** S4.7: runs a scene (`scene.turn_on`) from the room box. Absent without a writer. */
  runScene?: (entityId: string) => void;
  /** S4.7: puts an area-less HA entity into room `roomIndex`'s area, after asking. Absent without a writer. */
  addToArea?: (roomIndex: number, entityId: string) => void;
  /** S4.3: the room whose HA area differs from the device's, when there is one, and the action that moves it there. */
  areaDiff?: (devIndex: number) => { name: string } | null;
  moveArea?: (devIndex: number) => void;
  /** Say something in the status line. */
  say(msg: string): void;
  /** S10.2: attaches `entity` via `apply` and pulls its device icon off every floor, one undo step; `label` names
   *  the door/device/item it was attached to, for the status line, and `keepDeviceId` spares that device's own icon. */
  attachEntity(entity: string, apply: (f: Floor) => void, label: string, keepDeviceId?: string): void;
  /** S11.2: "Attach to room" for the device at `devIndex`: its entity joins the room's list and the icon goes, one undo step, status line told. */
  attachToRoom(devIndex: number): void;
  /** Redraw without an edit. */
  refresh(): void;
  /** S7.2: opens the Help panel, the same as the toolbar's Help button. */
  help(): void;
  /** Floor operations of the editor: each is one undo step and reports in the status line. */
  floors: { rename(key: string, title: string): void; move(key: string, delta: number): void; remove(key: string): void };
}

type Input = HTMLInputElement | HTMLSelectElement | { value: string };
// A combo's own change event carries `detail` (see combo.ts's `commit: false`, S8.7's Motion options): the picked
// value even when the combo's own `.value` property was deliberately left unchanged. A native input/select event
// has no `detail`, so this falls back to `.value` for every other caller unchanged.
const val = (e: Event) => ((e as CustomEvent).detail ?? (e.target as Input).value) as string;
/** A combo box's `id`, `.value` and `@change` wiring, shared by every entity picker below. `options` is flat with
 *  an optional `group` (see combo.ts); `none` is the label of the "" option when the field allows clearing. */
function combo(id: string, label: string, cur: string, options: ComboOption[], on: (v: string) => void, none?: string) {
  const all = none !== undefined ? [{ value: "", label: none }, ...options] : options;
  return html`<fp-combo id=${id} .label=${label} .options=${all} .value=${live(cur)} @change=${(e: Event) => on(val(e))}></fp-combo>`;
}
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
      <div class="rangerow">
        <input id=${`${id}rot`} type="range" min="0" max="359" step="1" .value=${live(String(shape.textureRot ?? 0))}
          @input=${(e: Event) => c.rotateTexture(on, i, Number(val(e)), "live")}
          @change=${(e: Event) => c.rotateTexture(on, i, Number(val(e)), "commit")}>
        <span class="rot-val">${shape.textureRot ?? 0}°</span>
      </div>
      <label for=${`${id}scale`}>texture scale</label>
      <div class="rangerow">
        <input id=${`${id}scale`} type="range" min="25" max="200" step="5" .value=${live(String(Math.round((shape.textureScale ?? 1) * 100)))}
          @input=${(e: Event) => c.scaleTexture(on, i, Number(val(e)) / 100, "live")}
          @change=${(e: Event) => c.scaleTexture(on, i, Number(val(e)) / 100, "commit")}>
        <span class="rot-val">${Math.round((shape.textureScale ?? 1) * 100)}%</span>
      </div>` : nothing}
    <p>${button(`${id}colx`, "Use the default colour", () => c.paint(on, i, null))}</p>`;
}

function text(label: string, id: string, value: string, on: (v: string) => void, disabled = false, title?: string) {
  return html`<label for=${id}>${label}</label><input id=${id} type="text" ?disabled=${disabled} .value=${value} title=${title ?? nothing} @change=${(e: Event) => on(val(e))}>`;
}
/** A number field. It always shows what the state holds: `refresh` re-renders it after every change, so a refused or clamped value snaps back. */
function number(c: PanelCtx, label: string, id: string, value: number | string, on: (v: number) => void) {
  return html`<label for=${id}>${label}</label><input id=${id} type="number" .value=${live(String(value))} @change=${(e: Event) => { const n = numVal(e); if (n !== null) on(n); c.refresh(); }}>`;
}
/**
 * An optional height in cm (docs/specs/heights-and-2-5d.md). Empty means "not set": the property is removed and the
 * default, shown as the placeholder, applies again. Text, not a number input, so a stray "tall" reaches us and gets an
 * answer instead of silently arriving as "". A value outside 0 to 1000 is clamped and says so; anything else is refused
 * and the field goes back. `apply` gets the number, or undefined to remove it.
 */
function heightField(c: PanelCtx, label: string, id: string, cur: unknown, fallback: number, apply: (n: number | undefined) => void) {
  return optionalField(c, label, id, cur, fallback, apply, { noun: "a height", min: 0, max: MAX_HEIGHT, how: `cm from 0 to ${MAX_HEIGHT}`, unit: "cm" });
}
/** S14.3: the effect size of a device, a percent from `FX_MIN` to `FX_MAX`; empty removes it and the type's own size (100) applies. */
const fxField = (c: PanelCtx, cur: unknown, apply: (n: number | undefined) => void) =>
  optionalField(c, "effect size (%)", "vfx", cur, 100, apply, { noun: "an effect size", min: FX_MIN, max: FX_MAX, how: `a percent from ${FX_MIN} to ${FX_MAX}`, unit: "%" });
/** The one optional-number field behind heights and the effect size: empty removes it, junk is refused with the reason, a value out of range is clamped and says so. */
function optionalField(c: PanelCtx, label: string, id: string, cur: unknown, fallback: number, apply: (n: number | undefined) => void,
  r: { noun: string; min: number; max: number; how: string; unit: string }) {
  const shown = typeof cur === "number" && Number.isFinite(cur) ? String(cur) : "";
  const on = (e: Event) => {
    const raw = (e.target as Input).value.trim();
    if (raw === "") apply(undefined);
    else {
      const n = Number(raw.replace(",", "."));
      if (!Number.isFinite(n)) c.say(`"${raw}" is not ${r.noun}. Use ${r.how}, or clear the field for the default ${fallback}. Kept ${shown || `the default ${fallback}`}.`);
      else {
        const k = Math.min(r.max, Math.max(r.min, n));
        apply(k);
        if (k !== n) c.say(`${raw} ${r.unit} is outside ${r.min} to ${r.max}; used ${k}.`); // after apply: an edit sets its own "Edited"
      }
    }
    c.refresh();
  };
  // Up and down: a step of 10 from the value shown, or from the default when none is set, held to the field's range.
  const step = (dir: 1 | -1, box: HTMLInputElement) => {
    const now = typeof cur === "number" && Number.isFinite(cur) ? cur : fallback;
    const k = Math.min(r.max, Math.max(r.min, now + dir * 10));
    if (k !== cur) apply(k);
    box.value = String(k); // a focused box is not re-rendered, so show the step here
    c.refresh();
  };
  const boxOf = (e: Event) => (e.currentTarget as HTMLElement).closest(".stepper")!.querySelector("input")!;
  const key = (e: KeyboardEvent) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); step(e.key === "ArrowUp" ? 1 : -1, e.currentTarget as HTMLInputElement); } };
  return html`<label for=${id}>${label}</label><span class="stepper"><input id=${id} type="text" inputmode="decimal" placeholder=${String(fallback)} .value=${live(shown)} @change=${on} @keydown=${key}>
    <button type="button" class="btn step" id=${`${id}-up`} aria-label=${`${label} up`} @click=${(e: Event) => step(1, boxOf(e))}>▲</button><button type="button" class="btn step" id=${`${id}-down`} aria-label=${`${label} down`} @click=${(e: Event) => step(-1, boxOf(e))}>▼</button></span>`;
}
/** Rotation as buttons: 30, 45, 60 or 90 more degrees in the chosen direction, and Reset to 0 when `reset` is given. `turn` gets the signed degrees. */
function rotateButtons(c: PanelCtx, id: string, turn: (deg: number) => void, opts: { reset?: () => void; disabled?: boolean; label?: string; title?: string } = {}) {
  const cw = c.st.turnDir === 1;
  return html`<div class="rotrow" role="group" aria-label="Turn by degrees" title=${opts.title ?? nothing}><span>${opts.label ?? "rotation"}</span>
    <button class="btn" id=${`${id}dir`} aria-pressed=${cw ? "false" : "true"} @click=${() => { c.st.turnDir = cw ? -1 : 1; c.refresh(); }}>${cw ? "clockwise" : "counter-clockwise"}</button>
    ${[30, 45, 60, 90].map((n) => html`<button class="btn" id=${`${id}${n}`} ?disabled=${opts.disabled} aria-label=${`Turn ${n} degrees ${cw ? "clockwise" : "counter-clockwise"}`} @click=${() => turn(c.st.turnDir * n)}>${n}</button>`)}
    ${opts.reset ? html`<button class="btn" id=${`${id}reset`} @click=${opts.reset}>Reset</button>` : nothing}</div>`;
}
/** A 0-359 degree slider under the turn buttons: previews every tick, one undo step per drag. Ids: `<id>sl` the slider, `<id>val` the readout. */
const rotationSlider = (c: PanelCtx, id: string, on: "furniture" | "unlinked", i: number, rot: number) => html`<div class="rangerow">
  <input id=${`${id}sl`} type="range" min="0" max="359" step="1" aria-label="Rotation" .value=${live(String(Math.round(rot) % 360))}
    @input=${(e: Event) => c.rotateItem(on, i, Number(val(e)), "live")}
    @change=${(e: Event) => c.rotateItem(on, i, Number(val(e)), "commit")}>
  <span class="rot-val" id=${`${id}val`}>${Math.round(rot) % 360}°</span></div>`;
function select(label: string, id: string, value: string, options: readonly string[], on: (v: string) => void, names: Record<string, string> = {}) {
  return html`<label for=${id}>${label}</label><select id=${id} .value=${value} @change=${(e: Event) => on(val(e))}>${options.map((o) => html`<option value=${o} ?selected=${o === value}>${names[o] ?? o}</option>`)}</select>`;
}
/** What the door type select shows where it differs from the stored kind id (`slit` is stored, "slit window" is read). */
const DOOR_KIND_NAMES: Record<string, string> = { slit: "slit window" };
export const ROOM_LABELS: Record<RoomKind, string> = { room: "Room", garden: "Garden", pavement: "Pavement", fill: "Fill", terrace: "Terrace", structure: "Structure", zone: "Zone", water: "Water" };
const kindSelect = (value: string, on: (v: string) => void) =>
  html`<label for="rk">kind</label><select id="rk" .value=${value} @change=${(e: Event) => on(val(e))}>${ROOM_KINDS.map((k) => html`<option value=${k} ?selected=${k === value}>${ROOM_LABELS[k]}</option>`)}</select>`;
/** `cls` adds a style: `warn` (orange) for what deletes an item, `danger` (red) for what deletes a floor or resets everything.
 *  `title` carries detail that does not fit the sidebar's hint line, reachable on hover. */
const button = (id: string, label: string, on: () => void, cls = "", title?: string) => html`<button class=${cls ? `btn ${cls}` : "btn"} id=${id} title=${title ?? nothing} @click=${on}>${label}</button>`;
/** The angle of a segment a-b in degrees, 0 to 360, clockwise on screen, to 0.1. */
const angleOf = (a: [number, number], b: [number, number]) => Math.round((((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 360) % 360) * 10) / 10 % 360;
// S8.9.1: a hint is written short enough to fit the sidebar at its normal width, not clipped to fit. `title`
// still carries the same text for a hover tooltip. `dyn` marks the few hints built from a live Home Assistant
// name or a measurement, which may run long; nowrap+ellipsis in the stylesheet is a safety net for those only.
const hint = (t: string, dyn = false) => html`<p class="hint fit${dyn ? " dyn" : ""}" title=${t}>${t}</p>`;
/**
 * S8.9: a small section heading inside a selection panel. Every panel groups its fields, in this order where they
 * apply: Identity, Home Assistant, Links, Appearance, Automations, Danger (always last, if the panel has one) — so
 * a reader learns one layout for every kind of selection instead of a different field order each time. A section
 * with nothing in it is simply never rendered (the caller decides), so no heading is ever left floating over an
 * empty section. The one deliberate exception is the room panel's Delete, which stays next to Unsnap rather than
 * moving to a Danger section at the bottom — an explicit earlier decision, see docs/DECISIONS.md.
 */
const heading = (label: string) => html`<h4 class="pnl-h">${label}</h4>`;
/** S17.1: a panel section that folds on a click on its title; the fold is remembered (`EditorState.folded`). */
const section = (c: PanelCtx, key: string, label: string, body: unknown) => html`<details class="pnl-sec" data-sec=${key} .open=${live(!c.st.folded.has(key))}><summary class="pnl-h" @click=${(e: Event) => { e.preventDefault(); c.st.setFolded(key, !c.st.folded.has(key)); c.refresh(); }}>${label}</summary>${body}</details>`;

// ---- Home Assistant pickers (S1.38): with HA data a name is chosen, not typed ----
const byName = <T extends { name: string }>(l: readonly T[]) => [...l].sort((a, b) => a.name.localeCompare(b.name));
const NOT_IN_HA = "Not in Home Assistant. Pick another, or leave it.";
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
  const unknown = !!cur && !ha.entities.some((e) => e.id === cur);
  const options: ComboOption[] = byName(ha.entities).map((e) => ({ value: e.id, label: e.name, group: e.domain }));
  if (unknown) options.push({ value: cur!, label: `${cur} (not in Home Assistant)` });
  return html`<label for=${id}>${label}</label>${combo(id, label, cur ?? "", options, (v) => on(v || undefined), none)}
    ${unknown ? hint(NOT_IN_HA) : nothing}`;
}

/**
 * S5.5: the Help panel — a step-by-step guide, the same regardless of selection. It replaces the selection panel
 * while open, so the reader can follow a step and do it with the guide still visible; the button that opens it is
 * in the toolbar (editor-app.ts), which also gives focus back to itself when this panel's Close button is used.
 */
export function helpPanel(close: () => void): TemplateResult {
  return html`<strong>? Help</strong>
    <p><button class="btn" id="helpClose" @click=${close}>Close</button></p>
    <table class="controls" id="controls" aria-label="Controls">
      ${CONTROLS.map((c) => html`<tr><th scope="row"><kbd>${c.keys}</kbd></th><td>${c.does}</td></tr>`)}
    </table>
    <ol class="guide">
      ${GUIDE_STEPS.map((s) => html`<li><details><summary>${s.title}</summary><p>${s.body}</p></details></li>`)}
    </ol>`;
}

export function selectionPanel(c: PanelCtx): TemplateResult {
  const { st } = c, f = st.f, s = st.sel;
  if (!s) return floorPanel(c);
  switch (s.t) {
    case "v": return cornerPanel(c, s);
    case "edge": return edgePanel(c, s);
    case "wall": return wallPanel(c, s.i);
    case "extra": return f.extras[s.i] ? extraPanel(c, s.i) : html`<p class="hint fit">Nothing selected.</p>`;
    case "opening": return f.openings[s.i] ? openingPanel(c, s.i) : html`<p class="hint fit">Nothing selected.</p>`;
    case "door": return f.doors[s.i] ? doorPanel(c, s.i) : html`<p class="hint fit">Nothing selected.</p>`;
    case "room": return f.rooms[s.i] ? roomPanel(c, s.i) : html`<p class="hint fit">Nothing selected.</p>`;
    case "dev": return f.devices[s.i] ? devicePanel(c, s.i) : html`<p class="hint fit">Nothing selected.</p>`;
    case "furn": return f.furniture[s.i] ? furniturePanel(c, s.i) : html`<p class="hint fit">Nothing selected.</p>`;
    case "stairs": return f.stairs[s.i] ? stairsPanel(c, s.i) : html`<p class="hint fit">Nothing selected.</p>`;
    case "unl": return f.unlinked[s.i] ? unlinkedPanel(c, s.i) : html`<p class="hint fit">Nothing selected.</p>`;
    case "devs": return devsPanel(c, s.is);
  }
}

/** S4.5: several Shift+clicked devices. "Create group" shows only when they are all lights or all motion sensors, two or more. */
function devsPanel(c: PanelCtx, is: number[]): TemplateResult {
  const { st } = c, f = st.f;
  const names = is.map((i) => f.devices[i]).filter((d) => !!d).map((d) => d!.name ?? d!.entity);
  const kind = groupKind(f, is);
  return html`<strong>${is.length} devices selected</strong>
    <ul>${names.map((n) => html`<li>${n}</li>`)}</ul>
    ${!kind ? hint("Shift+click more of the same kind to group.") : nothing}
    ${kind && c.createGroup ? html`
      ${text("group name", "grpName", st.groupDraft, (v) => { st.groupDraft = v; c.refresh(); })}
      <p>${button("vgroup", "Create group", () => { const name = st.groupDraft.trim(); if (name) c.createGroup!(is, kind, name); })}</p>` : nothing}`;
}

/** Shown when nothing is selected: the current floor. */
function floorPanel(c: PanelCtx) {
  const { st } = c, key = st.floor, keys = Object.keys(st.layout.floors), i = keys.indexOf(key), title = st.f.title || key;
  const hasUnbound = st.f.devices.some((d) => d.entity === "");
  return html`<strong>Floor</strong>
    ${hint("Nothing selected. Click the plan to edit.")}
    <p class="hint help-line">Need help? Open Help. <button class="btn" id="floorHelp" @click=${() => c.help()}>Help</button></p>
    ${heading("Identity")}
    ${!st.ha || !st.f.ha ? html`<label for="ft">floor title</label>
    <input id="ft" type="text" .value=${live(st.f.title)} @change=${(e: Event) => { c.floors.rename(key, val(e)); c.refresh(); }}>` : nothing}
    <div class="row">
      <button class="btn" id="fup" title="Higher floor: later in the chips" ?disabled=${i < 0 || i >= keys.length - 1} @click=${() => c.floors.move(key, 1)}>Move up</button>
      <button class="btn" id="fdown" title="Lower floor: earlier in the chips" ?disabled=${i <= 0} @click=${() => c.floors.move(key, -1)}>Move down</button>
    </div>
    ${heightField(c, "floor height (cm)", "fht", st.f.height, DEFAULT_FLOOR_HEIGHT, (n) => c.commit((f) => { setHeight(f, "height", n); }))}
    ${heightField(c, "slab (cm)", "fslab", st.f.slab, DEFAULT_SLAB, (n) => c.commit((f) => { setHeight(f, "slab", n); }))}
    ${st.ha ? heading("Home Assistant") : nothing}
    ${st.ha ? floorLink(c, st.ha) : nothing}
    ${st.ha ? unplacedAreas(c, st.ha) : nothing}
    ${hasUnbound ? heading("Links") : nothing}
    ${unboundList(c)}
    ${heading("Danger")}
    ${st.confirmDelete
      ? html`<p id="fconfirm" role="alert">Delete floor ${title} and everything on it?</p>
        <div class="row">${button("fdelyes", "Delete", () => c.floors.remove(key), "danger")}${button("fdelno", "Cancel", () => { st.confirmDelete = false; c.refresh(); })}</div>`
      : html`<p><button class="btn danger" id="fdel" ?disabled=${keys.length < 2} title=${keys.length < 2 ? "The last floor cannot be deleted" : "Delete this floor"} @click=${() => { st.confirmDelete = true; c.refresh(); }}>Delete floor</button></p>`}
    ${hint("Deleting a floor returns its devices to Add.")}`;
}

/** S4.2: HA areas no room or zone on any floor uses, as buttons that start drawing a room for one. Nothing when every area is on the plan. */
function unplacedAreas(c: PanelCtx, ha: HaData) {
  const used = new Set(Object.values(c.st.layout.floors).flatMap((f) => f.rooms.map((r: Room) => r.area).filter(Boolean)));
  const list = byName(ha.areas).filter((a) => !used.has(a.id));
  if (!list.length) return nothing;
  return html`<div id="unplacedAreas"><strong>Areas not on the plan (${list.length})</strong>
    <div class="row">${list.map((a) => html`<button class="btn" @click=${() => c.drawArea(a)}>${a.name}</button>`)}</div>
    ${hint("Click one, then draw its room.")}</div>`;
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
  if (!p) return html`<p class="hint fit">Nothing selected.</p>`;
  const move = (to: [number, number]) => c.commit((f) => movePointAll(f, p, to, false, s.ref));
  const canDelete = "poly" in s.ref && (polyPts(c.st.f, s.ref.poly)?.length ?? 0) > 3;
  return html`<strong>Corner</strong>
    ${heading("Appearance")}
    ${number(c, "x (cm)", "px", p[0], (x) => move([x, p[1]]))}
    ${number(c, "y (cm)", "py", p[1], (y) => move([p[0], y]))}
    ${"poly" in s.ref && canDelete ? html`${heading("Danger")}<p>${button("delv", "Delete corner", () => { const ref = s.ref as { poly: string; j: number }; c.commit((f) => removePoint(f, ref.poly, ref.j)); c.select(null); }, "warn")}</p>` : nothing}`;
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
  if (!pts) return html`<p class="hint fit">Nothing selected.</p>`;
  const a = pts[s.i], b = pts[(s.i + 1) % pts.length];
  const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const rooms = edgeRooms(c.st.f, s.poly, s.i);
  const isOutline = s.poly === "o"; // S1.52: the house perimeter has its own kind, editable even with no room on it
  const end = { poly: s.poly, j: (s.i + 1) % pts.length };
  const set = (how: Parameters<typeof setSecondEnd>[3]) => c.commit((f) => setSecondEnd(f, a, b, how, end));
  const kind = rooms[0]?.room.wk[rooms[0].i] ?? (isOutline ? (c.st.f.owk?.[s.i] ?? "external") : "wall"); // rooms that disagree show the first one's kind
  const editable = rooms.length > 0 || isOutline;
  return html`<strong>${WALL_LABELS[kind] ?? "Wall"}</strong>
    ${hint("Second end moves; shared corners follow.")}
    ${editable ? heading("Identity") : nothing}
    ${editable ? html`<label for="ek">kind</label><select id="ek" .value=${kind} @change=${(e: Event) => c.commit((f) => setEdgeKind(f, s.poly, s.i, val(e) as EdgeKind))}>${EDGE_KINDS.map((k) => html`<option value=${k} ?selected=${k === kind}>${WALL_LABELS[k]}</option>`)}</select>` : nothing}
    ${heading("Appearance")}
    ${number(c, "length (m)", "elen", (dist(a, b) / 100).toFixed(2), (m) => set({ length: m }))}
    ${hint(`angle ${ang.toFixed(1)}°`, true)}
    <div class="row">${button("mkh", "Make horizontal", () => set({ axis: "h" }))}${button("mkv", "Make vertical", () => set({ axis: "v" }))}</div>
    <p>${button("addpt", "Add a point in the middle", () => { c.commit((f) => insertPoint(f, s.poly, s.i, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)])); c.select(null); })}</p>
    ${editable && kind !== "none" ? html`${heading("Danger")}${edgeDelete(c, s, a, b)}` : nothing}`;
}

function wallPanel(c: PanelCtx, i: number) {
  const w = c.st.f.walls[i];
  if (!w) return html`<p class="hint fit">Nothing selected.</p>`;
  const set = (how: Parameters<typeof setSecondEnd>[3]) => c.commit((f) => {
    const g = setSecondEnd(f, w.a, w.b, how, { k: "walls", i, end: "b" });
    if ("length" in how) g.walls[i].locked = true; // typing a length locks the wall, by default
    return g;
  });
  return html`<strong>${WALL_LABELS[w.kind] ?? "Wall"}</strong>
    ${hint("Drag ends to place; they snap to corners.")}
    ${heading("Identity")}
    <label for="wk">kind</label><select id="wk" .value=${live(w.kind)} @change=${(e: Event) => {
      const v = val(e);
      if (v !== "opening") { c.commit((f) => { f.walls[i].kind = v as WallKind; }); return; }
      if (dist(w.a, w.b) === 0) { c.say("A wall of zero length cannot become an opening"); c.refresh(); return; }
      c.commit((f) => wallToOpening(f, i, c.st.floor));
      c.select({ t: "opening", i: c.st.f.openings.length - 1 });
    }}>${WALL_KINDS.map((k) => html`<option value=${k} ?selected=${k === w.kind}>${WALL_LABELS[k]}</option>`)}<option value="opening">Opening (a gap in the wall)</option></select>
    ${number(c, "length (m)", "wlen", (dist(w.a, w.b) / 100).toFixed(2), (m) => set({ length: m }))}
    ${heightField(c, "height (cm)", "wht", w.height, wallHeight(c.st.f, { ...w, height: undefined }), heightSetter(c, "walls", i, "height"))}
    ${heading("Appearance")}
    <div class="row">${button("wh", "Make horizontal", () => set({ axis: "h" }))}${button("wv", "Make vertical", () => set({ axis: "v" }))}</div>
    ${lockField(c, "wlock", "walls", i)}
    ${angleField(c, "wrot", "walls", i)}
    ${heading("Danger")}
    <p>${button("wdel", "Delete", () => { c.commit((f) => { f.walls.splice(i, 1); }); c.select(null); }, "warn")}</p>`;
}

/** S4.13: a structure line (a free-standing annotation like "boiler + tank" - not a wall, not a room edge). Name and length only; no kind. */
function extraPanel(c: PanelCtx, i: number) {
  const x = c.st.f.extras[i];
  if (!x) return html`<p class="hint fit">Nothing selected.</p>`;
  return html`<strong>Structure line</strong>
    ${hint("Drag ends to resize, or middle to move.")}
    ${heading("Identity")}
    ${text("name", "exn", x.name, (v) => c.commit((f) => { f.extras[i].name = v; }))}
    ${hint(`length ${(dist(x.a, x.b) / 100).toFixed(2)} m`, true)}
    ${heading("Danger")}
    <p>${button("exdel", "Delete", () => { c.commit((f) => { f.extras.splice(i, 1); }); c.select(null); }, "warn")}</p>`;
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
/**
 * S10.2: `attach`, when given, routes a pick through `c.attachEntity` instead of `set` directly, so picking an
 * entity that is placed as an icon pulls it off the plan in the same undo step (behaviour 1: `apply` writes the
 * attachment, `attachEntity` does the pulling). `set` still does the Remove button either way — detaching only
 * ever removes the attachment (behaviour 3), never the icon. `vctl`'s Controls draft (session state, not a layout
 * field) passes no `attach` and keeps its old direct-`set` behaviour.
 */
/** A round red button with only an X; the name is in `aria-label` and `title`, not in text. */
const removeX = (id: string, name: string, on: () => void) =>
  html`<button class="btn rm-x" id=${id} type="button" aria-label=${`Remove ${name}`} title=${`Remove ${name}`} @click=${on}><svg viewBox="0 0 24 24" aria-hidden="true"><path d=${UI_ICONS.close}/></svg></button>`;
function multiAttachField(
  c: PanelCtx, id: string, label: string, cur: string[], choices: CatalogEntry[], set: (next: string[]) => void,
  attach?: { apply: (f: Floor, next: string[]) => void; targetLabel: string; keepDeviceId?: string },
  /** `grouped` orders the offered entries and names each one's heading; `roundRemove` shows Remove as a round red X; `boxed` draws a frame round the picker and its list. */
  look?: { grouped?: (avail: CatalogEntry[]) => GroupedChoice[]; roundRemove?: boolean; boxed?: boolean },
) {
  const placed = placedEntities(c.st.layout);
  const nameOf = (entity: string) => { const e = c.st.layout.catalog.find((x) => x.entity === entity); return e ? (e.room ? `${e.room} - ${e.name}` : e.name) : entity; };
  const avail = choices.filter((s) => !cur.includes(s.entity));
  // S10.2 behaviour 2: an entity already placed as an icon is still offered, labelled so the user can tell; the
  // suffix is appended to the label only, so `filterCombo`'s name match (label+value+group) still finds it by name.
  const entries = look?.grouped ? look.grouped(avail) : avail.map((s) => ({ entry: s, group: s.room }));
  const options: ComboOption[] = entries.map(({ entry: s, group }) => ({ value: s.entity, label: placed.has(s.entity) ? `${s.name} (on plan)` : s.name, group }));
  // Picking adds to the list and clears itself: the combo's own value never lingers on the picked entity, unlike a
  // native `<select>` whose "add..." placeholder simply gets reselected next render.
  const add = (v: string) => {
    if (!v) return;
    if (attach) c.attachEntity(v, (f) => attach.apply(f, [...cur, v]), attach.targetLabel, attach.keepDeviceId);
    else set([...cur, v]);
  };
  const inner = html`<label for=${id}>${label}</label>
    ${combo(id, label, "", options, add, "add...")}
    ${cur.map((en, k) => html`<p class="attach-row">${nameOf(en)} ${look?.roundRemove ? removeX(`${id}-rm${k}`, nameOf(en), () => set(cur.filter((x) => x !== en))) : button(`${id}-rm${k}`, "Remove", () => set(cur.filter((x) => x !== en)), "warn")}</p>`)}`;
  return look?.boxed ? html`<div class="sens-box">${inner}</div>` : inner;
}

function doorPanel(c: PanelCtx, i: number) {
  const d = c.st.f.doors[i];
  const mutateList = (field: "sensors" | "vibration" | "locks") => (f: Floor, next: string[]) => { if (next.length) f.doors[i][field] = next; else delete f.doors[i][field]; };
  const setList = (field: "sensors" | "vibration" | "locks") => (next: string[]) => c.commit((f) => mutateList(field)(f, next));
  // `cover` is general purpose (a garage door's roller shutter is one too, kind "door") and stays offered on
  // every kind, same as before S4.24 — it doubles as the electric-curtain dropdown on a glass door or window.
  const coverLabel = d.kind === "glass" || d.kind === "window" || d.kind === "slit" ? "electric curtain" : "cover";
  // The placeholders are what the kind would be with no own value: for a slit that depends on the wall it hangs from.
  const dflt = doorSpan({ kind: d.kind } as Door, doorCeiling(c.st.f, d));
  return html`<strong>Door / window</strong>
    ${hint("Drag along the wall; drag an end to resize.")}
    ${heading("Identity")}
    ${text("name", "dn", d.name, (v) => c.commit((f) => { f.doors[i].name = v; }))}
    ${select("type", "dk", d.kind, DOOR_KINDS, (v) => c.commit((f) => { f.doors[i].kind = v as typeof d.kind; }), DOOR_KIND_NAMES)}
    ${number(c, "length (cm)", "dl", Math.round(dist(d.a, d.b)), (n) => c.commit((f) => { Object.assign(f.doors[i], resizeSegment(d.a, d.b, Math.max(20, n))); f.doors[i].locked = true; }))}
    ${heightField(c, "height (cm)", "dht", d.height, dflt.head - dflt.sill, heightSetter(c, "doors", i, "height"))}
    ${d.kind === "window" || d.kind === "slit" || d.sill !== undefined ? heightField(c, "sill (cm)", "dsill", d.sill, dflt.sill, heightSetter(c, "doors", i, "sill")) : nothing}
    <p>${button("deld", "Delete", () => { c.commit((f) => { f.doors.splice(i, 1); }); c.select(null); }, "warn")}</p>
    ${heading("Home Assistant")}
    ${multiAttachField(c, "dsens", "contact sensors", d.sensors ?? [], c.st.doorAttachChoices(d.id, "sensors"), setList("sensors"), { apply: mutateList("sensors"), targetLabel: d.name })}
    ${multiAttachField(c, "dvibr", "vibration sensors", d.vibration ?? [], c.st.doorAttachChoices(d.id, "vibration"), setList("vibration"), { apply: mutateList("vibration"), targetLabel: d.name })}
    ${multiAttachField(c, "dlocks", "smart locks", d.locks ?? [], c.st.doorAttachChoices(d.id, "locks"), setList("locks"), { apply: mutateList("locks"), targetLabel: d.name })}
    <label for="dcover">${coverLabel}</label>
    ${(() => {
      const choices = c.st.coverChoices(d.id);
      const placed = placedEntities(c.st.layout);
      const options: ComboOption[] = choices.map((s) => ({ value: s.entity, label: placed.has(s.entity) ? `${s.name} (on plan)` : s.name, group: s.room }));
      if (d.cover && !choices.some((s) => s.entity === d.cover)) options.push({ value: d.cover, label: d.cover });
      const setCover = (v: string) => {
        if (v) c.attachEntity(v, (f) => { f.doors[i].cover = v; }, d.name);
        else c.commit((f) => { delete f.doors[i].cover; });
      };
      return combo("dcover", coverLabel, d.cover ?? "", options, setCover, "none");
    })()}
    ${heading("Appearance")}
    ${lockField(c, "dlock", "doors", i)}
    ${angleField(c, "drot", "doors", i)}
    <label><input type="checkbox" id="dopen" .checked=${c.st.openDoor === d.id} @change=${(e: Event) => { c.st.openDoor = (e.target as HTMLInputElement).checked ? d.id : null; c.refresh(); }}> preview open</label>`;
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
    ${hint("Drag an end to resize or move it.")}
    ${heading("Identity")}
    <label for="ok">kind</label><select id="ok" title="A gap hides the wall behind it, unlike a wall kind." .value=${live("opening")} @change=${toWall}><option value="opening" selected>Opening</option>${WALL_KINDS.map((k) => html`<option value=${k}>${WALL_LABELS[k]}</option>`)}</select>
    ${number(c, "length (cm)", "ol", Math.round(dist(o.a, o.b)), (n) => c.commit((f) => { Object.assign(f.openings[i], resizeSegment(o.a, o.b, Math.max(20, n))); f.openings[i].locked = true; }))}
    ${heightField(c, "height (cm)", "oht", o.height, 210, heightSetter(c, "openings", i, "height"))}
    ${heightField(c, "sill (cm)", "osill", o.sill, 0, heightSetter(c, "openings", i, "sill"))}
    ${heading("Appearance")}
    ${lockField(c, "olock", "openings", i)}
    ${angleField(c, "orot", "openings", i)}
    ${heading("Danger")}
    <p>${button("odel", "Delete", () => { c.commit((f) => { f.openings.splice(i, 1); }); c.select(null); }, "warn")}</p>`;
}

function roomPanel(c: PanelCtx, i: number) {
  const r = c.st.f.rooms[i];
  // S22.6: the Place entry comes first, under the title: on a room with HA devices left to place it is the main action, and lower down it sat below the fold.
  return html`<strong>Room</strong>
    ${placeAreaButton(c, i)}
    ${r.kind === "zone" ? hint("Drag corners to reshape.") : nothing}
    ${r.kind === "structure" ? hint("Drag body to move; corners to reshape.") : nothing}
    ${section(c, "room:identity", "Identity", html`
    ${c.st.ha ? roomLink(c, c.st.ha, i) : html`${text("name", "rn", r.name, (v) => c.commit((f) => { f.rooms[i].name = v; }))}
    ${text("area id", "ra", r.area, (v) => c.commit((f) => { f.rooms[i].area = v; }), !!r.area, r.kind === "zone" ? "Maps this zone to a Home Assistant area." : undefined)}
    ${r.area ? nothing : entityField(c, "rent", "shows the state of", r.entity, "(none)", (v) => c.commit((f) => { setOrDelete(f.rooms[i], "entity", v); }))}`}
    <p>${button("rdel", "Delete", () => { c.commit((f) => { f.rooms.splice(i, 1); }); c.select(null); }, "warn")}</p>`)}
    ${c.st.ha ? heading("Home Assistant") : nothing}
    ${roomSensors(c, i)}
    ${roomScenesPanel(c, i)}
    ${c.st.ha ? section(c, "room:ha", "In this area (Home Assistant)", haBox(c, i)) : nothing}
    ${section(c, "room:appearance", "Appearance", html`
    ${kindSelect(r.kind, (v) => c.commit((f) => {
      const room = f.rooms[i];
      if (room.kind === v) return;
      room.kind = v as typeof r.kind;
      if (v === "zone") room.wk = room.pts.map((): WallKind => "boundary"); // a zone has no wall edge
      // A kind `roomAt` cannot pick shows no sensors and has no Sensors section to remove them: drop them in this same step.
      if (!ROOM_OWNS[room.kind]) for (const [field] of ROOM_SENSORS) delete room[field];
    }))}
    ${heightField(c, "ceiling height (cm)", "rht", r.height, c.st.f.height ?? DEFAULT_FLOOR_HEIGHT, heightSetter(c, "rooms", i, "height"))}
    ${roomTurn(c, i)}
    ${paintControls(c, "rooms", i, "r", r)}`)}`;
  // The room's Delete sits right under the name, before the sensors (Diego, 2026-10-06; it was next to Unsnap, see docs/DECISIONS.md).
}

/**
 * S11.2: the room's temperature, humidity and motion sensors, three pickers built like a door's contact sensors
 * (`multiAttachField`): a pick pulls a loose icon of that entity off the plan in the same undo step, a Remove button
 * only detaches. Only a kind that `roomAt` can pick takes sensors (`ROOM_OWNS`): attached to a zone, structure or fill, nothing would show them.
 */
const ROOM_SENSORS: [RoomSensorField, string, string][] = [["temps", "rtemp", "temperature sensors"], ["humidity", "rhum", "humidity sensors"], ["motion", "rmot", "motion sensors"]];
function roomSensors(c: PanelCtx, i: number) {
  const r = c.st.f.rooms[i];
  if (!ROOM_OWNS[r.kind]) return nothing;
  return section(c, "room:sensors", "Sensors", html`
    ${ROOM_SENSORS.map(([field, id, label]) => {
      const write = (f: Floor, next: string[]) => setRoomList(f.rooms[i], field, next);
      return multiAttachField(c, id, label, r[field] ?? [], c.st.roomSensorChoices(i, field), (next) => c.commit((f) => write(f, next)), { apply: write, targetLabel: r.name || "the room" }, { grouped: (avail) => groupSensorChoices(c.st.layout, avail, c.st.floor, r.name), roundRemove: true, boxed: true });
    })}`);
}

/**
 * S14.7, S17.4: the room's scenes, as a list. Home Assistant `scene.*` entities come first, marked "Home Assistant": the ones whose area is the
 * room's appear on the card by themselves ("area"), "Also offer" adds scenes from elsewhere ("offered", with a Remove). They run on the card
 * and are not edited here (Hue scenes live on the bridge). Custom scenes follow, each with Edit (the designer, S17.3) and Delete.
 * Every gesture is one `commit`, one undo step.
 */
function roomScenesPanel(c: PanelCtx, i: number) {
  const r = c.st.f.rooms[i];
  if (!ROOM_OWNS[r.kind]) return nothing;
  const ha = c.st.ha;
  const sceneRows = ha?.entities.filter((e) => e.domain === "scene") ?? [];
  const inArea = r.area ? sceneRows.filter((e) => e.area === r.area) : [];
  const extra = r.haScenes ?? [];
  const more = sceneRows.filter((e) => !inArea.includes(e) && !extra.includes(e.id));
  const nameOf = (id: string) => sceneRows.find((e) => e.id === id)?.name ?? id;
  const w = (fn: (room: Room) => void) => c.commit((f) => { fn(f.rooms[i]); });
  const custom = r.scenes ?? [];
  return section(c, "room:scenes", "Scenes", html`
    ${hint("Shown as buttons on the card.")}
    ${ha ? html`${inArea.map((e) => html`<div class="scene-item" data-ha-scene=${e.id}><span>${e.name}</span><small class="tag">Home Assistant · this area</small></div>`)}
      ${extra.map((e, k) => html`<div class="scene-item" data-ha-scene=${e}><span>${nameOf(e)}</span><small class="tag">Home Assistant · offered</small><button class="btn keep" id=${`rsc-ha-rm-${k}`} type="button" aria-label=${`Stop offering ${nameOf(e)}`} @click=${() => w((room) => { setRoomHaScenes(room, extra.filter((x) => x !== e)); })}>Remove</button></div>`)}
      ${more.length ? html`${hint("Add a Home Assistant scene from another area to this room's card.")}<label for="rsc-ha-add">Offer another scene</label><select id="rsc-ha-add" .value=${live("")} @change=${(e: Event) => { const v = val(e); if (v) w((room) => { setRoomHaScenes(room, [...extra, v]); }); c.refresh(); }}><option value="">(a Home Assistant scene)</option>${more.map((e) => html`<option value=${e.id}>${e.name}</option>`)}</select>` : nothing}` : nothing}
    ${custom.map((sc, k) => html`<div class="scene-item" data-scene=${sc.id}>
      <span>${sc.name}</span><small class="tag">${sc.items.length} device${sc.items.length === 1 ? "" : "s"}</small>
      ${button(`rsc-edit-${k}`, "Edit", () => c.designScene(i, sc.id))}
      ${button(`rsc-del-${k}`, "Delete", () => w((room) => { removeScene(room, sc.id); }), "warn", "Removes the scene. Undo brings it back.")}
    </div>`)}
    <p>${button("rsc-new", "New scene", () => c.designScene(i, null), "primary", "Opens the scene designer.")}</p>`);
}

/** S4.15/S8.1: one button, counting what Home Assistant has in the room's area that the plan can show and does not yet; it opens the Place popup. */
function placeAreaButton(c: PanelCtx, i: number) {
  const n = c.st.areaToPlace(i).length;
  return n ? html`<p>${button("rplace", `Place ${n} Home Assistant device${n === 1 ? "" : "s"}`, () => c.placeArea(i))}</p>` : nothing;
}

const setOrDelete = <T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined) => { if (v === undefined || v === "") delete o[k]; else o[k] = v; };
/** A height, sill or mount height: set, or removed so the default applies again. */
const setHeight = (o: object, key: string, n: number | undefined) => { if (n === undefined) delete (o as Record<string, unknown>)[key]; else (o as Record<string, unknown>)[key] = n; };
const heightSetter = (c: PanelCtx, list: "rooms" | "walls" | "doors" | "openings" | "furniture" | "unlinked" | "devices", i: number, key: string) =>
  (n: number | undefined) => c.commit((f) => { setHeight(f[list][i], key, n); });

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
    <label for="ra">area</label><select id="ra" @change=${(e: Event) => pick(val(e))}>
      <option value="" ?selected=${!r.area}>(no area — custom)</option>
      ${free.map(opt)}
      ${taken.length ? html`<optgroup label="Already on the plan">${taken.map(opt)}</optgroup>` : nothing}
      ${unknown ? missingOpt(r.area) : nothing}
    </select>${unknown ? hint(NOT_IN_HA) : nothing}
    ${c.createArea && r.kind !== "water" && r.name.trim() && (!r.area || unknown) ? html`<p>${button("rcreate", `Create area ${r.name.trim()} in Home Assistant`, () => c.createArea!(i))}</p>` : nothing}
    ${r.area ? nothing : html`${text("plan name", "rn", r.name, (v) => c.commit((f) => { f.rooms[i].name = v; }))}
    ${entityField(c, "rent", "shows the state of", r.entity, "(none)", (v) => c.commit((f) => { setOrDelete(f.rooms[i], "entity", v); }))}`}`;
}

/** S4.7: one row of the "In Home Assistant" box: its name, "Open" (more-info), and a kind-specific extra action. */
function haRow(c: PanelCtx, row: HaBoxRow, kind?: "automation" | "script" | "scene", uid?: string) {
  const edit = (seg: "automation" | "script") => `/config/${seg}/edit/${uid ?? row.id.split(".").slice(1).join(".")}`;
  return html`<div class="harow2" data-ha-row=${row.id}>
    <span>${row.name}${row.placed ? " (on plan)" : ""}</span>
    <button class="btn keep" type="button" @click=${() => c.moreInfo(row.id)}>Open</button>
    ${kind === "scene" && c.runScene ? html`<button class="btn keep" type="button" @click=${() => c.runScene!(row.id)}>Run</button>` : nothing}
    ${(kind === "automation" || kind === "script") ? html`<a class="btn keep" href=${edit(kind)} target="_top">Edit in HA</a>` : nothing}
  </div>`;
}

/**
 * S8.10: fixed display order for the room box's Devices group — reuses `TYPE_LABELS`, the project's one
 * domain/device_class -> DeviceType -> label mapping (`typeForEntity` in `src/core/ha.ts`); no second mapping is
 * invented here. "Other" (unmapped entities) always trails, whatever position it holds in `TYPE_LABELS` itself.
 */
const DEVICE_GROUP_ORDER: DeviceType[] = [...TYPE_LABELS.map(([t]) => t).filter((t) => t !== "other"), "other"];

/**
 * S8.10: the maintainer's real room had ~35 flat rows under "Devices" — TV entities, phones, batteries and so on —
 * "impossible to use". `rows` (already the room's own area, already sorted by name by `roomHaBox`) is split into
 * one collapsible sub-group per `DeviceType`, in `DEVICE_GROUP_ORDER`, each closed by default. A row whose entity
 * cannot be found (should not happen; defensive only) falls into "Other".
 */
function haDeviceGroups(c: PanelCtx, ha: HaData, rows: HaBoxRow[]) {
  const byType = new Map<DeviceType, HaBoxRow[]>();
  for (const row of rows) {
    const e = ha.entities.find((x) => x.id === row.id);
    const t: DeviceType = e ? typeForEntity(e) : "other";
    const list = byType.get(t);
    if (list) list.push(row); else byType.set(t, [row]);
  }
  const labelOf = (t: DeviceType) => TYPE_LABELS.find(([tt]) => tt === t)?.[1] ?? "Other";
  const shown = DEVICE_GROUP_ORDER.filter((t) => byType.get(t)?.length);
  // S8.10 follow-up (Opus review): `repeat`, keyed by the type itself, so a room whose type set differs from the
  // previous one's never reuses another type's DOM node at the same position — an unkeyed `.map` did, and the
  // reused `<details>` kept its stale `open` state under the new type's key (`docs/DECISIONS.md` has the repro).
  // `.open=${live(...)}` (not `?open=`) so the binding always compares against the DOM's real current state, not
  // only lit-html's last-committed value, in case anything else ever changes it outside a render.
  // The write side is `@click` on the `<summary>`, flipping our own tracked state, not `@toggle` on `<details>`.
  // The HTML spec fires `toggle` as a queued task, well after the click that caused it, and `<summary>`'s own
  // click-driven `open` flip happens even later (its "activation behaviour" runs after the click event's own
  // listeners, confirmed empirically: a `click` listener still reads the pre-toggle value). A second render — a
  // room switch is one, and it can land in that gap — would then read `haGroups.has(key)` still false, `live()`
  // would see that mismatch against the DOM's already-true `open`, and force it back closed before the queued
  // `toggle` task ever got to record the click into `haGroups`, silently discarding it (`docs/DECISIONS.md` has
  // the repro). `@click` computes the new state synchronously, in the same task as the click, before any later
  // render can race it.
  return repeat(shown, (t) => t, (t) => {
    const list = byType.get(t)!;
    const key = `dev:${t}`;
    return html`<details class="habox-sub" data-ha-devgroup=${t} .open=${live(c.st.haGroups.has(key))}>
      <summary class="habox-h" @click=${() => c.st.setHaGroup(key, !c.st.haGroups.has(key))}>${labelOf(t)} (${list.length})</summary>
      ${list.map((row) => haRow(c, row))}
    </details>`;
  });
}

/**
 * S8.10: one collapsible block of the room box (Devices, Helpers, Automations, Scripts, Scenes — see `haBox`),
 * closed by default. Its open state lives in `EditorState.haGroups`, keyed by the group's own label (`grp:<label>`,
 * `dev:<type>` for a Devices sub-group) — not by room or by any per-render structure — so it survives selecting
 * another room and back, and a `hass` update (the editor's own `EditorState` instance never gets swapped for those).
 */
function haGroupBlock(c: PanelCtx, ha: HaData, label: string, rows: HaBoxRow[], kind?: "automation" | "script" | "scene") {
  const key = `grp:${label}`;
  const body = label === "Devices"
    ? haDeviceGroups(c, ha, rows)
    : rows.map((row) => haRow(c, row, kind, kind ? ha.entities.find((e) => e.id === row.id)?.uid : undefined));
  // S8.10 follow-up (Opus review): `.open=${live(...)}`, same reasoning as `haDeviceGroups` below — this group's
  // own `<details>` is itself one entry of an unkeyed-turned-`repeat`d list in `haBox`.
  return html`<details class="habox-group" data-ha-group=${label.toLowerCase()} .open=${live(c.st.haGroups.has(key))}>
    <summary class="habox-h" @click=${() => c.st.setHaGroup(key, !c.st.haGroups.has(key))}>${label} (${rows.length})</summary>
    ${body}
  </details>`;
}

/**
 * S4.7: below the room panel, everything Home Assistant has in the room's area, grouped under five headings (placed
 * devices marked), plus "Add to area..." for an entity HA has in no area yet. A custom room (no area) with its own
 * `entity` shows that one row instead; with neither, a hint that there is nothing to show.
 */
function haBox(c: PanelCtx, i: number) {
  const ha = c.st.ha;
  if (!ha) return nothing;
  const r = c.st.f.rooms[i];
  if (!r.area) {
    if (!r.entity) return html`${hint("No area: set one above.")}`;
    const e = ha.entities.find((x) => x.id === r.entity);
    return html`<div class="habox">${haRow(c, { id: r.entity, name: e?.name ?? r.entity, placed: true })}</div>`;
  }
  const box = roomHaBox(ha, r.area, placedEntities(c.st.layout));
  const all: [string, HaBoxRow[], "automation" | "script" | "scene" | undefined][] = [
    ["Devices", box.devices, undefined], ["Helpers", box.helpers, undefined],
    ["Automations", box.automations, "automation"], ["Scripts", box.scripts, "script"], ["Scenes", box.scenes, "scene"],
  ];
  const groups = all.filter(([, rows]) => rows.length);
  const free = byName(ha.entities.filter((e) => !e.area));
  // S8.10 follow-up (Opus review): keyed by label, same reason as the Devices sub-groups — a room whose set of
  // non-empty groups differs from the previous one's must never reuse another group's DOM node (and its open
  // state) at the same position.
  return html`<div class="habox">
    ${groups.length ? repeat(groups, ([label]) => label, ([label, rows, kind]) => haGroupBlock(c, ha, label, rows, kind)) : hint("Nothing in this area yet.")}
    ${c.addToArea && free.length ? html`<label for="haadd">Add to area...</label><select id="haadd" .value=${live("")} @change=${(e: Event) => { const v = val(e); if (v) c.addToArea!(i, v); }}>
      <option value="" selected>(pick an entity)</option>${free.map((e) => html`<option value=${e.id}>${e.name}</option>`)}</select>` : nothing}</div>`;
}

/** Rotation of a room or zone (a turn, in degrees, about its middle) and the Unsnap toggle. A room that still shares a corner cannot turn. */
function roomTurn(c: PanelCtx, i: number) {
  const r = c.st.f.rooms[i], id = `r${i}`;
  const free = r.free === true, locked = !free && snapped(c.st.f, id);
  return html`${rotateButtons(c, "rrot", (n) => c.commit((f) => rotatePoly(f, id, n)), { disabled: locked, label: "Room Rotation" })}
    <p>${button("runsnap", free ? "Snap back" : "Unsnap", () => c.commit((f) => { if (free) delete f.rooms[i].free; else f.rooms[i].free = true; }))}</p>
    ${free ? hint("Unsnapped: no longer joins its neighbours.") : locked ? hint("Shared corner: unsnap to rotate.") : nothing}`;
}

/** S4.6: switch panel "Controls..." — pick lights, switches, plugs or groups, then create the automation. */
function controlsField(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i], draft = c.st.controlsDraft;
  const choices = c.st.controlsChoices(i);
  const single = draft.length === 1 ? choices.find((s) => s.entity === draft[0]) : undefined;
  return html`${multiAttachField(c, "vctl", "Controls", draft, choices, (next) => { c.st.controlsDraft = next; c.refresh(); })}
    ${single?.type === "light" && c.st.canMakeLight(i) ? hint(`One light? Use "Create a light" instead.`) : nothing}
    <p>${button("vctlgo", "Create automation", () => { if (draft.length) c.controlsAutomation!(i, draft); }, "", "Home Assistant opens the automation's own editor once it is created, so it can be adjusted or renamed.")}</p>
    ${hint(`"${d.name ?? d.entity}" cannot control itself.`, true)}`;
}

/** S4.6: "Schedule" — two HH:MM fields, then create the automation. On light, switch, plug and media panels. */
function scheduleField(c: PanelCtx, i: number) {
  const st = c.st, d = st.f.devices[i];
  return html`<label for="vschon">on at</label><input id="vschon" type="time" .value=${live(st.scheduleOn)} @change=${(e: Event) => { st.scheduleOn = val(e); c.refresh(); }}>
    <label for="vschoff">off at</label><input id="vschoff" type="time" .value=${live(st.scheduleOff)} @change=${(e: Event) => { st.scheduleOff = val(e); c.refresh(); }}>
    <p>${button("vschgo", "Create schedule automation", () => { if (st.scheduleOn && st.scheduleOff) c.scheduleAutomation!(i, st.scheduleOn, st.scheduleOff); }, "", "Home Assistant opens the automation's own editor once it is created.")}</p>
    ${hint(`Turns ${d.name ?? d.entity} on and off daily.`, true)}`;
}

const SCHEDULABLE: DeviceType[] = ["light", "switch", "plug", "media"];

function devicePanel(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  // Opus review of S8.9: areaDiffField renders nothing without c.moveArea, so a Links heading over just an
  // area-diff must not show unless moveArea is also there to fill it.
  const hasLinks = d.type === "light" || !!(c.areaDiff?.(i) && c.moveArea) || ROOM_SENSOR_TYPES.includes(d.type);
  const hasAutomations = !!(c.makeLight && c.st.canMakeLight(i)) || !!(c.controlsAutomation && d.type === "switch") || !!(c.scheduleAutomation && SCHEDULABLE.includes(d.type));
  return html`<strong>${d.name ?? d.id}</strong>
    ${hint("a" in d ? "Drag to move; it aligns to the wall." : "Drag to move.")}
    ${hint("Removed devices return to Add.")}
    ${heading("Identity")}
    ${deviceTypeField(c, i)}
    ${"a" in d ? number(c, "length (cm)", "vl", Math.round(dist(d.a, d.b)), (n) => c.commit((f) => { Object.assign(f.devices[i], resizeSegment(d.a, d.b, Math.max(10, n))); })) : nothing}
    ${heading("Home Assistant")}
    ${deviceEntity(c, i)}
    ${d.type === "camera" ? hint("Cone: 120° field of view, 1 m deep.") : nothing}
    ${d.type === "heater" ? heaterFields(c, i) : nothing}
    ${d.type === "ac" ? acField(c, i) : nothing}
    ${d.type === "plug" ? powerField(c, i) : nothing}
    ${d.type === "person" ? roomSensorField(c, i) : nothing}
    ${d.type === "radar" ? targetsField(c, i) : nothing}
    ${hasLinks ? heading("Links") : nothing}
    ${d.type === "light" ? boundField(c, i) : nothing}
    ${attachToRoomField(c, i)}
    ${areaDiffField(c, i)}
    ${heading("Appearance")}
    ${heightField(c, "mount height (cm)", "vz", d.z, DEVICE_Z[d.type] ?? 100, heightSetter(c, "devices", i, "z"))}
    ${drawsEffect(d) ? fxField(c, d.fx, heightSetter(c, "devices", i, "fx")) : nothing}
    ${rotateButtons(c, "vrot", (n) => c.commit((f) => { const r = (((d.rot ?? 0) + n) % 360 + 360) % 360; if (r) f.devices[i].rot = r; else delete f.devices[i].rot; }), { reset: () => { if (d.rot) c.commit((f) => { delete f.devices[i].rot; }); } })}
    ${hasAutomations ? heading("Automations") : nothing}
    ${c.makeLight && c.st.canMakeLight(i) ? html`<p>${button("vmklight", "Create a light from this switch", () => c.makeLight!(i))}</p>${hint("Wraps this switch in a new HA light entity.")}` : nothing}
    ${c.controlsAutomation && d.type === "switch" ? controlsField(c, i) : nothing}
    ${c.scheduleAutomation && SCHEDULABLE.includes(d.type) ? scheduleField(c, i) : nothing}
    ${heading("Danger")}
    <p>${button("vdel", "Remove from plan", () => { c.commit((f) => { f.devices.splice(i, 1); }); c.select(null); }, "warn")}</p>`;
}

/**
 * S4.18: corrects a device's type, whatever set it wrong (a guess from the area's entity list, or a bad catalog
 * entry) — there was previously no way to fix one once placed. Changing away from a type drops the fields only that
 * type uses (`bound` for light, `trvs`/`tempSensors` for heater, `linked` for ac, `room` for person), in the same undo step, so the
 * layout stays valid and the panel never shows a field for the wrong type.
 */
/** S11.2: a temp, humidity or motion device either already belongs to a room (shown as text) or may join the one it sits in. */
const ROOM_SENSOR_TYPES: DeviceType[] = ["temp", "humidity", "motion"];
function attachToRoomField(c: PanelCtx, i: number) {
  if (!ROOM_SENSOR_TYPES.includes(c.st.f.devices[i].type)) return nothing;
  const owner = c.st.roomOwning(i);
  if (owner) return html`<p class="hint" id="vattached">Attached to ${owner}. Its readings show on the room.</p>`;
  const a = c.st.roomAttach(i);
  return html`<p>${a.ok
    ? button("vattach", "Attach to room", () => c.attachToRoom(i), "", `Adds this sensor to ${c.st.f.rooms[a.room].name || "the room"} and removes the icon.`)
    : html`<button class="btn" id="vattach" disabled title=${a.reason}>Attach to room</button>`}</p>
    ${a.ok ? nothing : html`<p class="hint" id="vattach-why">${a.reason}</p>`}`;
}

function deviceTypeField(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  const set = (t: string) => c.commit((f) => {
    const dv = f.devices[i];
    dv.type = t as DeviceType;
    if (t !== "light") { delete dv.bound; delete dv.motion; }
    if (t !== "heater") { delete dv.trvs; delete dv.tempSensors; }
    if (t !== "ac") delete dv.linked;
    if (t !== "person") delete dv.room;
    if (t !== "plug") delete dv.power;
    if (t !== "radar") delete dv.targets;
  });
  return html`<label for="vtype">type</label><select id="vtype" .value=${d.type} @change=${(e: Event) => set(val(e))}>
    ${typeOptions(TYPE_LABELS, d.type)}
  </select>`;
}

/** The device sits in a room whose HA area is not the one HA has it in: say so, and offer the move (asked again even after "don't ask"). */
function areaDiffField(c: PanelCtx, i: number) {
  const diff = c.areaDiff?.(i);
  return diff && c.moveArea ? html`${hint(`Home Assistant has it in another area than ${diff.name}.`, true)}<p>${button("vmovearea", `Move it to ${diff.name} in Home Assistant`, () => c.moveArea!(i))}</p>` : nothing;
}

/**
 * The device's Home Assistant entity. With HA data it is a select: the entities that suit the device's type, those in the room's area first,
 * then everything else, so nothing is out of reach. Entities already placed on the plan are left out. It can attach an unbound device, switch a bound one to another, and go back to
 * "not connected" (entity ""). An id HA does not know stays as the selected option. Without HA data it stays a text field.
 *
 * S8.6: this is the one picker that still lists individual entities rather than collapsing to one row per device —
 * a device icon already exists here, so someone may deliberately want its power sensor rather than its switch. It
 * groups the options under one `<optgroup>` per device instead, nested within the existing In room/Elsewhere/
 * Everything else tiers (an HTML `<optgroup>` cannot itself nest, so each device gets its own sibling optgroup,
 * ordered by device name; the tier's device-less entities keep the tier's own label, in a trailing optgroup). Within
 * a device's optgroup, a config/diagnostic entity (`cat`) sorts after the device's other entities.
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
  const nameOf = new Map((ha.devices ?? []).map((dv) => [dv.id, dv.name]));
  // Opus review finding 11: a device with no name in Home Assistant's registry (`d.name` can be null) falls back
  // to its own main entity's name, never the raw device id — the same rule mainEntitiesByDevice/asDeviceRow follow.
  // The main entity is picked from the device's FULL entity set (`mainEntitiesByDevice`, all of `ha.entities`), not
  // just the entities in whichever tier is being rendered — a tier can hold only a device's diagnostic sibling,
  // which `mainEntity` excludes on its own, so a per-tier lookup found no main entity and fell back to the id.
  const mainOf = mainEntitiesByDevice(ha);
  // S10.1: a native `<optgroup>` cannot nest, so the original picker gave each device its own sibling optgroup
  // within a tier. `fp-combo`'s groups are one flat level, so a device's group label carries the tier along with
  // it ("In Kitchen · Kitchen light"); a tier's device-less entities keep the tier's own label alone, unchanged —
  // this is the one deliberate difference from the original nesting, noted in docs/DECISIONS.md.
  const byTier = (tierLabel: string, l: HaData["entities"]): ComboOption[] => {
    const groups = new Map<string, HaData["entities"]>(), loose: HaData["entities"] = [];
    for (const e of byName(l)) {
      if (!e.dev) { loose.push(e); continue; }
      if (!groups.has(e.dev)) groups.set(e.dev, []);
      groups.get(e.dev)!.push(e);
    }
    const devGroups = [...groups.entries()].map(([devId, ents]) => [nameOf.get(devId) || mainOf.get(devId)?.name || devId, ents] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    const opts: ComboOption[] = [];
    for (const [devName, ents] of devGroups) {
      const sorted = [...ents].sort((a, b) => (a.cat ? 1 : 0) - (b.cat ? 1 : 0)); // config/diagnostic entities last, else name order kept (stable)
      for (const e of sorted) opts.push({ value: e.id, label: e.name, group: `${tierLabel} · ${devName}` });
    }
    for (const e of loose) opts.push({ value: e.id, label: e.name, group: tierLabel });
    return opts;
  };
  const unknown = !!d.entity && !ha.entities.some((e) => e.id === d.entity);
  const label = TYPE_LABELS.find((t) => t[0] === d.type)?.[1] ?? d.type;
  const options: ComboOption[] = [
    ...(here.length ? byTier(`In ${room!.name}`, here) : []),
    ...(elsewhere.length ? byTier(here.length ? "Elsewhere" : label, elsewhere) : []),
    ...(rest.length ? byTier("Everything else", rest) : []),
  ];
  if (unknown) options.push({ value: d.entity, label: `${d.entity} (not in Home Assistant)` });
  return html`<label for="ve">Home Assistant entity</label>
    ${combo("ve", "Home Assistant entity", d.entity, options, set, "(not connected)")}
    ${unknown ? hint(NOT_IN_HA) : nothing}${d.entity ? nothing : hint("Not connected yet. Pick its entity.")}`;
}

/**
 * "Controlled by": the switch or plug that powers a light. Written as `bound`, the key is deleted for none. S8.7:
 * restricted to this floor's own switches and plugs (maintainer feedback: "only show the floor related switches"),
 * via `switchChoicesForLight`, with the one same-area name match, when there is one, shown first and labelled
 * "(suggested)". The current value always stays offered, even off-floor, so a value set before this floor scoping
 * existed does not vanish from the select.
 */
function boundField(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  const choices = c.st.switchChoicesForLight(i);
  const suggested = choices.filter((s) => s.suggested);
  const rest = choices.filter((s) => !s.suggested); // catalog order kept, same as the all-floors picker this replaces
  const nameOf = (entity: string) => choices.find((s) => s.entity === entity)?.name ?? c.st.layout.catalog.find((x) => x.entity === entity)?.name ?? entity;
  const motionChoices = c.linkMotion ? c.st.motionChoices(i) : [];
  const set = (v: string) => {
    if (v.startsWith("motion:")) { c.st.pendingMotion = v.slice("motion:".length); c.refresh(); return; }
    c.commit((f) => { if (v) f.devices[i].bound = v; else delete f.devices[i].bound; });
  };
  const label = (s: { room?: string; name: string }, suggest: boolean) => `${s.room ? `${s.room} - ` : ""}${s.name}${suggest ? " (suggested)" : ""}`;
  const opt = (s: { entity: string; room?: string; name: string }, suggest = false): ComboOption => ({ value: s.entity, label: label(s, suggest), group: s.room });
  const options: ComboOption[] = [
    ...suggested.map((s) => opt(s, true)),
    ...rest.map((s) => opt(s)),
    ...(d.bound && !choices.some((s) => s.entity === d.bound) ? [{ value: d.bound, label: d.bound }] : []),
    // S8.7: a Motion entry starts the pending-motion flow instead of committing `bound` directly (`commit: false`,
    // see combo.ts); its value is namespaced `motion:<entity>` so it never collides with a real switch/plug id.
    ...motionChoices.map((s): ComboOption => ({ value: `motion:${s.entity}`, label: s.name, group: "Motion", commit: false })),
  ];
  return html`<label for="vbound">Controlled by</label>
    ${combo("vbound", "Controlled by", d.bound ?? "", options, set, "(none)")}
    ${d.bound ? hint(`${d.name ?? nameOf(d.entity)} + ${nameOf(d.bound)}`, true) : nothing}
    ${motionField(c, i)}`;
}

/**
 * S8.7: the row under "Controlled by" for the motion-link flow. `d.motion` set: shows the link and an Unlink
 * button (removes only `motion`; the automation stays in Home Assistant). No `motion` but a Motion option was just
 * picked (`st.pendingMotion`): shows the off-delay field and "Create automation". Neither: nothing. Absent without
 * a writer (`c.linkMotion` unset).
 */
function motionField(c: PanelCtx, i: number) {
  if (!c.linkMotion) return nothing;
  const d = c.st.f.devices[i], ha = c.st.ha;
  const nameOf = (entity: string) => ha?.entities.find((e) => e.id === entity)?.name || entity;
  if (d.motion) {
    return html`${hint(`Turns on with motion: ${nameOf(d.motion)}`, true)}
      <p>${button("vmotionunlink", "Unlink", () => c.commit((f) => { delete f.devices[i].motion; }))}</p>
      ${hint("Its HA automation is not deleted.")}`;
  }
  const pending = c.st.pendingMotion;
  if (!pending) return nothing;
  return html`<label for="vmotionmin">Turn on with ${nameOf(pending)}, off after (minutes)</label>
    <input id="vmotionmin" type="number" min="1" step="1" .value=${live(c.st.pendingMotionMinutes)} @change=${(e: Event) => { c.st.pendingMotionMinutes = val(e); c.refresh(); }}>
    <p>${button("vmotiongo", "Create automation", () => { const min = Number(c.st.pendingMotionMinutes); if (min > 0) c.linkMotion!(i, pending, min); })}</p>`;
}

/** S4.24: a heater attaches several TRV/climate entities and several temperature sensors — design interview,
 * 2026-09-22: this is the whole scope, no open-window cutoff. */
function heaterFields(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  const mutateList = (field: "trvs" | "tempSensors") => (f: Floor, next: string[]) => { if (next.length) f.devices[i][field] = next; else delete f.devices[i][field]; };
  const setList = (field: "trvs" | "tempSensors") => (next: string[]) => c.commit((f) => mutateList(field)(f, next));
  return html`${multiAttachField(c, "htrv", "TRVs", d.trvs ?? [], c.st.deviceAttachChoices(i, "trvs"), setList("trvs"), { apply: mutateList("trvs"), targetLabel: d.name ?? d.entity, keepDeviceId: d.id })}
    ${multiAttachField(c, "hsens", "temperature sensors", d.tempSensors ?? [], c.st.deviceAttachChoices(i, "tempSensors"), setList("tempSensors"), { apply: mutateList("tempSensors"), targetLabel: d.name ?? d.entity, keepDeviceId: d.id })}`;
}

/**
 * A plug's power sensor, written as `power` (the key is deleted for none). With HA only sensors of device class
 * `power` are offered; the current value always stays listed, so an id HA does not know is never silently dropped.
 * Empty is not "off": the card then links the device's own power sensor when it has exactly one.
 */
function powerField(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  const set = (v: string | undefined) => {
    if ((v || undefined) === d.power) return; // unchanged: no undo step
    c.commit((f) => { if (v) f.devices[i].power = v; else delete f.devices[i].power; });
  };
  const note = hint("Active from 2 W of power (card option plug_watts). Empty: the device's own sensor if it has one; none: active when on.", true);
  const ha = c.st.ha;
  if (!ha) return html`${entityField(c, "vpower", "Power sensor", d.power, "(auto)", set)}${note}`;
  const found = byName(ha.entities.filter((e) => e.domain === "sensor" && e.dc === "power"));
  const options: ComboOption[] = found.map((e) => ({ value: e.id, label: e.name }));
  if (d.power && !found.some((e) => e.id === d.power)) options.push({ value: d.power, label: `${d.power} (not a power sensor in Home Assistant)` });
  return html`<label for="vpower">Power sensor</label>${combo("vpower", "Power sensor", d.power ?? "", options, (v) => set(v || undefined), "(auto)")}${note}`;
}

/** S7.8: the entity that says which room a person is in. Written as `room`, the key is deleted for none. The person's
 *  own entity is refused here as `validate` refuses it, so the picker never writes a layout Save would reject. */
function roomSensorField(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  return html`${entityField(c, "vroom", "Room sensor", d.room, "(none: stays where placed)", (v) => {
    if (v && v === d.entity) { c.say("The room sensor must be another entity than the person: one whose state names a room."); c.refresh(); return; }
    if (v === d.room) return;
    c.commit((f) => { if (v) f.devices[i].room = v; else delete f.devices[i].room; });
  })}${hint("Sensor showing the person's room.")}`;
}

/**
 * S7.9: a radar's tracked targets, one row of two entities (x, y) per target, add/remove like `multiAttachField`
 * but for a pair, since there is no single catalog entry that names both sensors of one target at once. A blank
 * pair is dropped on remove; `validate` — not this field — refuses one with only x or only y filled in, so the
 * layout can stay in an interim state mid-edit without the writer needing to know that (finding 12).
 */
function targetsField(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  const cur = d.targets ?? [];
  const setPair = (k: number, key: "x" | "y") => (v: string | undefined) => c.commit((f) => {
    const list = [...(f.devices[i].targets ?? [])];
    list[k] = { x: list[k]?.x ?? "", y: list[k]?.y ?? "", [key]: v ?? "" };
    f.devices[i].targets = list;
  });
  const remove = (k: number) => c.commit((f) => {
    const list = (f.devices[i].targets ?? []).filter((_, j) => j !== k);
    if (list.length) f.devices[i].targets = list; else delete f.devices[i].targets;
  });
  const add = () => c.commit((f) => { f.devices[i].targets = [...(f.devices[i].targets ?? []), { x: "", y: "" }]; });
  return html`<label>Targets</label>
    ${cur.map((t, k) => html`<p class="attach-row target-row">
      ${entityField(c, `vtgx${k}`, `#${k + 1} x (right, mm)`, t.x || undefined, "(none)", setPair(k, "x"))}
      ${entityField(c, `vtgy${k}`, `#${k + 1} y (ahead, mm)`, t.y || undefined, "(none)", setPair(k, "y"))}
      ${button(`vtgrm${k}`, "Remove", () => remove(k), "warn")}
    </p>`)}
    <p>${button("vtgadd", "Add target", add, "", "From an mmWave radar such as an ESPHome LD2450. rot above sets which way is ahead.")}</p>
    ${hint("x = right, y = ahead, in millimetres.")}`;
}

/** S4.24: an ac attaches several AC-or-TRV entities to one list. */
function acField(c: PanelCtx, i: number) {
  const d = c.st.f.devices[i];
  const mutate = (f: Floor, next: string[]) => { if (next.length) f.devices[i].linked = next; else delete f.devices[i].linked; };
  const set = (next: string[]) => c.commit((f) => mutate(f, next));
  return multiAttachField(c, "aclink", "AC / TRV entities", d.linked ?? [], c.st.deviceAttachChoices(i, "linked"), set, { apply: mutate, targetLabel: d.name ?? d.entity, keepDeviceId: d.id });
}

function furniturePanel(c: PanelCtx, i: number) {
  const m = c.st.f.furniture[i];
  // S1.51: width and depth are clamped to the same 5..2000 cm bounds the corner drag and validate() hold.
  const setSize = (k: "w" | "h") => (n: number) => c.commit((f) => { f.furniture[i][k] = Math.min(2000, Math.max(5, n)); });
  return html`<strong>Furniture</strong>
    ${hint("Drag it to move it.")}
    ${heading("Identity")}
    ${text("plan name", "fun", m.name ?? "", (v) => c.commit((f) => { setOrDelete(f.furniture[i], "name", v.trim()); }))}
    ${select("symbol", "fs", m.symbol, FURNITURE_SYMBOLS, (v) => c.commit((f) => { f.furniture[i].symbol = v as typeof m.symbol; }))}
    ${heading("Home Assistant")}
    ${entityField(c, "fuent", "shows the state of", m.entity, "(none)", (v) => c.commit((f) => { setOrDelete(f.furniture[i], "entity", v); }))}
    ${heading("Appearance")}
    ${number(c, "width (cm)", "fw", m.w, setSize("w"))}
    ${number(c, "depth (cm)", "fh", m.h, setSize("h"))}
    ${heightField(c, "height (cm)", "fuht", m.height, FURNITURE_HEIGHTS[m.symbol] ?? 100, heightSetter(c, "furniture", i, "height"))}
    ${heightField(c, "bottom (cm)", "fuz", m.z, FURNITURE_Z[m.symbol] ?? 0, heightSetter(c, "furniture", i, "z"))}
    <p class="hint" id="fusize">H ${Math.round(furnitureHeight(m))} × W ${Math.round(m.w)} × L ${Math.round(m.h)} cm</p>
    ${rotationSlider(c, "frot", "furniture", i, m.rot)}
    ${rotateButtons(c, "fr", (n) => c.commit((f) => { f.furniture[i].rot = ((m.rot + n) % 360 + 360) % 360; }), { reset: () => { if (m.rot) c.commit((f) => { f.furniture[i].rot = 0; }); } })}
    ${heading("Danger")}
    <p>${button("fudel", "Delete", () => { c.commit((f) => { f.furniture.splice(i, 1); }); c.select(null); }, "warn")}</p>`;
}

/**
 * S4.25: an unlinked appliance — a fixed icon by type (not a swappable furniture symbol), scaled, coloured and
 * rotated, with zero or more HA entities attached for reference only (`multiAttachField`, same as a heater's
 * trvs). No on/off state: the colour is a flat override, not a live reading.
 */
function unlinkedPanel(c: PanelCtx, i: number) {
  const u = c.st.f.unlinked[i];
  const label = TYPE_LABELS.find((t) => t[0] === u.type)?.[1] ?? u.type;
  const mutateAttached = (f: Floor, next: string[]) => { if (next.length) f.unlinked[i].attached = next; else delete f.unlinked[i].attached; };
  const setAttached = (next: string[]) => c.commit((f) => mutateAttached(f, next));
  return html`<strong>${u.name ?? label}</strong>
    ${hint("Drag it to move it.")}
    ${u.type === "speaker" || u.type === "tv" ? hint("Attach a media player: it shows playing, a tap opens it.") : hint("No single on/off state; for reference only.")}
    ${heading("Identity")}
    ${text("plan name", "uun", u.name ?? "", (v) => c.commit((f) => { setOrDelete(f.unlinked[i], "name", v.trim()); }))}
    ${heading("Home Assistant")}
    ${multiAttachField(c, "uuattach", "attached entities", u.attached ?? [], c.st.unlinkedAttachChoices(u.type), setAttached, { apply: mutateAttached, targetLabel: u.name ?? label })}
    ${heading("Appearance")}
    <label for="uucol">colour</label>
    <input id="uucol" type="color" .value=${u.color ?? "#8b8578"} @change=${(e: Event) => c.commit((f) => { f.unlinked[i].color = val(e); })}>
    ${button("uuclr", "Use default colour", () => c.commit((f) => { delete f.unlinked[i].color; }))}
    ${number(c, "scale", "uusc", u.scale, (n) => c.commit((f) => { f.unlinked[i].scale = Math.min(4, Math.max(0.25, n)); }))}
    ${heightField(c, "height (cm)", "uuht", u.height, UNLINKED_HEIGHTS[u.type] ?? 100, heightSetter(c, "unlinked", i, "height"))}
    <p class="hint" id="uusize">H ${Math.round(unlinkedHeight(u))} × W ${Math.round(UNLINKED_BASE * u.scale)} × L ${Math.round(UNLINKED_BASE * u.scale)} cm</p>
    ${rotationSlider(c, "uurot", "unlinked", i, u.rot)}
    ${rotateButtons(c, "uurot", (n) => c.commit((f) => { f.unlinked[i].rot = ((u.rot + n) % 360 + 360) % 360; }), { reset: () => { if (u.rot) c.commit((f) => { f.unlinked[i].rot = 0; }); } })}
    ${heading("Danger")}
    <p>${button("uudel", "Delete", () => { c.commit((f) => { f.unlinked.splice(i, 1); }); c.select(null); }, "warn")}</p>`;
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
  // Auto is the field left out, so the file stays as it was; the label says what Auto draws on this floor.
  const auto = resolveStairDirection({ ...t, direction: undefined }, floorsAroundKey(c.st.layout, c.st.floor));
  const setDirection = (v: string) => {
    if (v !== "auto" && !(STAIR_DIRECTIONS as readonly string[]).includes(v)) return;
    c.commit((f) => { if (v === "auto") delete f.stairs[i].direction; else f.stairs[i].direction = v as StairDirection; });
  };
  const directionSelect = html`<label for="sdir">direction</label><select id="sdir" .value=${t.direction ?? "auto"} @change=${(e: Event) => setDirection(val(e))}>
    <option value="auto" ?selected=${!t.direction}>Auto (${auto})</option>${STAIR_DIRECTIONS.map((d) => html`<option value=${d} ?selected=${d === t.direction}>${STAIR_DIRECTION_LABELS[d]}</option>`)}</select>`;
  return html`<strong>Stairs</strong>
    ${round ? hint("Drag to move; set size below.")
      : t.rot ? hint("Rotated: set 0 to reshape.")
      : html`${hint("Drag corners to reshape.")}${hint("Click an edge to add a point.")}`}
    ${heading("Identity")}
    ${text("name", "sn", t.name, (v) => c.commit((f) => { f.stairs[i].name = v; }))}
    ${select("shape", "ss", t.shape, STAIR_SHAPES, setShape)}
    ${directionSelect}
    <p><span>steps</span> <span id="sstn">${stairSteps(t)}</span> <span class="hint fit">one every 40 cm</span></p>
    ${heading("Appearance")}
    ${rotateButtons(c, "srot", (n) => c.commit((f) => { f.stairs[i].rot = ((t.rot + n) % 360 + 360) % 360; }), { reset: () => { if (t.rot) c.commit((f) => { f.stairs[i].rot = 0; }); }, title: round ? undefined : "A rotated flight has no corner handles: set the rotation to 0 to reshape it." })}
    ${round ? html`${number(c, "outer diameter (cm)", "sdia", t.dia ?? 0, setDia)}${number(c, "inner diameter (cm)", "sinner", t.inner ?? 0, setInner)}` : nothing}
    ${paintControls(c, "stairs", i, "s", t)}
    ${heading("Danger")}
    <p>${button("sdel", "Delete", () => { c.commit((f) => { f.stairs.splice(i, 1); }); c.select(null); }, "warn")}</p>
    ${hint("Added to every floor; deleted from one only.")}`;
}
