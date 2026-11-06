// B53.5 (spec item 19b): a piece of furniture as a few boxes, in the piece's own frame. ONE function feeds the 2.5D solids
// (solids.ts) and the 3D scene (scene-build.ts), so the two views cannot differ (CLAUDE.md finding 8).
//
// Frame: x runs 0..w and y 0..h across the piece as the symbol is drawn, y = 0 being its back edge (a sofa's back, a bed's
// head); z runs up from the piece's own bottom, 0..H, in cm. Every block lies inside that box at any size the editor allows
// (5 cm up), so each fixed size below shrinks with the piece (`room`, `lift`) and a block that would be empty is dropped.
// A layout is untrusted input (finding 1): nothing here throws, and a piece that cannot be drawn gives no blocks.
import { furnitureHeight } from "./heights";
import type { Furniture } from "./schema";

/**
 * `dark` is a leg or a plinth: the piece's colour, 20 % darker (`darkened`). B53.12: `glass` is a shower wall (theme `--fp-glass`,
 * translucent) and `mirror` a mirror's face (theme `--fp-mirror`); neither takes the piece's paint.
 */
export interface Block { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; tone: "body" | "dark" | "glass" | "mirror" }

/** How much black a dark block takes: the piece's colour 20 % darker. The one place the figure lives (CSS, 3D palette, paint). */
export const DARKEN_PCT = 20;
/** A colour, `css`, mixed `DARKEN_PCT` toward black: what a dark block is painted with. */
export const darkened = (css: string): string => `color-mix(in srgb, ${css} ${100 - DARKEN_PCT}%, black)`;

/** `darkened` for a `#rrggbb` (3D cannot read `color-mix`): each channel times (100 - DARKEN_PCT) %. Anything else comes back unchanged. */
export const darkenedHex = (hex: string): string => /^#[0-9a-fA-F]{6}$/.test(hex)
  ? "#" + [1, 3, 5].map((k) => Math.round(parseInt(hex.slice(k, k + 2), 16) * (100 - DARKEN_PCT) / 100).toString(16).padStart(2, "0")).join("")
  : hex;

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The fractions of the chaise and of the back run of an L sofa (spec item 18). */
export const CHAISE_SHARE = 0.35, RUN_SHARE = 0.45;

/** B53.2: whether the piece is drawn flipped about its own vertical axis: a `sofa-l` with `mirror: true`, nothing else. */
export const mirrored = (m: Furniture): boolean => m?.symbol === "sofa-l" && m.mirror === true;

/** Blocks of `m`, in the order they should be drawn when two do not overlap on screen: low first. [] for a piece that cannot be drawn. */
export function furnitureBlocks(m: Furniture): Block[] {
  const w = m?.w, h = m?.h;
  if (!fin(w) || !fin(h) || !(w > 0) || !(h > 0)) return [];
  const H = furnitureHeight(m);
  if (!fin(H) || !(H > 0)) return [];
  const out: Block[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tone: Block["tone"] = "body") => {
    // Clamped into the piece, and kept only if something is left.
    const b: Block = { x0: Math.max(0, x0), x1: Math.min(w, x1), y0: Math.max(0, y0), y1: Math.min(h, y1), z0: Math.max(0, z0), z1: Math.min(H, z1), tone };
    if (b.x1 > b.x0 && b.y1 > b.y0 && b.z1 > b.z0) out.push(b);
  };
  /** An inset or thickness of `want` cm along a span, at most `share` of the span, so two of them never meet. */
  const room = (span: number, want: number, share = 0.25) => Math.min(want, span * share);
  /** A height of `want` cm, at most `share` of H: the levels of a piece keep their order on a low one. */
  const lift = (want: number, share: number) => Math.min(want, H * share);

  switch (m.symbol) {
    case "table": case "coffee-table": case "desk": {
      const t = lift(4, 0.2), s = room(Math.min(w, h), 5), i = room(Math.min(w, h), 5);
      for (const [x, y] of [[i, i], [w - i - s, i], [i, h - i - s], [w - i - s, h - i - s]]) box(x, x + s, y, y + s, 0, H - t, "dark");
      box(0, w, 0, h, H - t, H);
      break;
    }
    case "sofa": case "armchair": sofa(w, h, H, box); break;
    case "sofa-l": {
      const run = h * RUN_SHARE, chaise = w * CHAISE_SHARE, seat = H * 0.45;
      const mirror = (b: Block): Block => (mirrored(m) ? { ...b, x0: w - b.x1, x1: w - b.x0 } : b);
      const first = out.length;
      sofa(w, run, H, box);
      box(0, chaise, run, h, 0, seat);
      for (let k = first; k < out.length; k++) out[k] = mirror(out[k]);
      break;
    }
    case "bed": {
      const f = lift(30, 0.6), top = Math.min(55, H), inx = room(w, 3), head = room(h, 8);
      box(0, w, 0, h, 0, f);
      box(inx, w - inx, Math.max(head, room(h, 3)), h - room(h, 3), f, top);
      box(0, w, 0, head, f, H);
      break;
    }
    case "chair": {
      const seat = lift(45, 0.75), t = lift(5, 0.1), s = room(Math.min(w, h), 4), back = h * 0.08;
      for (const [x, y] of [[0, 0], [w - s, 0], [0, h - s], [w - s, h - s]]) box(x, x + s, y, y + s, 0, seat - t, "dark");
      box(0, w, 0, h, seat - t, seat);
      box(0, w, 0, back, seat, H);
      break;
    }
    case "cabinet": case "sink": case "buffet": case "wardrobe": case "dresser": case "nightstand": case "counter": case "stove": case "dishwasher": {
      const plinth = lift(10, 0.3), top = lift(3, 0.2), ix = room(w, 5), iy = room(h, 5);
      box(ix, w - ix, iy, h - iy, 0, plinth, "dark");
      box(0, w, 0, h, plinth, H - top);
      box(0, w, 0, h, H - top, H);
      break;
    }
    case "bathtub": {
      const base = lift(15, 0.3), rx = room(w, 8), ry = room(h, 8);
      box(0, w, 0, h, 0, base);
      box(0, w, 0, ry, base, H);
      box(0, w, h - ry, h, base, H);
      box(0, rx, ry, h - ry, base, H);
      box(w - rx, w, ry, h - ry, base, H);
      break;
    }
    // B53.10: a pot, 35 % of H and inset 5 cm, and the foliage over the whole footprint above it.
    case "plant": {
      const pot = (H * 35) / 100, ix = room(w, 5), iy = room(h, 5);
      box(ix, w - ix, iy, h - iy, 0, pot, "dark");
      box(0, w, 0, h, pot, H);
      break;
    }
    // B53.12: a shower is a low dark tray (5 cm) and four glass walls (2 cm, at most 10 % of a side) up to H.
    case "shower": {
      const tray = lift(5, 0.2), tx = room(w, 2, 0.1), ty = room(h, 2, 0.1);
      box(0, w, 0, h, 0, tray, "dark");
      box(0, w, 0, ty, tray, H, "glass");
      box(0, w, h - ty, h, tray, H, "glass");
      box(0, tx, ty, h - ty, tray, H, "glass");
      box(w - tx, w, ty, h - ty, tray, H, "glass");
      break;
    }
    // B53.12: a belt deck 20 cm (at most 30 % of H) over the whole length, two front posts (dark) at the console end, x = 0, and the
    // console bar across them at H.
    case "treadmill": {
      const deck = lift(20, 0.3), s = room(Math.min(w, h), 6, 0.15), bar = lift(8, 0.1);
      box(0, w, 0, h, 0, deck);
      box(0, s, 0, s, deck, H, "dark");
      box(0, s, h - s, h, deck, H, "dark");
      box(0, s * 2, 0, h, H - bar, H);
      break;
    }
    // Four uprights (8 cm, at most 12 % of a side) and a rail round the top; the middle stays open.
    case "barbell-rack": {
      const s = room(Math.min(w, h), 8, 0.12), top = lift(6, 0.05);
      for (const [x, y] of [[0, 0], [w - s, 0], [0, h - s], [w - s, h - s]]) box(x, x + s, y, y + s, 0, H, "dark");
      box(0, w, 0, s, H - top, H, "dark");
      box(0, w, h - s, h, H - top, H, "dark");
      box(0, s, s, h - s, H - top, H, "dark");
      box(w - s, w, s, h - s, H - top, H, "dark");
      break;
    }
    // Two end frames and two shelves, the top one at H.
    case "weight-rack": {
      const e = room(w, 6, 0.1), t = lift(4, 0.15);
      box(0, e, 0, h, 0, H, "dark");
      box(w - e, w, 0, h, 0, H, "dark");
      box(e, w - e, 0, h, H * 0.35 - t, H * 0.35);
      box(e, w - e, 0, h, H - t, H);
      break;
    }
    // The seat at 40 % of H over the whole length and the raised head over the last 30 % of it, up to H.
    case "chaise-longue": {
      const seat = H * 0.4;
      box(0, w, 0, h, 0, seat);
      box(w * 0.7, w, 0, h, seat, H);
      break;
    }
    case "mirror": box(0, w, 0, h, 0, H, "mirror"); break;
    // A standing mirror is one upright mirror plate on a dark foot. Stacked slabs that stepped back to fake a 10 degree lean read as a
    // ladder in 2.5D and 3D (Opus review of B53.10-B53.13, looked at with `npm run shots -- --blocks`), so there is no lean.
    case "mirror-stand": {
      const foot = lift(4, 0.05), t = room(h, 3, 0.2), ix = room(w, 4, 0.1);
      box(ix, w - ix, 0, h, 0, foot, "dark");
      box(0, w, h - t, h, foot, H, "mirror");
      break;
    }
    // Every other symbol is one box, as before. Decided one by one (finding 17): a tree and a car are drawn by their own code
    // (a trunk and a crown; the car's table) and a patio is flat, so for them this box is the footprint and nothing more.
    case "toilet": case "bookcase": case "cube-shelf": case "robot-vacuum": case "robot-dock": case "fridge": case "washer": case "dryer": case "rug": case "tv": case "computer": case "speaker": case "tree": case "patio-wood": case "patio-concrete": case "car":
      box(0, w, 0, h, 0, H);
      break;
    default: break;
  }
  return out;
}

/**
 * A sofa along the back edge of a `w` wide and `d` deep run: the seat at 45 % of H over the whole run, the back 20 % of the depth
 * along y = 0 above the seat, up to H, and two arms 15 cm wide (at most 20 % of w) beside the seat, to 65 % of H. An L sofa passes
 * its run's depth (45 % of h), so its back is 20 % of that run.
 */
function sofa(w: number, d: number, H: number, box: (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tone?: Block["tone"]) => void): void {
  const seat = H * 0.45, back = d * 0.2, arm = Math.min(15, w * 0.2);
  box(0, w, 0, d, 0, seat);
  box(0, w, 0, back, seat, H);
  box(0, arm, back, d, seat, H * 0.65);
  box(w - arm, w, back, d, seat, H * 0.65);
}

/**
 * Where the symbol lies in 2.5D: on the highest block that covers at least 40 % of the footprint (an L sofa seat is 45 %) (a sofa's seat, a bed's mattress,
 * a table's top), in cm above the piece's bottom. A back, an arm or a leg is too small to carry it. H for a piece with no blocks.
 */
export function lidOf(m: Furniture, blocks: Block[]): number {
  const area = m.w * m.h, lid = Math.max(0, ...blocks.filter((b) => (b.x1 - b.x0) * (b.y1 - b.y0) >= area * 0.4).map((b) => b.z1));
  return lid > 0 ? lid : furnitureHeight(m);
}
