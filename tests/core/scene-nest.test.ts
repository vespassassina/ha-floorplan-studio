import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { buildScene } from "../../src/core/scene";
import type { Floor, Layout } from "../../src/core/schema";

// S19.A. Diego's garden house floor was missing in 3D. Two room fills at one height fight for the pixel, so the rule under test is:
// two rooms that overlap are never at the same height, and the smaller sits above the bigger. Each variant is a way a shed sits
// on a garden that the 30 cm corner rule of 0.18.2 did not cover.
const WK = ["none", "none", "none", "none"];
const floor = (rooms: unknown[], o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: [...WK] as never, rooms: rooms as never,
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const R = (id: string, kind: string, pts: number[][], o: object = {}) => ({ id, name: id, area: "", kind, pts, wk: [...WK], ...o });
const rect = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const heights = (f: Floor) => {
  const out: Record<string, number> = {};
  for (const s of buildScene(f).solids) if (s.kind === "room" && s.shape.type === "prism") out[s.id] = s.shape.z0;
  return out;
};

describe("scene: overlapping rooms are never at one height (S19.A)", () => {
  const garden = R("g", "garden", rect(0, 0, 500, 500));
  const variants: Record<string, { rooms: unknown[]; small: number; big: number }> = {
    "a textured shed 60 cm over the garden's corner": { rooms: [garden, R("s", "room", rect(400, 400, 560, 500), { texture: "oak" })], small: 1, big: 0 },
    "a shed 40 cm over the edge": { rooms: [garden, R("s", "room", rect(400, 400, 540, 480))], small: 1, big: 0 },
    "a shed half over the border": { rooms: [garden, R("s", "room", rect(450, 200, 600, 300))], small: 1, big: 0 },
    "a turned shed with corners 10 to 40 cm out": { rooms: [garden, R("s", "room", [[400, 400], [520, 430], [490, 540], [370, 510]])], small: 1, big: 0 },
    "a shed bigger than the garden": { rooms: [garden, R("s", "room", rect(100, 100, 700, 700))], small: 0, big: 1 },
    "a shed across a notch of an L-shaped garden": { rooms: [R("g", "garden", [[0, 0], [500, 0], [500, 200], [200, 200], [200, 500], [0, 500]]), R("s", "room", rect(100, 100, 400, 400))], small: 1, big: 0 },
    "two rooms crossing like a plus": { rooms: [R("a", "room", rect(0, 100, 500, 200)), R("b", "room", rect(200, 0, 300, 400))], small: 1, big: 0 },
  };
  for (const [name, v] of Object.entries(variants)) it(name, () => {
    for (const order of [0, 1]) {
      const rooms = order ? [...v.rooms].reverse() : v.rooms;
      const h = heights(floor(rooms));
      const at = (k: number) => h[`room:${order ? rooms.length - 1 - k : k}`];
      // The rule: the smaller room (by area, a tie by array order) is above. Variants list the bigger one first, except `bigger than the garden`.
      const [lo, hi] = [at(v.big), at(v.small)];
      expect(hi, `order ${order}: the smaller room sits above`).toBeGreaterThan(lo);
    }
  });

  it("two copies of one outline are not level: the later one wins, as it is drawn last on the plan", () => {
    expect(heights(floor([R("a", "garden", rect(0, 0, 500, 500)), R("b", "room", rect(0, 0, 500, 500))]))).toEqual({ "room:0": 0, "room:1": 1 });
  });

  it("the demo's rooms stay as they were: the pond above the garden, the house rooms and the pavement on the floor", () => {
    const h = heights((demo as unknown as Layout).floors.ground);
    expect(h).toEqual({ "room:0": 0, "room:1": 0, "room:2": 0, "room:4": 0, "room:5": 0, "room:6": 1 });
  });

  it("rooms that only share a border stay level", () => {
    expect(heights(floor([R("a", "room", rect(0, 0, 100, 100)), R("b", "room", rect(100, 0, 200, 100))]))).toEqual({ "room:0": 0, "room:1": 0 });
  });
});
