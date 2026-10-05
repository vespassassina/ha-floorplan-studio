// The motion edge of a room, as plain maths: a band along the inside of its outline. No three.js, no DOM. The plan draws
// the same thing as a stroke clipped to the room (the "motion perimeter"); a stroke has no width in 3D, so this is the
// band as triangles. Frame: the plan's, cm.
type Pt = readonly [number, number];

/**
 * Triangles (x, y pairs, six numbers per pair of corners... flat: x0, y0, x1, y1, x2, y2 per triangle) for the band between
 * `inner` and `outer` cm inside the polygon. Each corner is moved along the bisector of its two edges, so the band keeps
 * its width round a corner; a very sharp corner is capped. A polygon that cannot hold a band (fewer than three finite
 * points, no area, `outer` not past `inner`) gives nothing. Never throws.
 */
export function insetBand(base: readonly (readonly number[])[], inner: number, outer: number): number[] {
  if (!Array.isArray(base) || base.length < 3 || !(outer > inner) || !(inner >= 0) || !base.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return [];
  const p: Pt[] = [];
  for (const q of base) { const l = p[p.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) p.push([q[0], q[1]]); }
  while (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
  const n = p.length;
  if (n < 3) return [];
  const area = p.reduce((s, a, i) => { const b = p[(i + 1) % n]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
  if (!(Math.abs(area) > 1e-9)) return [];
  // For a positive area (y down, so clockwise on the page) the inward normal of a to b is (-dy, dx), for a negative one (dy, -dx).
  const sg = area > 0 ? 1 : -1;
  const normal = (a: Pt, b: Pt): Pt => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return l > 0 ? [(-sg * (b[1] - a[1])) / l, (sg * (b[0] - a[0])) / l] : [0, 0]; };
  const at = (i: number, d: number): Pt => {
    const n1 = normal(p[(i + n - 1) % n], p[i]), n2 = normal(p[i], p[(i + 1) % n]), k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    const m: Pt = k > 0.3 ? [(n1[0] + n2[0]) / k, (n1[1] + n2[1]) / k] : [n2[0], n2[1]]; // 0.3: past about 130 degrees of turn the miter would run away
    return [p[i][0] + m[0] * d, p[i][1] + m[1] * d];
  };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a0 = at(i, inner), a1 = at(j, inner), b0 = at(i, outer), b1 = at(j, outer);
    out.push(a0[0], a0[1], a1[0], a1[1], b1[0], b1[1], a0[0], a0[1], b1[0], b1[1], b0[0], b0[1]);
  }
  return out;
}

/** The pulse of the motion edge as the plan's CSS animation draws it: 1 at the start of a pulse, 0.35 half way. `age` in seconds, `period` in seconds. */
export const pulseAt = (age: number, period: number): number => 0.675 + 0.325 * Math.cos((2 * Math.PI * age) / period);
