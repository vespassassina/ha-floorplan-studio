import { iconsHold, NAME_MIN_PX, rotateAbout } from "../core";
import { t } from "../core/i18n";
import { TAP_SLOP_PX, THINGS } from "./actions";
import type { FocusDir } from "./plan-focus";
import { isSearchChord, PAN_STEP, planKeyFor, type ViewKey } from "./view-keys";
import { normaliseRotation, ROTATION_STEP, shortestDelta } from "./view-state";
import { clamp, MAX_ZOOM, MIN_ZOOM, panBy, pinch, type Pt, sameView, type View, zoomAt } from "./viewport";
import { html } from "lit";
import { dialogOpen } from "./card-dialogs";
import { openSearch, pickRoom, restorePick, tapRoom } from "./card-overview";
import { closePopup, foldSpider } from "./card-popup";
import { back } from "./card-sheet";
import { saveViewNow, scheduleSave } from "./card-view-state";
import type { FloorplanStudioCard, PickMemo } from "./floorplan-studio-card";

export function doViewKey(c: FloorplanStudioCard, key: ViewKey): boolean {
  if (!c._floor() || c._shows3d()) return false; // the 3D camera is the pointer's; the plan's zoom and turn are not on show
  switch (key) {
    case "zoomIn":
    case "zoomOut":
      if (c._zoomMode() === false) return false;
      c._zoomCentre(key === "zoomIn" ? BUTTON_ZOOM : 1 / BUTTON_ZOOM);
      return true;
    case "panLeft":
    case "panRight":
    case "panUp":
    case "panDown": {
      if (c._zoomMode() === false) return false;
      const v = c._current(), fit = c._fit;
      if (!v || !fit) return false;
      const dx = key === "panLeft" ? -PAN_STEP * v.w : key === "panRight" ? PAN_STEP * v.w : 0;
      const dy = key === "panUp" ? -PAN_STEP * v.h : key === "panDown" ? PAN_STEP * v.h : 0;
      const to = clamp(panBy(v, dx, dy), fit);
      if (sameView(to, v, fit)) return false; // at the edge, or not zoomed: nothing moved, so the page keeps the key
      c._setView(to);
      return true;
    }
    case "rotateLeft":
    case "rotateRight":
      if (!c._rotateOn()) return false;
      c._turnBy(key === "rotateLeft" ? -ROTATION_STEP : ROTATION_STEP);
      return true;
    case "reset":
      if (c._hasViewControls()) {
        if (!c._modified()) return false;
        resetView(c);
        return true;
      }
      if (c._zoomMode() === false || !c._zoomed()) return false;
      fitView(c);
      return true;
  }
}

/** Reset view: every view option back to the config's own, the stored entry cleared, the floor kept. The turn goes
 * back the short way (315 to 0 is +45). */
export function resetView(c: FloorplanStudioCard): void {
  c._appliedView = null;
  c._fallback3d = null;
  c._pickedView = c._pickedTilt = c._pickedWalls = c._pickedTheme = c._pickedLabels = c._pickedNames = c._pickedDetail = c._pickedGhost = c._pickedBelow = c._pickedHeat = c._pickedCam = null;
  c._pendingView = null;
  c._view = null;
  c._forgetCamera();
  const from = c._userAngle();
  c._startTurn(from + shortestDelta(from, normaliseRotation(c._config.rotation)), null);
  if (!c._turn) {
    c._pickedRot = null;
    saveViewNow(c);
  }
  c.requestUpdate();
}

/** S23.2: screen px per plan unit of the whole floor at fit, measured after each render and on a resize. Fit, not
 *  the view on show: like S9.2's icon scale, the floor follows the card's size, never its zoom, so zooming in only
 *  enlarges and a pinch costs no second render. The svg keeps its aspect (meet), so the scale is the smaller of the
 *  two ratios. Nothing laid out (jsdom, a hidden card): nothing changes. */
export function measurePx(c: FloorplanStudioCard): void {
  const svg = c.shadowRoot?.querySelector<SVGSVGElement>("svg.fp-zoomable"), fit = c._fit;
  const r = svg?.getBoundingClientRect();
  if (!svg || !fit || !r || !(fit.w > 0) || !(fit.h > 0) || r.width <= 0 || r.height <= 0) return;
  const px = Math.min(r.width / fit.w, r.height / fit.h), base = 1 / scale(c, fit);
  const k = (p: number) => Math.max(base, p ? NAME_MIN_PX / (12 * p) : 0);
  const was = k(qpx(c._px)), old = c._px;
  c._px = px;
  const icons = iconsHold(c._planPx(fit, px), c._iconsOn);
  if (icons !== c._iconsOn) { c._iconsOn = icons; c.requestUpdate(); } // S37.6/S38.7: the plan crossed 420 up or 380 down: icons or dots
  // S23 review S3: the stack of buttons at the right covers a strip of the plan; names keep out of it. The svg keeps
  // its aspect (meet, centred), so the fit box starts (r.width - fit.w * px) / 2 in. A stack laid out as a row is
  // above the plan's top, not beside it: no strip. 4 px of air before the buttons.
  const stack = c.shadowRoot?.querySelector<HTMLElement>(".fp-stack");
  const sr = stack && !stack.classList.contains("fp-stack-row") ? stack.getBoundingClientRect() : null;
  const right = r.left + (r.width + fit.w * px) / 2, strip = sr && sr.width > 0 ? Math.max(0, (right - sr.left + 4) / px) : 0, stripWas = c._strip;
  c._strip = strip;
  if (qstrip(strip, fit.w) !== qstrip(stripWas, fit.w)) return void c.requestUpdate();
  if (k(qpx(px)) !== was) return void c.requestUpdate();
  // k holds, but a name shrunk to fit its room has its own floor of 11 px: re-render when that floor binds now or did.
  const sizes = [...svg.querySelectorAll("text.lbl[data-rl]")].map((t) => Number(t.getAttribute("font-size"))).filter((s) => s > 0);
  if (!sizes.length || qpx(px) === qpx(old)) return;
  const least = Math.min(...sizes), floorNow = NAME_MIN_PX / qpx(px), floorWas = old ? NAME_MIN_PX / qpx(old) : 0;
  if (floorNow > least * 1.01 || floorWas >= least * 0.99) c.requestUpdate();
}

/** S9.2: the `scale` passed to `renderFloor`. Icons, names, values and radar dots are drawn at `24 * (1/scale)`
 * units, so shrinking `scale` grows them on screen. `auto` keeps a plan of 1000 cm or less exactly as before
 * (icon_size at its own default too, so today's card is byte-identical); past that, icons stop shrinking with
 * the plan, growing with its longest side instead — `fit` is the same view box `render()` already draws, per
 * the S9.2 brief ("the same box the card draws"), so this reads no geometry of its own. */
export function scale(c: FloorplanStudioCard, fit: { w: number; h: number }): number {
  const auto = Math.max(1, Math.max(fit.w, fit.h) / 1000);
  return 1 / (auto * c._iconSize());
}

/** Opus review of S9.6: `center` is documented as plan cm — the same unrotated coordinates a room or device sits
 * at in the layout — but `_home`'s own box (`viewBoxFor(f, 60, rotate)`, `render()` above) is already in the
 * *rendered* frame: `renderFloor`/`viewBoxFor` turn every point by `rotate` themselves (unlike the editor, which
 * draws unrotated coordinates inside a rotated `<g>`). Passing `_center()` straight into `pinnedView` therefore
 * pinned the wrong spot on any layout with `rotate` set. This turns the config's plan-cm point by the same
 * `rotate` before it reaches `pinnedView`, so it lands on the same plan point the layout itself names. */
export function rotatedCenter(card: FloorplanStudioCard): Pt | null {
  const c = card._center();
  if (!c) return null;
  const rotate = card._rotate();
  return rotate && rotate.deg % 360 ? rotateAbout(c, rotate.deg, rotate.pivot) : c;
}

/** S9.6: `config.zoom_level`, clamped to [1, MAX_ZOOM] — same untrusted-config shape as `_iconSize` above, and
 * the same reasoning as `_center`'s comment for why this defaults silently rather than throwing. */
export function zoomLevel(c: FloorplanStudioCard): number {
  const v = c._config.zoom_level;
  return typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_ZOOM, Math.max(ZOOM_LEVEL_MIN, v)) : DEFAULT_ZOOM_LEVEL;
}

export function fitView(c: FloorplanStudioCard): void {
  if (c._turn) return;
  c._view = null;
  scheduleSave(c);
  c.requestUpdate();
}

/** S7.4: +, − and fit, card chrome in the top-right corner (like `_floorChips`, outside the plan's `<svg>`).
 * S9.6 review (Opus, 2026-09-27): a single `atFit` used to gate both "−" and Fit off `box.w < home.w`, width
 * only. On a pinned card that reads two different things and neither is right for both buttons:
 *  - "−" widens the box; it must stop only at the whole floor (`fit`), since the docs promise a pinned card can
 *    still zoom out to see the rest of the house. Gating it at `home` disabled "−" the moment the card loaded,
 *    even though there was more floor to see.
 *  - Fit/Reset undoes `_view`; it must be disabled exactly when there is nothing to undo, i.e. `_view === null`
 *    (`_zoomed()`, above) — not "box is as wide as home", which stayed true after a same-width sideways pan and
 *    left Fit disabled with no way back to the pinned centre.
 * Unpinned (`home` equals `fit`): both conditions coincide, so this changes nothing for a plain card.
 *
 * Diego field report, 0.12.14: "−" used to disable at `fit` itself, so a shed or a corner `viewBoxFor` did not
 * bound on had no way to come into view. It now disables only at `MIN_ZOOM` (`viewport.ts`), the same floor
 * `clamp` itself enforces, so the button and the drag/pinch gesture agree on how far out the card goes. */
export function viewStack(c: FloorplanStudioCard, box: View, home: View, fit: View) {
  const atMin = box.w >= (fit.w / MIN_ZOOM) * (1 - 1e-6);
  const atHome = !c._zoomed();
  const atMax = box.w <= (fit.w / MAX_ZOOM) * (1 + 1e-6);
  const pinned = !sameView(home, fit, fit);
  // Fit only fits; "Reset view" (every view option back to the config) is in the ⋯ menu since S31.6.
  const resetLabel = pinned ? t("Home view") : t("Fit");
  return html`<div class="fp-stack">
      <button type="button" aria-label=${t("Zoom in")} title=${t("Zoom in")} ?disabled=${atMax} @click=${() => c._zoomCentre(BUTTON_ZOOM)}>+</button>
      <button type="button" aria-label=${t("Zoom out")} title=${t("Zoom out")} ?disabled=${atMin} @click=${() => c._zoomCentre(1 / BUTTON_ZOOM)}>−</button>
      <button type="button" aria-label=${resetLabel} title=${resetLabel} ?disabled=${atHome} @click=${() => fitView(c)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
      </button>
    </div>`;
}

/**
 * S7.4: pointer and wheel handlers for zoom and pan on the plan's own `<svg>`, bound once per element like
 * `bindDeviceActions`. Each handler reads `config.zoom` afresh, so `zoom: false` needs no rebinding.
 *
 * One pointer that moves past `TAP_SLOP_PX` pans (`bindDeviceActions` drops its tap at the same threshold); two
 * pinch. A pointer that goes down while none is tracked and is not the primary one is a second finger whose
 * first landed outside the svg: it is ignored, so half a pinch never pans the plan. Taps stay with
 * `bindDeviceActions`, except two quick taps off any device or door: 2x about the tap at fit, back to fit when
 * zoomed. The wheel zooms only with Ctrl/Cmd, or always under `zoom: "wheel"`; it is bound on the svg, so a
 * wheel over a floor chip or a zoom button never reaches it and scrolls the page.
 */
export function bindZoom(c: FloorplanStudioCard, svg: SVGSVGElement): () => void {
  const ptrs = new Map<number, { x: number; y: number }>();
  let start = { x: 0, y: 0 };
  let panning = false;
  let pinched = false;
  let lastTap: { t: number; x: number; y: number; before: PickMemo } | null = null;

  /** Screen point to plan point under view `v`. */
  const toPlan = (v: View, cx: number, cy: number): Pt => {
    const r = svg.getBoundingClientRect();
    return [v.x + ((cx - r.left) / r.width) * v.w, v.y + ((cy - r.top) / r.height) * v.h];
  };
  const capture = (id: number) => {
    try { svg.setPointerCapture(id); } catch { /* the pointer is already gone */ }
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.isPrimary) ptrs.clear(); // nothing else of its kind is down: forget any pointer whose up went missing
    else if (!ptrs.size) return;
    // Diego field report, 0.12.14: the card must always be draggable, `zoom: false` or not — that config key
    // turns off zoom, not pan. A first finger always starts a pan; a second finger only joins as a pinch when
    // zoom is on, so `zoom: false` still blocks pinch-zoom without blocking the one-finger drag that got here.
    if (ptrs.size === 1 && c._zoomMode() === false) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      start = { x: e.clientX, y: e.clientY };
      panning = false;
      pinched = false;
    } else {
      pinched = true;
      lastTap = null;
      for (const id of ptrs.keys()) capture(id);
    }
  };

  const onMove = (e: PointerEvent) => {
    const p = ptrs.get(e.pointerId);
    const v = c._current();
    if (!p || !v) return;
    if (ptrs.size === 1) {
      if (!panning) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_SLOP_PX) return;
        panning = true;
        capture(e.pointerId);
      }
      const r = svg.getBoundingClientRect();
      c._setView(panBy(v, (-(e.clientX - p.x) / r.width) * v.w, (-(e.clientY - p.y) / r.height) * v.h));
    } else if (ptrs.size === 2) {
      const o = [...ptrs].find(([id]) => id !== e.pointerId)![1];
      c._setView(pinch(v, toPlan(v, p.x, p.y), toPlan(v, o.x, o.y), toPlan(v, e.clientX, e.clientY), toPlan(v, o.x, o.y)));
    }
    p.x = e.clientX;
    p.y = e.clientY;
  };

  const onUp = (e: PointerEvent) => {
    if (!ptrs.delete(e.pointerId)) return;
    if (ptrs.size) {
      // One finger of a pinch lifted: the other carries on as a pan from where it is now.
      panning = true;
      return;
    }
    const tap = !panning && !pinched;
    panning = false;
    pinched = false;
    const onThing = (e.target as Element | null)?.closest?.(`${THINGS}, g[data-cam]`);
    if (!tap || onThing) {
      lastTap = null;
      return;
    }
    const now = performance.now();
    if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_PX) {
      restorePick(c, lastTap.before); // a double tap is a zoom, and leaves the room pick as it found it (DECISIONS, S11.3)
      lastTap = null;
      if (c._zoomMode() === false) return; // a double tap zooms; pan alone stays on when zoom is off
      // S9.6: zooms in from `home` (the pinned box, or the whole floor with no pin), not the whole floor — the
      // screen shows `home` at rest, so the plan point under the tap must be read against that same box.
      const home = c._home();
      if (c._zoomed() || !home) fitView(c);
      else c._setView(zoomAt(home, 2, ...toPlan(home, e.clientX, e.clientY)));
      return;
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY, before: { pick: c._pickedRoom, floor: c._pickedFloor, filter: c._roomFilter } };
    tapRoom(c, e);
  };

  const onCancel = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    if (!ptrs.size) {
      panning = false;
      pinched = false;
    }
  };

  const onWheel = (e: WheelEvent) => {
    const mode = c._zoomMode();
    if (mode === false || (mode !== "wheel" && !e.ctrlKey && !e.metaKey)) return;
    const v = c._current();
    if (!v) return;
    e.preventDefault();
    const dy = Math.max(-100, Math.min(100, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
    c._setView(zoomAt(v, Math.exp(-dy * 0.002), ...toPlan(v, e.clientX, e.clientY)));
  };

  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onCancel);
  svg.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    svg.removeEventListener("pointerdown", onDown);
    svg.removeEventListener("pointermove", onMove);
    svg.removeEventListener("pointerup", onUp);
    svg.removeEventListener("pointercancel", onCancel);
    svg.removeEventListener("wheel", onWheel);
  };
}

/** Arrows zoom (up in, down out) and turn (left, right); Space is Reset view. The same keys as the editor's, from
 * `view-keys.ts`. A key is taken (preventDefault) only when it did something, so a card that cannot act, because
 * zoom is off or the controls are hidden, leaves the page its arrows and its Space. Auto-repeat is let through:
 * holding an arrow keeps zooming. */
export function onViewKey(c: FloorplanStudioCard, ev: KeyboardEvent): void {
  if (!c.isConnected || !c._ownsViewKeys()) return;
  if (dialogOpen(c)) return; // a dialog has its own keys
  // S24.8: ⌘K, Ctrl+K or / opens the search, under the same gate as the view keys: the card focused, else hovered.
  if (isSearchChord(ev)) { if (openSearch(c)) ev.preventDefault(); return; }
  if (ev.key === "Escape" && c._popup) { closePopup(c); ev.preventDefault(); return; }
  if (ev.key === "Escape" && c._spider) { foldSpider(c); ev.preventDefault(); return; }
  // S31.10: a device key counts only while the plan itself has the focus; in the popup or a text field the keys are theirs.
  const onStage = c._focusDev !== null && ev.composedPath()[0] === c._stageSvg();
  if (ev.key === "Escape" && onStage) { c._dropFocus(); ev.preventDefault(); return; }
  if (ev.key === "Escape" && c._frame === "bottom" && c._activeListVisible() && (c._pickedRoom || c._pickedFloor || c._sheetStop !== "peek")) {
    back(c); // S31.8: one level up, and from the Overview down to peek
    ev.preventDefault();
    return;
  }
  if (ev.key === "Escape" && (c._pickedRoom || c._pickedFloor)) { // S11.3: the same ownership gate as the view keys, so another card never loses its room
    // Escape is Back: one level up in a side sheet too (room to floor to Overview). With no sheet there is no level, so it lets go.
    if (c._activeListVisible()) back(c); else pickRoom(c, null);
    ev.preventDefault();
    return;
  }
  const key = planKeyFor(ev, onStage);
  if (!key) return;
  if (key === "open") { if (c._openFocused()) ev.preventDefault(); return; }
  if (key === "leave") return; // handled above, before the Escape rules that would take it
  if (key === "focusLeft" || key === "focusRight" || key === "focusUp" || key === "focusDown") {
    if (c._moveFocus(key.slice(5).toLowerCase() as FocusDir)) ev.preventDefault();
    return;
  }
  if (doViewKey(c, key)) ev.preventDefault();
}

/** Two taps closer than this in time and space are a double-tap. */
export const DOUBLE_TAP_MS = 350;
export const DOUBLE_TAP_PX = 24;

/** One click of a zoom button. */
const BUTTON_ZOOM = 1.5;

/** S9.6: `zoom_level` default and clamp range — 1 is the whole floor, `MAX_ZOOM` (viewport.ts) is as deep as the
 * pinch zoom itself ever goes. */
const DEFAULT_ZOOM_LEVEL = 1;
const ZOOM_LEVEL_MIN = 1;

/** The scale and the control strip the plan is DRAWN with are snapped DOWN to steps (1 % of scale, 0.5 % of the plan's width; down, so a name's 11 px floor is never missed), and
 *  `_measurePx` re-renders when the step changes. A settled render is then a pure function of the final measured size, not of
 *  the sizes the card passed through on the way (a render drawn at a scale 0.4 % off used to stay, and differed in the second
 *  decimal of a label from a card drawn at the final size). */
const PX_STEP = Math.log(1.01);
export const qpx = (p: number): number => (p > 0 ? Math.exp(Math.floor(Math.log(p) / PX_STEP + 1e-9) * PX_STEP) : 0);
export const qstrip = (s: number, w: number): number => { const u = w * 0.005; return u > 0 ? Math.round(s / u) * u : s; };
