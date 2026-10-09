import { describe, expect, it } from "vitest";
import { DEVICE_TYPES, type Floor } from "../../src/core/schema";
import { CATEGORIES } from "../../src/core/categories";
import { LAYERS, layerCounts, layerHides, layerOfType, layersSummary, parseLayers, soloLayer, toggleLayer, type LayerId } from "../../src/core/layers";
import { renderFloor } from "../../src/core/render";

describe("S24.6 layers", () => {
  it("are the card's categories in their order, then Furniture", () => {
    expect(LAYERS.map((l) => l.id)).toEqual([...CATEGORIES.map((c) => c.id), "furniture"]);
    expect(LAYERS.at(-1)!.label).toBe("Furniture");
  });

  it("every device type belongs to one layer that is not Furniture (finding 17)", () => {
    const ids = new Set(LAYERS.map((l) => l.id));
    for (const t of DEVICE_TYPES) {
      expect(ids.has(layerOfType(t)), t).toBe(true);
      expect(layerOfType(t), t).not.toBe("furniture");
    }
    expect(layerOfType("light")).toBe("lights");
    expect(layerOfType("nonsense" as never)).toBe("other"); // an untrusted layout's unknown type
  });

  it("toggle hides then shows one family; solo shows only that one, and solo again shows all", () => {
    expect(toggleLayer([], "lights")).toEqual(["lights"]);
    expect(toggleLayer(["climate", "lights"], "lights")).toEqual(["climate"]);
    const solo = soloLayer([], "media");
    expect(solo).toHaveLength(LAYERS.length - 1);
    expect(solo).not.toContain("media");
    expect(soloLayer(solo, "media")).toEqual([]);
    expect(soloLayer(["lights"], "lights")).not.toContain("lights"); // alt-click on a hidden family shows it, alone
  });

  it("keeps hidden ids in layer order, without repeats", () => {
    expect(toggleLayer(["furniture"], "lights")).toEqual(["lights", "furniture"]);
  });

  it("parses storage it cannot trust", () => {
    expect(parseLayers(undefined)).toEqual([]);
    expect(parseLayers("lights")).toEqual([]);
    expect(parseLayers({ 0: "lights" })).toEqual([]);
    expect(parseLayers(["lights", "lights", "__proto__", 3, null, "furniture", "toString"])).toEqual(["lights", "furniture"]);
  });

  it("names what is hidden", () => {
    expect(layersSummary([])).toBe("");
    expect(layersSummary(["lights"])).toBe("Layers: lights hidden");
    expect(layersSummary(["computing"])).toBe("Layers: computers and network hidden");
    expect(layersSummary(["lights", "climate", "furniture"])).toBe(`Layers: 3 of ${LAYERS.length} hidden`);
    expect(layersSummary(soloLayer([], "security"))).toBe("Layers: only security shown");
    expect(layersSummary(LAYERS.map((l) => l.id))).toBe("Layers: all hidden");
  });

  it("counts a floor's things per layer: devices and unlinked appliances by type, furniture as Furniture", () => {
    const f = {
      devices: [{ type: "light" }, { type: "light" }, { type: "plug" }, { type: "bogus" }],
      unlinked: [{ type: "light" }, { type: "car" }],
      furniture: [{ symbol: "bed" }, { symbol: "sofa" }, { symbol: "tv" }],
    } as unknown as Floor;
    const c = layerCounts(f);
    expect(c.lights).toBe(3);
    expect(c.power).toBe(1);
    expect(c.other).toBe(2); // the car and the unknown type
    expect(c.furniture).toBe(3);
    expect(c.climate).toBe(0);
    expect(Object.keys(c).sort()).toEqual(LAYERS.map((l) => l.id).sort());
    expect(layerCounts({} as Floor).lights).toBe(0); // junk never throws
  });
});

describe("S24.6 renderFloor hides layers", () => {
  const floor: Floor = {
    title: "T", outline: [[0, 0], [600, 0], [600, 400], [0, 400]], rooms: [], walls: [], doors: [], openings: [], extras: [], stairs: [],
    devices: [
      { id: "l1", name: "Lamp", type: "light", entity: "light.a", x: 100, y: 100 },
      { id: "p1", name: "Plug", type: "plug", entity: "switch.p", x: 200, y: 100 },
    ],
    furniture: [{ id: "f1", symbol: "bed", x: 300, y: 200, rot: 0, w: 160, h: 200 }],
    unlinked: [{ id: "u1", type: "light", x: 400, y: 300 }, { id: "u2", type: "car", x: 500, y: 300 }],
  } as unknown as Floor;
  const base = { scale: 1 };
  const icons = (svg: string) => [...svg.matchAll(/<g[^>]*data-x="(\d+)"/g)].map((m) => m[1]);
  const unl = (svg: string) => [...svg.matchAll(/<g[^>]*data-u="(\d+)"/g)].map((m) => m[1]);

  it("hiding lights draws no light icon, linked or not, and keeps the rest", () => {
    const svg = renderFloor(floor, { ...base, hiddenLayers: ["lights"] });
    expect(icons(svg)).toEqual(["1"]);
    expect(unl(svg)).toEqual(["1"]);
    expect(svg).toContain('data-f="0"');
  });

  it("hiding Furniture draws no furniture and keeps every device", () => {
    const svg = renderFloor(floor, { ...base, hiddenLayers: ["furniture"] });
    expect(svg).not.toContain('data-f="0"');
    expect(icons(svg)).toEqual(["0", "1"]);
  });

  it("keeps what is selected, even on a hidden layer", () => {
    expect(icons(renderFloor(floor, { ...base, hiddenLayers: ["lights"], selection: { t: "dev", i: 0 } }))).toEqual(["0", "1"]);
    expect(renderFloor(floor, { ...base, hiddenLayers: ["furniture"], keep: { t: "furn", i: 0 } })).toContain('data-f="0"');
    expect(unl(renderFloor(floor, { ...base, hiddenLayers: ["lights"], keep: { t: "unl", i: 0 } }))).toEqual(["0", "1"]);
  });

  it("nothing hidden draws byte for byte what no option draws", () => {
    expect(renderFloor(floor, { ...base, hiddenLayers: [] })).toBe(renderFloor(floor, base));
    const all: LayerId[] = LAYERS.map((l) => l.id);
    expect(icons(renderFloor(floor, { ...base, hiddenLayers: all }))).toEqual([]);
  });
});

describe("S24.R8 layerHides: one rule for what the plan draws and what a click picks", () => {
  it("hides by family, keeps what `keep` names, and never throws on junk", () => {
    expect(layerHides([], "furn", 0)).toBe(false);
    expect(layerHides(undefined, "furn", 0)).toBe(false);
    expect(layerHides(["furniture"], "furn", 2)).toBe(true);
    expect(layerHides(["furniture"], "dev", 2, "light")).toBe(false);
    expect(layerHides(["lights"], "dev", 2, "light")).toBe(true);
    expect(layerHides(["lights"], "unl", 2, "light")).toBe(true);
    expect(layerHides(["furniture"], "furn", 2, undefined, { t: "furn", i: 2 })).toBe(false);
    expect(layerHides(["furniture"], "furn", 2, undefined, { t: "dev", i: 2 }, { t: "furn", i: 1 })).toBe(true);
    expect(layerHides(["furniture"], "furn", 2, undefined, null, { t: "furn", i: 2 })).toBe(false);
    expect(layerHides(["other"], "dev", 0, "nonsense" as never)).toBe(true);
    expect(layerHides("lights" as never, "dev", 0, "light")).toBe(false);
  });
});
