import { describe, expect, it } from "vitest";
import { FURNITURE_SYMBOLS, type Floor, type Furniture } from "../../src/core/schema";
import { furnitureHeight } from "../../src/core/heights";
import { furnitureBlocks, type Block } from "../../src/core/furniture-blocks";
import { FURNITURE_SOLID } from "../../src/core/solids";
import { renderFloor } from "../../src/core/render";
import { buildScene } from "../../src/core/scene";

// B53.5, spec item 19b and criterion 3b. One function, `furnitureBlocks`, in the piece's frame (x 0..w, y 0..h, z 0..H).
const piece = (symbol: string, w: number, h: number, extra: Record<string, unknown> = {}) => ({ id: "p", symbol, x: 300, y: 300, rot: 0, w, h, ...extra }) as unknown as Furniture;
const floor = (furniture: Furniture[]): Floor => ({
  title: "T", outline: [[0, 0], [900, 0], [900, 700], [0, 700]], owk: ["wall", "wall", "wall", "wall"],
  rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture, unlinked: [],
}) as unknown as Floor;
const E = 1e-9;
const inside = (b: Block, w: number, h: number, H: number) => b.x0 >= -E && b.y0 >= -E && b.z0 >= -E && b.x1 <= w + E && b.y1 <= h + E && b.z1 <= H + E;
const positive = (b: Block) => b.x1 > b.x0 && b.y1 > b.y0 && b.z1 > b.z0;
const SIZES: [number, number][] = [[173, 61], [61, 173], [5, 5], [5, 173], [173, 5], [20, 7], [2000, 2000]];
const HEIGHTS: (number | undefined)[] = [undefined, 1, 7, 33, 1000];

/** Where the `<g>` that opens at `from` closes: the piece's whole group, whatever it nests (the symbol sits between its blocks). */
function groupEnd(svg: string, from: number): number {
  const tag = /<g[\s>]|<\/g>/g;
  tag.lastIndex = from;
  for (let depth = 0, t; (t = tag.exec(svg)); ) if ((depth += t[0] === "</g>" ? -1 : 1) === 0) return tag.lastIndex;
  return svg.length;
}

describe("B53.5: furnitureBlocks", () => {
  it("gives every symbol its boxes, inside the footprint and under H, at asymmetric and at the smallest sizes", () => {
    for (const s of FURNITURE_SYMBOLS) for (const [w, h] of SIZES) for (const ht of HEIGHTS) for (const mirror of [false, true]) {
      const m = piece(s, w, h, { ...(ht === undefined ? {} : { height: ht }), ...(mirror && s === "sofa-l" ? { mirror: true } : {}) });
      const H = furnitureHeight(m), bl = furnitureBlocks(m), at = `${s} ${w}x${h} H${H}`;
      expect(bl.length, at).toBeGreaterThan(0);
      for (const b of bl) { expect(positive(b), `${at} ${JSON.stringify(b)}`).toBe(true); expect(inside(b, w, h, H), `${at} ${JSON.stringify(b)}`).toBe(true); }
    }
  });

  it("has the counts the spec describes", () => {
    const n = (s: string, extra = {}) => furnitureBlocks(piece(s, 200, 120, extra)).length;
    expect(n("table")).toBe(5); // top + 4 legs
    expect(n("coffee-table")).toBe(5);
    expect(n("sofa")).toBe(4); // seat, back, 2 arms
    expect(n("sofa-l")).toBe(5); // + the chaise
    expect(n("bed")).toBe(3); // frame, mattress, headboard
    expect(n("chair")).toBe(6); // 4 legs, seat, back
    for (const s of ["cabinet", "sink", "buffet"]) expect(n(s), s).toBe(3); // plinth, body, top
    expect(n("bathtub")).toBe(5); // base + 4 rim pieces
    for (const s of ["toilet", "shower", "bookcase", "tv", "computer", "speaker"]) expect(n(s), s).toBe(1);
  });

  it("makes legs and plinths dark and nothing else", () => {
    for (const s of FURNITURE_SYMBOLS) {
      const dark = furnitureBlocks(piece(s, 173, 61)).filter((b) => b.tone === "dark");
      const want = ["table", "coffee-table", "chair"].includes(s) ? 4 : ["cabinet", "sink", "buffet"].includes(s) ? 1 : 0;
      expect(dark.length, s).toBe(want);
    }
  });

  it("follows the stated measures on a table: a 4 cm top at H, legs 5 x 5 inset 5 from the corners", () => {
    const bl = furnitureBlocks(piece("table", 160, 90, { height: 75 }));
    const top = bl.find((b) => b.tone === "body")!, legs = bl.filter((b) => b.tone === "dark");
    expect(top).toMatchObject({ x0: 0, x1: 160, y0: 0, y1: 90, z0: 71, z1: 75 });
    expect(legs.map((l) => [l.x0, l.y0, l.x1 - l.x0, l.y1 - l.y0, l.z0, l.z1]).sort()).toEqual([[5, 5, 5, 5, 0, 71], [5, 80, 5, 5, 0, 71], [150, 5, 5, 5, 0, 71], [150, 80, 5, 5, 0, 71]].sort());
  });

  it("follows the stated measures on a sofa: seat 45 %, back 20 % deep to H, arms 15 wide to 65 %", () => {
    const bl = furnitureBlocks(piece("sofa", 200, 90, { height: 100 }));
    expect(bl).toContainEqual({ x0: 0, x1: 200, y0: 0, y1: 90, z0: 0, z1: 45, tone: "body" });
    expect(bl).toContainEqual({ x0: 0, x1: 200, y0: 0, y1: 18, z0: 45, z1: 100, tone: "body" });
    expect(bl).toContainEqual({ x0: 0, x1: 15, y0: 18, y1: 90, z0: 45, z1: 65, tone: "body" });
    expect(bl).toContainEqual({ x0: 185, x1: 200, y0: 18, y1: 90, z0: 45, z1: 65, tone: "body" });
    // arms are at most 20 % of the width
    expect(furnitureBlocks(piece("sofa", 50, 90, { height: 100 })).some((b) => b.x1 - b.x0 === 10 && b.z1 === 65)).toBe(true);
  });

  it("follows the stated measures on a bed, a chair, a cabinet and a bathtub", () => {
    const bed = furnitureBlocks(piece("bed", 160, 200, { height: 90 }));
    expect(bed).toContainEqual({ x0: 0, x1: 160, y0: 0, y1: 200, z0: 0, z1: 30, tone: "body" }); // frame
    expect(bed).toContainEqual({ x0: 3, x1: 157, y0: 8, y1: 197, z0: 30, z1: 55, tone: "body" }); // mattress, inset 3, clear of the headboard
    expect(bed).toContainEqual({ x0: 0, x1: 160, y0: 0, y1: 8, z0: 30, z1: 90, tone: "body" }); // headboard, 8 deep at the head edge
    const chair = furnitureBlocks(piece("chair", 45, 50));
    expect(chair).toContainEqual({ x0: 0, x1: 45, y0: 0, y1: 50, z0: 40, z1: 45, tone: "body" }); // seat 5 thick at 45
    expect(chair).toContainEqual({ x0: 0, x1: 45, y0: 0, y1: 4, z0: 45, z1: 90, tone: "body" }); // back 8 % of 50
    expect(chair.filter((b) => b.tone === "dark").every((b) => b.x1 - b.x0 === 4 && b.y1 - b.y0 === 4 && b.z1 === 40)).toBe(true);
    const cab = furnitureBlocks(piece("cabinet", 100, 40, { height: 180 }));
    expect(cab).toContainEqual({ x0: 5, x1: 95, y0: 5, y1: 35, z0: 0, z1: 10, tone: "dark" });
    expect(cab).toContainEqual({ x0: 0, x1: 100, y0: 0, y1: 40, z0: 10, z1: 177, tone: "body" });
    expect(cab).toContainEqual({ x0: 0, x1: 100, y0: 0, y1: 40, z0: 177, z1: 180, tone: "body" });
    const tub = furnitureBlocks(piece("bathtub", 170, 75));
    expect(tub).toContainEqual({ x0: 0, x1: 170, y0: 0, y1: 75, z0: 0, z1: 15, tone: "body" });
    expect(tub.filter((b) => b.z0 === 15 && b.z1 === 55)).toHaveLength(4);
    expect(tub.some((b) => b.x0 === 0 && b.x1 === 8 && b.y0 === 8 && b.y1 === 67)).toBe(true);
  });

  it("is empty for a piece that cannot be drawn, and never throws", () => {
    for (const bad of [null, undefined, {}, { symbol: "table" }, piece("table", NaN, 10), piece("table", 10, -1), piece("nonsense", 10, 10), piece("table", 10, 10, { height: -3 })]) {
      expect(() => furnitureBlocks(bad as never)).not.toThrow();
    }
    expect(furnitureBlocks(piece("table", NaN, 10))).toEqual([]);
    expect(furnitureBlocks(piece("nonsense", 10, 10))).toEqual([]);
  });

  // Criterion 3b, the second half: the two views build the same number of blocks from it.
  it("is what 2.5D and 3D both draw: the same block count per piece", () => {
    for (const s of FURNITURE_SYMBOLS) {
      if (FURNITURE_SOLID[s] !== "box" || s === "car") continue; // a car has its own parts; a tree is a trunk; a patio is flat
      for (const [w, h] of [[173, 61], [5, 5]] as [number, number][]) {
        const f = floor([piece(s, w, h)]);
        const n = furnitureBlocks(f.furniture[0]).length;
        const d25 = renderFloor(f, { scale: 1, view: "2.5d" });
        const from = d25.lastIndexOf("<g", d25.indexOf(`data-f="0"`)), body = d25.slice(from, groupEnd(d25, from));
        const tops = (body.match(/class="bt"/g) ?? []).length;
        const solids3 = buildScene(f).solids.filter((x) => x.kind === "furniture").length;
        expect(tops, `2.5D ${s} ${w}x${h}`).toBe(n);
        expect(solids3, `3D ${s} ${w}x${h}`).toBe(n);
      }
    }
  });
});
