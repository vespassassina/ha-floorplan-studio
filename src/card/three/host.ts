// S36.4: the card's glue to the 3D view. It ran inside the card file, which every user of the 2D plan downloads; it only runs
// once 3D is picked, so it lives here, in the lazy chunk, and the card calls it through `lib3d`. Behaviour is the card's old
// code word for word: only the place moved.
//
// What the chunk may import. Nothing from the card file or from a module the card also ships (the chunk would then import the
// card, which Home Assistant may load under another URL). So anything the card and the 2D plan share arrives in `Deps3D`
// (the same object `three-deps.ts` has always built), and the card is passed as `h`, typed by `import type` (erased).
import type { FloorplanStudioCard, PickMemo } from "../floorplan-studio-card";
import type { SceneDeps } from "../../core/scene-build";
import type { LiveDeps } from "../../core/live-build";
import type { bindDeviceActions } from "../actions";
import type { floorsAroundKey } from "../../core/stairs";
import type { floorElevation } from "../../core/heights";
import type { floorPlace, floorsBelow } from "../../core/floor-stack";
import type { plugThreshold } from "../../core/power";
import type { TextureDeps } from "../../core/three-deps";
import type { Pick as Pick3D } from "./pick";
import { coverOf } from "./cover";
import { DRAG_PX, NoWebGL, createView3D, type View3D } from "./view3d";

export { liveRenderers } from "./view3d";

/** What the card hands over: everything the glue needs from code the 2D plan also uses. */
export interface Deps3D {
  scene: SceneDeps;
  live: LiveDeps;
  texture: TextureDeps["texture"];
  floorsAroundKey: typeof floorsAroundKey;
  floorsBelow: typeof floorsBelow;
  floorElevation: typeof floorElevation;
  floorPlace: typeof floorPlace;
  plugThreshold: typeof plugThreshold;
  bindDeviceActions: typeof bindDeviceActions;
}

/** Copies of the card's double-tap numbers (the chunk imports no card code); a test holds them equal. */
export const DOUBLE_TAP_MS = 350;
export const DOUBLE_TAP_PX = 24;

/** What was last given to one view, to compare: the floor and its stair context, and the floors below. Dies with the view. */
interface Given { floor: unknown; around: string; below: { mode: string; floors: unknown[]; nums: string } | null; pick: { stamp: number; x: number; y: number; pick: Pick3D | null } | null }
const given = new WeakMap<View3D, Given>();
const givenOf = (v: View3D): Given => {
  let g = given.get(v);
  if (!g) given.set(v, (g = { floor: null, around: "", below: null, pick: null }));
  return g;
};

/** Brings the 3D view in line with what the card shows, after every render, once the module is loaded and the card still wants 3D
 * (the card checked): makes the view once its container is on screen. It never throws; every failure is the one line and the 2D plan. */
export function sync3d(h: FloorplanStudioCard, d: Deps3D): void {
  const f = h._floor();
  if (!f) return;
  const host = h.shadowRoot?.querySelector<HTMLElement>(".fp-3d") ?? null;
  if (!host) return;
  if (!h._view3d) {
    try {
      h._view3d = createView3D(host, {
        turnDeg: h._rotate()?.deg ?? 0,
        onCamera: () => { h._camMoved = true; h._scheduleSave(); },
        deps: { scene: d.scene, live: d.live, texture: d.texture },
        onFail: (why, retry) => { h._retry3d = retry === true; h._fallback3d = `3D view unavailable: ${why}. Showing 2D.`; h._dispose3d(); h.requestUpdate(); },
      });
    } catch (err) {
      h._fallback3d = err instanceof NoWebGL ? "3D view unavailable: this browser has no WebGL. Showing 2D." : "3D view unavailable: it could not start. Showing 2D.";
      h.requestUpdate();
      return;
    }
  }
  const view = h._view3d, g = givenOf(view);
  // A theme change (or Home Assistant's dark mode) re-reads the colours; a new floor, or one the layout reload replaced, rebuilds the scene.
  view.setTheme(`${h._theme()}|${h._haDark()}`);
  view.setWalls(h._walls());
  const layout = h._layout!, key = h._floorKey()!;
  const around = d.floorsAroundKey(layout, key), aroundKey = JSON.stringify(around);
  // The selected floor is the one the camera frames. The floors below are the view's own meshes (S27.7), given after `setFloor`.
  if (f !== g.floor || aroundKey !== g.around) {
    g.floor = f;
    g.around = aroundKey;
    view.setFloor(f, around);
    if (key !== h._view3dKey) { // S14.4: another floor (or a new view) brings the camera its floor was left with
      h._view3dKey = key;
      const cam = h._floorViews.get(key)?.cam;
      h._camMoved = cam !== undefined;
      if (cam) view.setCamera(cam);
    }
  }
  syncBelow(h, d, view, g);
  // The live state, decided by the plan's own rules (core/live.ts); the view changes its parts in place, and does nothing when it is the same as the last.
  const now = Date.now();
  view.setLive(f, { scale: 1, state: h._stateForRender(), formatState: h._format, now, fade: h._config.fade, plugWatts: d.plugThreshold(h._config.plug_watts), plugHeat: h._plugHeat(), powerLinks: h._powerLinks(), roomGlow: h._config.room_glow, night: h._night(), sun: h._sun(), labels: h._labels(), showNames: h._names(), camThumb: h._camOpts(), around }, now);
  view.setRing(h._picked());
  apply3dFrame(h);
}

/** S27.14: gives the view the floors below the shown one: each lower floor at its elevation relative to this one (negative) and its
 * `floorPlace` (shift and turn). Only when something changed (the view rebuilds its meshes on every call), and always after `setFloor`. */
function syncBelow(h: FloorplanStudioCard, d: Deps3D, view: View3D, g: Given): void {
  const layout = h._layout, key = h._floorKey();
  if (!layout || !key) return;
  const mode = h._below();
  const keys = mode === "off" ? [] : d.floorsBelow(layout, key), here = d.floorElevation(layout, key);
  const entries = keys.map((k) => { const p = d.floorPlace(layout, k, key); return { floor: layout.floors[k], elevation: d.floorElevation(layout, k) - here, shift: p.shift, turn: p.turn }; });
  const nums = JSON.stringify(entries.map((e) => [e.elevation, e.shift, e.turn]));
  const last = g.below;
  if (last && last.mode === mode && last.nums === nums && last.floors.length === entries.length && entries.every((e, i) => e.floor === last.floors[i])) return;
  if (!last && mode === "off") { g.below = { mode, floors: [], nums }; return; } // nothing was ever given: nothing to take away
  g.below = { mode, floors: entries.map((e) => e.floor), nums };
  view.setBelow(entries, mode);
}

/** What the 3D view has under a pointer event, read once per event: the gesture code and the room tap both ask. */
function pick3d(h: FloorplanStudioCard, e: PointerEvent): Pick3D | null {
  const view = h._view3d;
  if (!view) return null;
  const g = givenOf(view), c = g.pick;
  if (c && c.stamp === e.timeStamp && c.x === e.clientX && c.y === e.clientY) return c.pick;
  const pick = view.pick(e.clientX, e.clientY);
  g.pick = { stamp: e.timeStamp, x: e.clientX, y: e.clientY, pick };
  return pick;
}

/** S12.4: taps in 3D mean what they mean in 2D. A device, a door or window and an unlinked appliance go to the same
 *  gesture code as the plan's (`bindDeviceActions`, told what is under the pointer by a ray instead of the DOM):
 *  tap toggles, hold opens more-info, `NO_TOGGLE` types do not toggle. Any other tap picks the room under it, or clears.
 *  A drag (the view says so), a pinch and a double tap pick nothing; a double tap puts the pick back as it was. */
export function bind3d(h: FloorplanStudioCard, host: HTMLElement, d: Deps3D): () => void {
  const svgEl = (tag: string, attr: string, v: number, linked = false): Element => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    el.setAttribute(attr, String(v));
    if (linked) el.setAttribute("data-linked", "");
    return el;
  };
  const unbindGestures = d.bindDeviceActions(host, h, (i) => h._floor()?.devices[i], (i) => h._floor()?.doors[i], {
    longPress: !h._kiosk(),
    openVacuumDialog: (dev) => h._openVacuumDialog(dev),
    openChooser: (title, entities, line) => h._openChooserDialog(title, entities, line),
    openPopup: (t, at, from) => h._openPopup(t, at, from),
    getUnlinked: (i) => h._floor()?.unlinked[i],
    getPiece: (i) => h._floor()?.furniture?.[i],
    ...h._tapOpts(),
    resolve: (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return null;
      const p = pick3d(h, e);
      return !p ? null : p.type === "cam" ? svgEl("g", "data-cam", p.index) : p.type === "device" ? svgEl("g", "data-x", p.index) : p.type === "door" ? svgEl("line", "data-d", p.index) : p.type === "unlinked" ? svgEl("g", "data-u", p.index) : p.type === "piece" ? svgEl("g", "data-f", p.index, true) : null;
    },
  });
  let start: { x: number; y: number } | null = null, pointers = 0;
  let last: { t: number; x: number; y: number; before: PickMemo } | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.isPrimary) pointers = 0;
    pointers++;
    if (pointers > 1) { start = null; last = null; return; }
    start = e.pointerType === "mouse" && e.button !== 0 ? null : { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    pointers = Math.max(0, pointers - 1);
    const s = start;
    start = null;
    if (!s || h._view3d?.dragged !== false || Math.hypot(e.clientX - s.x, e.clientY - s.y) > DRAG_PX) { if (s && h._view3d?.dragged) h._closePopup(); last = null; return; }
    const p = pick3d(h, { clientX: s.x, clientY: s.y, timeStamp: -1 } as PointerEvent);
    if (p && (p.type === "device" || p.type === "cam" || p.type === "door" || p.type === "unlinked" || p.type === "piece")) { last = null; return; } // its own thing, never a pick
    h._closePopup(); // a tap on anything else is an outside tap
    const now = performance.now();
    if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_PX) {
      h._releaseFocus();
      h._restorePick(last.before);
      last = null;
      return;
    }
    last = { t: now, x: e.clientX, y: e.clientY, before: { pick: h._pickedRoom, floor: h._pickedFloor, filter: h._roomFilter } };
    if (!h._activeListVisible()) return;
    const room = p?.type === "room" ? p.index : null;
    h._pickRoom(room !== null && h._picked() !== room ? room : null);
    holdFocus(h);
  };
  const onCancel = () => { pointers = 0; start = null; };
  // S14.2: hover (mouse only). The pointer's position is two numbers and the pick runs once a frame, whatever the pointer does in between.
  let hx = 0, hy = 0, hraf = 0;
  const hoverFrame = () => {
    hraf = 0;
    const p = h._view3d?.pick(hx, hy);
    const t = p && !h._popup ? (p.type === "device" ? h._targetOf("x", p.index) : p.type === "door" ? h._targetOf("d", p.index) : p.type === "unlinked" ? h._targetOf("u", p.index) : p.type === "piece" ? h._targetOf("f", p.index) : null) : null;
    if (t) h._showTip(t, hx, hy, null);
    else h._hideTip();
  };
  const onHoverMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.buttons) { h._hideTip(); return; }
    hx = e.clientX; hy = e.clientY;
    if (!hraf) hraf = requestAnimationFrame(hoverFrame);
  };
  const onHoverEnd = () => h._hideTip();
  host.addEventListener("pointermove", onHoverMove);
  host.addEventListener("pointerleave", onHoverEnd);
  host.addEventListener("pointerdown", onHoverEnd);
  host.addEventListener("wheel", onHoverEnd, { passive: true });
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onCancel);
  return () => {
    if (hraf) cancelAnimationFrame(hraf);
    host.removeEventListener("pointermove", onHoverMove);
    host.removeEventListener("pointerleave", onHoverEnd);
    host.removeEventListener("pointerdown", onHoverEnd);
    host.removeEventListener("wheel", onHoverEnd);
    h._hideTip();
    unbindGestures();
    host.removeEventListener("pointerdown", onDown);
    host.removeEventListener("pointerup", onUp);
    host.removeEventListener("pointercancel", onCancel);
  };
}

/** The bottom sheet lies over the lower part of the 3D stage; the camera frames the house in the rest (`coverOf`, F1 of the framing
 * spec). Side and kiosk cover nothing. Costs a layout read, so it runs after a render and a resize, not per frame. The room is the
 * picked one (F3), held back while a canvas tap waits out the double-tap window. */
export function apply3dFrame(h: FloorplanStudioCard): void {
  const view = h._view3d, host = h.shadowRoot?.querySelector<HTMLElement>(".fp-3d"), stops = h._stopsNow();
  if (!view || !host) return;
  const cover = stops ? coverOf(host.getBoundingClientRect(), h.getBoundingClientRect(), h._frame, stops, h._sheetStop) : { top: 0, right: 0, bottom: 0, left: 0 };
  if (!h._focusHold) h._focus3d = h._picked();
  view.setFrame({ cover, room: h._focus3d });
}

/** A canvas tap's room pick reaches the 3D view only when the double-tap window has closed and the pick stands; the ring and the sheet change at once. */
function holdFocus(h: FloorplanStudioCard): void {
  h._releaseFocus();
  h._focusHold = true;
  h._focusTimer = globalThis.setTimeout(() => { h._focusTimer = null; h._focusHold = false; apply3dFrame(h); }, DOUBLE_TAP_MS);
}
