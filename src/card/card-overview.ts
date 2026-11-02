import { type ActiveDevice, activeDevices, ALL_OFF_TITLE, allOffTitle, type Attention, attention, type AttentionItem, type AttentionKind, type CategoryId, customCalls, customScene, DEVICE_ICONS, deviceCentre, type DeviceType, filterToRoom, floorSummary, formatAge, formatChanged, groupByCategory, type LayerId, layerOfType, layerWord, layoutEntries, pieceDevice, plugThreshold, presetCalls, type RoomDeviceRow, roomHeat, roomScenes, type RoomSensorRow, roomSummary, type RoomSummary, sceneNeedsConfirm, type SearchEntry, stateText, type ThingRef } from "../core";
import { colorVarFor } from "../core/active";
import { t, tn } from "../core/i18n";
import { fireEvent, openView } from "./actions";
import { favouriteRefs } from "./favourites";
import type { PopupOp } from "./popup";
import type { PopupSubject } from "./popup-ui";
import { scenesTemplate } from "./room-scenes-ui";
import type { Pt } from "./viewport";
import { html, nothing } from "lit";
import { floorOffButton, openVacuumDialog } from "./card-dialogs";
import { overviewStates } from "./card-replay";
import { callService, closePopup, deviceSubject, openPopup, openSubject, popupMarkup, runOp, subjectOf, subjectOp, subjectText, thingSel } from "./card-popup";
import { back, popupInSheet, sheetTo, toggleActiveCollapsed } from "./card-sheet";
import { scheduleSave } from "./card-view-state";
import type { FloorplanStudioCard, PickMemo } from "./floorplan-studio-card";

/** The words the side panel says for a room and for a floor (S20.2): the same panel, one subject. */
export interface Scope { unnamed: string; clear: string; noDevices: string; nothingOn: string; activeHere: string; onlyHere: string }
export const ROOM_SCOPE: Scope = {
  get unnamed() { return t("Unnamed room"); }, get clear() { return t("Clear the room selection"); }, get noDevices() { return t("No devices in this room"); },
  get nothingOn() { return t("Nothing on in this room"); }, get activeHere() { return t("Active in this room"); }, get onlyHere() { return t("This room only"); },
};
export const FLOOR_SCOPE: Scope = {
  get unnamed() { return t("Unnamed floor"); }, get clear() { return t("Clear the floor selection"); }, get noDevices() { return t("No devices on this floor"); },
  get nothingOn() { return t("Nothing is on, on this floor"); }, get activeHere() { return t("Active on this floor"); }, get onlyHere() { return t("This floor only"); },
};

/** The Scenes section starts folded, so its fold set entry means "opened by the user" (the other groups start open and the entry means folded). */
const SCENES_OPEN = "r:scenes:open";
/** S24.7: the Overview's Unavailable row starts folded, like Scenes: its entry means "opened". */
const UNAVAILABLE_OPEN = "a:unavailable:open";
/** S24.7: a row tap zooms to at least this, against the whole floor, and rings its thing this long. */
const LOCATE_ZOOM = 2;
const PULSE_MS = 2400;

/** S24.7: one Overview row, an Attention item or an active device, with where it is (`at`) so a tap can go there. */
interface OverviewRow { entity: string; name: string; floor: string; at: ThingRef | { what: "room"; index: number }; room?: string; state: string; age?: string; type?: DeviceType; colorVar: string; attn: boolean }
/** What an Attention row says after its name. Every kind is a decision (finding 17): a new kind fails to compile here. */
const ATTENTION_TEXT: Record<AttentionKind, (it: AttentionItem, level: string) => string> = {
  "alarm-triggered": () => t("triggered"),
  "alarm-armed": (it) => it.state.replace(/_/g, " "), // Home Assistant's own state word
  open: () => t("open"),
  jammed: () => t("jammed"),
  unlocked: () => t("unlocked"),
  leak: () => t("leak"),
  smoke: () => t("smoke"),
  "too-hot": (it) => t("{reading}, above {bound}", { reading: it.state, bound: String(it.bound ?? "") }), // the name is the room's
  "too-cold": (it) => t("{reading}, below {bound}", { reading: it.state, bound: String(it.bound ?? "") }),
  "battery-low": (_it, level) => (level ? t("battery {level} %", { level }) : t("battery low")),
  unavailable: () => t("unavailable"),
};
/** The header's count chips, short: "6 lights · 2 alerts". Singular and plural per category; every category is a decision. */
const CHIP_TEXT: Record<CategoryId, (n: number) => string> = {
  lights: (n) => tn("{n} light", "{n} lights", n), climate: (n) => tn("{n} heating", "{n} heating", n), security: (n) => tn("{n} sensor", "{n} sensors", n),
  media: (n) => tn("{n} playing", "{n} playing", n), power: (n) => tn("{n} plug", "{n} plugs", n), covers: (n) => tn("{n} cover", "{n} covers", n),
  computing: (n) => tn("{n} computer", "{n} computers", n), sensors: (n) => tn("{n} sensor", "{n} sensors", n),
  people: (n) => tn("{n} person", "{n} people", n), other: (n) => tn("{n} other", "{n} other", n),
};

/** S33 review: the entity domains `tap_action: toggle` may operate without the popup. A plain on/off of a light, a switch, an input_boolean or a fan. Lock, cover and siren open the popup: a stray tap never unlocks a door, moves a garage door or sounds a siren. Climate, humidifier, water_heater, automation, remote, media_player and group do too: their on/off is not a lamp's. */
export const TOGGLE_AT_ONCE = new Set(["light", "switch", "input_boolean", "fan"]);

export function toggleCat(c: FloorplanStudioCard, id: string): void {
  if (!c._foldedCats.delete(id)) c._foldedCats.add(id);
  try { globalThis.localStorage?.setItem(c._catStorageKey(), JSON.stringify([...c._foldedCats])); } catch { /* storage blocked: the fold just does not persist */ }
  c.requestUpdate();
}

/** S14.6: one category of rows under a header button. `list` is `a` (Active), `r` (Room) or `f` (Favourites); folded state is per list. */
export function catGroup(c: FloorplanStudioCard, list: "a" | "r" | "f", id: string, label: string, count: number, rows: unknown) {
  const key = `${list}:${id}`, folded = c._foldedCats.has(key);
  return html`<div class="fp-active-group" data-cat=${id}>
      <button type="button" class="fp-active-group-label fp-cat" aria-expanded=${folded ? "false" : "true"} @click=${() => toggleCat(c, key)}>
        <span class="fp-cat-chev" aria-hidden="true">${folded ? "▸" : "▾"}</span><span class="fp-cat-name">${label}</span><span class="fp-active-count">${count}</span>
      </button>${folded ? null : rows}
    </div>`;
}

/** S24.7 (F2): a tap on an Overview row goes to its thing; the popup opens beside the row. */
export function tapOverviewRow(c: FloorplanStudioCard, o: OverviewRow, e: MouseEvent): void {
  if (o.at.what === "room") return goToRoom(c, o.floor, o.at.index);
  const row = e.currentTarget as Element, b = row.getBoundingClientRect();
  locate(c, { floor: o.floor, ...o.at }, row, e.detail > 0 ? { x: e.clientX, y: e.clientY } : { x: b.left + b.width / 2, y: b.bottom });
}

/** S42.3: a tap on a temperature row does what a tap on the room does on the plan: the floor, then the room picked (the
 *  sheet rises on a phone). A floor the card cannot show does nothing. */
function goToRoom(c: FloorplanStudioCard, floor: string, index: number): void {
  if (!(floor === c._floorKey() || c._floorList()?.some(([k]) => k === floor))) return;
  c._selectFloor(floor); // a no-op on the floor already shown
  pickRoom(c, index);
}

/**
 * S24.7: go to a thing of the layout. It switches to its floor when the card can show that floor (a card pinned to one
 * floor cannot: it only opens the popup), centres the plan on it at `LOCATE_ZOOM` or closer (not in 3D, and with
 * `zoom: false` at the zoom on show), rings it for `PULSE_MS`, and opens its popup beside `from`. A linked piece opens
 * more-info, as its tap on the plan does. A ref that names nothing does nothing. The search (S24.8) calls this too.
 */
export function locate(c: FloorplanStudioCard, ref: { floor: string } & ThingRef, from: Element | null = null, at: { x: number; y: number } | null = null): void {
  const f = c._layout?.floors[ref.floor];
  if (!f || !Number.isInteger(ref.index) || ref.index < 0) return;
  const device = ref.what === "device" ? f.devices[ref.index] : undefined;
  const piece = ref.what === "piece" ? f.furniture?.[ref.index] : undefined;
  const door = ref.what === "door" ? f.doors?.[ref.index] : undefined;
  const p: Pt | null = device ? deviceCentre(device) : piece ? [piece.x, piece.y] : door ? [(door.a[0] + door.b[0]) / 2, (door.a[1] + door.b[1]) / 2] : null;
  if (!device && !piece && !door) return;
  const shows = ref.floor === c._floorKey() || !!c._floorList()?.some(([k]) => k === ref.floor);
  if (shows) {
    c._selectFloor(ref.floor); // a no-op on the floor already shown
    if (p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && !c._shows3d()) {
      const now = c._pendingView?.zoom ?? c._anchorOfView()?.zoom ?? 1;
      c._pendingView = { focus: p, zoom: c._zoomMode() === false ? now : Math.max(now, LOCATE_ZOOM) };
      scheduleSave(c);
    }
    startPulse(c, { floor: ref.floor, what: ref.what, index: ref.index });
  }
  // S24.8: search and rows do not follow Layers. A thing of a hidden family is drawn anyway, and the sheet says why it is alone.
  const fam: LayerId | null = device ? layerOfType(device.type) : piece ? "furniture" : null;
  c._kept = shows && fam && c._hiddenLayers.includes(fam) ? { floor: ref.floor, t: device ? "dev" : "furn", i: ref.index, fam } : null;
  const point = at ?? (() => { const b = (from ?? c).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.bottom }; })();
  if (piece) { const d = pieceDevice(piece); if (d) { if (piece.symbol === "car") openSubject(c, deviceSubject(c, d), point, from); else fireEvent(c, "hass-more-info", { entityId: d.entity }); } }
  else if (device) openSubject(c, deviceSubject(c, device), point, from);
  else if (door) { const s = subjectOf(c, { door, index: ref.index }); if (s) openSubject(c, s, point, from); }
  if (shows && (device || door) && c._popup) c._panTarget = thingSel(c, ref.what, ref.index); // S31.8: the plan goes to it, above the sheet
  c.requestUpdate();
}

export function startPulse(c: FloorplanStudioCard, p: { floor: string } & ThingRef): void {
  c._pulse = p;
  if (c._pulseTimer !== null) globalThis.clearTimeout(c._pulseTimer);
  c._pulseTimer = globalThis.setTimeout(() => { c._pulseTimer = null; c._pulse = null; c.requestUpdate(); }, PULSE_MS);
  // The ring is placed after a render, but the plan can move without one (a pan, a sheet rising, a layout settling): follow it every frame.
  globalThis.cancelAnimationFrame(c._pulseRaf);
  const follow = () => { if (!c._pulse) return; placePulse(c); c._pulseRaf = globalThis.requestAnimationFrame(follow); };
  c._pulseRaf = globalThis.requestAnimationFrame(follow);
}

/** After every render: the ring sits over its thing's icon, door or piece on the plan, or hides when the plan does not show it. */
export function placePulse(c: FloorplanStudioCard): void {
  const ring = c.shadowRoot?.querySelector<HTMLElement>(".fp-pulse");
  const p = c._pulse;
  if (!ring || !p) return;
  const sel = thingSel(c, p.what, p.index);
  const el = p.floor === c._floorKey() ? c.shadowRoot?.querySelector(sel) : null;
  const r = el?.getBoundingClientRect(), h = c.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) { ring.hidden = true; return; }
  const size = Math.max(24, Math.min(r.width, r.height) + 16);
  ring.hidden = false;
  ring.style.left = `${r.left - h.left + r.width / 2}px`;
  ring.style.top = `${r.top - h.top + r.height / 2}px`;
  ring.style.width = ring.style.height = `${size}px`;
}

/** The key of the selected floor while it is the one shown, else null (a floor the config no longer lists means nothing). */
export function pickedFloorKey(c: FloorplanStudioCard): string | null {
  return c._pickedFloor !== null && c._pickedFloor === c._floorKey() ? c._pickedFloor : null;
}

export function pickFloor(c: FloorplanStudioCard, key: string | null): void {
  c._pickedRoom = null;
  c._pickedFloor = key;
  c._roomFilter = true;
  c._sceneAsk = null;
  if (key !== null) sheetTo(c, "half");
  c.requestUpdate();
}

/** S11.3: the index of the picked room on the shown floor, or null: none picked, a room of another floor, or one the
 *  layout no longer has (a reload keeps the id, so it survives an edit that moves the index). */
export function picked(c: FloorplanStudioCard): number | null {
  const p = c._pickedRoom, f = c._floor();
  if (!p || !f || c._floorKey() !== p.floor) return null;
  const i = f.rooms.findIndex((r) => r.id === p.id);
  return i < 0 ? null : i;
}

/** Picks the room at floor index `i` of the shown floor, or clears with `null`. A new pick turns the filter back on. */
export function pickRoom(c: FloorplanStudioCard, i: number | null): void {
  c._releaseFocus(); // a row, a search result, Back: the camera follows at once (a canvas tap holds it again after this call)
  const room = i === null ? undefined : c._floor()?.rooms[i];
  const key = c._floorKey();
  c._pickedRoom = room && key ? { floor: key, id: room.id } : null;
  c._pickedFloor = null;
  c._roomFilter = true;
  c._sceneAsk = null;
  if (c._pickedRoom) { sheetTo(c, "half"); c._panTarget = "svg polygon.room-picked"; }
  c.requestUpdate();
}

/** S11.3: a tap that landed on no device, door or appliance. It picks the room under the finger: the first room polygon
 *  of everything stacked at that point (`elementsFromPoint`), so the room's name, its readout and its furniture count as
 *  its floor, on a turned plan and in 2.5D too. A zone or a structure lies over a room rather than being one, so it is
 *  looked through; a device's pin or stem is not (it is the device's, and a device never picks). The same room again, anything else, or a hatched fill clears. Only with the panel on: kiosk and
 *  `active_list: false` have nowhere to show a room. */
export function tapRoom(c: FloorplanStudioCard, e: PointerEvent): void {
  if (!c._activeListVisible()) return;
  const rooms = c._floor()?.rooms ?? [];
  const root = c.shadowRoot;
  // jsdom has no elementsFromPoint: the event's own target stands in, as it did before.
  const stack = root && typeof root.elementsFromPoint === "function" ? root.elementsFromPoint(e.clientX, e.clientY) : [e.target as Element | null];
  let i = -1;
  for (const n of stack) {
    const hit = n?.closest?.("polygon[data-r]");
    if (hit) {
      const k = Number(hit.getAttribute("data-r")), kind = rooms[k]?.kind;
      if (kind === "zone" || kind === "structure" || kind === "fill") continue; // not rooms: look through to the room below
      i = k;
      break;
    }
    // A room's own name (data-rl), its readout (data-rv) and its furniture are its floor. Anything else on top (a device's
    // value or name, a structure line's name, a wall) is its own thing: no pick.
    if (!n?.closest?.("text[data-rl], text[data-rv], g.furn")) break;
  }
  const room = rooms[i];
  pickRoom(c, room && picked(c) !== i ? i : null);
}

/** What a double tap restores: the pick as it was before its first tap, which `_tapRoom` already changed. */
export function restorePick(c: FloorplanStudioCard, before: PickMemo): void {
  c._pickedRoom = before.pick;
  c._pickedFloor = before.floor;
  c._roomFilter = before.filter;
  c.requestUpdate();
}

/** A keyboard press on a toggling row does what a tap on its icon does (S14.2): it opens the popup, anchored on the row. Nothing is operated by the press itself. */
export function keyToggle(c: FloorplanStudioCard, r: RoomDeviceRow, row: Element | null): void {
  const d = c._floor()?.devices[r.index];
  const b = row?.getBoundingClientRect();
  if (!c._replay && !c._kiosk() && openView(d?.view)) return; // as its tap does (the replay guard of the popup says "Replaying")
  if (d?.type === "vacuum") { openVacuumDialog(c, d); return; } // as its tap on the plan does
  if (d) openPopup(c, { device: d, index: r.index }, { x: b ? b.left + b.width / 2 : 0, y: b ? b.bottom : 0 }, row);
}

/** A row of the room section's device list. It carries `data-x`, so the panel's own `bindDeviceActions` gives it the
 *  plan icon's gestures: a tap opens the popup, a hold opens more-info. Its `click` only acts for a keyboard press
 *  (`detail` 0), which sends no pointer events. */
export function roomDeviceRow(c: FloorplanStudioCard, r: RoomDeviceRow) {
  // S14 review: every row is the plan icon's twin (`data-x`): a tap opens the popup, a hold opens more-info, whatever the type.
  const click = (e: MouseEvent) => { if (e.detail === 0) keyToggle(c, r, e.currentTarget as Element); };
  // A linked piece has no `data-x` (its index is in `furniture`, not `devices`): its row is its tap on the plan, more-info.
  if (r.piece) {
    return html`<div class="fp-item">
      <button type="button" class=${r.on ? "fp-active-row" : "fp-active-row fp-off"} style="--fp-active-row-color:var(${r.colorVar})" @click=${() => fireEvent(c, "hass-more-info", { entityId: r.entity })}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${DEVICE_ICONS[r.type]}></path></svg>
        <span>${r.name}</span><span class="fp-row-state">${r.state}</span>
      </button>
    </div>`;
  }
  return html`<div class="fp-item">
      <button type="button" class=${r.on ? "fp-active-row" : "fp-active-row fp-off"} data-x=${String(r.index)} style="--fp-active-row-color:var(${r.colorVar})" @click=${click}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${DEVICE_ICONS[r.type]}></path></svg>
        <span>${r.name}</span><span class="fp-row-state">${r.state}</span>
      </button>
    </div>`;
}

/** A sensor the room owns that has no icon on the plan: listed by its friendly name (or entity id), a plain more-info row. */
export function roomSensorRow(c: FloorplanStudioCard, r: RoomSensorRow) {
  const type = r.kind === "temps" ? "temp" : r.kind;
  return html`<div class="fp-item">
      <button type="button" class=${r.state === "on" ? "fp-active-row" : "fp-active-row fp-off"} style="--fp-active-row-color:var(${r.state === "on" ? "--fp-dev-motion" : "--fp-ink"})" @click=${() => fireEvent(c, "hass-more-info", { entityId: r.entity })}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${DEVICE_ICONS[type]}></path></svg>
        <span>${r.name}</span><span class="fp-row-state">${r.state}</span>
      </button>
    </div>`;
}

/** S14.7: the room's scene buttons: Home Assistant scenes, custom scenes, All off and All on. */
export function scenesBlock(c: FloorplanStudioCard) {
  const f = c._floor(), at = picked(c);
  if (!f || at === null) return nothing;
  const menu = roomScenes(f, at, c._hass);
  return scenesTemplate({ menu, asking: c._sceneAsk, run: (key) => runScene(c, key), cancel: () => { c._sceneAsk = null; c.requestUpdate(); }, open: c._foldedCats.has(SCENES_OPEN), toggle: () => toggleCat(c, SCENES_OPEN) });
}

/** One tap on a scene button. A Home Assistant scene is `scene.turn_on`; a custom scene and the presets go through the light and switch services (`customCalls`, `presetCalls`). A custom scene that turns a switch off asks first. */
export function runScene(card: FloorplanStudioCard, key: string): void {
  const f = card._floor(), at = picked(card), call = card._hass?.callService;
  if (!f || at === null || !call) return;
  const [kind, id = ""] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  const send = (c: { domain: string; service: string; data: Record<string, unknown> }) => callService(card, c.domain, c.service, c.data);
  if (kind === "ha") {
    if (!roomScenes(f, at, card._hass).ha.some((s) => s.entity === id)) return;
    send({ domain: "scene", service: "turn_on", data: { entity_id: id } });
  } else if (kind === "preset") {
    if (id !== "on") return; // S24.8: the only preset left; the room's Lights off button is the off
    for (const c of presetCalls("on", roomScenes(f, at, card._hass).lights)) send(c);
  } else if (kind === "custom") {
    const scene = customScene(f, at, id);
    if (!scene) return;
    if (sceneNeedsConfirm(scene) && card._sceneAsk !== key) { card._sceneAsk = key; card.requestUpdate(); return; }
    for (const c of customCalls(scene)) send(c);
  }
  card._sceneAsk = null;
  card.requestUpdate();
}

/** S20.1: the room's or floor's Lights off (S24.8; was All off). One call per domain (`presetCalls`, the scene preset's own builder) over
 *  `offEntities`: the lights that are on, and (S22.1) the bound relays that are on, each once. In practice one
 *  `light.turn_off` and, with a relay-lit lamp, one `switch.turn_off`. */
export function allOff(card: FloorplanStudioCard, lights: string[]): void {
  for (const c of presetCalls("off", lights)) callService(card, c.domain, c.service, c.data);
  card.requestUpdate();
}

/** S11.3: the room section: name, the facts the plan only hints at, and the room's devices as rows that act. A fact with
 *  nothing behind it (no sensor, no state) is left out, never printed empty; doors and lights always say "none". */
export function roomSection(c: FloorplanStudioCard, s: RoomSummary, active: unknown, scope: Scope) {
  const facts: [string, string][] = [
    [t("Area|size"), s.areaM2 === null ? "" : `${s.areaM2} m²`],
    [t("Temperature"), s.temperature],
    [t("Humidity"), s.humidity],
    [t("Motion"), s.motion ? (s.motion.on ? t("on since {when}", { when: formatChanged(s.motion.since) }) : t("off since {when}", { when: formatChanged(s.motion.since) })) : ""],
    // S24.3 (G3): an unlocked door is not an open one. "Unlocked" shows only where a door carries a lock.
    [t("Open|openings"), s.openings.join(", ") || t("none")],
    [t("Unlocked"), s.hasLocks ? s.unlocked.join(", ") || t("none") : ""],
    [t("Lights on"), s.lightsOn.join(", ") || t("none")],
  ];
  return html`<div class="fp-room">
      <div class="fp-room-head">
        <span class="fp-room-name">${s.name || scope.unnamed}</span>
        ${c._frame === "side" ? nothing : html`<button type="button" class="fp-room-clear" aria-label=${scope.clear} @click=${() => pickRoom(c, null)}>×</button>`}
      </div>
      <dl class="fp-room-facts">${facts.filter(([, v]) => v).map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      ${s.offEntities.length || scope === FLOOR_SCOPE ? html`<div class="fp-alloff-row">${s.offEntities.length ? html`<button type="button" class="fp-alloff" aria-label=${t("Lights off in {name}", { name: s.name || scope.unnamed })} title=${c._layout ? allOffTitle(c._layout.floors, c._floorKey() ?? "", s) : t(ALL_OFF_TITLE)} @click=${() => allOff(c, s.offEntities)}>${t("Lights off")}</button>` : nothing}${scope === FLOOR_SCOPE ? floorOffButton(c) : nothing}</div>` : nothing}
      ${scenesBlock(c)}
      ${active}
      <div class="fp-active-group-label">${t("Devices")}</div>
      <div class="fp-room-devices">
        ${s.devices.length || s.sensors.length
        ? groupByCategory([...s.devices.map((r) => ({ type: r.type, tpl: roomDeviceRow(c, r) })), ...s.sensors.map((r) => ({ type: (r.kind === "temps" ? "temp" : r.kind) as DeviceType, tpl: roomSensorRow(c, r) }))])
            .map((g) => catGroup(c, "r", g.id, t(g.label), g.items.length, g.items.map((i) => i.tpl)))
        : html`<p class="fp-active-empty">${scope.noDevices}</p>`}
      </div>
    </div>`;
}

/** `attention()` for the layout and states on show; computed once per pair (the pills and the Overview both read it). */
export function attentionOf(c: FloorplanStudioCard): Attention | null {
  const layout = c._layout, states = overviewStates(c), reg = c._hass?.entities; // S39 review S4: other floors stay live while replaying
  if (!layout) return null;
  const m = c._attnMemo, warn = c._tempWarn;
  if (m && m.layout === layout && m.states === states && m.reg === reg && m.warn === warn) return m.a;
  // The registry finds a placed device's battery sensor on its own HA device (S24.R1).
  const a = attention(layout, states, reg, warn);
  c._attnMemo = { layout, states, reg, warn, a };
  return a;
}

export function floorTitle(c: FloorplanStudioCard, key: string): string {
  return c._layout?.floors[key]?.title || key;
}

/** An Attention item as a row: the name, then what is wrong and for how long ("open · 12 min"). */
export function attnRow(c: FloorplanStudioCard, it: AttentionItem, now: number): OverviewRow {
  // `attention` read the level, from whichever entity or attribute reported it (S24.R1).
  const level = typeof it.level === "number" && Number.isFinite(it.level) ? String(Math.round(it.level)) : "";
  const age = formatAge(it.lastChanged, now);
  const what = ATTENTION_TEXT[it.kind]?.(it, level) ?? it.kind;
  return { entity: it.entity, name: it.name, floor: it.floor, at: { what: it.at.what, index: it.at.index }, ...(it.room ? { room: it.room } : {}), state: what, ...(age ? { age } : {}), ...(it.type ? { type: it.type } : {}), colorVar: "--fp-warn", attn: true };
}

/** An active device as a row, its state in the popup's own words (`_subjectText`): a relay-lit lamp reads "on · via …". */
export function activeRow(c: FloorplanStudioCard, it: ActiveDevice): OverviewRow {
  const f = c._layout?.floors[it.floor];
  const d = it.at.what === "device" ? f?.devices[it.at.index] : it.at.what === "piece" ? (f?.furniture?.[it.at.index] && pieceDevice(f.furniture[it.at.index]!)) || undefined : undefined;
  const state = d ? subjectText(c, deviceSubject(c, d)) : stateText(it.type, c._stateForRender()?.[it.entity], undefined, it.entity, c._format);
  return { entity: it.entity, name: it.name, floor: it.floor, at: it.at, ...(it.room ? { room: it.room } : {}), state, type: it.type, colorVar: it.colorVar, attn: false };
}

/** One row: the whole row is the one target (A3: no chevron; the details are in the popup). Text through lit, escaped (finding 2). */
export function ovRow(c: FloorplanStudioCard, o: OverviewRow, badge: boolean) {
  const icon = o.type && DEVICE_ICONS[o.type];
  return html`<button type="button" class=${o.attn ? "fp-active-row fp-ov-row fp-ov-alert" : "fp-active-row fp-ov-row"} data-pop data-entity=${o.entity} data-floor=${o.floor}
      style="--fp-active-row-color:var(${o.colorVar})" @click=${(e: MouseEvent) => tapOverviewRow(c, o, e)}>
      ${o.attn || !icon ? html`<span class="fp-ov-mark" aria-hidden="true">⚠</span>` : html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${icon}></path></svg>`}
      <span class="fp-ov-text"><span class="fp-ov-name">${o.name}</span>${o.room || badge
      ? html`<span class="fp-ov-where">${o.room ?? ""}${badge ? html`<span class="fp-row-floor">${floorTitle(c, o.floor)}</span>` : nothing}</span>`
      : nothing}</span>
      <span class="fp-row-state">${o.state}${o.age ? html` · <span class="fp-ov-age">${o.age}</span>` : nothing}</span>
    </button>`;
}

/** S34.4 (F2, F3): the Favourites section, or nothing. Every floor the card shows, whatever "All floors" says. A row is the
 *  Active row (a tap goes to the thing) and the popup's own button beside it, from `_popupOp` and `_runOp`; a turn OFF that
 *  asks turns the button into Confirm and Cancel. A thing with no button (a sensor, `NO_TOGGLE`, unavailable) has none. */
export function favouriteSection(c: FloorplanStudioCard) {
  const layout = c._layout;
  if (!layout || !c._fav.ids.length) return nothing;
  const shown = c._floorList()?.map(([k]) => k) ?? [c._floorKey() ?? ""];
  const badge = shown.length > 1;
  const rows = favouriteRefs(layout, c._fav.ids, shown).flatMap((r) => {
    const f = layout.floors[r.floor], m = f?.furniture?.[r.ref.index];
    const d = r.ref.what === "device" ? f?.devices[r.ref.index] : m ? pieceDevice(m) : undefined;
    if (!d) return [];
    const s = deviceSubject(c, d), op = subjectOp(c, s), state = c._stateForRender()?.[r.entity]?.state;
    const row: OverviewRow = { entity: r.entity, name: s.name, floor: r.floor, at: r.ref, state: subjectText(c, s), type: d.type, colorVar: colorVarFor(d, c._stateForRender()), attn: false };
    const confirm = op ? favConfirm(c, op, r.entity) : null;
    const asking = !!confirm && c._favAsk === r.entity;
    const act = !op ? nothing : asking
      ? html`<div class="fp-fav-confirm"><button type="button" class="fp-fav-act" @click=${() => favAct(c, s, op)}>${confirm}</button><button type="button" class="fp-fav-cancel" @click=${() => { c._favAsk = null; c.requestUpdate(); }}>${t("Cancel")}</button></div>`
      : html`<button type="button" class="fp-fav-act" @click=${() => favAct(c, s, op)}>${op.label}</button>`;
    return [html`<div class=${state === "unavailable" || state === "unknown" ? "fp-fav-row fp-fav-gone" : "fp-fav-row"} data-entity=${r.entity}>${ovRow(c, row, badge)}${act}</div>`];
  });
  if (!rows.length) return nothing;
  return html`<section class="fp-ov-section fp-ov-fav">${catGroup(c, "f", "favourites", t("Favourites"), rows.length, rows)}</section>`;
}

/** The confirm text a row button asks with, or null when it acts at once. Same rule as `tap_action: toggle`: only a plain
 *  on/off (`TOGGLE_AT_ONCE`) acts on one tap; a lock or a cover asks, so one phone tap never unlocks or opens anything (S33). */
export function favConfirm(c: FloorplanStudioCard, op: PopupOp, entity: string): string | null {
  if (op.confirm) return op.confirm;
  return TOGGLE_AT_ONCE.has(entity.split(".")[0] ?? "") ? null : op.ask;
}

/** The row button: one service call, or (a turn OFF that asks) the first press only opens the confirm step. */
export function favAct(c: FloorplanStudioCard, s: PopupSubject, op: PopupOp): void {
  if (favConfirm(c, op, s.entity ?? "") && c._favAsk !== s.entity) { c._favAsk = s.entity ?? null; c.requestUpdate(); return; }
  c._favAsk = null;
  runOp(c, s, op);
  c.requestUpdate();
}

/** S24.7: Attention on top, then Active by category, over `attn` and `items` (already cut to the scope). */
export function overviewList(c: FloorplanStudioCard, attn: Attention, items: ActiveDevice[], badge: boolean, empty: string) {
  const now = c._now();
  const unOpen = c._foldedCats.has(UNAVAILABLE_OPEN);
  const attnRows = attn.items.map((it) => attnRow(c, it, now));
  const groups = groupByCategory(items.map((it) => ({ type: it.type, row: activeRow(c, it) })));
  return html`${attnRows.length || attn.unavailable.length ? html`<section class="fp-ov-section fp-ov-attn"><div class="fp-ov-head">${t("Attention · {n}", { n: attnRows.length })}</div>
        ${attnRows.map((o) => ovRow(c, o, badge))}
        ${attn.unavailable.length ? html`<div class="fp-active-group" data-cat="unavailable">
          <button type="button" class="fp-active-group-label fp-cat" aria-expanded=${unOpen ? "true" : "false"} @click=${() => toggleCat(c, UNAVAILABLE_OPEN)}>
            <span class="fp-cat-chev" aria-hidden="true">${unOpen ? "▾" : "▸"}</span><span class="fp-cat-name">${t("Unavailable")}</span><span class="fp-active-count">${attn.unavailable.length}</span>
          </button>${unOpen ? attn.unavailable.map((it) => ovRow(c, attnRow(c, it, now), badge)) : nothing}
        </div>` : nothing}
      </section>` : nothing}
      <section class="fp-ov-section fp-ov-act"><div class="fp-ov-head">${t("Active · {n}", { n: items.length })}</div>
        ${groups.length ? groups.map((g) => catGroup(c, "a", g.id, t(g.label), g.items.length, g.items.map((i) => ovRow(c, i.row, badge)))) : html`<p class="fp-active-empty">${empty}</p>`}
      </section>`;
}

/** The header's chips: the alerts, then one per category with something on, short ("2 alerts · 6 lights"). */
export function chips(c: FloorplanStudioCard, items: ActiveDevice[], alerts: number) {
  const parts = groupByCategory(items).map((g) => ({ text: CHIP_TEXT[g.id](g.items.length), warn: false }));
  // What is wrong comes first, so a folded header that cuts the line short still shows it.
  if (alerts) parts.unshift({ text: tn("{n} alert", "{n} alerts", alerts), warn: true });
  return html`<span class="fp-ov-chips" title=${parts.map((p) => p.text).join(" · ")}>${parts.length ? parts.map((p, i) => html`${i ? " · " : ""}<span class=${p.warn ? "fp-chip fp-chip-warn" : "fp-chip"}>${p.text}</span>`) : t("Nothing on")}</span>`;
}

/** S9.5, S24.7: the floating Overview, card chrome outside the `<svg>` (finding 8). What is wrong (`attention`) comes before
 *  what is on (`activeDevices`, the one place that decides "active"); a thing in Attention is not listed again under Active.
 *  The scope is the floor on show, or every floor with "All floors" (F3), which then badges each row with its floor.
 *
 *  S11.3, S20.2: with a room or floor picked, its section comes first and the list below is cut to its entities
 *  (`filterToRoom`) until "Show all", which lists every floor. The panel stays open while a room is picked. */
export function activePanel(c: FloorplanStudioCard) {
  if (!c._activeListVisible() || !c._layout) return null;
  const state = overviewStates(c);
  const opts = { plugWatts: plugThreshold(c._config.plug_watts), powerLinks: c._powerLinks(), formatState: c._format };
  const at = picked(c), floor = c._floor();
  const floorKey = pickedFloorKey(c), shown = c._floorKey();
  // S20.2: the panel's one subject is the picked room, else the selected floor, summed over its rooms by the same builder.
  const summary = at !== null && floor ? roomSummary(floor, at, state, opts) : floorKey && floor ? floorSummary(floor, state, opts) : null;
  if (summary && at === null && floorKey && !summary.name) summary.name = floorKey;
  // H2: in a heat mode the panel prints the number the plan prints (`roomHeat` drops faulty readings), not its own mean.
  const hk = c._heatKind(), heat = summary && at !== null && floor && hk !== "off" ? roomHeat(floor, at, hk, state) : null;
  if (summary && heat) summary[hk === "temperature" ? "temperature" : "humidity"] = heat.text;
  const scope = at === null && floorKey ? FLOOR_SCOPE : ROOM_SCOPE;
  const many = Object.keys(c._layout.floors).length > 1;
  // The scope: the picked room or floor while its filter is on; every floor under "Show all"; else the floor on show, or all.
  const all = summary ? !c._roomFilter : c._overviewAll || !many;
  const a = attentionOf(c) ?? { items: [], unavailable: [], floors: {} };
  const inScope = <T extends { floor: string; entity: string }>(list: T[]): T[] => (summary && c._roomFilter ? filterToRoom(list.filter((x) => x.floor === shown), summary) : all ? list : list.filter((x) => x.floor === shown));
  // S42.3: a room's own warning has no entity, so `filterToRoom` cannot see it; the picked room keeps it.
  const own = (it: AttentionItem) => at !== null && it.floor === shown && it.at.what === "room" && it.at.index === at;
  const attn: Attention = { items: summary && c._roomFilter ? a.items.filter((it) => own(it) || inScope([it]).length > 0) : inScope(a.items), unavailable: inScope(a.unavailable), floors: a.floors };
  // Only what Attention says about the same fact leaves Active (an open door, an unlocked lock). A low battery says
  // nothing about on or off: a lamp that is on and low is in both (S24.R6).
  const flagged = new Set(attn.items.filter((it) => it.kind !== "battery-low").map((it) => it.entity));
  const items = inScope(activeDevices(c._layout, state, opts)).filter((it) => !flagged.has(it.entity));
  const badge = all && many;
  const list = overviewList(c, attn, items, badge, summary && c._roomFilter ? scope.nothingOn : t("Nothing on"));
  const crumb = summary ? (shown ? floorTitle(c, shown) : "") : all && many ? t("All floors") : shown ? floorTitle(c, shown) : "";
  // S31.5: from 640 px it is the side sheet (a cell of the grid, a 52 px rail when folded); S31.8: under it, the bottom sheet.
  const side = c._frame === "side";
  const name = summary ? summary.name || scope.unnamed : t("Overview");
  const content = () => summary
    ? roomSection(c, summary, html`<div class="fp-filter"><span>${c._roomFilter ? scope.activeHere : t("Active everywhere")}</span><button type="button" class="fp-show-all" @click=${() => { c._roomFilter = !c._roomFilter; c.requestUpdate(); }}>${c._roomFilter ? t("Show all") : scope.onlyHere}</button></div>
                <div class="fp-filtered">${list}</div>`, scope)
    : html`<div class="fp-ov-search" data-slot="search"><fp-search .entries=${searchEntries(c)} .first=${c._favSet} label=${t("Search the plan")} placeholder=${t("Search rooms and devices")} @fp-pick=${(e: CustomEvent<SearchEntry>) => onSearchPick(c, e)}></fp-search></div>
                <div class="fp-ov-scopes">${floorOffButton(c)}${many ? html`<button type="button" class="fp-ov-scope" aria-pressed=${c._overviewAll ? "true" : "false"} @click=${() => toggleOverviewAll(c)}>${t("All floors")}</button>` : nothing}</div>
                <div class="fp-ov-layers" data-slot="layers">${layerNote(c)}</div>
                ${favouriteSection(c)}${list}
                <p class="fp-ov-hint">${t("Tap a row: the plan goes to it.")}</p>`;
  if (!side) return bottomSheet(c, name, crumb, summary !== null, chips(c, items, attn.items.length), content);
  const folded = c._activeCollapsed && !summary;
  const cls = ["fp-active", "fp-side", summary ? "fp-room-open" : folded ? "fp-rail" : ""].filter(Boolean).join(" ");
  if (folded) {
    const n = attn.items.length;
    return html`<div class=${cls} role="region" aria-label=${t("Overview")}>
        <button type="button" class="fp-rail-open" aria-label=${t("Open overview")} aria-expanded="false" title=${n ? t("Open overview, {alerts}", { alerts: tn("{n} alert", "{n} alerts", n) }) : t("Open overview")} @click=${() => toggleActiveCollapsed(c)}>▸${n ? html`<span class="fp-rail-count">${n}</span>` : nothing}</button>
      </div>`;
  }
  return html`<div class=${cls} role="region" aria-label=${name}>
      <div class="fp-active-head">
        ${summary ? html`<button type="button" class="fp-back" aria-label=${t("Back")} title=${t("Back")} @click=${() => back(c)}>←</button>` : nothing}
        <span class="fp-active-title">${t("Home")}${crumb ? html`<span class="fp-crumb"> › ${crumb}</span>` : nothing}</span>
        ${summary
        ? nothing
        : html`<button
          type="button"
          class="fp-active-collapse"
          aria-label=${c._activeCollapsed ? t("Open overview") : t("Fold overview")}
          aria-expanded=${c._activeCollapsed ? "false" : "true"}
          @click=${() => toggleActiveCollapsed(c)}
        >${c._activeCollapsed ? "▸" : "▾"}</button>`}
        ${chips(c, items, attn.items.length)}
      </div>
      <div class="fp-active-body">${content()}</div>
    </div>`;
}

/**
 * S31.8: the phone's sheet. A top row (Back, then the handle: the grabber, where we are, the counts) and a body that is the
 * level's content: the Overview, a floor or a room as the side sheet shows them, or the popup as the Device level. At peek the
 * body is `inert`, so nothing under the clipped edge takes a Tab. The handle is one button: a tap or Enter or Space cycles the
 * stops, a drag moves them (see the block comment above the class). Its name is "Overview" on every level, the spec's name; the
 * region around it is named for the level.
 */
export function bottomSheet(c: FloorplanStudioCard, name: string, crumb: string, deeper: boolean, chips: unknown, content: () => unknown) {
  const pop = c._popup && popupInSheet(c) ? c._popup.s : null;
  const peek = c._sheetStop === "peek" && !c._sheetDrag;
  const level = pop ? pop.name : name;
  const drag = c._sheetDrag;
  return html`<div class=${drag ? "fp-active fp-bottom fp-dragging" : "fp-active fp-bottom"} data-stop=${c._sheetStop} role="region" aria-label=${level} style=${drag ? `height:${drag.h}px` : ""}
      @pointerdown=${c._sheetGuard.down} @click=${c._sheetGuard.click}>
      <div class="fp-sheet-top">
        ${deeper || pop || c._sheetStop !== "peek" ? html`<button type="button" class="fp-back" aria-label=${t("Back")} title=${t("Back")} @click=${() => back(c)}>←</button>` : nothing}
        <button type="button" class="fp-handle" aria-label=${t("Overview")} aria-expanded=${c._sheetStop === "peek" ? "false" : "true"}
          @pointerdown=${c._onHandleDown} @pointermove=${c._onHandleMove} @pointerup=${c._onHandleUp} @pointercancel=${c._onHandleCancel}
          @click=${c._onHandleClick} @keydown=${c._onHandleKey}>
          <span class="fp-grab" aria-hidden="true"></span>
          <span class="fp-handle-line"><span class="fp-active-title">${pop ? pop.name : deeper ? name : html`${t("Home")}${crumb ? html`<span class="fp-crumb"> › ${crumb}</span>` : nothing}`}</span>${pop ? html` <span class="fp-ov-chips">${subjectText(c, pop)}</span>` : chips}</span>
        </button>
      </div>
      <div class="fp-active-body" ?inert=${peek}>${pop ? popupMarkup(c, true) : content()}</div>
    </div>`;
}

export function toggleOverviewAll(c: FloorplanStudioCard): void {
  c._overviewAll = !c._overviewAll;
  c._saveActiveState();
  c.requestUpdate();
}

/** The search's entries: every device and linked piece (a card pinned to one floor still opens another floor's popup, as
 *  `_locate` does), and the floors and rooms this card can show. Cached by layout, whether states are known (names fall
 *  back to `friendly_name`) and the floors on offer, so the box indexes once per layout, not per keystroke or state update. */
export function searchEntries(c: FloorplanStudioCard): SearchEntry[] {
  const layout = c._layout;
  if (!layout) return [];
  const known = !!c._hass?.states, shown = c._floorKey() ?? "";
  const floors = [shown, ...(c._floorList() ?? []).map(([k]) => k)].join("\n");
  const m = c._searchMemo;
  if (m && m.layout === layout && m.known === known && m.floors === floors) return m.entries;
  const can = new Set(floors.split("\n"));
  const entries = layoutEntries(layout, c._hass?.states).filter((e) => e.kind === "device" || (e.floor !== undefined && can.has(e.floor)));
  c._searchMemo = { layout, known, floors, entries };
  return entries;
}

/** The chord: back to the Overview (a room or floor picked hides it), unfolded, no popup, and the search focused. False
 *  when there is no sheet to search in (kiosk, `active_list: false`, no layout), so the page keeps the key. Unfolding is
 *  the person's choice, as a tap on the fold button is. */
export function openSearch(c: FloorplanStudioCard): boolean {
  if (!c._activeListVisible() || !c._layout) return false;
  if (c._pickedRoom || c._pickedFloor) pickRoom(c, null);
  sheetTo(c, "full"); // S31.8: Search opens the phone's sheet full
  if (c._activeCollapsed) { c._activeCollapsed = false; c._activeUserChose = true; c._saveActiveState(); }
  closePopup(c);
  c.requestUpdate();
  void c.updateComplete.then(async () => {
    const box = c.shadowRoot?.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>("fp-search");
    if (!box) return;
    await box.updateComplete;
    box.focus();
  });
  return true;
}

/** Enter or a click on a result. A device or piece is located as a row tap locates it (floor, centre, ring, popup beside the
 *  sheet). A floor is shown. A room shows its floor and opens its section, and the keyboard goes to the section's close
 *  button, since the search it came from is gone with the Overview. */
export function onSearchPick(c: FloorplanStudioCard, ev: CustomEvent<SearchEntry>): void {
  const e = ev.detail;
  if (!e || typeof e.floor !== "string") return;
  if (e.kind === "device" && typeof e.device === "number") {
    locate(c, { floor: e.floor, what: e.piece ? "piece" : "device", index: e.device }, ev.currentTarget instanceof Element ? ev.currentTarget : null);
  } else if (e.kind === "floor") {
    c._selectFloor(e.floor);
  } else if (e.kind === "room" && typeof e.room === "number") {
    c._selectFloor(e.floor);
    if (c._floorKey() !== e.floor) return;
    pickRoom(c, e.room);
    void c.updateComplete.then(() => c.shadowRoot?.querySelector<HTMLElement>(".fp-back, .fp-room-clear")?.focus());
  }
}

/** The note for a thing located under a hidden family, with Show for that family. The family chips themselves are the ⋯
 *  menu's Layers section since S31.6; this stays in the Overview, where the located thing was found. */
export function layerNote(c: FloorplanStudioCard) {
  const f = c._floor(), k = keptHere(c);
  if (!f || c._shows3d() || !k) return nothing;
  const hidden = c._hiddenLayers;
  return html`<p class="fp-layer-note" role="status">${t("Hidden by Layers: {layer}", { layer: layerWord(k.fam) })} <button type="button" @click=${() => c._setLayers(hidden.filter((x) => x !== k.fam))}>${t("Show")}</button></p>`;
}

/** The kept thing when it is on the floor on show and its family is still hidden. */
export function keptHere(c: FloorplanStudioCard) {
  const k = c._kept;
  return k && k.floor === c._floorKey() && c._hiddenLayers.includes(k.fam) ? k : null;
}
