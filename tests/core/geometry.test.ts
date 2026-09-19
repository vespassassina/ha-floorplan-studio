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

describe("zones do not take part in snapping, stitching or merging", () => {
  const zone = (id: string, pts: Pt[]) => ({ ...room(id, pts), kind: "zone" as const, w: pts.map(() => false) });
  // an off-grid zone inside room a, so a corner snap onto it would be visible
  const withZone = (): Floor => {
    const f = floor();
    f.rooms.push(zone("z", [[37, 53], [77, 53], [77, 83], [37, 83]]));
    return f;
  };

  it("polys still lists a zone, id r<i>, so its corners drag", () => {
    const f = withZone();
    expect(polys(f).map((p) => p.id)).toEqual(["o", "r0", "r1", "r2"]);
    expect(polys(f)[3].room?.kind).toBe("zone");
  });
  it("snapPoint does not snap another polygon's point to a zone corner", () => {
    // 3 cm from the zone corner (37, 53): without the rule it returns the corner, with it the grid point
    expect(snapPoint(withZone(), [40, 50], opts())).toEqual([40, 50]);
  });
  it("snapPoint does not put a point as a T on a zone edge", () => {
    // 3 cm above the zone edge y=53 between x=37 and x=77
    expect(snapPoint(withZone(), [60, 50], opts())).toEqual([60, 50]);
  });
  it("a zone corner still snaps to a room corner", () => {
    expect(snapPoint(withZone(), [103, 4], opts({ exclude: [[37, 53]] }))).toEqual([100, 0]);
  });
  it("stitch does not insert a room corner into a zone edge", () => {
    const g = stitch(withZone(), [50, 53]);
    expect(g.rooms[2].pts).toHaveLength(4);
  });
  it("stitch does not insert a zone corner into a room edge or the outline", () => {
    const f = withZone();
    f.rooms[2].pts = [[50, 100], [70, 100], [70, 90], [50, 90]]; // corner (50, 100) lies on the edge of room a and the outline? (a: y=100)
    const g = stitch(f, [50, 100]);
    expect(g.rooms[0].pts).toHaveLength(4);
    expect(g.rooms[0].w).toHaveLength(4);
    expect(g.rooms[2].pts).toHaveLength(4);
  });
  it("stitch still stitches a room corner that is not a zone corner", () => {
    const f = withZone();
    f.rooms.push(room("c", [[50, 100], [60, 130], [40, 130]]));
    expect(stitch(f, [50, 100]).rooms[0].pts).toHaveLength(5);
  });
  it("mergeCorners leaves a zone corner 10 cm from a room corner where it is", () => {
    const f = floor();
    f.rooms.push(zone("z", [[110, 10], [150, 10], [150, 50], [110, 50]]));
    const g = mergeCorners(f, 25);
    expect(g.rooms[2].pts).toEqual([[110, 10], [150, 10], [150, 50], [110, 50]]);
    expect(g.rooms[1].pts[0]).toEqual([100, 0]);
  });
  it("movePoints with a zone corner named moves only the zone corner; a room corner never drags a zone corner", () => {
    const f = floor();
    f.rooms.push(zone("z", [[100, 0], [150, 0], [150, 50], [100, 50]]));
    const a = movePoints(f, [100, 0], [110, 5], false, { poly: "r2", i: 0 });
    expect(a.rooms[2].pts[0]).toEqual([110, 5]);
    expect(a.rooms[0].pts[1]).toEqual([100, 0]);
    expect(a.rooms[1].pts[0]).toEqual([100, 0]);
    const b = movePoints(f, [100, 0], [110, 5], false, { poly: "r0", i: 1 });
    expect(b.rooms[0].pts[1]).toEqual([110, 5]);
    expect(b.rooms[1].pts[0]).toEqual([110, 5]);
    expect(b.rooms[2].pts[0]).toEqual([100, 0]);
  });
});

describe("a zone edge is never a wall (review S1.5, finding 1)", () => {
  const zone = (id: string, pts: Pt[]) => ({ ...room(id, pts), kind: "zone" as const, w: pts.map(() => false) });
  it("toggleWall on a zone polygon returns the floor unchanged", () => {
    const f = floor();
    f.rooms.push(zone("z", rect(20, 20, 60, 60)));
    expect(toggleWall(f, "r2", 0)).toBe(f);
    expect(edgeRooms(f, "r2", 0)).toEqual([]);
  });
  it("toggleWall on a room edge that a zone edge lies on leaves the zone dotted", () => {
    const f = floor();
    f.rooms.push(zone("z", rect(0, 0, 100, 40))); // its top edge is the top edge of room a
    f.rooms[0].w[0] = false; // dotted now, so the toggle sets true: a zone edge would follow
    const g = toggleWall(f, "r0", 0);
    expect(g.rooms[0].w[0]).toBe(true);
    expect(g.rooms[2].w).toEqual([false, false, false, false]);
    expect(edgeRooms(f, "r0", 0).map((h) => h.room.id)).toEqual(["a"]);
  });
});

describe("movePoints without an owner never drags a zone corner (review S1.5, finding 2)", () => {
  const zone = (id: string, pts: Pt[]) => ({ ...room(id, pts), kind: "zone" as const, w: pts.map(() => false) });
  it("a zone corner on a room corner stays when the point is moved with no `only`", () => {
    const f = floor();
    f.rooms.push(zone("z", [[100, 0], [150, 0], [150, 50], [100, 50]]));
    const g = movePoints(f, [100, 0], [110, 5], false);
    expect(g.rooms[0].pts[1]).toEqual([110, 5]);
    expect(g.rooms[1].pts[0]).toEqual([110, 5]);
    expect(g.rooms[2].pts[0]).toEqual([100, 0]);
    expect(g.outline).toEqual(f.outline);
  });
});

describe("nearestEdge and zones (review S1.5, finding 4)", () => {
  const zone = (id: string, pts: Pt[]) => ({ ...room(id, pts), kind: "zone" as const, w: pts.map(() => false) });
  const withZone = () => { const f = floor(); f.rooms.push(zone("z", rect(20, 20, 60, 60))); return f; };
  it("skips a zone edge by default, so a door never attaches to it", () => {
    // 2 cm from the zone edge y=20, 20 cm from the room edge y=0
    const e = nearestEdge(withZone(), [40, 22], 1e9)!;
    expect(e.poly).not.toBe("r2");
    expect(e.q).toEqual([40, 0]);
  });
  it("finds a zone edge when asked, as edge selection does", () => {
    const e = nearestEdge(withZone(), [40, 22], 1e9, { zones: true })!;
    expect([e.poly, e.i, e.q]).toEqual(["r2", 0, [40, 20]]);
  });
  it("a floor with only a zone has no host edge", () => {
    const f = floor();
    f.outline = []; f.rooms = [zone("z", rect(20, 20, 60, 60))];
    expect(nearestEdge(f, [40, 22], 1e9)).toBeNull();
    expect(nearestEdge(f, [40, 22], 1e9, { zones: true })).not.toBeNull();
  });
});
