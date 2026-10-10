import { describe, it, expect } from "vitest";
import { buildScene } from "../../src/core/scene";
import type { Floor } from "../../src/core/schema";

// S27.7: `SceneOpts.shift` moves every solid in plan x and y, so a floor below can be drawn at its place in the house.
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const f = floor({
  rooms: [{ name: "Hall", kind: "room", pts: [[10, 10], [300, 10], [300, 200], [10, 200]] } as never],
  furniture: [{ id: "f", symbol: "cabinet", x: 300, y: 250, rot: 0, w: 60, h: 40 }],
  devices: [{ id: "d", type: "light", entity: "light.x", x: 100, y: 120 } as never],
});
const pts = (s: ReturnType<typeof buildScene>["solids"][number]): number[][] => (s.shape.type === "prism" ? s.shape.base : [s.shape.at]);

describe("scene: shift (S27.7)", () => {
  it("moves every point of every solid by [dx, dy] and leaves z alone", () => {
    const a = buildScene(f), b = buildScene(f, { shift: [137.4, -61.7], elevation: -275 });
    expect(b.solids.length).toBe(a.solids.length);
    expect(b.solids.length).toBeGreaterThan(5);
    a.solids.forEach((s, i) => {
      const t = b.solids[i];
      pts(s).forEach((p, k) => { expect(pts(t)[k][0]).toBeCloseTo(p[0] + 137.4, 6); expect(pts(t)[k][1]).toBeCloseTo(p[1] - 61.7, 6); });
      if (s.shape.type === "prism" && t.shape.type === "prism") { expect(t.shape.z0).toBeCloseTo(s.shape.z0 - 275, 6); expect(t.shape.z1).toBeCloseTo(s.shape.z1 - 275, 6); }
    });
  });
  it("moves the bounds the same way", () => {
    const a = buildScene(f), b = buildScene(f, { shift: [-50, 20] });
    expect(b.bounds.min).toEqual([a.bounds.min[0] - 50, a.bounds.min[1] + 20, a.bounds.min[2]]);
    expect(b.bounds.max).toEqual([a.bounds.max[0] - 50, a.bounds.max[1] + 20, a.bounds.max[2]]);
  });
  it("junk shift means none, and never throws", () => {
    const a = buildScene(f);
    for (const junk of [undefined, null, "1,2", [1], [1, 2, 3], [NaN, 0], [0, Infinity], [1, "2"], {}, 5] as unknown[]) {
      expect(() => buildScene(f, { shift: junk as never })).not.toThrow();
      expect(buildScene(f, { shift: junk as never })).toEqual(a);
    }
  });
});
