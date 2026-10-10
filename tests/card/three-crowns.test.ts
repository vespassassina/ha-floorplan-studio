import { describe, expect, it } from "vitest";
import { buildScene, type Solid } from "../../src/core/scene";
import { treeShape } from "../../src/core/tree";
import { furnitureBottom } from "../../src/core/heights";
import { CROWN_SEGMENTS, crownMatrices } from "../../src/card/three/crowns";
import type { Floor } from "../../src/core/schema";

// S28.7: the pure part of the crowns. One 4x4 (column-major) per tree solid, from the solid alone.
const floor = (furniture: unknown[]): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: furniture as never, unlinked: [],
});
const tree = (o = {}) => ({ id: "t", symbol: "tree", x: 300, y: 200, rot: 0, w: 120, h: 70, ...o });
const col = (m: Float32Array, k: number, c: number) => Math.hypot(m[k * 16 + c * 4], m[k * 16 + c * 4 + 1], m[k * 16 + c * 4 + 2]);

describe("crownMatrices", () => {
  it("one matrix per tree: centre over the trunk, scale from the tree's own size and the crown's z range", () => {
    const o = { x: 310, y: 190, w: 120, h: 70, height: 600 }, m = tree(o), t = treeShape(m as never)!;
    const sc = buildScene(floor([m, { id: "tb", symbol: "table", x: 10, y: 10, rot: 0, w: 40, h: 40 }]), { elevation: 20 });
    const { count, matrices } = crownMatrices(sc.solids);
    expect(count).toBe(1);
    const z0 = furnitureBottom(m as never) + 20;
    expect([matrices[12], matrices[13], matrices[14]].map((v) => +v.toFixed(3))).toEqual([310, +(z0 + t.crownMiddle).toFixed(3), 190]); // three's frame: plan y is z
    expect(col(matrices, 0, 0)).toBeCloseTo(60, 3);                       // rx = w / 2
    expect(col(matrices, 0, 1)).toBeCloseTo((t.crownTop - t.crownBottom) / 2, 3);
    expect(col(matrices, 0, 2)).toBeCloseTo(35, 3);                       // ry = h / 2
  });
  it("a turned tree turns its crown the way the plan turns the symbol (clockwise on the page)", () => {
    const { matrices } = crownMatrices(buildScene(floor([tree({ rot: 90 })])).solids);
    // a quarter turn takes the crown's x axis (plan east) to plan south: three's +z
    expect(matrices[0]).toBeCloseTo(0, 5);
    expect(matrices[2]).toBeCloseTo(60, 4);
  });
  it("skips a solid whose size or crown is junk, and never throws", () => {
    const good = buildScene(floor([tree()])).solids.find((s) => s.kind === "furniture")!;
    const bad = (ref: Record<string, unknown>) => ({ ...good, ref: { ...good.ref, ...ref } }) as unknown as Solid;
    const junk = [
      bad({ size: [0, 70] }), bad({ size: [NaN, 70] }), bad({ size: "x" }), bad({ size: undefined }), bad({ crown: undefined }), bad({ crown: { z0: 5, z1: 5, rot: 0 } }),
      bad({ crown: { z0: 9, z1: 3, rot: 0 } }), bad({ crown: { z0: NaN, z1: 3, rot: 0 } }), bad({ crown: { z0: 1, z1: 3, rot: "a" } }), bad({ size: [1e12, 1e12] }),
      { ...good, shape: { type: "point", at: [1, 1], z: 1 } } as unknown as Solid, { ...good, shape: { type: "prism", base: [], z0: 0, z1: 1 } } as unknown as Solid,
      null as unknown as Solid, 7 as unknown as Solid, { ...good, kind: "wall" } as Solid,
    ];
    expect(crownMatrices(junk).count).toBe(0);
    expect(crownMatrices([...junk, good]).count).toBe(1);
    expect(crownMatrices(null as never).count).toBe(0);
  });
  it("2000 trees are made in well under a second", () => {
    const furniture = Array.from({ length: 2000 }, (_, i) => tree({ id: `t${i}`, x: (i % 50) * 10, y: Math.floor(i / 50) * 10 }));
    const sc = buildScene(floor(furniture)), t0 = performance.now();
    expect(crownMatrices(sc.solids).count).toBe(2000);
    expect(performance.now() - t0).toBeLessThan(200);
  });
  it("the crown is an icosahedron of a few faces, not a sphere", () => { expect(CROWN_SEGMENTS).toBe(1); });
});
