import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Floor, Furniture, Layout, Pt } from "../../src/core/schema";
import { closedLoop, furnitureNear, gridRound, pivotOnArc, roundStairs, rotateSegment, scaleFurniture, snapRoomTo, spawnInView, spawnPoint, squareAt, stairsAt, type Corner } from "../../src/editor/ops";

const ground = () => structuredClone((demo as unknown as Layout).floors.ground);
const FALLBACK: Pt = [123, 457];

/** A floor with only an outline: nothing else on it. */
const bareFloor = (outline: Pt[]): Floor => ({ title: "T", outline, rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [] });

describe("spawnPoint", () => {
  it("is right of the outline's bounding box, at its top, on the grid (10 cm by default), when the outline is everything", () => {
    const f = bareFloor([[10, 20], [803, 20], [803, 604], [10, 604]]); // max x 803, min y 20: asymmetric on purpose
    expect(spawnPoint(f, FALLBACK)).toEqual([950, 20]); // 803 + 150 = 953 rounds to 950 (S1.34: it was 955 on the 5 cm grid)
    expect(spawnPoint(f, FALLBACK, 5)).toEqual([955, 20]);
    expect(spawnPoint(f, FALLBACK, 50)).toEqual([950, 0]);
    expect(spawnPoint(f, FALLBACK, 0)).toEqual([953, 20]);
  });

  // S4.13-adjacent fix (Diego, 2026-09-22): a fixed spawn point at "outline right edge + 150" landed every
  // second new item on top of the first, because nothing already spawned there moved the next spawn along.
  // spawnPoint now reads every point already on the floor (contentPoints), not only the outline.
  it("clears a loose wall that reaches further right than the outline, not only the outline itself", () => {
    const f = bareFloor([[10, 20], [500, 20], [500, 604], [10, 604]]);
    f.walls = [{ id: "w1", a: [10, 20], b: [803, 400], kind: "wall" }]; // its far end is well past the outline's own right edge (500)
    expect(spawnPoint(f, FALLBACK)).toEqual([950, 20]); // 803 (the wall's end, not the outline's 500) + 150 = 953, rounds to 950
  });

  it("uses the demo outline: 800 wide, top at 0", () => {
    expect(spawnPoint(ground(), FALLBACK)).toEqual([1050, 0]); // the demo's own devices reach x 900, further right than the outline (800)
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

describe("spawnInView (Diego, 2026-09-28: a device spawns where the viewport is centred, not the outline's top right)", () => {
  it("is the centre point itself, snapped to the grid, when nothing already on the floor is near it", () => {
    const f = bareFloor([[0, 0], [2000, 0], [2000, 2000], [0, 2000]]);
    expect(spawnInView(f, [503, 507])).toEqual([500, 510]);
    expect(spawnInView(f, [503, 507], 5)).toEqual([505, 505]);
  });

  it("nudges right in 40 cm steps until clear of a point already on the floor within 20 cm, and only then", () => {
    const f = bareFloor([[0, 0], [2000, 0], [2000, 2000], [0, 2000]]);
    f.devices = [{ id: "d0", name: "Lamp", type: "light", entity: "light.x", x: 500, y: 500 }];
    expect(spawnInView(f, [510, 500])).toEqual([550, 500]); // 510 is within 20 cm of the device, one 40 cm step clears it
    expect(spawnInView(f, [800, 500])).toEqual([800, 500]); // far enough away already: no nudge
  });

  it("reads every point on the floor, not only devices — a wall corner nudges it too", () => {
    const f = bareFloor([[0, 0], [2000, 0], [2000, 2000], [0, 2000]]);
    f.walls = [{ id: "w1", a: [500, 500], b: [700, 500], kind: "wall" }];
    expect(spawnInView(f, [505, 505])).toEqual([550, 510]);
  });

  it("does not change the floor", () => {
    const f = ground(), copy = structuredClone(f);
    spawnInView(f, [400, 300]);
    expect(f).toEqual(copy);
  });
});

describe("snapRoomTo", () => {
  it("moves a room 3 cm off its place back onto the neighbour's corner, and shares the edge", () => {
    const f = ground(), orig = structuredClone(f);
    f.rooms[0].pts = f.rooms[0].pts.map((p): Pt => [p[0] + 3, p[1] - 2]);
    const g = snapRoomTo(f, 0, 14);
    expect(g.rooms[0].pts).toEqual(orig.rooms[0].pts);
    expect(g.rooms[0].pts[1]).toEqual(g.rooms[1].pts[0]);
  });
  it("uses the closest corner pair, not the first in range", () => {
    const f = ground(), orig = structuredClone(f);
    f.rooms[0].pts = f.rooms[0].pts.map((p): Pt => [p[0] + 4, p[1]]);
    expect(snapRoomTo(f, 0, 14).rooms[0].pts).toEqual(orig.rooms[0].pts);
  });
  it("changes nothing when no corner is in range, or for a zone", () => {
    const f = ground();
    f.rooms[0].pts = f.rooms[0].pts.map((p): Pt => [p[0] + 300, p[1] + 300]);
    expect(snapRoomTo(f, 0, 14)).toBe(f);
    const z = ground(), zi = z.rooms.findIndex((r) => r.kind === "zone");
    z.rooms[zi].pts = z.rooms[zi].pts.map((p): Pt => [p[0] + 3, p[1]]);
    expect(snapRoomTo(z, zi, 14)).toBe(z);
  });
});

describe("rotateSegment", () => {
  it("turns a horizontal segment 90 degrees about its midpoint", () => {
    expect(rotateSegment([100, 200], [300, 200], 90)).toEqual({ a: [200, 100], b: [200, 300] });
  });
  it("keeps the midpoint and the length, rounded to 1 cm", () => {
    const r = rotateSegment([0, 0], [100, 0], 30);
    expect(r.a).toEqual([7, -25]);
    expect(r.b).toEqual([93, 25]);
    expect([(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2]).toEqual([50, 0]);
    expect(Math.abs(Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) - 100)).toBeLessThanOrEqual(1); // rounding to 1 cm costs at most 1 cm
  });
  it("360 degrees gives the segment back, and 0 changes nothing", () => {
    expect(rotateSegment([10, 20], [110, 20], 360)).toEqual({ a: [10, 20], b: [110, 20] });
    expect(rotateSegment([10, 20], [110, 20], 0)).toEqual({ a: [10, 20], b: [110, 20] });
  });
  it("a segment of zero length stays a point", () => {
    expect(rotateSegment([5, 5], [5, 5], 77)).toEqual({ a: [5, 5], b: [5, 5] });
  });
});

describe("pivotOnArc (S4.9)", () => {
  it("puts the point on the circle around the pivot, at the given radius, towards the pointer", () => {
    expect(pivotOnArc([0, 0], [100, 0], 50)).toEqual([50, 0]); // pointer straight out: lands at that distance
    expect(pivotOnArc([0, 0], [0, 200], 50)).toEqual([0, 50]);
  });
  it("keeps the exact radius even when the pointer is not on the circle", () => {
    const p = pivotOnArc([0, 0], [30, 40], 100); // 30-40-50 triangle, same direction, radius 100
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(100, 6);
    expect(p[0] / p[1]).toBeCloseTo(30 / 40, 6); // same direction as the pointer
  });
  it("a pointer exactly on the pivot keeps the previous point's direction", () => {
    expect(pivotOnArc([10, 10], [10, 10], 50, [110, 10])).toEqual([60, 10]); // falls back to the old direction (right)
  });
  it("rounds to the whole cm", () => {
    const p = pivotOnArc([0, 0], [1, 1], 100);
    expect(p[0]).toBe(Math.round(p[0]));
    expect(p[1]).toBe(Math.round(p[1]));
  });
});

describe("stairs constructors (S1.25)", () => {
  it("stairsAt keeps its 100 x 300 flight and adds the straight defaults", () => {
    expect(stairsAt([500, 400])).toEqual({ name: "Stairs", pts: [[450, 250], [550, 250], [550, 550], [450, 550]], shape: "straight", steps: 8, rot: 0 });
  });
  it("roundStairs is a 24-gon on the outer circle with a default inner of 0.3 of dia", () => {
    const t = roundStairs([500, 400], 200);
    expect(t).toMatchObject({ shape: "round", dia: 200, inner: 60, steps: 10, rot: 0 });
    expect(t.pts).toHaveLength(24);
    for (const p of t.pts) expect(Math.abs(Math.hypot(p[0] - 500, p[1] - 400) - 100)).toBeLessThan(1);
  });
  it("takes an inner of its own", () => expect(roundStairs([0, 0], 200, 80).inner).toBe(80));
});

describe("gridRound (S1.34)", () => {
  it.each([[5, 503, 505], [10, 503, 500], [10, 505, 510], [50, 523, 500], [50, 526, 550], [0, 503.4, 503]])(
    "grid %i rounds %f to %i", (g, n, want) => { expect(gridRound(n, g)).toBe(want); });
  it("stairsAt and squareAt put their corners on the chosen grid", () => {
    expect(stairsAt([503, 397], 10).pts[0]).toEqual([450, 250]);
    expect(stairsAt([503, 397], 50).pts[0]).toEqual([450, 250]);
    expect(stairsAt([503, 397], 5).pts[0]).toEqual([455, 245]);
    expect(stairsAt([503, 397], 0).pts[0]).toEqual([453, 247]);
    expect(squareAt([503, 397], 50)[0]).toEqual([400, 300]);
  });
});

describe("closedLoop (S1.48)", () => {
  const wall = (id: string, a: Pt, b: Pt) => ({ id, a, b, kind: "wall" as const });
  const sq = () => { const f = ground(); f.walls = [wall("w1", [1000, 0], [1200, 0]), wall("w2", [1200, 0], [1200, 100]), wall("w3", [1200, 100], [1000, 100]), wall("w4", [1000, 100], [1000, 0])]; return f; };
  it("finds the ring through the wall just added, in order", () => {
    const l = closedLoop(sq(), 3)!;
    expect(l.walls.sort()).toEqual([0, 1, 2, 3]);
    expect(l.pts).toHaveLength(4);
  });
  it("is null while one side is missing", () => {
    const f = sq(); f.walls.pop();
    expect(closedLoop(f, 2)).toBeNull();
  });
  it("takes ends a little apart as one point, not ends far apart", () => {
    const f = sq(); f.walls[3].b = [1001, 1];
    expect(closedLoop(f, 3, 2)).not.toBeNull();
    f.walls[3].b = [1010, 10];
    expect(closedLoop(f, 3, 2)).toBeNull();
  });
  it("two squares sharing a wall give the ring through the wall asked for, not both", () => {
    const f = sq();
    f.walls.push(wall("w5", [1200, 0], [1400, 0]), wall("w6", [1400, 0], [1400, 100]), wall("w7", [1400, 100], [1200, 100]), wall("w8", [1200, 100], [1200, 0]));
    const l = closedLoop(f, 7)!;
    expect(l.walls.length).toBe(4);
  });
  it("the same wall drawn three times is no ring", () => {
    const f = ground(); f.walls = [wall("a", [0, 0], [100, 0]), wall("b", [0, 0], [100, 0]), wall("c", [100, 0], [0, 0])];
    expect(closedLoop(f, 2)).toBeNull();
  });
  it("with `through`, only a ring that passes that point counts", () => {
    const f = sq(); f.walls.push(wall("w5", [1200, 100], [1300, 100]), wall("w6", [1300, 100], [1200, 0])); // a triangle (1200,0),(1200,100),(1300,100) on the square's side
    expect(closedLoop(f, 5)!.walls).toHaveLength(3);
    expect(closedLoop(f, 5, 2, [5000, 5000])).toBeNull();
    expect(closedLoop(f, 5, 2, [1300, 100])!.walls).toHaveLength(3);
  });
  it("a triangle counts, two walls do not", () => {
    const f = ground(); f.walls = [wall("a", [0, 0], [100, 0]), wall("b", [100, 0], [0, 0])];
    expect(closedLoop(f, 1)).toBeNull();
    f.walls = [wall("a", [0, 0], [100, 0]), wall("b", [100, 0], [50, 80]), wall("c", [50, 80], [0, 0])];
    expect(closedLoop(f, 2)!.walls).toHaveLength(3);
  });
});

describe("scaleFurniture (S1.51)", () => {
  const CORNERS: Corner[] = ["nw", "ne", "se", "sw"];
  const opposite: Record<Corner, Corner> = { nw: "se", ne: "sw", se: "nw", sw: "ne" };
  const piece = (rot = 0): Furniture => ({ id: "f", symbol: "sofa", x: 500, y: 500, rot, w: 200, h: 100 });
  /** The world position of one corner of `m`'s box (its own frame, turned by `rot`). */
  const worldCorner = (m: Furniture, c: Corner): Pt => {
    const sx = c === "ne" || c === "se" ? 1 : -1, sy = c === "se" || c === "sw" ? 1 : -1;
    const lx = (sx * m.w) / 2, ly = (sy * m.h) / 2, r = (m.rot * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
    return [m.x + lx * cos - ly * sin, m.y + lx * sin + ly * cos];
  };
  const d = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

  it.each([0, 30, 90] as const)("at rot %d: each corner moves the centre by half the change and leaves the opposite corner within 0.01 cm", (rot) => {
    const m = piece(rot);
    for (const c of CORNERS) {
      const before = worldCorner(m, c), opp = worldCorner(m, opposite[c]);
      const to: Pt = [before[0] + 30, before[1] + 20]; // drag outward: well inside the 5..2000 cm bounds
      const next = scaleFurniture(m, c, to);
      expect(d(worldCorner(next, opposite[c]), opp)).toBeLessThan(0.01);
      const wantCentre: Pt = [m.x + (to[0] - before[0]) / 2, m.y + (to[1] - before[1]) / 2];
      expect(d([next.x, next.y], wantCentre)).toBeLessThan(0.05);
    }
  });

  it("Shift keeps the width/height ratio the piece had when the drag started", () => {
    const m = piece(0); // 200 x 100, ratio 0.5
    const next = scaleFurniture(m, "se", [900, 560], { shift: true }); // a very wide, barely taller target
    expect(next.h / next.w).toBeCloseTo(m.h / m.w, 2);
  });

  it("clamps hold at both ends: too small stops at 5 cm, too big stops at 2000 cm", () => {
    const m = piece(0);
    const shrunk = scaleFurniture(m, "se", [601, 501]); // 1 cm past the centre on each axis: would be near 0
    expect(shrunk.w).toBeGreaterThanOrEqual(5);
    expect(shrunk.h).toBeGreaterThanOrEqual(5);
    const past = scaleFurniture(m, "se", [-100, 500]); // dragged well past the opposite corner: must clamp, never flip negative
    expect(past.w).toBe(5);
    const grown = scaleFurniture(m, "se", [50000, 50000]);
    expect(grown.w).toBe(2000);
    expect(grown.h).toBe(2000);
  });

  it("a tree at rot 45 scales along its own axes, not the screen's", () => {
    const m = piece(45);
    const before = worldCorner(m, "se"), opp = worldCorner(m, "nw");
    const to: Pt = [before[0] + 10, before[1] + 10]; // moved along the screen diagonal, not the piece's local axes
    const next = scaleFurniture(m, "se", to);
    expect(d(worldCorner(next, "nw"), opp)).toBeLessThan(0.01); // the opposite corner still doesn't move
    expect(next.w).not.toBe(m.w); // yet the box did resize: the drag was decomposed onto the piece's own frame
  });
});


// Diego, 2026-10-07: with a room selected, a new furniture, object, device, door or zone lands in the middle of that room.
import { roomMiddle as middleOf } from "../../src/editor/ops";
describe("roomMiddle", () => {
  const room = (pts: [number, number][], kind = "room") => ({ id: "r", name: "R", area: "", kind, pts, wk: pts.map(() => "wall") });
  const floorOf = (...rooms: unknown[]) => ({ rooms } as never);
  it("is the middle of the selected room, on the grid", () => {
    expect(middleOf(floorOf(room([[0, 0], [100, 0], [100, 100], [0, 100]]), room([[300, 40], [700, 40], [700, 240], [300, 240]])), { t: "room", i: 1 }, 10)).toEqual([500, 140]);
  });
  it("is null with nothing, a non-room, a missing room or a ring too short selected", () => {
    const f = floorOf(room([[0, 0], [10, 0]]));
    expect(middleOf(f, null, 10)).toBeNull();
    expect(middleOf(f, { t: "dev", i: 0 } as never, 10)).toBeNull();
    expect(middleOf(f, { t: "room", i: 5 }, 10)).toBeNull();
    expect(middleOf(f, { t: "room", i: 0 }, 10)).toBeNull();
  });
  it("stays inside an L-shaped room whose average point is outside", () => {
    const l = room([[0, 0], [400, 0], [400, 100], [100, 100], [100, 400], [0, 400]]);
    const m = middleOf(floorOf(l), { t: "room", i: 0 }, 10)!;
    expect(m[0] >= 0 && m[0] <= 400 && m[1] >= 0 && m[1] <= 400 && (m[0] <= 100 || m[1] <= 100)).toBe(true);
  });
});

describe("S18.10 furnitureNear: a small piece is grabbed from a padded box", () => {
  const piece = (o: Partial<Furniture>): Furniture => ({ id: "f", symbol: "tv", x: 500, y: 300, rot: 0, w: 120, h: 10, ...o });
  const floor = (...m: Furniture[]): Floor => ({ ...bareFloor([[0, 0], [1000, 0], [1000, 600], [0, 600]]), furniture: m });
  it("finds a thin tv 6 screen px below its edge, not 30", () => {
    const f = floor(piece({}));
    expect(furnitureNear(f, [500, 305 + 6], 1)).toBe(0);
    expect(furnitureNear(f, [500, 305 + 30], 1)).toBeNull();
  });
  it("pads in px, so zooming out grows the box in cm", () => {
    expect(furnitureNear(floor(piece({})), [500, 305 + 20], 0.5)).toBe(0);
  });
  it("turns with the piece", () => {
    const f = floor(piece({ rot: 90 })); // 10 wide, 120 tall on the plan
    expect(furnitureNear(f, [505 + 6, 300], 1)).toBe(0);
    expect(furnitureNear(f, [500, 305 + 6 + 60], 1)).toBeNull();
  });
  // Finding 4: 90 degrees swaps w and h, which a flipped rotation sign does too, so it cannot tell. 30 degrees can: the long axis
  // points down-right (cos 30, sin 30), and a sign error would read the same point as far off the axis.
  it("turns with the piece at 30 degrees: a point on the long axis is found, one past its end or off the axis is not", () => {
    const f = floor(piece({ rot: 30 })), along = (d: number, side = 0): [number, number] => [500 + d * Math.cos(Math.PI / 6) - side * Math.sin(Math.PI / 6), 300 + d * Math.sin(Math.PI / 6) + side * Math.cos(Math.PI / 6)];
    expect(furnitureNear(f, along(50), 1)).toBe(0);
    expect(furnitureNear(f, along(-50), 1)).toBe(0);
    expect(furnitureNear(f, along(0, 11), 1)).toBe(0); // 6 px outside the 10 cm depth, inside the pad
    expect(furnitureNear(f, along(75), 1)).toBeNull(); // past the end (60 + 8)
    expect(furnitureNear(f, along(0, 30), 1)).toBeNull();
  });
  it("only a tv, a speaker or a computer is padded: a toilet, a sink or a shower is left to the real hit", () => {
    for (const symbol of ["toilet", "sink", "shower", "bathtub", "chair", "table", "sofa", "bed", "cabinet", "car", "tree", "patio-wood", "patio-concrete"] as const)
      expect(furnitureNear(floor(piece({ symbol, w: 20, h: 20 })), [500, 300 + 10 + 6], 1), symbol).toBeNull();
    for (const symbol of ["tv", "speaker", "computer"] as const)
      expect(furnitureNear(floor(piece({ symbol, w: 20, h: 20 })), [500, 300 + 10 + 6], 1), symbol).toBe(0);
  });
  it("leaves a big piece to the real hit: no padding", () => {
    expect(furnitureNear(floor(piece({ symbol: "sofa", w: 200, h: 90 })), [500, 345 + 6], 1)).toBeNull();
  });
  it("takes the topmost of two small pieces", () => {
    expect(furnitureNear(floor(piece({}), piece({ symbol: "speaker", w: 25, h: 25, y: 308 })), [500, 305], 1)).toBe(1);
  });
});
