import { describe, expect, it } from "vitest";
import { FLOORPLAN_CSS, FURNITURE, FURNITURE_HEIGHTS, FURNITURE_SYMBOLS, renderFloor, validate, type Floor, type Layout } from "../../src/core";
import { furnitureBlocks } from "../../src/core/furniture-blocks";
import { buildScene } from "../../src/core/scene";

function makeFloor(): Floor {
  return {
    title: "Ground",
    outline: [[0, 0], [400, 0], [400, 300], [0, 300]],
    rooms: [{ id: "g1", name: "Garden", area: "garden", kind: "garden", pts: [[0, 0], [900, 0], [900, 500], [0, 500]], wk: ["fence", "fence", "fence", "fence"] }],
    walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], unlinked: [],
    furniture: [
      { id: "cp1", symbol: "carport", x: 660, y: 150, rot: 0, w: 520, h: 300 },
      { id: "aw1", symbol: "awning", x: 200, y: 425, rot: 0, w: 400, h: 250, entity: "cover.terrace_awning" },
    ],
  };
}

describe("S90: Carports and extensible awnings", () => {
  it("validates carport and awning symbols with proper heights and defaults", () => {
    expect(FURNITURE_SYMBOLS).toContain("carport");
    expect(FURNITURE_SYMBOLS).toContain("awning");
    expect(FURNITURE_HEIGHTS.carport).toBe(250);
    expect(FURNITURE_HEIGHTS.awning).toBe(20);
    expect(FURNITURE.carport.w).toBe(520);
    expect(FURNITURE.awning.w).toBe(400);
    const layout: Layout = { version: 2, unit: "cm", north: 0, floors: { ground: makeFloor() }, catalog: [] };
    expect(validate(layout).ok).toBe(true);
  });

  it("builds 4 poles, ledger/eaves beams, and translucent polycarbonate roof for carport", () => {
    const blocks = furnitureBlocks({ id: "cp1", symbol: "carport", x: 0, y: 0, rot: 0, w: 520, h: 300, height: 250 });
    // 2 beams + 4 poles + 1 translucent glass roof = 7 blocks
    expect(blocks.length).toBe(7);
    expect(blocks.filter((b) => b.tone === "glass").length).toBe(1);
    expect(blocks.filter((b) => b.tone === "dark").length).toBe(6);

    const sc = buildScene(makeFloor());
    const cpSolids = sc.solids.filter((s) => s.kind === "furniture" && s.ref.index === 0);
    expect(cpSolids.some((s) => s.paint?.role === "furniture-glass")).toBe(true);
  });

  it("renders canopy translucency and dynamically scales awning by HA cover current_position", () => {
    expect(FLOORPLAN_CSS).toContain(".furn-canopy");
    const f = makeFloor();
    const openSvg = renderFloor(f, {
      scale: 1,
      state: { "cover.terrace_awning": { state: "open", attributes: { current_position: 100 }, last_changed: "" } },
    });
    const halfSvg = renderFloor(f, {
      scale: 1,
      state: { "cover.terrace_awning": { state: "open", attributes: { current_position: 50 }, last_changed: "" } },
    });
    const closedSvg = renderFloor(f, {
      scale: 1,
      state: { "cover.terrace_awning": { state: "closed", attributes: { current_position: 0 }, last_changed: "" } },
    });
    expect(openSvg).toContain("furn-canopy");
    expect(openSvg).toContain("scale(4 2.5)");
    expect(halfSvg).toContain("scale(4 1.25)");
    expect(closedSvg).toContain("scale(4 0.3)");
  });
});
