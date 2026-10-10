import type { Floor, Pt } from "./schema";

/**
 * S27.4: where to lay one floor on the floor below it. Translation only, in the floors' stored coordinates.
 *
 * Structure lines of a floor: the outline's edges and every `external` wall; with neither, the edges of every room
 * (zones are only a dotted overlay and are left out). The score is the share of the upper floor's structure length,
 * sampled every 10 cm, that lies within 5 cm of the lower floor's structure lines after the move, 0 to 100.
 *
 * Candidates are every pair of corners (upper, lower), at most 64 corners per floor (the ones with the longest
 * edges), plus no move. The best few are refined by a translation-only nearest-line fit. A tie within 1 point goes
 * to the smaller move. Layout input is untrusted: nothing here throws.
 *
 * Limits that only a huge or hand-made floor meets: at most 1500 samples (the step grows past 10 cm), and the
 * 800 longest lines of the lower floor.
 */

type Seg = [number, number, number, number];
type Sample = { x: number; y: number; w: number };

export interface AlignResult {
  /** cm to add to a point of the upper floor to lay it on the lower one, to 0.1 cm. */
  t: Pt;
  /** 0 to 100: the share of the upper floor's structure that lands within `NEAR` of the lower floor's. */
  score: number;
  /** Under `WEAK_BELOW` per cent. Apply still works; the caller says so. */
  weak: boolean;
}

export const NEAR = 5;
export const WEAK_BELOW = 50;
const STEP = 10, MAX_SAMPLES = 1500, MAX_LOWER = 800, MAX_CORNERS = 64, COARSE = 48, TOP = 3, REFINE_ROUNDS = 10, REFINE_REACH = 25, TIE = 1;

const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const pt = (p: unknown): p is Pt => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]);
const list = (x: unknown): any[] => (Array.isArray(x) ? x : []);

function ring(pts: unknown, out: Seg[]): void {
  const p = list(pts);
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (pt(a) && pt(b) && (a[0] !== b[0] || a[1] !== b[1])) out.push([a[0], a[1], b[0], b[1]]);
  }
}

function structure(f: unknown): Seg[] {
  const o = typeof f === "object" && f !== null ? (f as Record<string, unknown>) : {};
  const s: Seg[] = [];
  if (list(o.outline).length > 2) ring(o.outline, s);
  for (const w of list(o.walls)) if (typeof w === "object" && w !== null && (w as any).kind === "external" && pt((w as any).a) && pt((w as any).b)) {
    const { a, b } = w as { a: Pt; b: Pt };
    if (a[0] !== b[0] || a[1] !== b[1]) s.push([a[0], a[1], b[0], b[1]]);
  }
  if (s.length) return s;
  for (const r of list(o.rooms)) if (typeof r === "object" && r !== null && (r as any).kind !== "zone") ring((r as any).pts, s);
  return s;
}

const len = (s: Seg) => Math.hypot(s[2] - s[0], s[3] - s[1]);

/** Points along every line, one per `step` cm (at the middle of each piece), each weighing the length it stands for. */
function sampleLines(segs: Seg[], step: number): Sample[] {
  const out: Sample[] = [];
  for (const s of segs) {
    const l = len(s), n = Math.max(1, Math.round(l / step));
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n;
      out.push({ x: s[0] + (s[2] - s[0]) * u, y: s[1] + (s[3] - s[1]) * u, w: l / n });
    }
  }
  return out;
}

const longest = (segs: Seg[], n: number) => (segs.length <= n ? segs : [...segs].sort((a, b) => len(b) - len(a)).slice(0, n));

/** Squared distance from (px, py) to segment s. */
function d2(px: number, py: number, s: Seg): number {
  const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
  const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / l2));
  const ex = s[0] + dx * u - px, ey = s[1] + dy * u - py;
  return ex * ex + ey * ey;
}

/** Percent of the sample weight that lies within `NEAR` of a line, after moving by (tx, ty). */
function scoreAt(samples: Sample[], lines: Seg[], tx: number, ty: number): number {
  let hit = 0, all = 0;
  const lim = NEAR * NEAR;
  for (const p of samples) {
    all += p.w;
    const x = p.x + tx, y = p.y + ty;
    for (let i = 0; i < lines.length; i++) if (d2(x, y, lines[i]) <= lim) { hit += p.w; break; }
  }
  return all === 0 ? 0 : (100 * hit) / all;
}

/** Slide by the mean pull of the samples that have a line within reach, a few times; keeps the best score seen. */
function refine(samples: Sample[], lines: Seg[], t: Pt): { t: Pt; score: number } {
  let best = { t, score: scoreAt(samples, lines, t[0], t[1]) };
  let tx = t[0], ty = t[1];
  const lim = REFINE_REACH * REFINE_REACH;
  for (let round = 0; round < REFINE_ROUNDS; round++) {
    let sx = 0, sy = 0, n = 0;
    for (const p of samples) {
      const x = p.x + tx, y = p.y + ty;
      let bd = lim, bi = -1;
      for (let i = 0; i < lines.length; i++) { const d = d2(x, y, lines[i]); if (d < bd) { bd = d; bi = i; } }
      if (bi < 0) continue;
      const s = lines[bi], dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
      const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / l2));
      sx += s[0] + dx * u - x; sy += s[1] + dy * u - y; n++;
    }
    if (n === 0) break;
    const mx = sx / n, my = sy / n;
    if (Math.abs(mx) < 0.05 && Math.abs(my) < 0.05) break;
    tx += mx; ty += my;
    const sc = scoreAt(samples, lines, tx, ty);
    if (sc > best.score) best = { t: [tx, ty], score: sc };
  }
  return best;
}

/** The corners of the lines, the ones with the longest edges first, at most `MAX_CORNERS`. */
function corners(segs: Seg[]): Pt[] {
  const m = new Map<string, { p: Pt; w: number }>();
  const add = (x: number, y: number, w: number) => {
    const k = `${Math.round(x)},${Math.round(y)}`, c = m.get(k);
    if (c) c.w += w; else m.set(k, { p: [x, y], w });
  };
  for (const s of segs) { const l = len(s); add(s[0], s[1], l); add(s[2], s[3], l); }
  return [...m.values()].sort((a, b) => b.w - a.w).slice(0, MAX_CORNERS).map((c) => c.p);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The translation that lays `upper` best on `lower`, and how well it fits; null when either has nothing to match. Never throws. */
export function alignFloor(upper: Floor, lower: Floor): AlignResult | null {
  try {
    const us = structure(upper);
    const ls = structure(lower);
    if (!us.length || !ls.length) return null;
    const total = us.reduce((a, s) => a + len(s), 0);
    const step = Math.max(STEP, total / MAX_SAMPLES);
    const samples = sampleLines(us, step);
    const lines = longest(ls, MAX_LOWER);
    const coarseLines = longest(ls, 150);
    const stride = Math.max(1, Math.ceil(samples.length / COARSE));
    const coarse = samples.filter((_, i) => i % stride === 0);

    // Candidate moves, deduplicated to the whole cm.
    const seen = new Set<string>(["0,0"]);
    const cands: Pt[] = [[0, 0]];
    const uc = corners(us), lc = corners(ls);
    for (const a of uc) for (const b of lc) {
      const t: Pt = [b[0] - a[0], b[1] - a[1]], k = `${Math.round(t[0])},${Math.round(t[1])}`;
      if (!seen.has(k)) { seen.add(k); cands.push(t); }
    }
    const ranked = cands.map((t) => ({ t, s: scoreAt(coarse, coarseLines, t[0], t[1]) }));
    // Stable sort: ties keep the order, no move first.
    ranked.sort((a, b) => b.s - a.s);

    const fitSamples = samples.length > 1000 ? samples.filter((_, i) => i % Math.ceil(samples.length / 1000) === 0) : samples;
    const fitLines = longest(ls, 600);
    const finals = ranked.slice(0, TOP).map((c) => refine(fitSamples, fitLines, c.t));
    // The no-move case is always in the running, as is its refinement.
    const zero = refine(fitSamples, fitLines, [0, 0]);
    finals.push(zero);
    for (const f of finals) f.score = scoreAt(samples, lines, round1(f.t[0]), round1(f.t[1]));
    const top = Math.max(...finals.map((f) => f.score));
    const pick = finals.filter((f) => f.score >= top - TIE).sort((a, b) => Math.hypot(a.t[0], a.t[1]) - Math.hypot(b.t[0], b.t[1]))[0];
    const t: Pt = [round1(pick.t[0]) + 0, round1(pick.t[1]) + 0];
    const score = Math.round(pick.score * 10) / 10;
    return { t, score, weak: score < WEAK_BELOW };
  } catch {
    return null;
  }
}
