import { writeViewMemory } from "./view-memory";
import { viewBoxFor } from "../core";
import { easeInOut, normaliseRotation, ROTATION_STEP, shortestDelta } from "../card/view-state";
import { panBy } from "../card/viewport";
import { PAN_STEP, type ViewKey } from "../card/view-keys";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- the remembered view, the floor switch, zoom, turn and the view keys ---------------------------------

/** One 45 degree turn takes this long; more steps stretch it, within bounds (the card uses the same). */
const TURN_MS = 350;

/** Cheap stand-in for the view: when it is unchanged, `exportView` need not run on every render. */
export function viewKey(ed: FloorplanStudioEditor): string {
  const st = ed.st;
  return `${st.floor}|${st.labels}|${st.viewRot}|${st.hidden.join(",")}|${st.heat}|${JSON.stringify(st.cam)}|${JSON.stringify(st.views)}`;
}

/** Sets `data-switch` on the plan root so the stylesheet's keyframes run. Removed first, with a reflow, so the same direction twice starts again. */
export function startSwitch(ed: FloorplanStudioEditor, dir: "up" | "down") {
  const svg = ed.renderRoot.querySelector<SVGSVGElement>(".canvas > svg") ?? ed.renderRoot.querySelector<SVGSVGElement>("svg");
  if (!svg) return;
  svg.removeAttribute("data-switch");
  void svg.getBoundingClientRect();
  svg.setAttribute("data-switch", dir);
}

/** The animation of the plan root ends: clear the attribute, so the next switch is a new one. The plan's own animations (glow) bubble here too and are ignored. */
export const onSwitchEnd = (ed: FloorplanStudioEditor, ev: AnimationEvent) => {
  if (ev.target === ev.currentTarget && ev.animationName.startsWith("fp-floor-in")) (ev.currentTarget as Element).removeAttribute("data-switch");
};

/** Writes the view now if it differs from what was last written. Storage that refuses is not an error: the view just is not kept. */
export const flushView = (ed: FloorplanStudioEditor) => {
  clearTimeout(ed.memTimer);
  ed.memTimer = undefined;
  if (ed.memKey === null || ed.st.turning !== null) return;
  const m = ed.st.exportView(), sig = JSON.stringify(m);
  if (sig === ed.memSig) return;
  ed.memSig = sig;
  writeViewMemory(m);
};

export const onVisibility = (ed: FloorplanStudioEditor) => { if (document.visibilityState === "hidden") flushView(ed); };

/** Zoom by `k` (below 1 zooms in) about the middle of what is shown; 0 fits the whole floor again. A view change only: no layout edit, no undo step. */
export function zoomBy(ed: FloorplanStudioEditor, k: number) {
  const st = ed.st, v = st.view;
  if (ed.turn) ed.turn.whole = false; // a zoom chosen mid-turn is kept, not refitted away
  if (!k) st.fit();
  else { const cx = v.x + v.w / 2, cy = v.y + v.h / 2; st.views[st.floor] = { x: cx - (v.w * k) / 2, y: cy - (v.h * k) / 2, w: v.w * k, h: v.h * k }; }
  ed.requestUpdate();
}

/** Whether the floor on show is at its fit (zoom 1). Such a view is refitted as the plan turns; a zoomed one keeps its centre and zoom. */
export function viewIsWhole(ed: FloorplanStudioEditor): boolean {
  const st = ed.st, was = st.views[st.floor];
  if (!was) return true;
  const fit = viewBoxFor(st.f, 80, st.rotation);
  return Math.abs(was.w / fit.w - 1) < 1e-3 && Math.abs(was.h / fit.h - 1) < 1e-3;
}

/** The Rotate view buttons and the [ ] keys: 45 degrees on top of `layout.rotate`, animated. View state only: the layout is never written and there is no undo step. */
export function turnBy(ed: FloorplanStudioEditor, delta: number) {
  startTurn(ed, (ed.turn ? ed.turn.to : ed.st.viewRot) + delta, ed.turn ? ed.turn.whole : viewIsWhole(ed));
}

/** Reset view: the whole floor, the plan upright (by the shortest way round). */
export function resetView(ed: FloorplanStudioEditor) {
  const st = ed.st, from = ed.turn ? ed.turn.to : st.viewRot;
  if (!from && !ed.turn) { st.fit(); ed.requestUpdate(); return; }
  startTurn(ed, from + shortestDelta(from, 0), true);
}

export function startTurn(ed: FloorplanStudioEditor, to: number, whole: boolean) {
  const st = ed.st, from = st.turning ?? st.viewRot;
  if (ed.turn) cancelAnimationFrame(ed.turn.raf);
  const dur = TURN_MS * Math.min(2, Math.max(0.4, Math.abs(to - from) / ROTATION_STEP));
  ed.turn = { from, to, t0: performance.now(), dur, whole, raf: 0 };
  st.turning = from;
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true) { settleTurn(ed); return; }
  ed.turn.raf = requestAnimationFrame(ed.tickTurn);
  ed.requestUpdate();
}

export const tickTurn = (ed: FloorplanStudioEditor) => {
  const t = ed.turn;
  if (!t) return;
  const p = (performance.now() - t.t0) / t.dur;
  if (p >= 1) { settleTurn(ed); return; }
  ed.st.turning = t.from + (t.to - t.from) * easeInOut(p);
  if (t.whole) ed.st.fit();
  t.raf = requestAnimationFrame(ed.tickTurn);
  ed.requestUpdate();
};

/** Ends the turn at its target: the stored step is wrapped to 0..315 and the frame angle is dropped. */
export function settleTurn(ed: FloorplanStudioEditor) {
  const t = ed.turn;
  if (!t) return;
  cancelAnimationFrame(t.raf);
  ed.turn = null;
  ed.st.viewRot = normaliseRotation(t.to);
  ed.st.turning = null;
  if (t.whole) ed.st.fit();
  ed.requestUpdate();
}

/** Leaves a turn where it is going, without drawing (the editor is leaving). */
export function stopTurn(ed: FloorplanStudioEditor) {
  if (!ed.turn) return;
  cancelAnimationFrame(ed.turn.raf);
  ed.st.viewRot = normaliseRotation(ed.turn.to);
  ed.st.turning = null;
  ed.turn = null;
}

/** Moves the view by a share of its width and height, as a drag on the plan would. */
export function panKey(ed: FloorplanStudioEditor, dx: number, dy: number) {
  const st = ed.st, v = st.view;
  st.views[st.floor] = panBy(v, dx * v.w, dy * v.h);
  ed.requestUpdate();
}

export function doViewKey(ed: FloorplanStudioEditor, key: ViewKey, ev: KeyboardEvent) {
  ev.preventDefault();
  if (key === "zoomIn") zoomBy(ed, 1 / 1.25);
  else if (key === "zoomOut") zoomBy(ed, 1.25);
  else if (key === "panLeft") panKey(ed, -PAN_STEP, 0);
  else if (key === "panRight") panKey(ed, PAN_STEP, 0);
  else if (key === "panUp") panKey(ed, 0, -PAN_STEP);
  else if (key === "panDown") panKey(ed, 0, PAN_STEP);
  else if (key === "rotateLeft") turnBy(ed, -ROTATION_STEP);
  else if (key === "rotateRight") turnBy(ed, ROTATION_STEP);
  else resetView(ed);
}

export function setAlt(ed: FloorplanStudioEditor, on: boolean) { if (ed.altDown !== on) { ed.altDown = on; ed.requestUpdate(); } }
