/** S7.4: the card's zoom and pan, as pure maths on a viewBox. No DOM here: the card turns pointer pixels into
 * plan units and writes the result into the `<svg viewBox>`. */

export interface View { x: number; y: number; w: number; h: number }
export type Pt = [number, number];

/** The deepest the card zooms in, relative to fit. */
export const MAX_ZOOM = 8;

const finite = (v: View) => [v.x, v.y, v.w, v.h].every(Number.isFinite) && v.w > 0 && v.h > 0;

/** Zooms by `k` (> 1 in, < 1 out) about plan point (px, py): that point keeps its place on screen. */
export function zoomAt(view: View, k: number, px: number, py: number): View {
  if (!Number.isFinite(k) || k <= 0) return view;
  return { x: px - (px - view.x) / k, y: py - (py - view.y) / k, w: view.w / k, h: view.h / k };
}

/** Moves the view's origin by (dx, dy) plan units. Dragging the plan right is a negative dx. */
export function panBy(view: View, dx: number, dy: number): View {
  return { x: view.x + dx, y: view.y + dy, w: view.w, h: view.h };
}

/** Keeps `start` so that `[start, start + size]` overlaps `[lo, lo + span]` by at least a third of the smaller of
 * the two. Zoomed in the view is the smaller, so a third of the view stays on the plan. */
function bound(start: number, size: number, lo: number, span: number): number {
  const m = Math.min(size, span) / 3;
  return Math.min(Math.max(start, lo - size + m), lo + span - m);
}

/** The view, held between fit and `MAX_ZOOM`, and panned no further than leaves a third on the plan. Anything
 * wider than fit is fit; anything non-finite is fit too. */
export function clamp(view: View, fit: View): View {
  // The 1e-6 slack: zooming in and back out lands a hair under fit.w, which must still read as fit.
  if (!finite(view) || !finite(fit) || view.w >= fit.w * (1 - 1e-6)) return fit;
  let v = view;
  const min = fit.w / MAX_ZOOM;
  if (v.w < min) v = zoomAt(v, v.w / min, v.x + v.w / 2, v.y + v.h / 2);
  const x = bound(v.x, v.w, fit.x, fit.w), y = bound(v.y, v.h, fit.y, fit.h);
  return x === v.x && y === v.y ? v : { x, y, w: v.w, h: v.h };
}

/** Two fingers moved from p1, p2 to q1, q2 (plan units under `view`): zooms by the change in their distance and
 * moves the plan point under the old midpoint to the new one. Fingers on one spot are not a pinch. */
export function pinch(view: View, p1: Pt, p2: Pt, q1: Pt, q2: Pt): View {
  const d0 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const d1 = Math.hypot(q2[0] - q1[0], q2[1] - q1[1]);
  if (!(d0 > 0) || !(d1 > 0)) return view;
  const k = d1 / d0;
  const pm: Pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const qm: Pt = [(q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2];
  return { x: pm[0] - (qm[0] - view.x) / k, y: pm[1] - (qm[1] - view.y) / k, w: view.w / k, h: view.h / k };
}
