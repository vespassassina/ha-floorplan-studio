import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout, Pt } from "../../src/core/schema";
import { closedLoop, gridRound, roundStairs, rotateSegment, snapRoomTo, spawnPoint, squareAt, stairsAt } from "../../src/editor/ops";

const ground = () => structuredClone((demo as unknown as Layout).floors.ground);
const FALLBACK: Pt = [123, 457];

describe("spawnPoint", () => {
  it("is right of the outline's bounding box, at its top, on the grid (10 cm by default)", () => {
    const f = ground();
    f.outline = [[10, 20], [803, 20], [803, 604], [10, 604]]; // max x 803, min y 20: asymmetric on purpose
    expect(spawnPoint(f, FALLBACK)).toEqual([950, 20]); // 803 + 150 = 953 rounds to 950 (S1.34: it was 955 on the 5 cm grid)
    expect(spawnPoint(f, FALLBACK, 5)).toEqual([955, 20]);
    expect(spawnPoint(f, FALLBACK, 50)).toEqual([950, 0]);
    expect(spawnPoint(f, FALLBACK, 0)).toEqual([953, 20]);
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
  it("a triangle counts, two walls do not", () => {
    const f = ground(); f.walls = [wall("a", [0, 0], [100, 0]), wall("b", [100, 0], [0, 0])];
    expect(closedLoop(f, 1)).toBeNull();
    f.walls = [wall("a", [0, 0], [100, 0]), wall("b", [100, 0], [50, 80]), wall("c", [50, 80], [0, 0])];
    expect(closedLoop(f, 2)!.walls).toHaveLength(3);
  });
});
