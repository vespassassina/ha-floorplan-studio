import { describe, expect, it } from "vitest";
import { FURNITURE_SYMBOLS } from "../../src/core";
import { FURNITURE_LABELS } from "../../src/editor/toolbar";

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
});
