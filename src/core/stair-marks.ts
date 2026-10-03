// The 2D marks of a flight that does not simply go up: an arrow on its axis and, going down, steps that darken toward the
// low end like a stairwell. Pure string builders, drawn inside the stair's own turned group by `renderFloor`.
// A straight flight climbs toward +x when it runs along x and toward -y when it runs along y (as in solids.ts); a round
// one climbs with the angle, from 0 (the right) once round. "Up" has no mark: it is the plan as it always was.
import { num } from "./fmt";
import type { Pt, StairDirection } from "./schema";

/** The box of the flight, and for a round one its outer and inner radius. */
export interface StairBox { x0: number; x1: number; y0: number; y1: number; steps: number; round?: { R: number; r: number } }

const HEAD = 12; // cm, longest arrow head
const WING = 0.6; // half the head's width, as a share of its length
const INSET = 0.15; // share of the long side left clear at each end of the axis
const ARC = [210, 330] as const; // degrees: the low and the high end of a round flight's arrow (the top of the ring)

/** A head at `tip`, two wings back along `d` (the unit direction the arrow travels there). */
function head(tip: Pt, d: Pt, size: number): string {
  const back: Pt = [tip[0] - d[0] * size, tip[1] - d[1] * size], n: Pt = [-d[1] * size * WING, d[0] * size * WING];
  return `M${num(back[0] + n[0])} ${num(back[1] + n[1])}L${num(tip[0])} ${num(tip[1])}L${num(back[0] - n[0])} ${num(back[1] - n[1])}`;
}

/** The arrow's path for a flight going `dir` ("up" has none). Down points at the low end; both has a head at each end. */
function arrowPath(b: StairBox, dir: StairDirection): string {
  const both = dir === "both";
  if (b.round) {
    const rm = b.round.r ? (b.round.R + b.round.r) / 2 : b.round.R * 0.6, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, size = Math.min(HEAD, rm * 0.5);
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const at = (deg: number): Pt => [cx + rm * Math.cos(rad(deg)), cy + rm * Math.sin(rad(deg))];
    const [low, high] = [at(ARC[0]), at(ARC[1])];
    // The tangent of a climb (the angle growing) is (-sin, cos); the low end's head points the other way, down the flight.
    const downD: Pt = [Math.sin(rad(ARC[0])), -Math.cos(rad(ARC[0]))], upD: Pt = [-Math.sin(rad(ARC[1])), Math.cos(rad(ARC[1]))];
    return `M${num(high[0])} ${num(high[1])}A${num(rm)} ${num(rm)} 0 0 0 ${num(low[0])} ${num(low[1])}${head(low, downD, size)}${both ? head(high, upD, size) : ""}`;
  }
  const along = b.x1 - b.x0 > b.y1 - b.y0, long = along ? b.x1 - b.x0 : b.y1 - b.y0, short = along ? b.y1 - b.y0 : b.x1 - b.x0;
  const mid = along ? (b.y0 + b.y1) / 2 : (b.x0 + b.x1) / 2, inset = long * INSET, size = Math.min(HEAD, short * 0.25);
  const low = along ? b.x0 + inset : b.y1 - inset, high = along ? b.x1 - inset : b.y0 + inset;
  const p = (v: number): Pt => (along ? [v, mid] : [mid, v]);
  const toLow: Pt = along ? [-1, 0] : [0, 1];
  return `M${num(p(high)[0])} ${num(p(high)[1])}L${num(p(low)[0])} ${num(p(low)[1])}${head(p(low), toLow, size)}${both ? head(p(high), [-toLow[0], -toLow[1]], size) : ""}`;
}

/** One band per step, darker toward the low end: the treads sinking into the floor. A round flight is one shape, shaded evenly. */
function shades(b: StairBox, outline: string): string[] {
  if (b.round) return [`<path class="stair-shade" opacity="0.6" fill-rule="evenodd" ${outline}/>`];
  const along = b.x1 - b.x0 > b.y1 - b.y0, n = b.steps, out: string[] = [];
  for (let j = 0; j < n; j++) { // j counts from the high end
    const op = num((j + 1) / n);
    out.push(along
      ? `<rect class="stair-shade" opacity="${op}" x="${num(b.x1 - ((b.x1 - b.x0) * (j + 1)) / n)}" y="${num(b.y0)}" width="${num((b.x1 - b.x0) / n)}" height="${num(b.y1 - b.y0)}"/>`
      : `<rect class="stair-shade" opacity="${op}" x="${num(b.x0)}" y="${num(b.y0 + ((b.y1 - b.y0) * j) / n)}" width="${num(b.x1 - b.x0)}" height="${num((b.y1 - b.y0) / n)}"/>`);
  }
  return out;
}

/** What is drawn over a flight's fill: the shade under its treads, the arrow over them. `outline` is the `d` attribute a round flight's shade reuses. */
export function stairMarks(b: StairBox, dir: StairDirection, outline: string): { shade: string; arrow: string } {
  if (dir === "up") return { shade: "", arrow: "" };
  return { shade: dir === "down" ? shades(b, outline).join("") : "", arrow: `<path class="stair-dir" d="${arrowPath(b, dir)}"/>` };
}
