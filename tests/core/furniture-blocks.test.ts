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
    for (const s of ["cabinet", "sink", "buffet", "wardrobe", "dresser", "nightstand", "counter", "stove", "dishwasher"]) expect(n(s), s).toBe(3); // plinth, body, top (B53.10)
    expect(n("desk")).toBe(5); // as a table: top + 4 legs
    expect(n("armchair")).toBe(4); // as a sofa: seat, back, 2 arms
    expect(n("plant")).toBe(2); // pot + foliage
    for (const s of ["fridge", "washer", "dryer", "rug"]) expect(n(s), s).toBe(1);
    expect(n("bathtub")).toBe(5); // base + 4 rim pieces
    for (const s of ["toilet", "bookcase", "tv", "computer", "speaker", "cube-shelf", "robot-vacuum", "robot-dock", "mirror"]) expect(n(s), s).toBe(1);
  });

  it("makes legs and plinths dark and nothing else", () => {
    for (const s of FURNITURE_SYMBOLS) {
      const dark = furnitureBlocks(piece(s, 173, 61)).filter((b) => b.tone === "dark");
      const want = ["table", "coffee-table", "chair", "desk"].includes(s) ? 4 : ["cabinet", "sink", "buffet", "wardrobe", "dresser", "nightstand", "counter", "stove", "dishwasher", "plant", "shower", "mirror-stand"].includes(s) ? 1 : s === "treadmill" ? 2 : s === "barbell-rack" ? 8 : s === "weight-rack" ? 2 : 0;
      expect(dark.length, s).toBe(want);
    }
  });

  it("B53.10: a plant is a pot of 35 % of H and the foliage above it; a rug is one box 1 cm high", () => {
    const p = furnitureBlocks(piece("plant", 40, 40));
    expect(p).toContainEqual({ x0: 5, x1: 35, y0: 5, y1: 35, z0: 0, z1: 31.5, tone: "dark" });
    expect(p.find((b) => b.tone === "body")).toMatchObject({ z0: 31.5, z1: 90 });
    expect(furnitureBlocks(piece("rug", 200, 140))).toEqual([{ x0: 0, x1: 200, y0: 0, y1: 140, z0: 0, z1: 1, tone: "body" }]);
    const d = furnitureBlocks(piece("desk", 140, 70)).find((b) => b.tone === "body")!;
    expect(d).toMatchObject({ z0: 71, z1: 75 }); // as a table
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

// B53.12 (spec item 19e). Written after the code, not before: the shapes were found by drawing them.
describe("B53.12: gym, chaise, shelf, mirrors, robot, shower box", () => {
  const SIZES: [number, number][] = [[5, 5], [5, 300], [300, 5], [35, 35], [180, 80], [2000, 2000]];
  const at = (s: string, w: number, h: number, extra = {}) => furnitureBlocks(piece(s, w, h, extra));
  const NEW = ["treadmill", "barbell-rack", "weight-rack", "chaise-longue", "cube-shelf", "mirror", "mirror-stand", "robot-vacuum", "robot-dock", "shower"];

  it("keeps every block inside the piece at every size the editor allows, and every piece has blocks", () => {
    for (const s of NEW) for (const [w, h] of SIZES) {
      const H = furnitureHeight(piece(s, w, h));
      const bl = at(s, w, h);
      expect(bl.length, `${s} ${w}x${h}`).toBeGreaterThan(0);
      for (const b of bl) {
        expect(b.x0).toBeGreaterThanOrEqual(0); expect(b.x1).toBeLessThanOrEqual(w);
        expect(b.y0).toBeGreaterThanOrEqual(0); expect(b.y1).toBeLessThanOrEqual(h);
        expect(b.z0).toBeGreaterThanOrEqual(0); expect(b.z1).toBeLessThanOrEqual(H);
        expect(b.x1 - b.x0).toBeGreaterThan(0);
      }
    }
  });

  it("treadmill: a 20 cm deck over the whole footprint, two dark posts at the console end, a bar at H", () => {
    const bl = at("treadmill", 180, 80);
    expect(bl[0]).toMatchObject({ x0: 0, x1: 180, y0: 0, y1: 80, z0: 0, z1: 20, tone: "body" });
    const posts = bl.filter((b) => b.tone === "dark");
    expect(posts).toHaveLength(2);
    for (const p of posts) { expect(p.x0).toBe(0); expect(p.z0).toBe(20); expect(p.z1).toBe(140); }
    expect(bl.some((b) => b.z1 === 140 && b.z0 > 100 && b.y1 - b.y0 === 80)).toBe(true);
  });

  it("barbell-rack: four dark uprights to H and a dark frame; weight-rack: two dark ends and two shelves", () => {
    const r = at("barbell-rack", 120, 120);
    expect(r.every((b) => b.tone === "dark")).toBe(true);
    expect(r.filter((b) => b.z0 === 0 && b.z1 === 230)).toHaveLength(4);
    const w = at("weight-rack", 120, 50);
    expect(w.filter((b) => b.tone === "dark")).toHaveLength(2);
    expect(w.filter((b) => b.tone === "body").map((b) => b.z1).sort((a, b) => a - b)).toEqual([28, 80]);
  });

  it("chaise-longue: the seat at 40 % of H over all of it, the raised head over its last 30 %", () => {
    const bl = at("chaise-longue", 160, 65);
    expect(bl[0]).toMatchObject({ x0: 0, x1: 160, z0: 0, z1: 32 });
    expect(bl[1]).toMatchObject({ x0: 112, x1: 160, z0: 32, z1: 80 });
  });

  it("mirror: one mirror-tone panel with the whole height; mirror-stand: a dark foot and a lean of about 10 degrees in thin mirror slabs", () => {
    expect(at("mirror", 80, 5)).toEqual([{ x0: 0, x1: 80, y0: 0, y1: 5, z0: 0, z1: 100, tone: "mirror" }]);
    const bl = at("mirror-stand", 50, 40);
    expect(bl.filter((b) => b.tone === "dark")).toHaveLength(1);
    const slabs = bl.filter((b) => b.tone === "mirror").sort((a, b) => a.z0 - b.z0);
    expect(slabs).toHaveLength(6);
    for (let k = 1; k < slabs.length; k++) { expect(slabs[k].y1).toBeLessThan(slabs[k - 1].y1); expect(slabs[k].z0).toBeCloseTo(slabs[k - 1].z1, 9); } // each further back than the one below, none with a gap
    const lean = slabs[0].y1 - slabs[5].y1, rise = slabs[5].z0 - slabs[0].z0;
    expect(Math.atan2(lean, rise) * 180 / Math.PI).toBeGreaterThan(7); expect(Math.atan2(lean, rise) * 180 / Math.PI).toBeLessThan(10.5); // the top slab is 5/6 up, so the slope of the steps is 10 degrees
  });

  it("shower: a 5 cm dark tray under four glass walls to H, 2 cm thick, that never cover the tray", () => {
    const bl = at("shower", 90, 90);
    expect(bl[0]).toMatchObject({ z0: 0, z1: 5, tone: "dark", x1: 90, y1: 90 });
    const glass = bl.filter((b) => b.tone === "glass");
    expect(glass).toHaveLength(4);
    for (const g of glass) { expect(g.z0).toBe(5); expect(g.z1).toBe(furnitureHeight(piece("shower", 90, 90))); }
    expect(Math.min(...glass.map((g) => Math.min(g.x1 - g.x0, g.y1 - g.y0)))).toBe(2);
  });

  it("only the shower has glass and only the mirrors have mirror blocks", () => {
    for (const s of FURNITURE_SYMBOLS) {
      const tones = new Set(furnitureBlocks(piece(s, 120, 70)).map((b) => b.tone));
      expect(tones.has("glass"), s).toBe(s === "shower");
      expect(tones.has("mirror"), s).toBe(s === "mirror" || s === "mirror-stand");
    }
  });
});
