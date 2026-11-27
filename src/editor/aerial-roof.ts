// S93: Aerial / Drone / Google Maps roof photo import helpers (Studio-only, 0 B in card).
import { dist, type Pt, type Trace } from "../core";
import { traceRotStored } from "./trace";

/** Centers and fits an aerial/drone photo over `outline` (with `marginCm` padding) and pre-rotates a North-up photo by `-northDeg`. */
export function fitTraceToRoof(
  outline: readonly Pt[],
  imgW: number,
  imgH: number,
  northDeg = 0,
  marginCm = 120,
): { x: number; y: number; w: number; rot: number } {
  const aspect = imgW > 0 && imgH > 0 ? imgW / imgH : 1;
  if (outline.length < 3) {
    return { x: 0, y: 0, w: Math.max(100, Math.round(1000 * aspect)), rot: traceRotStored(-northDeg) };
  }
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const x0 = Math.min(...xs) - marginCm, x1 = Math.max(...xs) + marginCm;
  const y0 = Math.min(...ys) - marginCm, y1 = Math.max(...ys) + marginCm;
  const bw = Math.max(100, x1 - x0), bh = Math.max(100, y1 - y0);
  const w = Math.max(1, Math.round(Math.max(bw, bh * aspect)));
  const h = w / aspect;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rot = traceRotStored(-(Number.isFinite(northDeg) ? northDeg : 0));
  // Compute top-left so the rotated image stays centered on (cx, cy).
  const rad = (rot * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const hw = w / 2, hh = h / 2;
  const x = Math.round(cx - (hw * c - hh * s));
  const y = Math.round(cy - (hw * s + hh * c));
  return { x, y, w, rot };
}

/** Rotates an existing trace image around its approximate centre to align a North-up Google Maps screenshot with `northDeg`. */
export function alignTraceToNorth(t: Trace, northDeg: number, aspect = 1): Trace {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const hw = t.w / 2, hh = t.w / (2 * safeAspect);
  const oldRad = (t.rot * Math.PI) / 180;
  const cx = t.x + hw * Math.cos(oldRad) - hh * Math.sin(oldRad);
  const cy = t.y + hw * Math.sin(oldRad) + hh * Math.cos(oldRad);
  const nextRot = traceRotStored(-(Number.isFinite(northDeg) ? northDeg : 0));
  const newRad = (nextRot * Math.PI) / 180;
  return {
    ...t,
    rot: nextRot,
    x: Math.round(cx - (hw * Math.cos(newRad) - hh * Math.sin(newRad))),
    y: Math.round(cy - (hw * Math.sin(newRad) + hh * Math.cos(newRad))),
  };
}

/** Scales a trace image from two clicked reference points whose real-world separation is `realCm`. */
export function calibrateTraceFromTwoPoints(t: Trace, p1: Pt, p2: Pt, realCm: number): Trace | null {
  if (!(Number.isFinite(realCm) && realCm > 0)) return null;
  const d = dist(p1, p2);
  if (!(Number.isFinite(d) && d > 1e-6)) return null;
  const w = Math.round(t.w * (realCm / d) * 100) / 100;
  if (!(Number.isFinite(w) && w > 0)) return null;
  return { ...t, w };
}

/** Simplifies a traced roof polygon by removing near-duplicate and collinear points within `tolCm`. */
export function simplifyRoofOutline(pts: readonly Pt[], tolCm = 12): Pt[] {
  const clean: Pt[] = [];
  for (const p of pts) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const prev = clean[clean.length - 1];
    if (!prev || dist(prev, p) >= Math.max(1, tolCm / 2)) clean.push([Math.round(p[0]), Math.round(p[1])]);
  }
  if (clean.length > 2 && dist(clean[0], clean[clean.length - 1]) < Math.max(1, tolCm / 2)) clean.pop();
  if (clean.length <= 3) return clean;
  const out: Pt[] = [];
  for (let i = 0; i < clean.length; i++) {
    const a = clean[(i - 1 + clean.length) % clean.length], b = clean[i], c = clean[(i + 1) % clean.length];
    const abx = b[0] - a[0], aby = b[1] - a[1], acx = c[0] - a[0], acy = c[1] - a[1];
    const len = Math.hypot(acx, acy);
    const perp = len > 1e-6 ? Math.abs(abx * acy - aby * acx) / len : dist(a, b);
    if (perp >= tolCm) out.push(b);
  }
  return out.length >= 3 ? out : clean;
}
