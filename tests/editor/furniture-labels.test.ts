import { describe, expect, it } from "vitest";
import { FURNITURE_SYMBOLS } from "../../src/core";
import { FURNITURE_AREAS, FURNITURE_LABELS, furnitureMenu } from "../../src/editor/toolbar";

describe("S26.17: furniture names in the Add menu", () => {
  it("names every symbol, with no hyphen, and no two the same", () => {
    const names = FURNITURE_SYMBOLS.map((s) => FURNITURE_LABELS[s]);
    for (const [i, n] of names.entries()) { expect(n, FURNITURE_SYMBOLS[i]).toBeTruthy(); expect(n).not.toMatch(/-/); }
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(FURNITURE_LABELS).sort()).toEqual([...FURNITURE_SYMBOLS].sort());
  });
  it("writes the patios as Patio, wood and Patio, concrete", () => {
    expect(FURNITURE_LABELS["patio-wood"]).toBe("Patio, wood");
    expect(FURNITURE_LABELS["patio-concrete"]).toBe("Patio, concrete");
  });
  it("files every symbol under exactly one area of the house (a new piece fails until placed)", () => {
    const all = FURNITURE_AREAS.flatMap(([, s]) => s);
    expect(all.length).toBe(new Set(all).size);
    expect([...all].sort()).toEqual([...FURNITURE_SYMBOLS].sort());
    for (const [area, s] of FURNITURE_AREAS) expect(s.length, area).toBeGreaterThan(0);
  });
  it("lists the areas in house order and each area's pieces A to Z by name", () => {
    const menu = furnitureMenu();
    expect(menu.map(([a]) => a)).toEqual(FURNITURE_AREAS.map(([a]) => a));
    for (const [area, s] of menu) {
      const names = s.map((y) => FURNITURE_LABELS[y]);
      expect(names, area).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
    // An area written out of order in the table still comes out sorted.
    const living = menu.find(([a]) => a === "Living")![1].map((y) => FURNITURE_LABELS[y]);
    expect(living.slice(0, 2)).toEqual(["Armchair", "Bookcase"]);
  });
});
