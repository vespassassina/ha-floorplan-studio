import { describe, expect, it } from "vitest";
import { FURNITURE, FURNITURE_HEIGHTS, FURNITURE_SYMBOLS, renderFloor, validate, type Floor, type Layout } from "../../src/core";
import { furnitureBlocks } from "../../src/core/furniture-blocks";
import { buildScene } from "../../src/core/scene";

function makeFloor(): Floor {
  return {
    title: "Ground",
    outline: [[0, 0], [400, 0], [400, 300], [0, 300]],
    rooms: [{ id: "g1", name: "Garden", area: "garden", kind: "garden", pts: [[0, 0], [900, 0], [900, 500], [0, 500]], wk: ["hedge", "hedge", "hedge", "hedge"] }],
    walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], unlinked: [],
    furniture: [{ id: "gh1", symbol: "garden-house", name: "Tool shed", x: 700, y: 350, rot: 0, w: 300, h: 250, color: "#7a5c3a", entity: "light.shed" }],
  };
}

describe("S91: Garden house / shed", () => {
  it("validates garden-house symbol with default size, height, custom colour, and optional HA entity", () => {
    expect(FURNITURE_SYMBOLS).toContain("garden-house");
    expect(FURNITURE["garden-house"].w).toBe(300);
    expect(FURNITURE["garden-house"].h).toBe(250);
    expect(FURNITURE_HEIGHTS["garden-house"]).toBe(260);
    const layout: Layout = { version: 2, unit: "cm", north: 0, floors: { ground: makeFloor() }, catalog: [] };
    expect(validate(layout).ok).toBe(true);
  });

  it("builds foundation plinth, inset cabin walls, and 3-tier pitched roof overhang in 3D", () => {
    const blocks = furnitureBlocks({ id: "gh1", symbol: "garden-house", x: 0, y: 0, rot: 0, w: 300, h: 250, height: 260 });
    expect(blocks.length).toBe(5);
    expect(blocks.filter((b) => b.tone === "dark").length).toBe(4);
    expect(blocks.filter((b) => b.tone === "body").length).toBe(1);
    const sc = buildScene(makeFloor());
    const ghSolids = sc.solids.filter((s) => s.kind === "furniture" && s.ref.index === 0);
    expect(ghSolids.length).toBe(5);
  });

  it("renders gable roof outline in 2D and reflects linked entity state", () => {
    const svg = renderFloor(makeFloor(), {
      scale: 1,
      state: { "light.shed": { state: "on", attributes: {}, last_changed: "" } },
    });
    expect(svg).toContain('data-f="0"');
    expect(svg).toContain("furn on");
    expect(svg).toContain("#7a5c3a");
  });
});
