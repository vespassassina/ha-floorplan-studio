import { describe, expect, it } from "vitest";
import { FURNITURE_SYMBOLS, ROOF_SHAPES, renderFloor, validate, type Floor, type Layout, type RoofSpec } from "../../src/core";
import { buildScene } from "../../src/core/scene";

function makeRoofFloor(roof: RoofSpec): Floor {
  return {
    title: "Roof",
    roof,
    outline: [[-40, -40], [640, -40], [640, 440], [-40, 440]],
    owk: ["parapet", "parapet", "parapet", "parapet"],
    rooms: [{ id: "rt1", name: "Flat terrace", area: "", kind: "terrace", pts: [[400, 200], [600, 200], [600, 400], [400, 400]], wk: ["parapet", "parapet", "parapet", "parapet"] }],
    walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], unlinked: [],
    furniture: [
      { id: "sk1", symbol: "skylight", x: 180, y: 120, rot: 0, w: 100, h: 120, entity: "cover.velux" },
      { id: "ch1", symbol: "chimney", x: 300, y: 180, rot: 0, w: 60, h: 60 },
      { id: "sp1", symbol: "solar-panel", x: 200, y: 310, rot: 0, w: 170, h: 100, entity: "sensor.solar_power" },
      { id: "rv1", symbol: "roof-vent", x: 420, y: 100, rot: 0, w: 45, h: 45 },
    ],
  };
}

describe("S92: Dedicated roof floor and roof fixtures", () => {
  it("validates every ROOF_SHAPES value and rejects invalid roof fields", () => {
    for (const shape of ROOF_SHAPES) {
      const l: Layout = { version: 2, unit: "cm", north: 0, floors: { roof: makeRoofFloor({ shape, pitch: 30, ridge: 0, overhang: 40, color: "#9c523b" }) }, catalog: [] };
      expect(validate(l).ok, shape).toBe(true);
    }
    expect(validate({ version: 2, unit: "cm", north: 0, floors: { roof: makeRoofFloor({ shape: "dome" as never }) }, catalog: [] }).ok).toBe(false);
    expect(validate({ version: 2, unit: "cm", north: 0, floors: { roof: makeRoofFloor({ shape: "gable", pitch: 80 }) }, catalog: [] }).ok).toBe(false);
    expect(validate({ version: 2, unit: "cm", north: 0, floors: { roof: makeRoofFloor({ shape: "gable", ridge: 45 as never }) }, catalog: [] }).ok).toBe(false);
    expect(validate({ version: 2, unit: "cm", north: 0, floors: { roof: makeRoofFloor({ shape: "gable", color: "red" }) }, catalog: [] }).ok).toBe(false);
    for (const sym of ["skylight", "chimney", "solar-panel", "roof-vent"] as const) expect(FURNITURE_SYMBOLS).toContain(sym);
  });

  it("renders 2D roof surface, ridge/hip lines, flat terrace section, and roof fixtures", () => {
    const gableSvg = renderFloor(makeRoofFloor({ shape: "gable", pitch: 30, ridge: 0, color: "#9c523b" }), { scale: 1 });
    expect(gableSvg).toContain('data-roof="gable"');
    expect(gableSvg).toContain('class="roof-ridge"');
    expect(gableSvg).toContain("#9c523b");

    const hipSvg = renderFloor(makeRoofFloor({ shape: "hip", ridge: 90 }), { scale: 1 });
    expect(hipSvg).toContain('data-roof="hip"');
    expect(hipSvg).toContain('class="roof-ridge"');

    const flatSvg = renderFloor(makeRoofFloor({ shape: "flat" }), { scale: 1 });
    expect(flatSvg).toContain('data-roof="flat"');
    expect(flatSvg).not.toContain('class="roof-ridge"');
  });

  it("builds 3D pitched roof tiers and roof fixture solids", () => {
    const scGable = buildScene(makeRoofFloor({ shape: "gable", pitch: 35, ridge: 0, color: "#9c523b" }));
    const roofSolids = scGable.solids.filter((s) => s.paint?.role === "roof");
    expect(roofSolids.length).toBe(6);
    expect(roofSolids[0].paint?.color).toBe("#9c523b");

    const scFlat = buildScene(makeRoofFloor({ shape: "flat" }));
    expect(scFlat.solids.filter((s) => s.paint?.role === "roof").length).toBe(1);
  });
});
