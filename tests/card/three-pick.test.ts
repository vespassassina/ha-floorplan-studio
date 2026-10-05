import { describe, expect, it } from "vitest";
import { buildScene, type Solid } from "../../src/core/scene";
import type { Floor } from "../../src/core/schema";
import { Picker, MARKER_R, PROXY_R, type Ray } from "../../src/card/three/pick";
import { wallBodies, lowerWalls, wallZ } from "../../src/card/three/cut";

// The ray picker of the 3D view as plain maths, with no WebGL. Plan frame: x east, y south, z up, cm.
// A ray that goes straight down (0, 0, -1) from 1000 cm up at (x, y) is the simplest, and tilted ones follow.

const house = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"],
  rooms: [{ id: "a", name: "A", area: "", kind: "room", pts: [[0, 0], [300, 0], [300, 500], [0, 500]], wk: ["wall", "wall", "wall", "wall"] },
          { id: "b", name: "B", area: "", kind: "room", pts: [[300, 0], [600, 0], [600, 500], [300, 500]], wk: ["wall", "wall", "wall", "wall"] }] as never,
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const down = (x: number, y: number): Ray => ({ o: [x, y, 1000], d: [0, 0, -1] });
/** A ray from `from` through `to`. */
const through = (from: [number, number, number], to: [number, number, number]): Ray => {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], l = Math.hypot(...d);
  return { o: from, d: [d[0] / l, d[1] / l, d[2] / l] };
};
const plain = (s: Solid): [number, number] | null => (s.shape.type === "prism" ? [s.shape.z0, s.shape.z1] : null);

describe("Picker: floors", () => {
  const p = new Picker(buildScene(house()).solids);
  it("a ray down into a room picks that room, the other room for the other half", () => {
    expect(p.pick(down(100, 250), plain)).toEqual({ type: "room", index: 0 });
    expect(p.pick(down(450, 250), plain)).toEqual({ type: "room", index: 1 });
  });
  it("a ray beside the house hits nothing", () => {
    expect(p.pick(down(900, 250), plain)).toBeNull();
  });
  it("a tilted ray over the south wall that lands in a room picks it; one that meets the wall's face is a wall", () => {
    // from the south, high: over the 250 cm wall and down onto room A's floor
    expect(p.pick(through([100, 2500, 4000], [100, 300, 0]), plain)).toEqual({ type: "room", index: 0 });
    // from the south, low: into the face of the south wall
    expect(p.pick(through([100, 1500, 120], [100, 500, 120]), plain)).toEqual({ type: "other" });
  });
});

describe("Picker: walls that are lowered are looked over", () => {
  const sc = buildScene(house());
  const p = new Picker(sc.solids), bodies = wallBodies(sc.solids);
  const cam: [number, number, number] = [150, 1800, 700];
  const lowered = lowerWalls(bodies, cam, "cut", new Set());
  const zOf = (s: Solid) => wallZ(s, lowered, 30);
  it("a ray that crosses the south wall at 100 cm hits it when it stands, and lands in the room when it is lowered", () => {
    const ray = through(cam, [150, 250, 0]);
    expect(lowered.has("o:2")).toBe(true);
    expect(p.pick(ray, plain)).toEqual({ type: "other" }); // full height: the wall is in the way
    expect(p.pick(ray, zOf)).toEqual({ type: "room", index: 0 }); // lowered: through to the floor behind it
  });
  it("a far wall stays in the way: a ray into the north wall's inner face is a wall", () => {
    expect(lowered.has("o:0")).toBe(false);
    expect(p.pick(through(cam, [150, 10, 150]), zOf)).toEqual({ type: "other" });
  });
});

describe("Picker: devices", () => {
  const f = house({ devices: [
    { id: "l1", type: "light", x: 100, y: 250, entity: "light.one", z: 200 },
    { id: "h1", type: "heater", x: 450, y: 250, entity: "climate.h", a: [400, 100], b: [500, 100] },
  ] as never });
  const sc = buildScene(f), p = new Picker(sc.solids);
  const point = sc.solids.find((s) => s.kind === "device" && s.shape.type === "point")!;
  const z = point.shape.type === "point" ? point.shape.z : 0;
  it("a ray through the marker's middle picks the device by its index", () => {
    expect(p.pick(down(100, 250), plain)).toEqual({ type: "device", index: 0 });
  });
  it("the hit proxy is bigger than the marker: a miss of 20 cm still picks it, and one of 30 cm falls through to the room", () => {
    expect(MARKER_R).toBeLessThan(PROXY_R);
    expect(p.pick({ o: [100 + 20, 250, z + 500], d: [0, 0, -1] }, plain)).toEqual({ type: "device", index: 0 });
    expect(p.pick({ o: [100 + 30, 250, z + 500], d: [0, 0, -1] }, plain)).toEqual({ type: "room", index: 0 });
  });
  it("a device with a body (a radiator) is picked by the body", () => {
    const body = sc.solids.find((s) => s.kind === "device" && s.shape.type === "prism");
    expect(body).toBeDefined();
    expect(p.pick(down(450, 100), plain)).toEqual({ type: "device", index: 1 });
  });
  it("a device behind a wall is not picked through it", () => {
    expect(p.pick(through([100, 1500, z], [100, 250, z]), plain)).toEqual({ type: "other" });
  });
});

describe("Picker: doors, furniture, appliances", () => {
  const f = house({
    doors: [{ id: "d", a: [100, 500], b: [190, 500], kind: "door", name: "Door", sensors: ["binary_sensor.d"] }] as never,
    furniture: [{ id: "t", symbol: "table", x: 100, y: 250, rot: 0, w: 80, h: 80 }, { id: "o", symbol: "table", x: 800, y: 250, rot: 0, w: 80, h: 80 }] as never,
    unlinked: [{ id: "u", kind: "washer", x: 450, y: 300, rot: 0, w: 60, h: 60, name: "Washer", entities: ["sensor.w"] }] as never,
  });
  const sc = buildScene(f), p = new Picker(sc.solids);
  it("a door's leaf or glass is the door, by its index", () => {
    expect(p.pick(through([145, 1500, 100], [145, 500, 100]), plain)).toEqual({ type: "door", index: 0 });
  });
  it("furniture picks the room under it; furniture on no room is a thing that clears", () => {
    expect(p.pick(down(100, 250), plain)).toEqual({ type: "room", index: 0 });
    expect(p.pick(down(800, 250), plain)).toEqual({ type: "other" });
  });
  it("an unlinked appliance is its own index", () => {
    expect(p.pick(down(450, 300), plain)).toEqual({ type: "unlinked", index: 0 });
  });
});

describe("Picker: a fill is looked through; hostile input", () => {
  it("a hatched fill room is not a pick: the ray goes on to the slab, which is a thing", () => {
    const f = house({ rooms: [{ id: "x", name: "", area: "", kind: "fill", pts: [[0, 0], [600, 0], [600, 500], [0, 500]], wk: ["none", "none", "none", "none"] }] as never });
    expect(new Picker(buildScene(f).solids).pick(down(300, 250), plain)).toEqual({ type: "other" });
  });
  it("junk rays and no solids never throw and hit nothing", () => {
    const p = new Picker(buildScene(house()).solids);
    for (const r of [{ o: [NaN, 0, 0], d: [0, 0, -1] }, { o: [0, 0, 100], d: [0, 0, 0] }, { o: [0, 0, 100], d: [Infinity, 0, 0] }, {} , null, { o: "x", d: 3 }]) {
      expect(() => p.pick(r as never, plain)).not.toThrow();
      expect(p.pick(r as never, plain)).toBeNull();
    }
    expect(new Picker([]).pick(down(0, 0), plain)).toBeNull();
    expect(() => new Picker(null as never)).not.toThrow();
  });
});

describe("Picker: 5000 furniture pieces (spec criterion 10)", () => {
  const f = house({ furniture: Array.from({ length: 5000 }, (_, i) => ({ id: `f${i}`, symbol: "table", x: (i % 100) * 6, y: Math.floor(i / 100) * 10, rot: i % 360, w: 15, h: 15 })) as never });
  const p = new Picker(buildScene(f).solids);
  it("a pick takes well under a tenth of a second, and finds the pieces", () => {
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) p.pick(through([300 + i, 1800, 900], [300 + i, 250, 0]), plain);
    expect(performance.now() - t0).toBeLessThan(1000); // 100 picks in a second: each one a hundredth of a second at worst
    expect(p.pick(down(30, 20), plain)).not.toBeNull();
  });
});

describe("Picker: a room's own sensor and what hides a label (S12.5)", () => {
  const two = (o: Partial<Floor> = {}) => house({ rooms: [{ ...(house().rooms[0] as object), temps: ["sensor.t"] }, house().rooms[1]] as never, devices: [{ id: "t", type: "temp", entity: "sensor.t", name: "T", x: 100, y: 250 }, { id: "u", type: "temp", entity: "sensor.u", name: "U", x: 450, y: 250 }] as never, ...o });
  it("a ray at the attached sensor's ball goes through to the room; the free sensor's ball is hit", () => {
    const scene = buildScene(two()), p = new Picker(scene.solids);
    const z = (scene.solids.find((s) => s.kind === "device" && s.ref.index === 0)!.shape as { z: number }).z;
    expect(p.pick({ o: [100, 250, z + 300], d: [0, 0, -1] }, plain)).toEqual({ type: "room", index: 0 });
    expect(p.pick({ o: [450, 250, z + 300], d: [0, 0, -1] }, plain)).toEqual({ type: "device", index: 1 });
  });
  it("a wall stands in the way of a ray, the floor and a table do not, and a ray that stops short of the wall is clear", () => {
    const p = new Picker(buildScene(house({ furniture: [{ id: "f", symbol: "table", x: 100, y: 250, rot: 0, w: 120, h: 80 }] as never })).solids);
    const from = [-500, 250, 100] as [number, number, number];
    expect(p.blocked(through(from, [100, 250, 10]), 640, plain)).toBe(true); // through the west wall (x=0)
    expect(p.blocked(through(from, [-100, 250, 10]), 420, plain)).toBe(false); // stops before it
    expect(p.blocked(through([100, 900, 3000], [100, 250, 10]), 3300, plain)).toBe(false); // from above, over the wall, onto the floor
    expect(p.blocked(through([100, 900, 200], [100, 250, 10]), 700, plain)).toBe(true); // low: through the south wall
    expect(p.blocked(down(100, 250), 5, plain)).toBe(false);
    expect(p.blocked({ o: [NaN, 0, 0], d: [0, 0, -1] }, 10, plain)).toBe(false);
  });
  it("a lowered wall does not block", () => {
    const sol = buildScene(house()).solids, p = new Picker(sol);
    const low = (s: Solid): [number, number] | null => (s.shape.type !== "prism" ? null : s.kind === "wall" ? [s.shape.z0, Math.min(s.shape.z1, 30)] : [s.shape.z0, s.shape.z1]);
    const ray = through([100, 900, 200], [100, 250, 100]);
    expect(p.blocked(ray, 720, plain)).toBe(true);
    expect(p.blocked(ray, 720, low)).toBe(false);
  });
});
