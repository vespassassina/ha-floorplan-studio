import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Floor, Pt, WallKind } from "../../src/core/schema";
import { dist, polys, nearestEdge, snapPoint, stitch, insertPoint, removePoint, movePoints, edgeRooms, setEdgeKind, mergeCorners } from "../../src/core/geometry";

// Two rooms side by side sharing the edge x=100, inside a 200x100 outline.
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (id: string, pts: Pt[]) => ({ id, name: id, area: id, label: "", kind: "room" as const, pts, wk: pts.map((): WallKind => "wall") });
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
  it("inserts a point on an edge the point lies on, exactly once, keeping wk", () => {
    const f = floor();
    f.rooms[0].wk = ["wall", "boundary", "wall", "wall"];
    f.rooms.push(room("c", [[50, 100], [60, 130], [40, 130]]));
    const g = stitch(f, [50, 100]);
    expect(g.rooms[0].pts).toEqual([[0, 0], [100, 0], [100, 100], [50, 100], [0, 100]]);
    expect(g.rooms[0].wk).toEqual(["wall", "boundary", "wall", "wall", "wall"]);
    expect(g.rooms[2].pts).toHaveLength(3);
    expect(f.rooms[0].pts).toHaveLength(4);
  });
  it("does not touch edges within 1% of an end, but does just beyond", () => {
    expect(stitch(floor(), [0.5, 0]).rooms[0].pts).toHaveLength(4);
    expect(stitch(floor(), [3, 0]).rooms[0].pts).toHaveLength(5);
  });
  it("insertPoint copies the edge kind of the edge it splits", () => {
    const f = floor();
    f.rooms[0].wk = ["fence", "wall", "wall", "wall"];
    const g = insertPoint(f, "r0", 0, [50, 0]);
    expect(g.rooms[0].wk).toEqual(["fence", "fence", "wall", "wall", "wall"]);
  });
  it("removePoint drops the point and its kind", () => {
    const g = removePoint(floor(), "r0", 1);
    expect(g.rooms[0].pts).toEqual([[0, 0], [100, 100], [0, 100]]);
    expect(g.rooms[0].wk).toHaveLength(3);
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

describe("edgeRooms", () => {
  it("finds both rooms on a shared edge", () => {
    const f = floor();
    const e = edgeRooms(f, "r0", 1);
    expect(e.map((x) => x.room.id).sort()).toEqual(["a", "b"]);
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
  it("drops consecutive equal corners and their edge kinds", () => {
    const f = floor();
    f.rooms[0].pts = [[0, 0], [100, 0], [105, 0], [100, 100], [0, 100]];
    f.rooms[0].wk = ["wall", "fence", "wall", "wall", "wall"];
    const g = mergeCorners(f, 25);
    expect(g.rooms[0].pts.length).toBe(g.rooms[0].wk.length);
    expect(g.rooms[0].pts.length).toBeLessThan(5);
  });
});

describe("zones do not take part in snapping, stitching or merging", () => {
  const zone = (id: string, pts: Pt[]) => ({ ...room(id, pts), kind: "zone" as const, wk: pts.map((): WallKind => "boundary") });
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
  it("stitch does not insert a room corner into a zone edge", () => {
    const g = stitch(withZone(), [50, 53]);
    expect(g.rooms[2].pts).toHaveLength(4);
  });
  it("stitch does not insert a zone corner into a room edge or the outline", () => {
    const f = withZone();
    f.rooms[2].pts = [[50, 100], [70, 100], [70, 90], [50, 90]]; // corner (50, 100) lies on the edge of room a and the outline? (a: y=100)
    const g = stitch(f, [50, 100]);
    expect(g.rooms[0].pts).toHaveLength(4);
    expect(g.rooms[0].wk).toHaveLength(4);
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
  const zone = (id: string, pts: Pt[]) => ({ ...room(id, pts), kind: "zone" as const, wk: pts.map((): WallKind => "boundary") });
  it("setEdgeKind on a zone polygon returns the floor unchanged", () => {
    const f = floor();
    f.rooms.push(zone("z", rect(20, 20, 60, 60)));
    expect(setEdgeKind(f, "r2", 0, "fence")).toBe(f);
    expect(edgeRooms(f, "r2", 0)).toEqual([]);
  });
  it("nearestEdge with zones: true prefers the room edge on an exact tie with a zone edge, whichever is listed first", () => {
    for (const zoneFirst of [true, false]) {
      const f = floor();
      const z = zone("z", rect(100, 10, 140, 50)); // its left edge lies on the a / b edge x = 100
      if (zoneFirst) f.rooms.unshift(z); else f.rooms.push(z);
      const hit = nearestEdge(f, [102, 30], 8, { zones: true })!;
      expect(hit.d).toBe(2);
      expect(polys(f).find((P) => P.id === hit.poly)!.room?.kind).toBe("room");
    }
  });
  it("setEdgeKind on a room edge that a zone edge lies on leaves the zone dotted", () => {
    const f = floor();
    f.rooms.push(zone("z", rect(0, 0, 100, 40))); // its top edge is the top edge of room a
    const g = setEdgeKind(f, "r0", 0, "external"); // a zone edge would follow if it were a match
    expect(g.rooms[0].wk[0]).toBe("external");
    expect(g.rooms[2].wk).toEqual(["boundary", "boundary", "boundary", "boundary"]);
    expect(edgeRooms(f, "r0", 0).map((h) => h.room.id)).toEqual(["a"]);
  });
});

describe("movePoints without an owner never drags a zone corner (review S1.5, finding 2)", () => {
  const zone = (id: string, pts: Pt[]) => ({ ...room(id, pts), kind: "zone" as const, wk: pts.map((): WallKind => "boundary") });
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
  const zone = (id: string, pts: Pt[]) => ({ ...room(id, pts), kind: "zone" as const, wk: pts.map((): WallKind => "boundary") });
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

describe("nearestEdge with free walls (review S1.5, finding 6)", () => {
  const withWall = () => { const f = floor(); f.walls = [{ id: "w1", a: [20, 60], b: [80, 60], kind: "fence" }]; return f; };
  it("ignores free walls by default", () => {
    expect(nearestEdge(withWall(), [50, 58], 1e9)!.poly).not.toBe("w");
  });
  it("finds a free wall when asked: foot point, direction, index", () => {
    const e = nearestEdge(withWall(), [50, 58], 1e9, { walls: true })!;
    expect([e.poly, e.i, e.q, e.u, e.d]).toEqual(["w", 0, [50, 60], [1, 0], 2]);
  });
  it("a room edge closer than the wall still wins", () => {
    expect(nearestEdge(withWall(), [50, 3], 1e9, { walls: true })!.poly).not.toBe("w");
  });
  it("clamps to the end of a wall and skips one of no length", () => {
    const f = floor();
    f.walls = [{ id: "w1", a: [20, 60], b: [30, 60], kind: "wall" }, { id: "w2", a: [45, 60], b: [45, 60], kind: "wall" }];
    // room edges are 40+ cm away; the wall end (30, 60) is 15, and the zero-length wall sits right on the point
    const e = nearestEdge(f, [45, 60], 1e9, { walls: true })!;
    expect([e.poly, e.i, e.q, e.d]).toEqual(["w", 0, [30, 60], 15]);
  });
});

describe("setEdgeKind (S1.17)", () => {
  it("writes the kind into both rooms that share the edge and leaves other edges alone", () => {
    const f = floor();
    const g = setEdgeKind(f, "r0", 1, "external");
    expect(g.rooms[0].wk[1]).toBe("external");
    expect(g.rooms[1].wk[3]).toBe("external");
    expect(g.rooms[0].wk.filter((k) => k !== "external")).toHaveLength(3);
    expect(f.rooms[0].wk[1]).toBe("wall"); // input untouched
  });
  it("returns the same floor when no room has the edge, and leaves a zone edge alone", () => {
    const f = floor();
    expect(setEdgeKind(f, "o", 0, "fence")).toBe(f);
    expect(setEdgeKind(f, "r9", 0, "fence")).toBe(f);
    const z = floor();
    z.rooms.push({ ...room("z", [[10, 10], [60, 10], [60, 60], [10, 60]]), kind: "zone" as const, wk: ["boundary", "boundary", "boundary", "boundary"] });
    expect(setEdgeKind(z, "r2", 0, "fence")).toBe(z);
    expect(z.rooms[2].wk).toEqual(["boundary", "boundary", "boundary", "boundary"]);
  });
});
