import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout, Pt } from "../../src/core/schema";
import { spawnPoint } from "../../src/editor/ops";

const ground = () => structuredClone((demo as unknown as Layout).floors.ground);
const FALLBACK: Pt = [123, 457];

describe("spawnPoint", () => {
  it("is right of the outline's bounding box, at its top, on the 5 cm grid", () => {
    const f = ground();
    f.outline = [[10, 20], [803, 20], [803, 604], [10, 604]]; // max x 803, min y 20: asymmetric on purpose
    expect(spawnPoint(f, FALLBACK)).toEqual([955, 20]); // 803 + 150 = 953 rounds to 955
  });

  it("uses the demo outline: 800 wide, top at 0", () => {
    expect(spawnPoint(ground(), FALLBACK)).toEqual([950, 0]);
  });

  it("returns the fallback for an outline of fewer than three points", () => {
    const f = ground();
    f.outline = [];
    expect(spawnPoint(f, FALLBACK)).toEqual(FALLBACK);
    f.outline = [[0, 0], [100, 0]];
    expect(spawnPoint(f, FALLBACK)).toEqual(FALLBACK);
  });

  it("does not change the floor", () => {
    const f = ground(), copy = structuredClone(f);
    spawnPoint(f, FALLBACK);
    expect(f).toEqual(copy);
  });
});
