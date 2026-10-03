import { describe, it, expect } from "vitest";
import { obliqueFor, planPivot, renderFloor, rotateAbout } from "../../src/core/render";
import { ROOM_KINDS, type Floor, type Pt } from "../../src/core/schema";

// Diego, 2026-10-03: "the walls in 2.5D are broke again, some scale too much, others stay fixed, the walls are not 3d
// anymore". Measured causes: (1) a garden, pavement, terrace or any other outdoor room behind the house counted as a
// floor to uncover, so every back wall was cut; (2) the cut was a hard step at a normal of 0.3, so at 17 degrees of
// turn ten walls jumped 160 cm at once and from 18 to 72 degrees every inner wall of a grid was flat.
// A wall now keeps its model height, except that one facing the viewer (or covering an inner room's floor) eases down to
// the cutaway. These tests read the drawn height of every wall face back from the markup.

const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (id: string, pts: Pt[], extra: object = {}) => ({ id, name: id, kind: "room", pts, wk: pts.map(() => "wall"), ...extra });
const floor = (rooms: object[], outline: Pt[], extra: object = {}): Floor => ({
  title: "T", outline, owk: outline.map(() => "external"), rooms: rooms as never,
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...extra,
});
const grid = (): Floor => floor(Array.from({ length: 9 }, (_, i) => room(`g${i}`, box((i % 3) * 300, Math.floor(i / 3) * 300, (i % 3) * 300 + 300, Math.floor(i / 3) * 300 + 300))), box(0, 0, 900, 900));
/** Rooms of `kind` all round a floor: the lawn a house stands in. */
const aroundGarden = (f: Floor, kind: string): Floor => ({ ...f, rooms: [room("out", box(-400, -400, 1300, 1300), { kind, wk: ["boundary", "boundary", "boundary", "boundary"] }) as never, ...f.rooms] });

const key = (a: Pt, b: Pt) => [a, b].map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).sort().join("|");
/** Drawn height in cm of every wall face, by its plan endpoints, with the screen-frame outward normal's y when it is a room edge. */
function heights(f: Floor, deg: number, tilt: number): Map<string, number> {
  const turn = deg % 360 ? { deg, pivot: planPivot({ floors: { x: f } } as never) } : undefined;
  const html = renderFloor(f, { scale: 1, view: "2.5d", tilt, rotate: turn });
  const ob = obliqueFor(tilt), lean = ob.rise * Math.hypot(1, ob.skew), out = new Map<string, number>();
  for (const m of html.matchAll(/<polygon class="ws[^"]*" points="([^"]*)"\/>/g)) {
    const q = m[1].split(" ").map((s) => s.split(",").map(Number));
    const k = key(q[0] as Pt, q[1] as Pt), h = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) / lean;
    out.set(k, Math.max(out.get(k) ?? 0, h));
  }
  return out;
}
const at = (m: Map<string, number>, a: Pt, b: Pt) => m.get(key(a, b));
const TILTS = [0.25, 0.5, 1];
const cutFor = (tilt: number) => Math.min(250, obliqueFor(tilt).cutaway);
const ROTATIONS = [0, 45, 90, 135, 180, 225, 270, 315];

/** The outward normal of the edge a->b of a clockwise (on screen) rectangle polygon, turned by `deg`: only its y matters. */
const normalY = (a: Pt, b: Pt, deg: number, c: Pt): number => {
  const s = rotateAbout(a, deg, c), t = rotateAbout(b, deg, c), len = Math.hypot(t[0] - s[0], t[1] - s[1]);
  return -(t[0] - s[0]) / len; // clockwise on screen (y down): outward is (dy, -dx)
};

describe("walls keep one height wherever they stand", () => {
  for (const tilt of TILTS) for (const deg of ROTATIONS) {
    it(`a 3x3 grid, turned ${deg}, tilt ${tilt}: back and side walls full, front and facing inner walls at the cutaway`, () => {
      const f = grid(), m = heights(f, deg, tilt), c = planPivot({ floors: { x: f } } as never), cut = cutFor(tilt);
      // A wall is as exposed as its most exposed side (a shared wall has two). 0.6 or more faces the viewer: lowered.
      // 0.2 or less is seen side-on or from behind: full. Between the two it eases, so it is not asserted.
      const exposure = new Map<string, number>(), ends = new Map<string, [Pt, Pt]>();
      for (const r of f.rooms) r.pts.forEach((a, i) => {
        const b = r.pts[(i + 1) % r.pts.length], k = key(a, b);
        exposure.set(k, Math.max(exposure.get(k) ?? -1, normalY(a, b, deg, c)));
        ends.set(k, [a, b]);
      });
      let lowered = 0, full = 0;
      for (const [k, ny] of exposure) {
        const h = m.get(k);
        expect(h, `no face for ${k}`).toBeDefined();
        if (ny >= 0.6) { expect(h, `${k} @${deg}`).toBeCloseTo(cut, 0); lowered++; }
        else if (ny <= 0.2) { expect(h, `${k} @${deg}`).toBeCloseTo(250, 0); full++; }
      }
      expect(lowered).toBeGreaterThan(0);
      expect(full).toBeGreaterThan(0);
    });

    it(`the same grid in a lawn, turned ${deg}, tilt ${tilt}: the lawn does not change a single wall`, () => {
      const plain = heights(grid(), deg, tilt), lawn = heights(aroundGarden(grid(), "garden"), deg, tilt);
      for (const [k, h] of plain) expect(lawn.get(k), k).toBeCloseTo(h, 5);
    });
  }

  it("a room of any kind behind a back wall: only a real room (a floor someone stands on) lowers it", () => {
    // The house is the lower room; the north room shares the line y = 200 with it. Every RoomKind is a decision (finding 17).
    for (const kind of ROOM_KINDS) {
      const north = room("n", box(0, 0, 400, 200), { kind, wk: kind === "room" ? ["wall", "wall", "wall", "wall"] : ["boundary", "boundary", "boundary", "boundary"] });
      const f = floor([north, room("house", box(0, 200, 400, 400))], box(0, 0, 400, 400));
      // The house's north edge faces up the screen, so it is lowered only because the room behind it is a floor to see.
      // (For a real room the north room's own south edge is the same wall, so the answer is the cutaway either way.)
      const h = at(heights(f, 0, 0.5), [0, 200], [400, 200]);
      if (kind === "room") expect(h, "room").toBeCloseTo(cutFor(0.5), 0);
      else expect(h, `kind ${kind}`).toBeCloseTo(250, 0);
    }
  });

  it("two walls of one model height and one exposure draw equal faces, in a row of rooms and with a lawn behind", () => {
    const row = floor([0, 1, 2, 3].map((c) => room(`r${c}`, box(c * 300, 0, c * 300 + 300, 400))), box(0, 0, 1200, 400));
    for (const f of [row, aroundGarden(row, "pavement")]) for (const deg of [0, 90, 180, 270]) {
      const m = heights(f, deg, 0.5), tops = [0, 1, 2, 3].map((c) => at(m, [c * 300, 0], [c * 300 + 300, 0])), bots = [0, 1, 2, 3].map((c) => at(m, [c * 300, 400], [c * 300 + 300, 400]));
      expect(new Set(tops.map((h) => Math.round(h! * 100))).size, `north walls @${deg}`).toBe(1);
      expect(new Set(bots.map((h) => Math.round(h! * 100))).size, `south walls @${deg}`).toBe(1);
    }
  });

  it("an animation frame to the next never jumps a wall: the height is continuous in the angle", () => {
    const L = floor([room("L", [[0, 0], [200, 0], [200, 150], [400, 150], [400, 300], [0, 300]])], [[0, 0], [400, 0], [400, 300], [0, 300]]);
    const free = floor([], box(0, 0, 600, 600), { walls: [[100, 100, 300, 100], [100, 300, 300, 500], [350, 100, 350, 400], [400, 400, 550, 250]].map((w, i) => ({ id: `w${i}`, a: [w[0], w[1]] as Pt, b: [w[2], w[3]] as Pt, kind: "wall" })) as never });
    const stacked = floor([room("living", box(0, 0, 400, 300)), room("hall", box(100, 300, 300, 500))], box(0, 0, 400, 500));
    for (const [name, f] of Object.entries({ grid: grid(), L, free, stacked, lawn: aroundGarden(grid(), "garden") })) for (const tilt of [0.5, 1]) {
      let prev = heights(f, 0, tilt);
      const cut = cutFor(tilt);
      for (let deg = 1; deg <= 360; deg++) {
        const cur = heights(f, deg, tilt);
        for (const [k, h] of cur) {
          const before = prev.get(k);
          if (before !== undefined) expect(Math.abs(h - before), `${name} tilt ${tilt} ${k} at ${deg}`).toBeLessThanOrEqual(0.125 * (250 - cut) + 1); // a full cut takes at least 8 degrees, not one frame
        }
        prev = cur;
      }
    }
  });

  it("the walls drawn at 90 degrees are the walls at 0 of the layout turned by 90 (the rule lives in the screen frame)", () => {
    const stacked = floor([room("living", box(0, 0, 400, 300)), room("hall", box(100, 300, 300, 500))], box(0, 0, 400, 500));
    for (const f of [stacked, grid()]) {
      const c = planPivot({ floors: { x: f } } as never), turned = (p: Pt) => rotateAbout(p, 90, c).map((v) => Math.round(v * 1000) / 1000) as Pt;
      const g = structuredClone(f);
      g.outline = g.outline.map(turned); g.rooms.forEach((r) => (r.pts = r.pts.map(turned)));
      const a = heights(f, 90, 0.5), b = heights(g, 0, 0.5);
      for (const r of f.rooms) r.pts.forEach((p, i) => {
        const q = r.pts[(i + 1) % r.pts.length];
        expect(at(b, turned(p), turned(q))).toBeCloseTo(at(a, p, q)!, 1);
      });
    }
  });

  it("a free wall is judged like a room wall: horizontal on screen is lowered, vertical full, 45 degrees lowered too", () => {
    const f = floor([], box(0, 0, 600, 600), { walls: [{ id: "h", a: [100, 100], b: [300, 100], kind: "wall" }, { id: "v", a: [350, 100], b: [350, 300], kind: "wall" }, { id: "d", a: [400, 400], b: [500, 500], kind: "wall" }] as never });
    const m = heights(f, 0, 0.5);
    expect(at(m, [100, 100], [300, 100])).toBeCloseTo(cutFor(0.5), 0);
    expect(at(m, [350, 100], [350, 300])).toBeCloseTo(250, 0);
    expect(at(m, [400, 400], [500, 500])).toBeCloseTo(cutFor(0.5), 0);
  });
});
