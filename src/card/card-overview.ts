import { ALL_OFF_TITLE, activeDevices, allOffTitle, type Attention, attention, customCalls, customScene, DEVICE_ICONS, deviceCentre, filterToRoom, floorSummary, formatAge, formatChanged, groupByCategory, isLinked, type LayerId, layerOfType, layerWord, layoutEntries, pieceDevice, plugThreshold, presetCalls, roomHeat, roomScenes, roomSummary, sceneNeedsConfirm, stateText, type ThingRef } from "../core";
import { colorVarFor } from "../core/active";
import { mark, t, tn } from "../core/i18n";
import { fireEvent, openView } from "./actions";
import { favouriteRefs } from "./favourites";
import { scenesTemplate } from "./room-scenes-ui";
import type { Pt } from "./viewport";
import { html, nothing, unsafeCSS, type CSSResult } from "lit";
import { floorOffButton, openVacuumDialog } from "./card-dialogs";
import { overviewStates } from "./card-replay";
import { callService, closePopup, deviceSubject, openPopup, openSubject, popupMarkup, runOp, subjectOf, subjectOp, subjectText, thingSel } from "./card-popup";
import { back, popupInSheet, sheetTo, toggleActiveCollapsed } from "./card-sheet";
import { scheduleSave } from "./card-view-state";
import { lazy } from "./lazy";
import type { FloorplanStudioCard, PickMemo } from "./floorplan-studio-card";

// B52.2: the Overview's rows, sheets, scenes, favourites and search are a chunk of their own (overview/panel.ts), with their stylesheet. The picks,
// the locate and the attention stay here: the plan, the menu, the zoom and the replay call them whether or not the chunk ever loads.
type Panel = typeof import("./overview/panel");
/** The build puts the chunk's hashed file name in this placeholder (vite.config.ts); unbuilt (vitest, dev) it stays one and the plain import is used. */
const overview = lazy<Panel>(() => import("./overview/panel"), "__FPOVERVIEW_CHUNK__", "overview");
/** A fetch that fails is tried again after `RETRY_MS`, under a new URL (lazy.ts): `TRIES` tries in all. Then the card goes on without the Overview, says so,
 * and does not ask again until the page is loaded again. Three tries over two seconds ride out a dropped connection; more would hammer a dead server. */
const TRIES = 3, RETRY_MS = 1000;
const UNAVAILABLE = mark("Overview unavailable: its code did not load. Reload the page to try again.");
let failed = 0;
/** A try is on its way, or the pause before the next one is running. A render in that time asks for nothing. lazy.ts shares a try in flight, but in
 * the pause there is none, and without this every render would start the next try at once. */
let busy = false;
/** The cards that rendered without the panel while it was not there; they draw it when it is. */
const waiting = new Set<FloorplanStudioCard>();

function settle(): void {
  busy = false;
  for (const c of waiting) if (c.isConnected) c.requestUpdate(); // a card taken out of the page meanwhile draws nothing
  waiting.clear();
}
function fetchPanel(): void {
  busy = true;
  overview.load().then(settle, () => {
    if (++failed >= TRIES) settle();
    else { globalThis.setTimeout(settle, RETRY_MS); }
  });
}

/** The chunk's stylesheet goes onto the card's shadow root once, after all the card's own sheets. Before B52.2 these rules sat in the first of them, ahead of
 * the popup, scenes, touch and replay sheets; none of those names an Overview class, so the later place changes nothing. Where the browser
 * has no constructable sheets (jsdom, Safari 15.4-16.3, Firefox 98-100) a <style> at the end of the root does the same job. Once is enough there too:
 * LitElement then appends its own <style>s first and renders before them, so the appended one is outside the part a template switch clears. */
const styled = new WeakSet<ShadowRoot>();
let sheet: CSSResult | undefined;
function adoptSheet(root: ShadowRoot, text: string): void {
  if (styled.has(root)) return;
  styled.add(root);
  const s = (sheet ??= unsafeCSS(text)).styleSheet;
  if (s) root.adoptedStyleSheets = [...root.adoptedStyleSheets, s];
  else root.append(Object.assign(document.createElement("style"), { textContent: text }));
}

/** On a phone the popup is the sheet's Device level, and the sheet is the chunk's. A tap that comes before the chunk, or after it failed for good, still gets
 * its popup: the card sets it at the foot of the plan, where the sheet's peek would have been. */
function popupWithoutSheet(c: FloorplanStudioCard) {
  const pop = c._popup && popupInSheet(c) ? popupMarkup(c, true) : null;
  return pop && html`<div class="fp-pop-wait">${pop}</div>`;
}

let made: ReturnType<Panel["make"]> | undefined;
/** The Overview; nothing while its chunk is on its way (no markup, so the plan is already where it will stay); the note after the last failed try. */
export function activePanel(c: FloorplanStudioCard) {
  if (!c._activeListVisible() || !c._layout) return null;
  const p = overview.get();
  if (!p) {
    const gone = failed >= TRIES;
    if (!gone) { waiting.add(c); if (!busy) fetchPanel(); }
    const pop = popupWithoutSheet(c);
    if (!gone) return pop;
    return html`<p class="fp-3d-note" role="status">${t(UNAVAILABLE)}</p>${pop}`;
  }
  if (c.shadowRoot) adoptSheet(c.shadowRoot, p.OVERVIEW_CSS);
  made ??= p.make({ ALL_OFF_TITLE, DEVICE_ICONS, TOGGLE_AT_ONCE, activeDevices, allOffTitle, attentionOf, back, callService, colorVarFor, customCalls, customScene, deviceSubject, favouriteRefs, filterToRoom, fireEvent, floorOffButton, floorSummary, floorTitle, formatAge, formatChanged, groupByCategory, html, keptHere, layerWord, layoutEntries, locate, nothing, openPopup, openVacuumDialog, openView, overviewStates, pickRoom, picked, pickedFloorKey, pieceDevice, plugThreshold, popupInSheet, popupMarkup, presetCalls, roomHeat, roomScenes, roomSummary, runOp, sceneNeedsConfirm, scenesTemplate, stateText, subjectOp, subjectText, t, tn, toggleActiveCollapsed });
  return made.activePanel(c);
}

/** S24.7: a row tap zooms to at least this, against the whole floor, and rings its thing this long. */
const LOCATE_ZOOM = 2;
const PULSE_MS = 2400;

/** S33 review: the entity domains `tap_action: toggle` may operate without the popup. A plain on/off of a light, a switch, an input_boolean or a fan. Lock, cover and siren open the popup: a stray tap never unlocks a door, moves a garage door or sounds a siren. Climate, humidifier, water_heater, automation, remote, media_player and group do too: their on/off is not a lamp's. */
export const TOGGLE_AT_ONCE = new Set(["light", "switch", "input_boolean", "fan"]);

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
  if (piece) { const d = pieceDevice(piece); if (d) { if (piece.symbol === "car" || isLinked(piece.symbol)) openSubject(c, deviceSubject(c, d), point, from); else fireEvent(c, "hass-more-info", { entityId: d.entity }); } }
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

/** The kept thing when it is on the floor on show and its family is still hidden. */
export function keptHere(c: FloorplanStudioCard) {
  const k = c._kept;
  return k && k.floor === c._floorKey() && c._hiddenLayers.includes(k.fam) ? k : null;
}
