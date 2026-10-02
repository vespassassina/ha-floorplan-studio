import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { OBLIQUE, renderFloor, viewBoxFor } from "../../src/core/render";

const L = demo as unknown as Layout;
const ground = L.floors.ground;

describe("2.5D projection and view box", () => {
  it("exports the three tunables in one place", () => {
    expect(Object.keys(OBLIQUE).sort()).toEqual(["cutaway", "rise", "skew"]);
    for (const v of Object.values(OBLIQUE)) expect(v).toBeGreaterThan(0);
  });

  it("view 2d and no view are byte-identical", () => {
    expect(renderFloor(ground, { scale: 0.5, view: "2d" })).toBe(renderFloor(ground, { scale: 0.5 }));
    expect(viewBoxFor(ground, 60, undefined, "2d")).toEqual(viewBoxFor(ground, 60));
  });

  it("2.5d widens the box upward by tallest*rise and rightward by tallest*skew*rise, nothing else", () => {
    // Asymmetric on purpose: a 400 cm floor height, rise and skew differ.
    const f = { ...structuredClone(ground), height: 400 } as typeof ground;
    const flat = viewBoxFor(f, 60), tall = viewBoxFor(f, 60, undefined, "2.5d");
    const up = 400 * OBLIQUE.rise, right = 400 * OBLIQUE.skew * OBLIQUE.rise;
    expect(tall.y).toBeCloseTo(flat.y - up, 6);
    expect(tall.h).toBeCloseTo(flat.h + up, 6);
    expect(tall.x).toBeCloseTo(flat.x, 6);
    expect(tall.w).toBeCloseTo(flat.w + right, 6);
  });

  it("counts a tall tree, not only walls", () => {
    const f = { ...structuredClone(ground), height: 100, furniture: [{ id: "t", symbol: "tree", x: 100, y: 100, rot: 0, w: 80, h: 80, height: 700 }] } as typeof ground;
    const flat = viewBoxFor(f, 60), tall = viewBoxFor(f, 60, undefined, "2.5d");
    expect(flat.y - tall.y).toBeCloseTo(700 * OBLIQUE.rise, 6);
  });

  it("an empty floor keeps its default box in 2.5d", () => {
    const e = { title: "E", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [] } as unknown as typeof ground;
    expect(viewBoxFor(e, 60, undefined, "2.5d")).toEqual(viewBoxFor(e, 60));
  });

  it("widens in the screen frame when the plan is turned", () => {
    const rot = { deg: 90, pivot: [0, 0] as [number, number] };
    const flat = viewBoxFor(ground, 60, rot), tall = viewBoxFor(ground, 60, rot, "2.5d");
    expect(flat.y - tall.y).toBeGreaterThan(100);
    expect(tall.x).toBeCloseTo(flat.x, 6);
  });
});
