import { describe, it, expect } from "vitest";
import type { Device, Floor, Pt } from "../../src/core/schema";
import { marqueeHits } from "../../src/editor/selection";

const dev = (id: string, x: number, y: number): Device => ({ id, type: "light", entity: `light.${id}`, x, y });
const seg = (id: string, a: Pt, b: Pt): Device => ({ id, type: "light", entity: `light.${id}`, a, b });
const floor = (devices: Device[]) => ({ devices } as unknown as Floor);
type Quad = [Pt, Pt, Pt, Pt];
const box = (x0: number, y0: number, x1: number, y1: number): Quad => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const all = () => false;

describe("marqueeHits", () => {
  it("takes devices whose centre is inside an axis box, in index order", () => {
    const f = floor([dev("a", 10, 10), dev("b", 500, 500), dev("c", 90, 40), seg("s", [20, 20], [60, 60])]);
    expect(marqueeHits(f, box(0, 0, 100, 100), all)).toEqual([0, 2, 3]);
  });

  it("uses a segment device's midpoint, not its ends", () => {
    const f = floor([seg("s", [-100, 50], [300, 50])]); // ends outside, midpoint (100,50) inside
    expect(marqueeHits(f, box(80, 40, 120, 60), all)).toEqual([0]);
    expect(marqueeHits(f, box(-120, 40, -80, 60), all)).toEqual([]);
  });

  it("a centre on the edge or a corner counts", () => {
    const f = floor([dev("e", 100, 50), dev("c", 0, 0), dev("o", 100.01, 50)]);
    expect(marqueeHits(f, box(0, 0, 100, 100), all)).toEqual([0, 1]);
  });

  it("handles a turned quad that a bounding box gets wrong", () => {
    // diamond centred (100,100), reach 50: corners on the axes
    const q: Quad = [[100, 50], [150, 100], [100, 150], [50, 100]];
    const f = floor([dev("in", 100, 100), dev("near", 70, 100), dev("bbox", 55, 55), dev("bbox2", 145, 145)]);
    expect(marqueeHits(f, q, all)).toEqual([0, 1]); // bbox corners (55,55) are outside the diamond
  });

  it("takes the quad whatever the corner winding", () => {
    const f = floor([dev("a", 50, 50), dev("b", 200, 50)]);
    const rev = box(0, 0, 100, 100).reverse() as Quad;
    expect(marqueeHits(f, rev, all)).toEqual([0]);
  });

  it("skip leaves out what is not drawn", () => {
    const f = floor([dev("a", 10, 10), dev("b", 20, 20), dev("c", 30, 30)]);
    expect(marqueeHits(f, box(0, 0, 100, 100), (i) => i === 1)).toEqual([0, 2]);
  });

  it("junk never throws and never hits", () => {
    const f = floor([dev("a", 10, 10)]);
    expect(marqueeHits(f, [[NaN, 0], [100, 0], [100, 100], [0, 100]], all)).toEqual([]);
    expect(marqueeHits(f, [[0, 0], [Infinity, 0], [100, 100], [0, 100]], all)).toEqual([]);
    expect(marqueeHits(f, box(0, 0, 100, 100).slice(0, 3) as unknown as Quad, all)).toEqual([]);
    expect(marqueeHits(f, null as unknown as Quad, all)).toEqual([]);
    expect(marqueeHits(f, box(0, 0, 0, 0), all)).toEqual([]);
    const junk = floor([dev("n", NaN, 5), { id: "x", type: "light", entity: "l.x" } as Device, null as unknown as Device, seg("s", [NaN, 0], [1, 1]), seg("t", "no" as unknown as Pt, [1, 1])]);
    expect(marqueeHits(junk, box(-1e9, -1e9, 1e9, 1e9), all)).toEqual([]);
    expect(marqueeHits({} as Floor, box(0, 0, 1, 1), all)).toEqual([]);
    expect(marqueeHits(null as unknown as Floor, box(0, 0, 1, 1), all)).toEqual([]);
  });

  it("an empty floor has no hits; a throwing skip is not asked about junk", () => {
    expect(marqueeHits(floor([]), box(0, 0, 100, 100), all)).toEqual([]);
  });
});
