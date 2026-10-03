import { describe, it, expect } from "vitest";
import { obliqueFor, planPivot, renderFloor } from "../../src/core/render";
import { WALLS_LABELS, WALLS_MODES, type WallsMode } from "../../src/core/solids";
import type { Floor, Pt } from "../../src/core/schema";

// Diego, 2026-10-03, twice: "walls are still not all growing the same in the designer". Two things came of it.
// 1. A real defect: one straight wall that is several edges (a room side by side with another, a vertex in the middle
//    of a line) was cut per edge, so half of it could be low and half tall. A straight run now has one cut.
// 2. A choice: `walls` = "full" (every wall at its model height), "cut" (the doll's house rule, the default) or "low"
//    (every wall at the cutaway height).

const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (id: string, pts: Pt[], extra: object = {}) => ({ id, name: id, kind: "room", pts, wk: pts.map(() => "wall"), ...extra });
const floor = (rooms: object[], outline: Pt[], extra: object = {}): Floor => ({
  title: "T", outline, owk: outline.map(() => "external"), rooms: rooms as never,
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...extra,
});
/** Two rooms, the lower one's top wall split by a vertex at x=300: its left piece has a room behind it, the right piece has not. */
const notch = (): Floor => floor([
  room("up", box(0, 0, 300, 300)),
  room("low", [[0, 300], [300, 300], [800, 300], [800, 600], [0, 600]], { wk: ["wall", "wall", "wall", "wall", "wall"] }),
], box(0, 0, 800, 600));
/** A house of three rooms in a row, split front and back by different vertices. */
const row = (): Floor => floor([
  room("a", [[0, 0], [250, 0], [400, 0], [400, 400], [0, 400]], { wk: ["wall", "wall", "wall", "wall", "wall"] }),
  room("b", box(400, 0, 700, 400)),
  room("c", [[700, 0], [1000, 0], [1000, 200], [1000, 400], [700, 400]], { wk: ["wall", "wall", "wall", "wall", "wall"] }),
], box(0, 0, 1000, 400));

const key = (a: Pt, b: Pt) => [a, b].map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).sort().join("|");
/** Drawn height in cm of the tallest face of every wall piece, by its plan endpoints, read back from the markup. */
function heights(f: Floor, o: { deg?: number; tilt?: number; walls?: WallsMode }): Map<string, number> {
  const deg = o.deg ?? 0, tilt = o.tilt ?? 0.5;
  const turn = deg % 360 ? { deg, pivot: planPivot({ floors: { x: f } } as never) } : undefined;
  const html = renderFloor(f, { scale: 1, view: "2.5d", tilt, rotate: turn, walls: o.walls });
  const ob = obliqueFor(tilt), lean = ob.rise * Math.hypot(1, ob.skew), out = new Map<string, number>();
  for (const m of html.matchAll(/<polygon class="ws[^"]*" points="([^"]*)"\/>/g)) {
    const q = m[1].split(" ").map((s) => s.split(",").map(Number));
    const k = key(q[0] as Pt, q[1] as Pt), h = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) / lean;
    out.set(k, Math.max(out.get(k) ?? 0, h));
  }
  return out;
}
const ROTATIONS = [0, 15, 30, 45, 60, 90, 120, 135, 180, 210, 225, 270, 300, 315];
const TILTS = [0.25, 0.5, 1];

describe("one straight wall is one height, however many edges it is made of", () => {
  const SPLITS: [string, () => Floor, Pt[][]][] = [
    ["a back wall split by a vertex, a room behind its left piece", notch, [[[0, 300], [300, 300]], [[300, 300], [800, 300]]]],
    ["a row of rooms, front wall in three pieces", row, [[[0, 400], [400, 400]], [[400, 400], [700, 400]], [[700, 400], [1000, 400]]]],
    ["a row of rooms, back wall in three pieces", row, [[[0, 0], [250, 0]], [[250, 0], [400, 0]], [[400, 0], [700, 0]], [[700, 0], [1000, 0]]]],
    ["a row of rooms, right wall in two pieces", row, [[[1000, 0], [1000, 200]], [[1000, 200], [1000, 400]]]],
  ];
  for (const [name, make, pieces] of SPLITS) for (const tilt of TILTS) for (const deg of ROTATIONS) {
    it(`${name}, turned ${deg}, tilt ${tilt}`, () => {
      const m = heights(make(), { deg, tilt });
      const hs = pieces.map(([a, b]) => m.get(key(a, b)));
      expect(hs.every((h) => typeof h === "number"), JSON.stringify(hs)).toBe(true);
      for (const h of hs) expect(h as number).toBeCloseTo(hs[0] as number, 1);
    });
  }
});

describe("the walls option", () => {
  it("lists full, cut and low, each with a label", () => {
    expect([...WALLS_MODES]).toEqual(["full", "cut", "low"]);
    for (const m of WALLS_MODES) expect(typeof WALLS_LABELS[m], m).toBe("string");
    expect(Object.keys(WALLS_LABELS).sort()).toEqual([...WALLS_MODES].sort());
  });
  it("no option and cut draw the same bytes (the default is today's rule)", () => {
    const f = notch();
    for (const deg of [0, 30]) {
      const turn = deg ? { deg, pivot: planPivot({ floors: { x: f } } as never) } : undefined;
      expect(renderFloor(f, { scale: 1, view: "2.5d", rotate: turn, walls: "cut" })).toBe(renderFloor(f, { scale: 1, view: "2.5d", rotate: turn }));
    }
  });
  for (const mode of WALLS_MODES) for (const tilt of TILTS) for (const deg of ROTATIONS) {
    it(`${mode}: every wall at its rule's height, turned ${deg}, tilt ${tilt}`, () => {
      for (const f of [notch(), row()]) {
        const m = heights(f, { deg, tilt, walls: mode }), cutaway = Math.min(250, obliqueFor(tilt).cutaway);
        expect(m.size).toBeGreaterThan(0);
        for (const [k, h] of m) {
          if (mode === "full") expect(h, k).toBeCloseTo(250, 1);
          else if (mode === "low") expect(h, k).toBeCloseTo(cutaway, 1);
          else { expect(h, k).toBeGreaterThanOrEqual(cutaway - 0.1); expect(h, k).toBeLessThanOrEqual(250 + 0.1); }
        }
      }
    });
  }
  it("a wall already lower than the cutaway is not raised by low", () => {
    const f = floor([], box(0, 0, 400, 400), { owk: ["fence", "fence", "fence", "fence"] }); // a fence is 110 cm
    const m = heights(f, { tilt: 0.5, walls: "low" });
    for (const h of m.values()) expect(h).toBeCloseTo(90, 1);
    const m2 = heights(f, { tilt: 1, walls: "low" }); // cutaway at tilt 1 is 45 cm: lower than the fence
    for (const h of m2.values()) expect(h).toBeCloseTo(Math.min(110, obliqueFor(1).cutaway), 1);
  });
  it("2D is byte for byte the same whatever walls says", () => {
    const f = notch();
    expect(renderFloor(f, { scale: 1, walls: "low" })).toBe(renderFloor(f, { scale: 1 }));
    expect(renderFloor(f, { scale: 1, walls: "full" })).toBe(renderFloor(f, { scale: 1, view: "2d" }));
  });
  it("junk is the default", () => {
    const f = notch();
    for (const junk of ["", "FULL", 3, null, {}, "__proto__"]) {
      expect(renderFloor(f, { scale: 1, view: "2.5d", walls: junk as never })).toBe(renderFloor(f, { scale: 1, view: "2.5d" }));
    }
  });
});
