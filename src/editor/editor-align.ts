import { alignCandidates, alignKeyOf, alignStatus, alignSummary, chooseAlign, COORD_LIMIT, type Floor, floorBelow, floorPivot, floorPlace, floorPose, poseFromPlace, type Pt, stairPlace, stairReport } from "../core";
import { stopDraw } from "./editor-draw";
import { parseAlignNumber, writeAlignSteps } from "./inspector";
import { takesTyping } from "../card/view-keys";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- S27.10: the Align mode ------------------------------------------------------------------------------

/** S27.10: Floors, Align to floor below… opens the Align mode on the current floor; the floor below shows as a ghost while it is open. */
export function openAlign(ed: FloorplanStudioEditor) {
  ed.closeMenus();
  if (floorBelow(ed.st.layout, ed.st.floor) === null) return;
  stopDraw(ed); ed.traceMove = false; ed.st.sel = null; ed.alignKey = ed.st.floor; ed.asideMode = "align"; ed.alignMemo = null; // S29.9: no selection, so no handle is left on the plan
  if (ed.st.helpOpen) ed.st.setHelp(false);
  ed.requestUpdate();
  ed.focus({ preventScroll: true }); // S29.10: the keys are heard on the host, so the menu click must leave focus there
}

export function closeAlign(ed: FloorplanStudioEditor, update = true) {
  ed.alignKey = null; ed.alignMemo = null;
  if (ed.asideMode === "align") ed.asideMode = "selection";
  if (update) ed.requestUpdate();
}

/**
 * The Align mode's numbers, from the live layout: the floor below, the answer (S30.8), the panel's lines, and the pose Apply would write.
 * The expensive part, `alignCandidates`, reads only the two floors' structure, so it is memoised on `alignKeyOf` of both (no turn: a nudge,
 * a turn press and an undo make new objects with the same structure and do not search). The cheap part, `chooseAlign`, reads the floor's
 * current turn and runs on every render.
 */
export function alignPreview(ed: FloorplanStudioEditor) {
  const st = ed.st, key = ed.alignKey;
  const bk = key === null ? null : floorBelow(st.layout, key);
  if (key === null || bk === null) return null;
  const upper = st.layout.floors[key], lower = st.layout.floors[bk];
  const place = floorPlace(st.layout, key, bk);
  const k = `${alignKeyOf(upper)}#${alignKeyOf(lower)}`;
  if (!ed.alignMemo || ed.alignMemo.key !== k) { ed.alignSearches++; ed.alignMemo = { key: k, fits: alignCandidates(upper, lower) }; }
  const r = chooseAlign(ed.alignMemo.fits, place.turn), pose = floorPose(st.layout, key);
  const to = r ? poseFromPlace(st.layout, key, bk, { turn: r.turn, shift: r.t }) : null;
  const belowTitle = lower.title || bk;
  return { key, belowKey: bk, belowTitle, r, place, cur: pose.off, rot: pose.rot, to, words: r ? alignSummary(r, place, floorPivot(upper)) : null, status: r ? alignStatus(r, place, belowTitle) : "" };
}

/** Apply: the best pose, turn and offset, in one undo step (`setPose`). */
export function applyAlign(ed: FloorplanStudioEditor) {
  const a = alignPreview(ed);
  if (!a || !a.r || !a.to) return;
  if (ed.st.setPose(a.key, a.to)) { ed.changed(a.status); return; }
  if (ed.st.planBlocked) { ed.refused(); return; }
  poseNone(ed);
}

/** A pose write that wrote nothing and is not the lock: the pose was already this one ("Already aligned"), or it passes the coordinate limit. */
export function poseNone(ed: FloorplanStudioEditor) {
  ed.status = ed.st.lastPose === "same" ? "Already aligned" : `The offset would be beyond the limit of ${COORD_LIMIT} cm. Move this floor nearer the origin first`;
  ed.requestUpdate();
}

/** S29.11: the stair report for the panel, live from the layout (so it follows every press), and whether Align stairs can run. */
export function alignStairInfo(ed: FloorplanStudioEditor) {
  const st = ed.st, key = ed.alignKey, bk = key === null ? null : floorBelow(st.layout, key);
  if (key === null || bk === null) return null;
  const upper = st.layout.floors[key], lower = st.layout.floors[bk], place = floorPlace(st.layout, key, bk);
  return { rows: stairReport(upper, lower, place), belowTitle: lower.title || bk, can: stairPlace(upper, lower, place) !== null };
}

/** Align stairs: the first stair of this floor laid on the nearest stair below, turn and shift, one undo step; the status says what it did. */
export function alignStairs(ed: FloorplanStudioEditor) {
  const st = ed.st, key = ed.alignKey, bk = key === null ? null : floorBelow(st.layout, key);
  if (key === null || bk === null) return;
  const r = stairPlace(st.layout.floors[key], st.layout.floors[bk], floorPlace(st.layout, key, bk));
  if (!r) { ed.status = "Both floors need a stair to align"; ed.requestUpdate(); return; }
  const pose = poseFromPlace(st.layout, key, bk, r.place);
  if (st.setPose(key, pose)) { ed.changed(r.text); return; }
  if (st.planBlocked) { ed.refused(); return; }
  poseNone(ed);
}

export function setAlignStep(ed: FloorplanStudioEditor, kind: "move" | "turn", n: number) { ed.stepsNow = { ...ed.alignSteps, [kind]: n }; writeAlignSteps(ed.stepsNow); ed.requestUpdate(); }

/** One press of a Move button: this floor moves by the step along `dir` on screen (the view's turn is taken into account); one undo step. */
export function moveAlign(ed: FloorplanStudioEditor, dir: Pt) {
  const key = ed.alignKey;
  if (key === null) return;
  const cm = ed.alignSteps.move;
  if (ed.st.nudgeFloor(key, dir, cm, ed.st.turnDeg)) { ed.changed(`Moved this floor ${cm} cm ${dir[0] > 0 ? "right" : dir[0] < 0 ? "left" : dir[1] < 0 ? "up" : "down"}`); return; }
  pressRefused(ed);
}

/** One press of a Turn button, about the floor's pivot (its place in the house does not change); one undo step. */
export function turnAlign(ed: FloorplanStudioEditor, sign: 1 | -1) {
  const key = ed.alignKey;
  if (key === null) return;
  const deg = ed.alignSteps.turn;
  if (ed.st.turnFloor(key, sign * deg, floorPivot(ed.st.layout.floors[key]))) { ed.changed(`Turned this floor ${deg}\u00B0 ${sign > 0 ? "clockwise" : "anticlockwise"}`); return; }
  pressRefused(ed);
}

/** A press that wrote nothing: the lock says so; otherwise the pose would pass the coordinate limit. */
export function pressRefused(ed: FloorplanStudioEditor) {
  if (ed.st.planBlocked) { ed.refused(); return; }
  poseNone(ed);
}

/** A typed value that wrote nothing: the lock says so; the same value is silent (the box shows the layout again); a pose past the coordinate limit says so. */
export function typedRefused(ed: FloorplanStudioEditor) {
  if (ed.st.planBlocked) ed.refused();
  else if (ed.st.lastPose === "refused") poseNone(ed);
  else ed.requestUpdate();
}

/** One of the two offset fields (cm): a number, one undo step; junk or the same value changes nothing and the field shows the layout again. */
export function setAlignOffset(ed: FloorplanStudioEditor, axis: 0 | 1, text: string) {
  const a = alignPreview(ed);
  if (!a) return;
  const n = parseAlignNumber(text);
  if (!Number.isFinite(n)) { ed.status = "Type a number of centimetres, such as 3,5 or -2.25"; ed.requestUpdate(); return; }
  const to: Pt = axis === 0 ? [n, a.cur[1]] : [a.cur[0], n];
  if (ed.st.setOffset(a.key, to)) ed.changed("Floor offset set"); else typedRefused(ed);
}

/** S29.10: the rotation box (degrees, a comma works); one undo step, about the pivot the Turn buttons use; junk or the same value changes nothing and the box shows the layout again. */
export function setAlignRotation(ed: FloorplanStudioEditor, text: string) {
  const a = alignPreview(ed);
  if (!a) return;
  const n = parseAlignNumber(text);
  if (!Number.isFinite(n)) { ed.status = "Type a number of degrees, such as 3,5 or -2.25"; ed.requestUpdate(); return; }
  // Review 29: about the pivot the Turn buttons use, so the floor's place in the house does not jump; the same angle writes nothing.
  if (ed.st.setRotation(a.key, n, floorPivot(ed.st.layout.floors[a.key]))) ed.changed("Floor rotation set"); else typedRefused(ed);
}

/** Reset: rotation and offset both to zero, one undo step. */
export function resetAlignOffset(ed: FloorplanStudioEditor) { const a = alignPreview(ed); if (a && (a.rot !== 0 || a.cur[0] !== 0 || a.cur[1] !== 0)) { if (ed.st.setPose(a.key, { rot: 0, off: [0, 0] })) ed.changed("Floor offset and rotation reset"); else ed.refused(); } }

/** S29.10: while Align is open on this floor, the arrows move it and `,` `.` turn it, by the selected steps. Held keys (auto-repeat) do nothing; a text field keeps its keys. */
export function alignKeyDo(ed: FloorplanStudioEditor, ev: KeyboardEvent): boolean {
  if (!ed.aligning || ed.draw) return false; // review 29: a draw owns its keys ('.' types a length)
  if (ev.defaultPrevented || ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  const dir: Record<string, Pt> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const d = dir[ev.key];
  if (!d && ev.key !== "," && ev.key !== ".") return false;
  if (takesTyping(ev.composedPath()[0] as HTMLElement | undefined)) return false;
  ev.preventDefault();
  if (ev.repeat) return true;
  if (d) moveAlign(ed, d); else turnAlign(ed, ev.key === "." ? 1 : -1);
  return true;
}

/** The floor below as `renderFloor`'s ghost: while the Align mode is open, or when View, Floor below is on (S27.11). */
export function ghostOpts(ed: FloorplanStudioEditor): { floor: Floor; shift: Pt; turn: number } | undefined {
  const st = ed.st, bk = floorBelow(st.layout, st.floor);
  if (bk === null) return undefined;
  const aligning = ed.asideMode === "align" && ed.alignKey === st.floor;
  if (!aligning && !st.ghostFloor) return undefined;
  const p = floorPlace(st.layout, bk, st.floor);
  return { floor: st.layout.floors[bk], shift: p.shift, turn: p.turn };
}
