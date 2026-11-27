import { describe, expect, it } from "vitest";
import { FLOORPLAN_CSS, WALL_KINDS, WALL_KIND_HEIGHT, renderFloor, validate, type Floor, type Layout } from "../../src/core";
import { buildScene, WALL_THICKNESS } from "../../src/core/scene";

function makeFloor(): Floor {
  return {
    title: "Ground",
    outline: [[0, 0], [400, 0], [400, 300], [0, 300]],
    rooms: [{ id: "g1", name: "Garden", area: "garden", kind: "garden", pts: [[0, 0], [600, 0], [600, 400], [0, 400]], wk: ["hedge", "fence", "hedge", "fence"] }],
    walls: [
      { id: "h1", a: [50, 350], b: [350, 350], kind: "hedge" },
      { id: "f1", a: [350, 350], b: [550, 350], kind: "fence", color: "#3a3d42" },
    ],
    stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [],
  };
}

describe("S89: Living hedges and multi-colour fences", () => {
  it("includes hedge in WALL_KINDS with 160 cm default height and 45 cm 3D thickness", () => {
    expect(WALL_KINDS).toContain("hedge");
    expect(WALL_KIND_HEIGHT.hedge).toBe(160);
    expect(WALL_THICKNESS.hedge).toBe(45);
    const layout: Layout = { version: 2, unit: "cm", north: 0, floors: { ground: makeFloor() }, catalog: [] };
    expect(validate(layout).ok).toBe(true);
  });

  it("renders 2D living hedges and multi-colour fence segments", () => {
    expect(FLOORPLAN_CSS).toContain(".e.hedge");
    expect(FLOORPLAN_CSS).toContain(".eh.hedge");
    expect(FLOORPLAN_CSS).toContain(".ws.hedge");
    const svg = renderFloor(makeFloor(), { scale: 1 });
    expect(svg).toContain('class="e hedge"');
    expect(svg).toContain('class="eh hedge"');
    expect(svg).toContain('class="e fence wc"');
    expect(svg).toContain("--fp-wall-c:#3a3d42");
  });

  it("builds thick 3D hedge solids and preserves fence custom colours", () => {
    const scene = buildScene(makeFloor());
    const hedges = scene.solids.filter((s) => s.paint?.role === "wall-hedge");
    expect(hedges.length).toBeGreaterThan(0);
    expect(hedges[0].shape.type).toBe("prism");
    if (hedges[0].shape.type === "prism") {
      expect(hedges[0].shape.z1 - hedges[0].shape.z0).toBe(160);
    }
    const colouredFence = scene.solids.find((s) => s.paint?.role === "wall-fence" && s.paint?.color === "#3a3d42");
    expect(colouredFence).toBeDefined();
  });
});
