import { TAP_SLOP_PX } from "./actions";
import { cardHeight, frameMode, HEADER_H, nextOnHandleTap, PEEK_H, type SheetStop, sheetStops, sideOpenByDefault, sideWidth, snapSheet, type Stops } from "./frame";
import { panBy, zoomAt } from "./viewport";
import { pickFloor, picked, pickedFloorKey } from "./card-overview";
import type { FloorplanStudioCard } from "./floorplan-studio-card";

/** Below this card width the Active list starts folded: it would cover the plan. */
const ACTIVE_FOLD_BELOW_PX = 480;

/** S31.5, Back in the side sheet: a room goes up to its floor, a floor to the Overview. Focus follows to what is now on top. */
export function back(c: FloorplanStudioCard): void {
  if (c._popup && popupInSheet(c)) { c._closePopup(); return; } // S31.8: Device goes back to what was under it
  const room = c._pickedRoom;
  if (c._frame === "bottom" && !room && !c._pickedFloor) { c._sheetStop = "peek"; c.requestUpdate(); return; }
  pickFloor(c, room && room.floor === c._floorKey() ? room.floor : null);
  // Focus follows only if the card already had it. A card that owns the key by hover alone must not pull focus off the page's own control.
  const had = !!c.shadowRoot?.activeElement;
  void c.updateComplete.then(() => { if (had) c.shadowRoot?.querySelector<HTMLElement>(".fp-back, .fp-active-collapse, .fp-rail-open, .fp-handle")?.focus(); });
}

/** S31.8: whether the popup is drawn in the bottom sheet (the Device level) and not floating: a card with a sheet, under 640 px. */
export function popupInSheet(c: FloorplanStudioCard): boolean {
  return c._frame === "bottom" && c._activeListVisible() && !!c._layout;
}

/** S31.8: the sheet goes to `stop` when this card has a bottom sheet. */
export function sheetTo(c: FloorplanStudioCard, stop: SheetStop): void {
  if (c._frame === "bottom" && c._activeListVisible()) c._sheetStop = stop;
}

export function toggleActiveCollapsed(c: FloorplanStudioCard): void {
  c._activeCollapsed = !c._activeCollapsed;
  c._activeUserChose = true;
  c._saveActiveState();
  c.requestUpdate();
}

/** S31.5: what the card's width gives it, from `frame.ts`: the side sheet from 640 px, the old floating panel under it, no
 *  sheet in kiosk or with `active_list: false`. Reads the host's own width, which the sheet's column does not change.
 *  True when the answer changed (the template differs by mode, so the caller renders again). */
export function measureFrame(c: FloorplanStudioCard): boolean {
  const width = c.getBoundingClientRect().width;
  if (!(width > 0)) return false;
  const mode = frameMode(width, { kiosk: c._kiosk(), sheet: c._config?.active_list !== false }), was = c._frame;
  const sheetW = mode === "side" ? (sheetOpen(c) ? sideWidth(width) : HEADER_H) : 0;
  c.style.setProperty("--fp-sheet-w", `${sheetW}px`);
  c._sheetPx = sheetW;
  c._frame = mode; // `_fitHeight` reads it: the peek is chrome on a phone
  fitHeight(c);
  // S31.8: the peek keeps a row of the grid to itself, and the three stops are the card's height now, as CSS lengths the sheet
  // reads, so a resize moves the sheet without a render.
  c.style.setProperty("--fp-peek-row", mode === "bottom" ? `${PEEK_H}px` : "0px");
  if (mode === "bottom") {
    const stops = sheetStops(c.getBoundingClientRect().height, HEADER_H);
    for (const k of ["peek", "half", "full"] as const) c.style.setProperty(`--fp-sheet-${k}`, `${Math.round(stops[k])}px`);
  }
  return mode !== was;
}

/** Whether the card's parent has a height that does not follow the card: shrink the card to 1 px and see if the parent
 *  notices. A parent whose height comes from its content shrinks with it; a sections row or a panel does not. A parent
 *  that another box holds up looks fixed too, and then the card is simply left at its plan's height, as before. */
export function rowIsFixed(c: FloorplanStudioCard): boolean {
  const parent = c.parentElement ?? (c.getRootNode() as ShadowRoot | undefined)?.host;
  if (!parent) return false;
  const was = c.style.height, before = parent.getBoundingClientRect().height;
  c.style.height = "1px";
  const after = parent.getBoundingClientRect().height;
  c.style.height = was;
  return before > 2 && Math.abs(before - after) < 0.5;
}

/** Whether the sheet is open and not the 52 px rail: not folded, or a room or floor is picked (which opens it). */
export function sheetOpen(c: FloorplanStudioCard): boolean {
  return !c._activeCollapsed || picked(c) !== null || pickedFloorKey(c) !== null;
}

/** Until the viewer has chosen by hand, the sheet's width decides: a side sheet is open from 900 px and a rail below,
 * the floating panel under 640 px is folded under 480 px and open from there up. Runs from `updated()` and the ResizeObserver; width 0 (detached,
 * `display:none`, not laid out yet) decides nothing. */
export function applyWidthDefault(c: FloorplanStudioCard): void {
  const changed = measureFrame(c);
  if (c._activeUserChose) { if (changed) c.requestUpdate(); return; }
  const width = c.getBoundingClientRect().width;
  if (width === 0) return;
  // The side sheet starts open from 900 px (frame.ts), the floating panel from 480; until the viewer folds by hand.
  const narrow = c._frame === "side" ? !sideOpenByDefault(width) : width < ACTIVE_FOLD_BELOW_PX;
  if (narrow === c._activeCollapsed && !changed) return;
  c._activeCollapsed = narrow;
  measureFrame(c);
  c.requestUpdate();
}

/** The three stops for the card's height now, in px, or null when the card is not laid out. */
export function stopsNow(c: FloorplanStudioCard): Stops | null {
  const h = c.getBoundingClientRect().height;
  return h > 0 ? sheetStops(h, HEADER_H) : null;
}

/** After the render that opened the sheet for a room or a thing: moves the plan so that thing's box is inside what the sheet at
 *  its stop leaves, by the pixel difference that centres it there. Nothing moves when it is already inside, or in 3D. */
export function panIntoVisible(c: FloorplanStudioCard): void {
  const sel = c._panTarget;
  c._panTarget = null;
  if (!sel || c._frame !== "bottom" || c._shows3d() || c._turn) return;
  const el = c.shadowRoot?.querySelector(sel);
  if (el && stopsNow(c)) panBoxIn(c, el);
}

/** The part of the plan the eye can use: the stage's box, less the bottom sheet at its stop (S31.8). Null before the first layout. */
export function visibleBox(c: FloorplanStudioCard): { left: number; top: number; right: number; bottom: number } | null {
  const svg = c._stageSvg();
  if (!svg) return null;
  const s = svg.getBoundingClientRect(), stops = c._frame === "bottom" ? stopsNow(c) : null;
  if (!(s.width > 0)) return null;
  return { left: s.left, right: s.right, top: s.top, bottom: stops ? Math.min(s.bottom, c.getBoundingClientRect().bottom - stops[c._sheetStop]) : s.bottom };
}

/** Moves the plan so `el`'s box is inside the visible part, by the pixel difference that centres it there. Nothing moves when it is already inside. */
export function panBoxIn(c: FloorplanStudioCard, el: Element): void {
  const svg = c._stageSvg(), vis = visibleBox(c), v = c._current();
  if (!svg || !vis || !v || c._turn) return;
  const s = svg.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (!(r.width + r.height > 0)) return;
  const m = 8; // a hair of air, so an icon is not touching the sheet's edge
  if (r.top >= vis.top + m && r.bottom <= vis.bottom - m && r.left >= vis.left && r.right <= vis.right) return;
  const dx = (vis.left + vis.right) / 2 - (r.left + r.width / 2), dy = (vis.top + vis.bottom) / 2 - (r.top + r.height / 2);
  const k = Math.min(s.width / v.w, s.height / v.h); // screen px per plan unit: the svg letterboxes its view box
  // A view at fit cannot be panned: `clamp` hands fit back for any box as wide as fit. A hair of zoom (0.1 %, invisible) makes it
  // a view that can move; the Fit button still takes it home.
  const base = c._view ? v : zoomAt(v, 1.001, v.x + v.w / 2, v.y + v.h / 2);
  c._setView(panBy(base, -dx / k, -dy / k));
}

/**
 * S31.7, fit to height (docs/specs/card-layout-touch.md, the assumption). In a parent with no height of its own (masonry, a
 * stack, `rows: auto`) the card was as tall as the plan at its width, so a wide plan on a short screen ran under the browser's
 * bottom edge. Its height is now `cardHeight` (frame.ts): the plan's height plus the header, cut to the visual viewport less
 * HA's header and 16 px, and on a phone at least the sheet's minimum. The plan letterboxes in what is left.
 * A parent that does give a height (HA's sections row, a panel view) already bounds the card, so it is left alone: the row
 * wins, as in 0.28.1. Arrow, so it can be a listener. Nothing laid out (jsdom, a hidden card) changes nothing.
 */
export function fitHeight(c: FloorplanStudioCard): void {
  const width = c.getBoundingClientRect().width, fit = c._fit;
  if (c.style.height !== c._fitted) return; // a height set on the host by hand (an inline style) is the user's: leave it
  const off = (): void => { c.style.removeProperty("height"); c._fitted = ""; };
  if (!(width > 0) || !fit || !(fit.w > 0) || !(fit.h > 0) || c.hasAttribute("panel") || rowIsFixed(c)) return off();
  const header = parseFloat(getComputedStyle(c).getPropertyValue("--header-height"));
  const h = cardHeight({
    planAspect: fit.w / fit.h,
    // Side mode sizes from the sheet's RESTING state, never from a pick: open from 900 px (its width), the 52 px rail below that
    // or once folded by hand. A room pick that opens the rail over the plan letterboxes it and never moves the card's edge.
    width: width - (c._frame === "side" ? (c._activeCollapsed ? HEADER_H : sideWidth(width)) : c._sheetPx),
    viewportH: globalThis.visualViewport?.height ?? globalThis.innerHeight,
    haHeader: Number.isFinite(header) ? header : 56, // the same fallback `:host([panel])` uses
    chrome: c._kiosk() ? 0 : HEADER_H + (c._frame === "bottom" ? PEEK_H : 0),
    mode: c._frame,
  });
  c.style.height = c._fitted = `${Math.round(h)}px`;
}

export function onHandleDown(c: FloorplanStudioCard, e: PointerEvent): void {
  if ((e.pointerType === "mouse" && e.button !== 0) || c._sheetDrag) return;
  const stops = stopsNow(c);
  if (!stops) return;
  const h0 = stops[c._sheetStop];
  c._sheetDrag = { id: e.pointerId, y0: e.clientY, h0, h: h0, moved: false, stops, trail: [{ t: e.timeStamp, h: h0 }] };
  try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* a synthetic event with no live pointer: the drag still works without capture */ }
}

export function onHandleMove(c: FloorplanStudioCard, e: PointerEvent): void {
  const d = c._sheetDrag;
  if (!d || e.pointerId !== d.id) return;
  const dy = e.clientY - d.y0;
  if (!d.moved && Math.abs(dy) < TAP_SLOP_PX) return; // a finger wobbles: under the slop it is still a tap
  d.moved = true;
  d.h = Math.min(d.stops.full, Math.max(d.stops.peek, d.h0 - dy));
  d.trail.push({ t: e.timeStamp, h: d.h });
  if (d.trail.length > 24) d.trail.shift();
  const sheet = c.shadowRoot?.querySelector<HTMLElement>(".fp-bottom");
  if (sheet) { sheet.classList.add("fp-dragging"); sheet.style.height = `${d.h}px`; } // straight to the element: no render per move
}

export function onHandleUp(c: FloorplanStudioCard, e: PointerEvent): void {
  const d = c._sheetDrag;
  if (!d || e.pointerId !== d.id) return;
  c._sheetDrag = null;
  const sheet = c.shadowRoot?.querySelector<HTMLElement>(".fp-bottom");
  if (sheet) { sheet.classList.remove("fp-dragging"); sheet.style.removeProperty("height"); }
  if (d.moved) {
    // The velocity of the last 100 ms, in px/ms, up positive. A finger that rested before it lifted has none.
    const recent = d.trail.filter((p) => p.t >= e.timeStamp - 100);
    const from = recent[0];
    const v = from && recent.length > 1 ? (d.h - from.h) / Math.max(e.timeStamp - from.t, 16) : 0;
    c._sheetStop = snapSheet(d.h, v, d.stops);
    c._dragEnded = true; // the click that follows is the drag's own
    globalThis.setTimeout(() => { c._dragEnded = false; }, 0);
  }
  c.requestUpdate();
}

export function onHandleCancel(c: FloorplanStudioCard, e: PointerEvent): void {
  const d = c._sheetDrag;
  if (!d || e.pointerId !== d.id) return;
  c._sheetDrag = null; // the browser took the gesture: the sheet goes back to its stop
  const sheet = c.shadowRoot?.querySelector<HTMLElement>(".fp-bottom");
  if (sheet) { sheet.classList.remove("fp-dragging"); sheet.style.removeProperty("height"); }
  c.requestUpdate();
}

export function onHandleClick(c: FloorplanStudioCard): void {
  if (c._dragEnded) { c._dragEnded = false; return; }
  c._sheetStop = nextOnHandleTap(c._sheetStop);
  c.requestUpdate();
}

/** Arrow keys on the handle move one stop, so the sheet is reachable without a tap or a drag. */
export function onHandleKey(c: FloorplanStudioCard, e: KeyboardEvent): void {
  const order: SheetStop[] = ["peek", "half", "full"], i = order.indexOf(c._sheetStop);
  const to = e.key === "ArrowUp" ? order[Math.min(2, i + 1)] : e.key === "ArrowDown" ? order[Math.max(0, i - 1)] : null;
  if (!to) return;
  e.preventDefault();
  e.stopPropagation(); // the card's own arrows pan the plan
  c._sheetStop = to;
  c.requestUpdate();
}
