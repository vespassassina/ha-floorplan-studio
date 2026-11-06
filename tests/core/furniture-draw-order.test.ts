import { describe, it, expect } from "vitest";
import { furnitureSolid } from "../../src/core/solids";
import { furnitureBlocks, lidOf } from "../../src/core/furniture-blocks";
import type { Furniture } from "../../src/core/schema";

// Opus review of B53, 2026-11-06: in 2.5D the symbol lies on the seat (lidOf), but was drawn after every block, so it painted
// over the back, the arms, the headboard and the tub rims that stand above it. A block that rises above the lid
// is drawn after the symbol; one that stays at or below it, before. Asymmetric sizes, both a back far (rot 0) and a back near (rot 180).
const px = { scr: (p: number[]) => p, lift: (p: number[], z: number) => [p[0], p[1] - z], skew: 0 } as never;
const MARK = `<g id="SYM"/>`;

describe("2.5D: the symbol sits between the blocks below the lid and those above it", () => {
  for (const symbol of ["sofa", "sofa-l", "bed", "chair", "bathtub"]) {
    for (const rot of [0, 180]) {
      it(`${symbol} at rot ${rot}`, () => {
        const m = { id: "f", symbol, x: 300, y: 200, rot, w: 230, h: 170, ...(symbol === "bed" ? { height: 100 } : {}) } as unknown as Furniture; // a bed at its default 55 has its headboard flush
        const blocks = furnitureBlocks(m), lid = lidOf(m, blocks);
        const above = blocks.filter((b) => b.z1 > lid + 1e-9).length;
        expect(above, `${symbol} has parts above its lid`).toBeGreaterThan(0);
        const svg = furnitureSolid(m, 0, "box", false, MARK, px)!.svg;
        const [before, after] = svg.split(MARK);
        const tops = (s: string) => (s.match(/class="bt"/g) ?? []).length;
        expect(tops(after), "blocks drawn after the symbol").toBe(above);
        expect(tops(before), "blocks drawn before the symbol").toBe(blocks.length - above);
      });
    }
  }
});

// Opus review of B53.10-B53.13, 2026-11-06: in plain 2D the pieces drew in array order, so a rug added after a sofa covered it and took its clicks.
describe("2D: a rug is drawn before every other piece, whatever its place in the array", () => {
  it("puts the rug's group before the sofa's when the sofa is first", async () => {
    const { renderFloor } = await import("../../src/core/render");
    const p = (id: string, symbol: string, x: number, y: number, w: number, h: number) => ({ id, symbol, x, y, rot: 0, w, h }) as Furniture;
    const f = { title: "T", outline: [[0, 0], [900, 0], [900, 700], [0, 700]], owk: ["wall", "wall", "wall", "wall"], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], unlinked: [], furniture: [p("s", "sofa", 300, 330, 160, 80), p("c", "chair", 500, 330, 50, 50), p("r", "rug", 300, 300, 200, 140)] } as never;
    const html = renderFloor(f, { scale: 1 });
    const at = (i: number) => html.indexOf(`<g data-f="${i}"`);
    expect(at(2), "rug found").toBeGreaterThan(-1);
    expect(at(2)).toBeLessThan(at(0));
    expect(at(2)).toBeLessThan(at(1));
    expect(at(0)).toBeLessThan(at(1)); // the others keep their order
  });
});
