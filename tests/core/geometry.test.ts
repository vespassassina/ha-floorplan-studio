import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Floor, Pt } from "../../src/core/schema";
import { dist, polys, nearestEdge, snapPoint, stitch, insertPoint, removePoint, movePoints, edgeRooms, toggleWall, mergeCorners } from "../../src/core/geometry";

// Two rooms side by side sharing the edge x=100, inside a 200x100 outline.
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (id: string, pts: Pt[]) => ({ id, name: id, area: id, label: "", kind: "room" as const, pts, w: pts.map(() => true) });
const floor = (): Floor => ({
  ...(structuredClone(demo.floors.ground) as unknown as Floor),
  outline: rect(0, 0, 200, 100),
  rooms: [room("a", rect(0, 0, 100, 100)), room("b", rect(100, 0, 200, 100))],
  stairs: [], doors: [], walls: [], openings: [], extras: [], devices: [], furniture: [],
});
const opts = (o: Partial<Parameters<typeof snapPoint>[2]> = {}) => ({ threshold: 10, grid: 5, exclude: [] as Pt[], neighbours: [] as Pt[], ...o });

describe("dist and polys", () => {
  it("measures distance", () => expect(dist([0, 0], [3, 4])).toBe(5));
  it("lists outline, rooms and stairs with stable ids", () => {
    const f = floor();
    f.stairs = [{ id: "st", name: "S", pts: rect(10, 10, 20, 20) }];
    expect(polys(f).map((p) => p.id)).toEqual(["o", "r0", "r1", "s0"]);
    expect(polys(f)[1].room).toBe(f.rooms[0]);
  });
});

describe("nearestEdge", () => {
  it("finds the closest edge within maxd", () => {
    const e = nearestEdge(floor(), [50, 4], 10)!;
    expect(e.q).toEqual([50, 0]);
    expect(e.d).toBe(4);
    expect(e.u).toEqual([1, 0]);
  });
  it("returns null when nothing is close enough", () => expect(nearestEdge(floor(), [50, 50], 10)).toBeNull());
});

describe("snapPoint", () => {
  it("snaps to a corner and wins over an edge", () => {
    expect(snapPoint(floor(), [103, 4], opts())).toEqual([100, 0]);
  });
  it("snaps onto an edge as a T, rounded to whole cm", () => {
    expect(snapPoint(floor(), [46.6, 4], opts())).toEqual([47, 0]);
  });
  it("ignores corners and edges of the moved group", () => {
    const f = floor();
    expect(snapPoint(f, [103, 4], opts({ exclude: [[100, 0], [100, 100]] }))).not.toEqual([100, 0]);
  });
  it("aligns to a neighbour on one axis, then grid on the other", () => {
    expect(snapPoint(floor(), [63, 47], opts({ neighbours: [[60, 30]] }))).toEqual([60, 45]);
  });
  it("with threshold 0 returns the grid-rounded input", () => {
    expect(snapPoint(floor(), [102, 3], opts({ threshold: 0 }))).toEqual([100, 5]);
  });
  it("with grid 0 leaves the point alone when nothing snaps", () => {
    expect(snapPoint(floor(), [55, 55], opts({ grid: 0 }))).toEqual([55, 55]);
  });
});

describe("stitch, insertPoint, removePoint", () => {
  it("inserts a point on an edge the point lies on, exactly once, keeping w", () => {
    const f = floor();
    f.rooms[0].w = [true, false, true, true];
    f.rooms.push(room("c", [[50, 100], [60, 130], [40, 130]]));
    const g = stitch(f, [50, 100]);
    expect(g.rooms[0].pts).toEqual([[0, 0], [100, 0], [100, 100], [50, 100], [0, 100]]);
    expect(g.rooms[0].w).toEqual([true, false, true, true, true]);
    expect(g.rooms[2].pts).toHaveLength(3);
    expect(f.rooms[0].pts).toHaveLength(4);
  });
  it("does not touch edges within 1% of an end, but does just beyond", () => {
    expect(stitch(floor(), [0.5, 0]).rooms[0].pts).toHaveLength(4);
    expect(stitch(floor(), [3, 0]).rooms[0].pts).toHaveLength(5);
  });
  it("insertPoint copies the wall flag of the edge it splits", () => {
    const f = floor();
    f.rooms[0].w = [false, true, true, true];
    const g = insertPoint(f, "r0", 0, [50, 0]);
    expect(g.rooms[0].w).toEqual([false, false, true, true, true]);
  });
  it("removePoint drops the point and its flag", () => {
    const g = removePoint(floor(), "r0", 1);
    expect(g.rooms[0].pts).toEqual([[0, 0], [100, 100], [0, 100]]);
    expect(g.rooms[0].w).toHaveLength(3);
  });
  it("removePoint refuses to go below 3 points", () => {
    const f = floor();
    f.rooms[0] = room("a", [[0, 0], [10, 0], [0, 10]]);
    expect(removePoint(f, "r0", 0)).toBe(f);
  });
});

describe("movePoints", () => {
  it("moves every coincident point (within 2 cm)", () => {
    const g = movePoints(floor(), [100, 0], [110, 5], false);
    expect(g.rooms[0].pts[1]).toEqual([110, 5]);
    expect(g.rooms[1].pts[0]).toEqual([110, 5]);
    expect(g.outline[1]).toEqual([200, 0]);
  });
  it("with detach moves one point only", () => {
    const g = movePoints(floor(), [100, 0], [110, 5], true, { poly: "r0", i: 1 });
    expect(g.rooms[0].pts[1]).toEqual([110, 5]);
    expect(g.rooms[1].pts[0]).toEqual([100, 0]);
  });
  it("does not mutate its input", () => {
    const f = floor();
    movePoints(f, [100, 0], [110, 5], false);
    expect(f.rooms[0].pts[1]).toEqual([100, 0]);
  });
});

describe("edgeRooms and toggleWall", () => {
  it("finds both rooms on a shared edge", () => {
    const f = floor();
    const e = edgeRooms(f, "r0", 1);
    expect(e.map((x) => x.room.id).sort()).toEqual(["a", "b"]);
  });
  it("toggleWall sets every matching room edge to the same new value", () => {
    const f = floor();
    f.rooms[0].w[1] = true;
    f.rooms[1].w[3] = false;
    const g = toggleWall(f, "r0", 1);
    expect(g.rooms[0].w[1]).toBe(false);
    expect(g.rooms[1].w[3]).toBe(false);
    const h = toggleWall(g, "r0", 1);
    expect(h.rooms[0].w[1]).toBe(true);
    expect(h.rooms[1].w[3]).toBe(true);
  });
});

describe("mergeCorners", () => {
  it("pulls a corner 20 cm from an outline corner onto it (tol 25)", () => {
    const f = floor();
    f.rooms[0].pts[2] = [180, 90];
    f.rooms[1].pts[2] = [200, 100];
    const g = mergeCorners(f, 25);
    expect(g.rooms[0].pts[2]).toEqual([200, 100]);
  });
  it("averages corners that are not on the outline", () => {
    const f = floor();
    f.rooms[0].pts[1] = [100, 10];
    f.rooms[1].pts[0] = [110, 10];
    const g = mergeCorners(f, 25);
    expect(g.rooms[0].pts[1]).toEqual(g.rooms[1].pts[0]);
    expect(g.rooms[0].pts[1]).toEqual([105, 10]);
  });
  it("drops consecutive equal corners and their wall flags", () => {
    const f = floor();
    f.rooms[0].pts = [[0, 0], [100, 0], [105, 0], [100, 100], [0, 100]];
    f.rooms[0].w = [true, true, true, true, true];
    const g = mergeCorners(f, 25);
    expect(g.rooms[0].pts.length).toBe(g.rooms[0].w.length);
    expect(g.rooms[0].pts.length).toBeLessThan(5);
  });
});
