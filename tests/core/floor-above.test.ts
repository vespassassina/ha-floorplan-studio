import { describe, expect, it } from "vitest";
import { floorAbove, floorBelow, type Floor, type Layout } from "../../src/core";

const blank = (title: string): Floor => ({
  title, outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [],
});

describe("S96: floorAbove", () => {
  const layout: Layout = {
    version: 2, unit: "cm", north: 0, catalog: [],
    floors: { basement: blank("Basement"), ground: blank("Ground"), first: blank("First"), roof: blank("Roof") },
  };

  it("returns the next higher floor key, or null for the top floor / unknown keys", () => {
    expect(floorAbove(layout, "basement")).toBe("ground");
    expect(floorAbove(layout, "ground")).toBe("first");
    expect(floorAbove(layout, "first")).toBe("roof");
    expect(floorAbove(layout, "roof")).toBeNull();
    expect(floorAbove(layout, "missing")).toBeNull();
    expect(floorBelow(layout, "basement")).toBeNull();
    expect(floorBelow(layout, "ground")).toBe("basement");
  });
});
