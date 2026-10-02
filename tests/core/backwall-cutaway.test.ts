import { describe, it, expect } from "vitest";
import { obliqueFor, renderFloor } from "../../src/core/render";
import type { Floor, Pt } from "../../src/core/schema";

// A wall is cut by what it would cover, not by which room owns its edge: a back wall whose lift reaches over another
// room's floor is drawn at the cutaway, a back wall with nothing behind it keeps the storey height.
const n = (v: number) => String(Math.round(v * 100) / 100);
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (id: string, pts: Pt[], extra: object = {}) => ({ id, name: id, kind: "room", pts, wk: pts.map(() => "wall"), ...extra });
const floor = (rooms: object[], outline: Pt[] = box(0, 0, 400, 500)): Floor => ({
  title: "T", outline, owk: outline.map(() => "external"), rooms: rooms as never,
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [],
});
const faces = (html: string) => [...html.matchAll(/<polygon class="ws[^"]*" points="([^"]*)"\/>/g)].map((m) => m[1]);
/** The face of the wall a->b, as drawn at height h at this tilt, on an unturned plan. */
function quad(a: Pt, b: Pt, h: number, tilt: number): string {
  const o = obliqueFor(tilt), up = (p: Pt) => `${n(p[0] + h * o.rise * o.skew)},${n(p[1] - h * o.rise)}`;
  return `${a} ${b} ${up(b)} ${up(a)}`;
}
const face = (f: Floor, a: Pt, b: Pt, tilt: number) => faces(renderFloor(f, { scale: 1, view: "2.5d", tilt })).find((q) => q.startsWith(`${a} ${b} `));
/** How tall the wall a->b is drawn, read back from its lifted corner. */
const heightOf = (f: Floor, a: Pt, b: Pt, tilt: number) => {
  const q = face(f, a, b, tilt);
  expect(q, `no face for ${a} ${b}`).toBeDefined();
  const top = q!.split(" ")[3].split(",").map(Number);
  return (a[1] - top[1]) / obliqueFor(tilt).rise;
};
const TILTS = [0.5, 1];

describe("back walls are cut by what they cover", () => {
  // Living is wide (0..400, y 0..300); the Hall below it is narrower (100..300, y 300..500), so its north wall is its
  // own edge, not Living's south edge. At rise 0 nothing lifts, so the tilts below start at 0.5.
  const stacked = () => floor([room("living", box(0, 0, 400, 300)), room("hall", box(100, 300, 300, 500))]);

  for (const tilt of TILTS) {
    it(`tilt ${tilt}: the Hall's north wall, over the Living room, is drawn at the cutaway`, () => {
      const cut = Math.min(250, obliqueFor(tilt).cutaway);
      expect(face(stacked(), [100, 300], [300, 300], tilt)).toBe(quad([100, 300], [300, 300], cut, tilt));
      expect(heightOf(stacked(), [100, 300], [300, 300], tilt)).toBeCloseTo(cut, 0);
    });

    it(`tilt ${tilt}: the house's back wall, with nothing behind it, keeps the storey height`, () => {
      expect(heightOf(stacked(), [0, 0], [400, 0], tilt)).toBeCloseTo(250, 0);
    });

    it(`tilt ${tilt}: a lone room's back wall stays full`, () => {
      const f = floor([room("r", box(0, 0, 400, 500))]);
      expect(heightOf(f, [0, 0], [400, 0], tilt)).toBeCloseTo(250, 0);
    });

    it(`tilt ${tilt}: side walls stay full`, () => {
      expect(heightOf(stacked(), [400, 0], [400, 300], tilt)).toBeCloseTo(250, 0);
    });
  }

  it("a wall lower than the cutaway is not raised to it", () => {
    const f = floor([room("living", box(0, 0, 400, 300)), room("hall", box(100, 300, 300, 500), { height: 60 })]);
    expect(heightOf(f, [100, 300], [300, 300], 0.5)).toBeCloseTo(60, 0);
  });

  it("a wall whose lift stops short of the room behind it is not cut", () => {
    // At tilt 1 a 250 cm wall lifts 275 on screen; a room whose floor ends 400 cm behind is out of reach.
    const f = floor([room("far", box(0, 0, 400, 100)), room("hall", box(100, 500, 300, 700))], box(0, 0, 400, 700));
    expect(heightOf(f, [100, 500], [300, 500], 1)).toBeCloseTo(250, 0);
  });

  it("a room clear of the lean to the right is not a cover", () => {
    // The lift leans right by 0.3 of its height, about 80 cm at most; a room 300 cm to the right is clear.
    const f = floor([room("east", box(600, 0, 900, 300)), room("hall", box(100, 300, 300, 500))], box(0, 0, 900, 500));
    expect(heightOf(f, [100, 300], [300, 300], 1)).toBeCloseTo(250, 0);
  });

  it("a zone behind a back wall counts too", () => {
    const f = floor([room("garden", box(0, 0, 400, 300), { kind: "zone" }), room("hall", box(100, 300, 300, 500))]);
    expect(heightOf(f, [100, 300], [300, 300], 1)).toBeCloseTo(obliqueFor(1).cutaway, 0);
  });

  describe("an L-shaped room", () => {
    // Notch empty top-right: its edge (200,150)->(400,150) faces north into nothing, so it stays full.
    const L: Pt[] = [[0, 0], [200, 0], [200, 150], [400, 150], [400, 300], [0, 300]];
    for (const tilt of TILTS) {
      it(`tilt ${tilt}: an inner back wall over empty ground keeps its height`, () => {
        expect(heightOf(floor([room("l", L)], L), [200, 150], [400, 150], tilt)).toBeCloseTo(250, 0);
      });
      it(`tilt ${tilt}: the same wall is cut when another room fills the notch`, () => {
        const f = floor([room("l", L), room("nook", box(200, 0, 400, 150))], box(0, 0, 400, 300));
        expect(heightOf(f, [200, 150], [400, 150], tilt)).toBeCloseTo(Math.min(250, obliqueFor(tilt).cutaway), 0);
      });
    }
  });

  it("tilt 0 lifts nothing: the face is flat and nothing throws", () => {
    expect(face(stacked(), [100, 300], [300, 300], 0)).toBe("100,300 300,300 300,300 100,300");
  });

  it("junk geometry does not throw", () => {
    const junk = floor([room("a", box(0, 0, 400, 300)), { id: "b", name: "b", kind: "room", pts: [[NaN, 1], [5, 5]], wk: [] }, room("d", [[0, 0], [Infinity, 0], [5, 9]]), room("hall", box(100, 300, 300, 500))]);
    expect(() => renderFloor(junk, { scale: 1, view: "2.5d", tilt: 1 })).not.toThrow();
  });

  it("2d output draws no wall faces", () => {
    expect(faces(renderFloor(stacked(), { scale: 1 }))).toEqual([]);
  });
});
