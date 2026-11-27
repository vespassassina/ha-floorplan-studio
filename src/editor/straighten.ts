import { dist, movePoints, polys, type Floor, type Pt } from "../core";

// S84: Straighten walls and merge collinear multi-segment walls (Studio-only, 0 B in floorplan-studio-card.js).

const TOUCH = 2;

const round = (n: number) => Math.round(n) + 0;

function segDev(a: Pt, p: Pt, b: Pt): { distCm: number; bendDeg: number } {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const ab = Math.hypot(vx, vy);
  if (ab < 1e-6) return { distCm: dist(a, p), bendDeg: 180 };
  const distCm = Math.abs((p[0] - a[0]) * vy - (p[1] - a[1]) * vx) / ab;
  const u1x = p[0] - a[0], u1y = p[1] - a[1], l1 = Math.hypot(u1x, u1y);
  const u2x = b[0] - p[0], u2y = b[1] - p[1], l2 = Math.hypot(u2x, u2y);
  if (l1 < 1e-6 || l2 < 1e-6) return { distCm: 0, bendDeg: 0 };
  const dot = Math.max(-1, Math.min(1, (u1x * u2x + u1y * u2y) / (l1 * l2)));
  const bendDeg = (Math.acos(dot) * 180) / Math.PI;
  return { distCm, bendDeg };
}

/**
 * Collapses redundant nearly-collinear vertices on `outline` and rooms, and merges chained collinear free `walls`
 * of the same kind/colour/height into single straight segments. Preserves junctions and door/opening endpoints.
 */
export function simplifyFloorWalls(
  f: Floor,
  maxAngleDeg = 5,
  maxDevCm = 6,
): { floor: Floor; merged: number; wallsMerged: number } {
  const g = structuredClone(f);
  let merged = 0;
  let wallsMerged = 0;

  // Points that must not be dropped: door/opening endpoints and vertices shared across 2+ polygons.
  const pinned: Pt[] = [];
  for (const d of g.doors) { pinned.push(d.a, d.b); }
  for (const o of g.openings) { pinned.push(o.a, o.b); }
  const polyList = [
    ...(g.outline.length >= 3 ? [{ pts: g.outline, wk: g.owk, wc: g.owc }] : []),
    ...g.rooms.filter((r) => r.kind !== "zone" && !r.free && r.pts.length >= 3).map((r) => ({ pts: r.pts, wk: r.wk, wc: r.wc })),
  ];
  // Any vertex that appears in another polygon as a corner with a sharp bend is pinned (T-junction).
  const isPinned = (p: Pt, selfIdx: number): boolean => {
    if (pinned.some((q) => dist(p, q) <= 3)) return true;
    for (let pi = 0; pi < polyList.length; pi++) {
      if (pi === selfIdx) continue;
      const pts = polyList[pi]!.pts;
      for (let j = 0; j < pts.length; j++) {
        if (dist(p, pts[j]!) <= TOUCH) {
          const prev = pts[(j - 1 + pts.length) % pts.length]!;
          const next = pts[(j + 1) % pts.length]!;
          if (segDev(prev, pts[j]!, next).bendDeg > maxAngleDeg) return true;
        }
      }
    }
    return false;
  };

  for (let pi = 0; pi < polyList.length; pi++) {
    const P = polyList[pi]!;
    let changed = true;
    while (changed && P.pts.length > 3) {
      changed = false;
      for (let j = 0; j < P.pts.length && P.pts.length > 3; j++) {
        const prevIdx = (j - 1 + P.pts.length) % P.pts.length;
        const nextIdx = (j + 1) % P.pts.length;
        if (P.wk && P.wk[prevIdx] !== P.wk[j]) continue;
        if (P.wc && P.wc[prevIdx] !== P.wc[j]) continue;
        const cur = P.pts[j]!;
        if (isPinned(cur, pi)) continue;
        const { distCm, bendDeg } = segDev(P.pts[prevIdx]!, cur, P.pts[nextIdx]!);
        if (distCm <= maxDevCm && bendDeg <= maxAngleDeg) {
          P.pts.splice(j, 1);
          P.wk?.splice(j, 1);
          P.wc?.splice(j, 1);
          merged++;
          changed = true;
          break;
        }
      }
    }
  }

  // Merge chained collinear free walls of identical kind, colour, and height.
  let wallPass = true;
  while (wallPass && g.walls.length >= 2) {
    wallPass = false;
    outer: for (let i = 0; i < g.walls.length; i++) {
      for (let j = i + 1; j < g.walls.length; j++) {
        const w1 = g.walls[i]!, w2 = g.walls[j]!;
        if (w1.kind !== w2.kind || w1.color !== w2.color || w1.height !== w2.height) continue;
        // Find shared endpoint pair
        const pairs: [Pt, Pt, Pt][] = [
          [w1.a, w1.b, w2.b], // w1.b == w2.a
          [w1.a, w1.b, w2.a], // w1.b == w2.b
          [w1.b, w1.a, w2.b], // w1.a == w2.a
          [w1.b, w1.a, w2.a], // w1.a == w2.b
        ];
        const checks: [Pt, Pt][] = [
          [w1.b, w2.a], [w1.b, w2.b], [w1.a, w2.a], [w1.a, w2.b],
        ];
        for (let k = 0; k < 4; k++) {
          if (dist(checks[k]![0], checks[k]![1]) > TOUCH) continue;
          const [end1, mid, end2] = pairs[k]!;
          // Do not merge if a 3rd wall meets at this junction
          const degree = g.walls.reduce((n, w, idx) => n + (idx !== i && idx !== j && (dist(w.a, mid) <= TOUCH || dist(w.b, mid) <= TOUCH) ? 1 : 0), 0);
          if (degree > 0) continue;
          const { distCm, bendDeg } = segDev(end1, mid, end2);
          if (distCm <= maxDevCm && bendDeg <= maxAngleDeg) {
            w1.a = [end1[0], end1[1]];
            w1.b = [end2[0], end2[1]];
            g.walls.splice(j, 1);
            wallsMerged++;
            wallPass = true;
            break outer;
          }
        }
      }
    }
  }

  return { floor: g, merged, wallsMerged };
}

/**
 * Snaps nearly-aligned edges of `outline`, rooms, and free `walls` within `snapDeg` of multiples of `stepDeg`
 * (`90`, `45`, `30`, or `15`), moving coincident corners together so rooms stay stitched.
 */
export function straightenFloorWalls(
  f: Floor,
  snapDeg = 6,
  stepDeg: 90 | 45 | 30 | 15 = 90,
): { floor: Floor; straightened: number } {
  const g = structuredClone(f);
  const allPts: Pt[] = [];
  const edges: [Pt, Pt][] = [];

  const addPoly = (pts: Pt[]) => {
    for (let i = 0; i < pts.length; i++) {
      allPts.push(pts[i]!);
      edges.push([pts[i]!, pts[(i + 1) % pts.length]!]);
    }
  };
  if (g.outline.length >= 3) addPoly(g.outline);
  for (const r of g.rooms) {
    if (r.kind === "zone" || r.free || r.pts.length < 3) continue;
    addPoly(r.pts);
  }
  for (const w of g.walls) {
    allPts.push(w.a, w.b);
    edges.push([w.a, w.b]);
  }

  const moveCoincident = (from: Pt, to: Pt) => {
    const fx = from[0], fy = from[1];
    const tx = round(to[0]), ty = round(to[1]);
    if (fx === tx && fy === ty) return;
    for (const p of allPts) {
      if (Math.hypot(p[0] - fx, p[1] - fy) <= TOUCH) {
        p[0] = tx;
        p[1] = ty;
      }
    }
  };

  let straightened = 0;
  for (const [a, b] of edges) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 10) continue;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const target = Math.round(ang / stepDeg) * stepDeg;
    let err = Math.abs(ang - target) % 360;
    if (err > 180) err = 360 - err;
    if (err <= 0.05 || err > snapDeg) continue;

    const rad = (target * Math.PI) / 180;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const half = len / 2;
    const na: Pt = [round(mx - Math.cos(rad) * half), round(my - Math.sin(rad) * half)];
    const nb: Pt = [round(mx + Math.cos(rad) * half), round(my + Math.sin(rad) * half)];
    moveCoincident(a, na);
    moveCoincident(b, nb);
    straightened++;
  }

  return { floor: g, straightened };
}

// ---- S85: exact corner angle measurement & setting -------------------------------------------------------

export const CORNER_ANGLE_PRESETS = [90, 45, 60, 120, 135, 180] as const;

/** Unsigned angle (0..180°, 0.1° precision) between the two edges meeting at vertex `j` of polygon `pts`. */
export function cornerAngleDeg(pts: readonly Pt[], j: number): number | null {
  if (!Array.isArray(pts) || pts.length < 3 || j < 0 || j >= pts.length) return null;
  const prev = pts[(j - 1 + pts.length) % pts.length]!;
  const cur = pts[j]!;
  const next = pts[(j + 1) % pts.length]!;
  const ax = prev[0] - cur[0], ay = prev[1] - cur[1];
  const bx = next[0] - cur[0], by = next[1] - cur[1];
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-6 || lb < 1e-6) return null;
  const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return Math.round(((Math.acos(dot) * 180) / Math.PI) * 10) / 10;
}

/**
 * Sets the angle at corner `j` of `poly` to `targetDeg` (1..180°) by rotating the outgoing leg (or incoming leg
 * when `movePrev` is true) around the corner while preserving its length, moving coincident corners together.
 */
export function setCornerAngle(f: Floor, poly: string, j: number, targetDeg: number, movePrev = false): Floor {
  if (!Number.isFinite(targetDeg) || targetDeg <= 0 || targetDeg > 180) return f;
  const P = polys(f).find((x) => x.id === poly);
  if (!P || P.pts.length < 3 || j < 0 || j >= P.pts.length) return f;
  const n = P.pts.length;
  const prevIdx = (j - 1 + n) % n, nextIdx = (j + 1) % n;
  const cur = P.pts[j]!;
  const anchor = movePrev ? P.pts[nextIdx]! : P.pts[prevIdx]!;
  const moving = movePrev ? P.pts[prevIdx]! : P.pts[nextIdx]!;
  const ax = anchor[0] - cur[0], ay = anchor[1] - cur[1];
  const mx = moving[0] - cur[0], my = moving[1] - cur[1];
  const la = Math.hypot(ax, ay), lm = Math.hypot(mx, my);
  if (la < 1e-6 || lm < 1e-6) return f;
  const cross = ax * my - ay * mx;
  const sign = cross < 0 ? -1 : 1;
  const baseAng = Math.atan2(ay, ax);
  const newAng = baseAng + sign * ((targetDeg * Math.PI) / 180);
  const to: Pt = [round(cur[0] + Math.cos(newAng) * lm), round(cur[1] + Math.sin(newAng) * lm)];
  if (to[0] === moving[0] && to[1] === moving[1]) return f;
  return movePoints(f, moving, to, false);
}

// ---- S86: external wall alignment between floors ---------------------------------------------------------

function longestEdge(pts: readonly Pt[]): { a: Pt; b: Pt; len: number; ang: number; mid: Pt } | null {
  if (!Array.isArray(pts) || pts.length < 3) return null;
  let best: { a: Pt; b: Pt; len: number; ang: number; mid: Pt } | null = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const len = dist(a, b);
    if (!best || len > best.len) {
      best = { a, b, len, ang: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    }
  }
  return best && best.len >= 10 ? best : null;
}

/**
 * Computes `{ rot, off }` (clockwise degrees + cm translation) to align `upper`'s longest exterior outline wall
 * flush onto `lower`'s longest exterior outline wall. Returns null if either floor has no valid outline.
 */
export function externalWallPlace(upper: Floor, lower: Floor): { rot: number; off: Pt; text: string } | null {
  const eu = longestEdge(upper.outline), el = longestEdge(lower.outline);
  if (!eu || !el) return null;
  let turn = ((el.ang - eu.ang) % 360 + 540) % 360 - 180;
  // Pick the orientation (0 or 180 flip) closest to 0° so we don't flip the floor upside down unnecessarily
  if (Math.abs(turn) > 90) turn = turn > 0 ? turn - 180 : turn + 180;
  turn = Math.round(turn * 10) / 10;
  const rad = (turn * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const rx = eu.mid[0] * cos - eu.mid[1] * sin;
  const ry = eu.mid[0] * sin + eu.mid[1] * cos;
  const off: Pt = [round(el.mid[0] - rx), round(el.mid[1] - ry)];
  return { rot: turn, off, text: `Aligned external wall (turn ${turn}°, shift ${off[0]}, ${off[1]} cm)` };
}
