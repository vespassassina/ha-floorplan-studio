import { describe, expect, it } from "vitest";
import { buildScene, CUT_WALL_HEIGHT, type Solid } from "../../src/core/scene";
import type { Floor } from "../../src/core/schema";
import { lowerWalls, wallBodies, wallZ, HYSTERESIS_CM } from "../../src/card/three/cut";

// Which walls the 3D view lowers, as plain maths (no WebGL). Plan frame: x east, y south, z up, cm.

const house = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const keyOf = (poly: string, index: number) => `${poly}:${index}`;
const N = "o:0", E = "o:1", S = "o:2", W = "o:3"; // the outline's four edges, top first

describe("lowerWalls: cut", () => {
  const bodies = wallBodies(buildScene(house()).solids);
  const none = new Set<string>();

  it("groups the wall pieces of one wall, with its middle, its height and the way it faces", () => {
    expect(bodies.map((b) => b.key).sort()).toEqual([N, E, S, W]);
    const south = bodies.find((b) => b.key === S)!;
    expect(south.mid[0]).toBeCloseTo(300, 0);
    expect(south.mid[1]).toBeCloseTo(500, 0);
    expect(south.h).toBe(250);
    expect(south.faces).toEqual([[0, 1]]);
  });

  it("a camera south of the house lowers the south wall and no other", () => {
    expect([...lowerWalls(bodies, [300, 1500, 2000], "cut", none)]).toEqual([S]);
  });

  it("a camera east of the house lowers the east wall and no other; north-east, two", () => {
    expect([...lowerWalls(bodies, [2500, 250, 1500], "cut", none)]).toEqual([E]);
    expect([...lowerWalls(bodies, [2500, -2000, 1500], "cut", none)].sort()).toEqual([N, E]);
  });

  it("a camera inside the house, or straight over it, lowers nothing: every outside face looks away", () => {
    expect(lowerWalls(bodies, [300, 250, 200], "cut", none).size).toBe(0);
    expect(lowerWalls(bodies, [300, 250, 4000], "cut", none).size).toBe(0);
  });

  it("hysteresis: a camera a few cm past a wall's plane does not lower it, and one that was lowered stays so until it is clearly back", () => {
    const at = (past: number) => [300, 500 + past, 1500] as [number, number, number];
    expect(lowerWalls(bodies, at(HYSTERESIS_CM / 2), "cut", none).has(S)).toBe(false);
    expect(lowerWalls(bodies, at(HYSTERESIS_CM * 2), "cut", none).has(S)).toBe(true);
    const was = new Set([S]);
    expect(lowerWalls(bodies, at(HYSTERESIS_CM / 2), "cut", was).has(S)).toBe(true);
    expect(lowerWalls(bodies, at(-HYSTERESIS_CM / 2), "cut", was).has(S)).toBe(true);
    expect(lowerWalls(bodies, at(-HYSTERESIS_CM * 2), "cut", was).has(S)).toBe(false);
    expect(was.has(S)).toBe(true); // the previous set is not changed
  });

  it("the same camera and the same past give the same answer", () => {
    const a = lowerWalls(bodies, [2500, -2000, 1500], "cut", none), b = lowerWalls(bodies, [2500, -2000, 1500], "cut", none);
    expect([...a].sort()).toEqual([...b].sort());
  });

  it("junk (NaN camera) lowers nothing and does not throw", () => {
    expect(lowerWalls(bodies, [NaN, 0, 0], "cut", none).size).toBe(0);
    expect(lowerWalls([], [0, 0, 0], "cut", none).size).toBe(0);
  });
});

describe("lowerWalls: a wall with a room on both sides", () => {
  const f = house({
    rooms: [{ id: "a", name: "A", kind: "room", pts: [[0, 0], [600, 0], [600, 250], [0, 250]] }, { id: "b", name: "B", kind: "room", pts: [[0, 250], [600, 250], [600, 500], [0, 500]] }] as never,
    walls: [{ id: "w", a: [100, 100], b: [200, 100], kind: "wall" }],
  });
  const bodies = wallBodies(buildScene(f).solids), part = bodies.find((b) => b.faces.length === 2 && b.mid[1] === 250 && b.key.startsWith("r"))!;
  it("is found", () => expect(part).toBeDefined());
  it("is lowered when the camera looks across it from a low angle, from either side", () => {
    expect(lowerWalls(bodies, [300, 1500, 1200], "cut", new Set()).has(part.key)).toBe(true);
    expect(lowerWalls(bodies, [300, -1000, 1200], "cut", new Set()).has(part.key)).toBe(true);
  });
  it("stands when the camera is nearly over it (it hides no floor) and when the camera looks along it", () => {
    expect(lowerWalls(bodies, [300, 1500, 40000], "cut", new Set()).has(part.key)).toBe(false);
    expect(lowerWalls(bodies, [-3000, 250, 1200], "cut", new Set()).has(part.key)).toBe(false);
  });
  it("a camera lower than the wall's top hides everything behind it", () => {
    expect(lowerWalls(bodies, [300, 800, 100], "cut", new Set()).has(part.key)).toBe(true);
  });
  it("a free wall has two sides too", () => {
    const free = bodies.find((b) => b.key === "w:0")!;
    expect(lowerWalls(bodies, [150, 1500, 1200], "cut", new Set()).has(free.key)).toBe(true);
  });
});

describe("lowerWalls: an inner wall seen from behind (the cutaway shot of S12.4)", () => {
  // One wide room in the south, two small ones north of it: the wide room's north edge overlaps both small rooms' south
  // edges only in part, so it stays a wall of its own with one face, pointing north. From the south that is "the far side".
  const f = house({ rooms: [
    { id: "s", name: "S", kind: "room", pts: [[0, 250], [600, 250], [600, 500], [0, 500]] },
    { id: "n1", name: "N1", kind: "room", pts: [[0, 0], [300, 0], [300, 250], [0, 250]] },
    { id: "n2", name: "N2", kind: "room", pts: [[300, 0], [600, 0], [600, 250], [300, 250]] },
  ] as never });
  const bodies = wallBodies(buildScene(f).solids).filter((b) => !b.key.startsWith("o:"));
  it("every inner wall that crosses the middle is lowered from a low camera in the south, whichever way it faces", () => {
    const mid = bodies.filter((b) => b.mid[1] === 250 && b.mid[0] > 100);
    expect(mid.length).toBeGreaterThan(0);
    const out = lowerWalls(bodies, [300, 1500, 1200], "cut", new Set());
    for (const b of mid) expect(out.has(b.key), b.key).toBe(true);
  });
  it("the outline's far wall still stands", () => {
    const all = wallBodies(buildScene(f).solids);
    expect(lowerWalls(all, [300, 1500, 1200], "cut", new Set()).has(N)).toBe(false);
  });
});

describe("lowerWalls: full and low", () => {
  const bodies = wallBodies(buildScene(house()).solids);
  it("full lowers none, low lowers every wall, wherever the camera is", () => {
    for (const cam of [[300, 1500, 1500], [300, 250, 100], [NaN, 0, 0]] as [number, number, number][]) {
      expect(lowerWalls(bodies, cam, "full", new Set([S])).size).toBe(0);
      expect(lowerWalls(bodies, cam, "low", new Set()).size).toBe(4);
    }
  });
});

describe("wallZ: what stands of each solid when its wall is lowered", () => {
  const sc = buildScene(house({ doors: [{ id: "d", a: [100, 0], b: [200, 0], kind: "window", sensors: [] }, { id: "e", a: [300, 500], b: [390, 500], kind: "door", sensors: [] }] as never }));
  const low = new Set([N, S]), high = new Set<string>();
  const wallSolids = (key: string) => sc.solids.filter((s) => s.kind === "wall" && keyOf(s.ref.poly!, s.ref.index!) === key);
  const range = (s: Solid) => (s.shape.type === "prism" ? [s.shape.z0, s.shape.z1] : []);

  it("a wall that is not lowered keeps its own range", () => {
    for (const s of sc.solids) expect(wallZ(s, high, CUT_WALL_HEIGHT)).toEqual(range(s));
  });
  it("a lowered wall stops at the cut height: the block under a sill is cut, a header over a door is gone, the gap has nothing", () => {
    const north = wallSolids(N);
    const header = north.find((s) => range(s)[0] > 100)!, plain = wallSolids(E)[0];
    expect(wallZ(header, low, CUT_WALL_HEIGHT)).toBeNull();
    expect(wallZ(plain, low, CUT_WALL_HEIGHT)).toEqual(range(plain)); // east is not lowered
    const southFull = wallSolids(S).find((s) => range(s)[0] === 0 && range(s)[1] === 250)!;
    expect(wallZ(southFull, low, CUT_WALL_HEIGHT)).toEqual([0, CUT_WALL_HEIGHT]);
  });
  it("the infill of a lowered wall is cut with it: glass above the cut is gone, a door's leaf is cut to the height", () => {
    const glass = sc.solids.find((s) => s.kind === "opening" && s.tag === "glass")!, leaf = sc.solids.find((s) => s.kind === "opening" && s.tag === "door-leaf")!;
    expect(range(glass)[0]).toBeGreaterThan(CUT_WALL_HEIGHT);
    expect(wallZ(glass, low, CUT_WALL_HEIGHT)).toBeNull();
    expect(wallZ(leaf, low, CUT_WALL_HEIGHT)).toEqual([0, CUT_WALL_HEIGHT]);
    expect(wallZ(glass, high, CUT_WALL_HEIGHT)).toEqual(range(glass));
  });
  it("a wall already lower than the cut height is not raised", () => {
    const short = buildScene(house({ walls: [{ id: "k", a: [10, 10], b: [100, 10], kind: "wall", height: 20 }] })).solids.find((s) => s.ref.poly === "w")!;
    expect(wallZ(short, new Set(["w:0"]), CUT_WALL_HEIGHT)).toEqual([0, 20]);
  });
  it("anything that is not a wall or an opening is never touched", () => {
    const f = buildScene(house({ furniture: [{ id: "t", symbol: "table", x: 300, y: 250, rot: 0, w: 80, h: 80 }] as never })).solids.find((s) => s.kind === "furniture")!;
    expect(wallZ(f, new Set([N, S, E, W]), CUT_WALL_HEIGHT)).toEqual(range(f));
  });
});
