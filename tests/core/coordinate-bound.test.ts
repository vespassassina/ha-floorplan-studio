import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { validate, COORD_LIMIT } from "../../src/core/schema";
import { loadLayout } from "../../src/editor/state";

// S12 review finding S3: coordinates near 1.7e308 are finite, passed validate, and made the 3D camera's distance NaN (a blank view).
// The bound is COORD_LIMIT = 1e7 cm (100 km). validate must refuse past it, in words, and never throw.
const withGround = (mut: (f: Record<string, any>) => void) => { const l = structuredClone(demo) as any; mut(l.floors.ground); return l; };
const messages = (l: unknown) => { const v = validate(l); return v.ok ? [] : v.errors; };

describe("coordinate bound", () => {
  it("the demo is inside it", () => { expect(validate(demo).ok).toBe(true); });
  it("the bound is 1e7 cm", () => { expect(COORD_LIMIT).toBe(1e7); });

  const cases: [string, (f: Record<string, any>) => void][] = [
    ["outline", (f) => { f.outline = [[0, 0], [1.7e308, 0], [1.7e308, 1.7e308], [0, 1.7e308]]; f.owk = ["external", "external", "external", "external"]; }],
    ["a room point", (f) => { f.rooms[0].pts[1] = [0, -2e7]; }],
    ["a wall end", (f) => { f.walls.push({ id: "w_far", kind: "wall", a: [0, 0], b: [1e9, 0] }); }],
    ["a door end", (f) => { f.doors[0].b = [1e9, 0]; }],
    ["a device x", (f) => { f.devices[0].x = 1e300; }],
    ["a furniture y", (f) => { f.furniture.push({ id: "m_far", symbol: "sofa", x: 0, y: 5e7, rot: 0, w: 100, h: 100 }); }],
    ["a stair point", (f) => { f.stairs[0].pts[0] = [1e12, 0]; }],
  ];
  for (const [name, mut] of cases) {
    it(`refuses ${name} beyond the bound, naming the floor and the limit`, () => {
      const e = messages(withGround(mut));
      expect(e.some((m) => /floor ground/.test(m) && /1e7|10000000/.test(m) && /cm/.test(m)), JSON.stringify(e)).toBe(true);
    });
  }
  it("accepts a point exactly on the bound, and refuses one just past it", () => {
    expect(messages(withGround((f) => { f.rooms[0].pts[1] = [1e7, 0]; })).filter((m) => /1e7|10000000/.test(m))).toEqual([]);
    expect(messages(withGround((f) => { f.rooms[0].pts[1] = [1e7 + 1, 0]; })).filter((m) => /1e7|10000000/.test(m)).length).toBeGreaterThan(0);
  });
  it("never throws on a shape that is not a layout (finding 1)", () => {
    for (const bad of [null, 5, "x", [], { version: 2, north: 0, floors: { g: { outline: 5, rooms: [null, { pts: 7 }], walls: "x", devices: [[1, 2]], stairs: [{ pts: [null] }], furniture: [5], unlinked: [{ x: {} }] } } }]) expect(() => validate(bad)).not.toThrow();
  });
  it("the editor's Open path (loadLayout) refuses it too", () => {
    const r = loadLayout(withGround((f) => { f.rooms[0].pts[1] = [0, 1.7e308]; }));
    expect(r.ok).toBe(false);
  });
});
