import type { Floor, Pt } from "../core/schema";

const EPS = 1e-6; // cm: a centre this close to an edge counts as on it

const isPt = (p: unknown): p is Pt => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** The point a device is picked by: a point device's x,y, a segment device's midpoint. Null for junk. */
function centre(d: unknown): Pt | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  if (isPt(o.a) && isPt(o.b)) return [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
  if (typeof o.x === "number" && typeof o.y === "number" && Number.isFinite(o.x) && Number.isFinite(o.y)) return [o.x, o.y];
  return null;
}

/**
 * S26.5: the indices of the devices whose centre lies in `quad` (four corners in plan space, either winding; the screen
 * rectangle taken back through the view's turn). An edge or a corner counts. `skip(i)` leaves out what is not drawn.
 * Junk (a bad quad, a bad device, a flat quad) never throws and never hits.
 */
export function marqueeHits(f: Floor, quad: [Pt, Pt, Pt, Pt], skip: (i: number) => boolean): number[] {
  const devices = f && Array.isArray(f.devices) ? f.devices : [];
  if (!Array.isArray(quad) || quad.length !== 4 || !quad.every(isPt)) return [];
  let area2 = 0;
  for (let k = 0; k < 4; k++) { const p = quad[k], q = quad[(k + 1) % 4]; area2 += p[0] * q[1] - q[0] * p[1]; }
  if (!(Math.abs(area2) > EPS)) return [];
  const sign = area2 > 0 ? 1 : -1;
  const hits: number[] = [];
  devices.forEach((d, i) => {
    const c = centre(d);
    if (!c) return;
    for (let k = 0; k < 4; k++) {
      const p = quad[k], q = quad[(k + 1) % 4];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len === 0) continue;
      // signed distance of c from the edge, positive on the inside
      if (sign * ((q[0] - p[0]) * (c[1] - p[1]) - (q[1] - p[1]) * (c[0] - p[0])) / len < -EPS) return;
    }
    if (skip(i)) return;
    hits.push(i);
  });
  return hits;
}
