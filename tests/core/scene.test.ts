import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { buildScene, type Solid } from "../../src/core/scene";
import { deviceSolidTop, FURNITURE_SOLID, DEVICE_SOLID } from "../../src/core/solids";
import { deviceZ, edgeHeight, floorHeight, furnitureHeight, radiatorSpan, unlinkedHeight, wallHeight, doorSpan, openingSpan } from "../../src/core/heights";
import { stairSteps } from "../../src/core/geometry";
import { DEVICE_TYPES, FURNITURE_SYMBOLS, ROOM_KINDS, type DeviceType, type Floor, type FurnitureSymbol, type Layout, type RoomKind } from "../../src/core/schema";

// The 3D scene, in cm, z up. Every number is read from heights.ts or solids.ts, never copied (spec R3).
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const prism = (s: Solid) => { if (s.shape.type !== "prism") throw new Error(`${s.id} is not a prism`); return s.shape; };
const xs = (s: Solid) => prism(s).base.map((p: number[]) => p[0]);
const ys = (s: Solid) => prism(s).base.map((p: number[]) => p[1]);
const span = (v: number[]) => [Math.min(...v), Math.max(...v)];
const area = (s: Solid) => { const b = prism(s).base as number[][]; return Math.abs(b.reduce((a, p, i) => { const q = b[(i + 1) % b.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2; };
const round = (n: number) => Math.round(n * 100) / 100;
const demoFloors = () => Object.values((demo as unknown as Layout).floors);
/** The wall pieces of outline edge `i` (top edge is 0), by their x extent. */
const edge0 = (sc: ReturnType<typeof buildScene>) => sc.solids.filter((s) => s.kind === "wall" && s.ref.poly === "o" && s.ref.index === 0 && s.tag !== "glass" && s.tag !== "door-leaf" && s.tag !== "panel");

describe("scene: walls read heights.ts", () => {
  it("every edge and free wall stands at the height heights.ts gives it", () => {
    const f = floor({
      height: 270,
      owk: ["external", "wall", "fence", "none"],
      rooms: [{ id: "r", name: "R", area: "", kind: "room", pts: [[50, 50], [250, 50], [250, 200], [50, 200]], wk: ["wall", "wall", "wall", "wall"], height: 233 }],
      walls: [{ id: "w1", a: [400, 300], b: [500, 300], kind: "wall", height: 137 }, { id: "w2", a: [400, 350], b: [500, 350], kind: "fence" }],
    });
    const sc = buildScene(f);
    const top = (poly: string, i: number) => Math.max(...sc.solids.filter((s) => s.kind === "wall" && s.ref.poly === poly && s.ref.index === i).map((s) => prism(s).z1));
    expect(top("o", 0)).toBe(edgeHeight(f, null, 0));
    expect(top("o", 0)).toBe(270);
    expect(top("o", 2)).toBe(edgeHeight(f, null, 2)); // fence: 110
    expect(top("r0", 1)).toBe(edgeHeight(f, f.rooms[0], 1));
    expect(top("r0", 1)).toBe(233);
    expect(top("w", 0)).toBe(wallHeight(f, f.walls[0]));
    expect(top("w", 0)).toBe(137);
    expect(top("w", 1)).toBe(wallHeight(f, f.walls[1]));
    // edge 3 of the outline is "none": not drawn
    expect(sc.solids.some((s) => s.ref.poly === "o" && s.ref.index === 3)).toBe(false);
  });

  it("a wall is as thick as its kind: 20 external, 10 inner, 4 fence", () => {
    const f = floor({ owk: ["external", "external", "external", "external"], walls: [{ id: "w", a: [100, 100], b: [300, 100], kind: "wall" }, { id: "f", a: [100, 200], b: [300, 200], kind: "fence" }] });
    const sc = buildScene(f);
    const w = sc.solids.find((s) => s.ref.poly === "w" && s.ref.index === 0)!, fe = sc.solids.find((s) => s.ref.poly === "w" && s.ref.index === 1)!, ex = edge0(sc)[0];
    expect(span(ys(w))).toEqual([95, 105]);
    expect(span(ys(fe))).toEqual([198, 202]);
    expect(span(ys(ex))).toEqual([-10, 10]);
  });

  it("zero-length and zero-height walls make no solid", () => {
    const f = floor({ owk: ["none", "none", "none", "none"], walls: [
      { id: "a", a: [10, 10], b: [10, 10], kind: "wall" }, { id: "b", a: [10, 10], b: [90, 10], kind: "wall", height: 0 },
      { id: "c", a: [10, 20], b: [90, 20], kind: "edge" }, { id: "d", a: [10, 30], b: [90, 30], kind: "boundary" }, { id: "e", a: [10, 40], b: [90, 40], kind: "wall" },
    ] });
    const w = buildScene(f).solids.filter((s) => s.kind === "wall");
    expect(w.map((s) => s.ref.index)).toEqual([4]);
  });

  it("one edge shared by two rooms is one wall, the taller and external one winning", () => {
    const sq = (x: number): [number, number][] => [[x, 0], [x + 100, 0], [x + 100, 100], [x, 100]];
    const f = floor({ owk: ["none", "none", "none", "none"], rooms: [
      { id: "a", name: "A", area: "", kind: "room", pts: sq(0), wk: ["wall", "wall", "wall", "wall"] },
      { id: "b", name: "B", area: "", kind: "room", pts: sq(100), wk: ["wall", "wall", "wall", "wall"], height: 300 },
    ] });
    const shared = buildScene(f).solids.filter((s) => s.kind === "wall" && span(xs(s))[0] >= 95 && span(xs(s))[1] <= 105);
    expect(shared).toHaveLength(1);
    expect(prism(shared[0]).z1).toBe(300);
  });
});

describe("scene: openings are gaps", () => {
  it("a door leaves exactly its width, from the floor to its height, and a closed leaf stands in it", () => {
    const f = floor({ doors: [{ id: "d1", name: "D", kind: "door", a: [100, 0], b: [190, 0], sensors: ["binary_sensor.d1"], height: 195 }] });
    const sc = buildScene(f), pieces = edge0(sc);
    // the wall is cut: at least two solids, and the x ranges at the wall's own height leave 100..190 empty
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    const full = pieces.filter((s) => prism(s).z0 === 0 && prism(s).z1 === floorHeight(f)).map((s) => span(xs(s))).sort((a, b) => a[0] - b[0]);
    expect(full).toEqual([[0, 100], [190, 600]]);
    // above the door a header closes the wall: from the door's head up to the ceiling
    const head = doorSpan(f.doors[0]).head;
    expect(head).toBe(195);
    const header = pieces.find((s) => prism(s).z0 === head)!;
    expect(span(xs(header))).toEqual([100, 190]);
    expect(prism(header).z1).toBe(floorHeight(f));
    // nothing stands in the gap between the floor and the head
    expect(pieces.some((s) => span(xs(s))[0] < 190 && span(xs(s))[1] > 100 && prism(s).z0 < head)).toBe(false);
    const leaf = sc.solids.find((s) => s.tag === "door-leaf")!;
    expect(leaf.ref.entity).toBe("binary_sensor.d1");
    expect(leaf.ref.index).toBe(0);
    expect([prism(leaf).z0, prism(leaf).z1]).toEqual([0, head]);
    expect(span(xs(leaf))).toEqual([100, 190]);
  });

  it("a window leaves a gap from the sill to the head, with wall below and above, and a glass pane in it", () => {
    const f = floor({ doors: [{ id: "w", name: "W", kind: "window", a: [210, 0], b: [330, 0], sill: 70, height: 95 }] });
    const sc = buildScene(f), pieces = edge0(sc), { sill, head } = doorSpan(f.doors[0]);
    expect([sill, head]).toEqual([70, 165]);
    const inGap = pieces.filter((s) => span(xs(s))[0] >= 210 && span(xs(s))[1] <= 330);
    const below = inGap.find((s) => prism(s).z0 === 0)!, above = inGap.find((s) => prism(s).z1 === floorHeight(f))!;
    expect(prism(below).z1).toBe(70);
    expect(prism(above).z0).toBe(165);
    expect(inGap).toHaveLength(2);
    const pane = sc.solids.find((s) => s.tag === "glass")!;
    expect([prism(pane).z0, prism(pane).z1]).toEqual([70, 165]);
    expect(span(xs(pane))).toEqual([210, 330]);
    expect(pane.ref.index).toBe(0);
  });

  it("a plain opening is a gap and nothing else; a sealed one is a panel", () => {
    const f = floor({ openings: [{ id: "o", a: [100, 0], b: [200, 0], height: 200, sill: 20 }], doors: [{ id: "s", name: "S", kind: "sealed", a: [300, 0], b: [380, 0] }] });
    const sc = buildScene(f), { sill, head } = openingSpan(f.openings[0]);
    expect([sill, head]).toEqual([20, 220]);
    expect(sc.solids.some((s) => s.tag === "glass" || s.tag === "door-leaf")).toBe(false);
    const panel = sc.solids.find((s) => s.tag === "panel")!;
    expect(span(xs(panel))).toEqual([300, 380]);
    expect([prism(panel).z0, prism(panel).z1]).toEqual([doorSpan(f.doors[0]).sill, doorSpan(f.doors[0]).head]);
    const gap = edge0(sc).filter((s) => span(xs(s))[0] >= 100 && span(xs(s))[1] <= 200);
    expect(gap.map((s) => [prism(s).z0, prism(s).z1]).sort()).toEqual([[0, 20], [220, 250]]);
  });

  it("the demo's front door, patio door and bedroom window each cut their wall", () => {
    const [ground, first] = demoFloors();
    const g = buildScene(ground), fs = buildScene(first);
    expect(g.solids.filter((s) => s.tag === "door-leaf").map((s) => s.ref.index).sort()).toEqual([0, 2]); // doors 0 and 2 are plain doors; 1 is glass
    expect(g.solids.filter((s) => s.tag === "glass")).toHaveLength(1);
    expect(fs.solids.filter((s) => s.tag === "glass")).toHaveLength(1);
    const win = fs.solids.find((s) => s.tag === "glass")!, { sill, head } = doorSpan(first.doors[0]);
    expect([prism(win).z0, prism(win).z1]).toEqual([sill, head]);
    expect([sill, head]).toEqual([90, 210]);
    expect(span(xs(win))).toEqual([100, 300]);
  });
});

describe("scene: floor slab and rooms", () => {
  it("has a slab under the outline and a thin fill per room that owns a floor", () => {
    const sc = buildScene(demoFloors()[0]);
    const slab = sc.solids.filter((s) => s.kind === "floor");
    expect(slab).toHaveLength(1);
    expect(prism(slab[0]).z1).toBe(0);
    expect(prism(slab[0]).z0).toBeLessThan(0);
    const rooms = sc.solids.filter((s) => s.kind === "room");
    expect(rooms.map((s) => s.ref.room)).toEqual([0, 1, 2, 4, 5, 6]); // room 3 is a zone
    for (const r of rooms) { expect(prism(r).z0).toBeGreaterThanOrEqual(0); expect(prism(r).z1 - prism(r).z0).toBeGreaterThan(0); expect(prism(r).z1).toBeLessThan(5); }
    expect(rooms.map((s) => s.tag)).toEqual(["room", "room", "room", "garden", "pavement", "water"]);
  });

  /** What a room kind becomes. Written out on purpose: a new RoomKind fails until someone decides (finding 17). */
  const ROOM_DECISION: Record<RoomKind, "fill" | "none" | "named"> = { room: "fill", garden: "fill", pavement: "fill", terrace: "fill", water: "fill", fill: "named", structure: "none", zone: "none" };
  it("decides every RoomKind", () => {
    expect(Object.keys(ROOM_DECISION).sort()).toEqual([...ROOM_KINDS].sort());
    for (const kind of ROOM_KINDS) {
      const named = floor({ owk: ["none", "none", "none", "none"], rooms: [{ id: "r", name: "N", area: "", kind, pts: [[0, 0], [100, 0], [100, 100], [0, 100]], wk: ["wall", "wall", "wall", "wall"], color: "#aabbcc", texture: "oak" }] });
      const unnamed = floor({ owk: ["none", "none", "none", "none"], rooms: [{ ...named.rooms[0], name: "" }] });
      const n = buildScene(named).solids.filter((s) => s.kind === "room"), u = buildScene(unnamed).solids.filter((s) => s.kind === "room");
      expect(n.length, kind).toBe(ROOM_DECISION[kind] === "none" ? 0 : 1);
      expect(u.length, `${kind} unnamed`).toBe(ROOM_DECISION[kind] === "fill" ? 1 : 0);
      if (n[0]) { expect(n[0].tag).toBe(kind); expect(n[0].paint).toEqual({ role: `room-${kind}`, color: "#aabbcc", texture: "oak" }); }
      // a zone has no wall of its own; a structure keeps its walls
      const walls = buildScene(named).solids.filter((s) => s.kind === "wall").length;
      expect(walls > 0, `${kind} walls`).toBe(kind !== "zone");
    }
  });

  it("a room nested in a bigger one sits above it, whatever the array order", () => {
    const f = floor({ owk: ["none", "none", "none", "none"], rooms: [
      { id: "s", name: "Small", area: "", kind: "room", pts: [[100, 100], [200, 100], [200, 200], [100, 200]], wk: ["none", "none", "none", "none"] },
      { id: "b", name: "Big", area: "", kind: "garden", pts: [[0, 0], [500, 0], [500, 500], [0, 500]], wk: ["none", "none", "none", "none"] },
    ] });
    const r = buildScene(f).solids.filter((s) => s.kind === "room");
    const small = r.find((s) => s.ref.room === 0)!, big = r.find((s) => s.ref.room === 1)!;
    expect(prism(small).z0).toBeGreaterThanOrEqual(prism(big).z1);
  });
});

describe("scene: furniture, unlinked, stairs", () => {
  const piece = (symbol: FurnitureSymbol, o = {}) => ({ id: "f", symbol, x: 300, y: 200, rot: 0, w: 120, h: 70, ...o });
  /** What a symbol becomes. Written out on purpose (finding 17). */
  const SYMBOL_DECISION: Record<FurnitureSymbol, "box" | "pole" | "flat"> = {
    table: "box", sofa: "box", bed: "box", cabinet: "box", chair: "box", sink: "box", toilet: "box", shower: "box", bathtub: "box", tv: "box", computer: "box",
    car: "box", tree: "pole", "patio-wood": "flat", "patio-concrete": "flat",
  };
  it("decides every FurnitureSymbol", () => {
    expect(Object.keys(SYMBOL_DECISION).sort()).toEqual([...FURNITURE_SYMBOLS].sort());
    for (const s of FURNITURE_SYMBOLS) {
      expect(FURNITURE_SOLID[s], s).toBe(SYMBOL_DECISION[s]);
      const m = piece(s), sc = buildScene(floor({ furniture: [m] }));
      const sol = sc.solids.filter((x) => x.kind === "furniture");
      expect(sol, s).toHaveLength(1);
      expect(sol[0].tag).toBe(s);
      expect(sol[0].ref.index).toBe(0);
      expect(prism(sol[0]).z0).toBe(0);
      expect(prism(sol[0]).z1).toBe(furnitureHeight(m as never));
      if (SYMBOL_DECISION[s] === "pole") { expect(area(sol[0])).toBeLessThan(m.w * m.h / 10); expect(sol[0].ref.size).toEqual([120, 70]); }
      else expect(round(area(sol[0]))).toBe(120 * 70);
    }
  });

  it("turns a piece about its centre and takes an explicit height", () => {
    const sol = buildScene(floor({ furniture: [piece("table", { rot: 90, height: 66 })] })).solids.find((s) => s.kind === "furniture")!;
    expect(prism(sol).z1).toBe(66);
    expect(span(xs(sol)).map(round)).toEqual([265, 335]); // 70 wide after a quarter turn
    expect(span(ys(sol)).map(round)).toEqual([140, 260]);
  });

  it("an unlinked appliance is a 40 cm block at its own height, scaled", () => {
    const u = { id: "u", type: "ac" as DeviceType, x: 100, y: 100, rot: 0, scale: 2 };
    const sol = buildScene(floor({ unlinked: [u] })).solids.find((s) => s.kind === "unlinked")!;
    expect(prism(sol).z1).toBe(unlinkedHeight(u));
    expect(prism(sol).z1).toBe(220);
    expect(span(xs(sol))).toEqual([60, 140]);
    expect(sol.tag).toBe("ac");
  });

  it("stairs are one block per step, each as high as the flight has climbed", () => {
    const g = demoFloors()[0], sc = buildScene(g), st = sc.solids.filter((s) => s.kind === "stair");
    const n = stairSteps(g.stairs[0]);
    expect(st).toHaveLength(n);
    st.forEach((s, k) => { expect(round(prism(s).z1)).toBe(round(((k + 1) / n) * floorHeight(g))); expect(prism(s).z0).toBe(0); expect(s.ref.index).toBe(0); });
    expect(prism(st[n - 1]).z1).toBe(floorHeight(g));
  });

  it("stairs going down are sunk below the floor, going both ways also keep a kerb", () => {
    const g = demoFloors()[0];
    const down = buildScene(g, { around: { above: false, below: true } }).solids.filter((s) => s.kind === "stair");
    expect(down.length).toBeGreaterThan(0);
    expect(down.every((s) => prism(s).z1 <= 0)).toBe(true);
    const both = buildScene({ ...g, stairs: [{ ...g.stairs[0], direction: "both" }] }).solids.filter((s) => s.kind === "stair");
    expect(both.length).toBeGreaterThan(stairSteps(g.stairs[0]));
    expect(both.filter((s) => s.tag === "kerb").every((s) => prism(s).z1 === 10)).toBe(true);
  });
});

describe("scene: devices match the 2.5D numbers", () => {
  const dev = (type: string, o: Record<string, unknown> = {}) => ({ id: "d", type, entity: `x.${type}`, x: 300, y: 250, ...o }) as never;

  it("a radiator is the span radiatorSpan gives, 8 cm deep along the bar", () => {
    const d = dev("heater", { x: undefined, y: undefined, a: [100, 50], b: [300, 50], z: 55 });
    const sol = buildScene(floor({ devices: [d] })).solids.find((s) => s.kind === "device")!;
    const { bottom, top } = radiatorSpan(d);
    expect([prism(sol).z0, prism(sol).z1]).toEqual([bottom, top]);
    expect([bottom, top]).toEqual([10, 55]);
    expect(span(xs(sol))).toEqual([100, 300]);
    expect(span(ys(sol))).toEqual([46, 54]);
    expect(sol.ref.entity).toBe("x.heater");
    expect(sol.tag).toBe("heater");
  });

  it("a radiator with no z goes up to the window sill less a margin", () => {
    const d = dev("heater", { x: undefined, y: undefined, a: [100, 50], b: [300, 50] });
    const sol = buildScene(floor({ devices: [d] })).solids.find((s) => s.kind === "device")!;
    expect(prism(sol).z1).toBe(radiatorSpan(d).top);
    expect(prism(sol).z1).toBe(70);
  });

  it("a speaker and a media player are the 20 x 20 x 30 cabinet, turned by rot", () => {
    for (const type of ["speaker", "media"]) {
      const d = dev(type, { rot: 45 });
      const sol = buildScene(floor({ devices: [d] })).solids.find((s) => s.kind === "device")!;
      expect(prism(sol).z0).toBe(0);
      expect(prism(sol).z1).toBe(deviceSolidTop(d));
      expect(round(area(sol))).toBe(400);
      expect(round(span(xs(sol))[1] - span(xs(sol))[0])).toBe(round(20 * Math.SQRT2));
    }
    const flat = buildScene(floor({ devices: [dev("speaker")] })).solids.find((s) => s.kind === "device")!;
    expect(span(xs(flat))).toEqual([290, 310]);
    expect(span(ys(flat))).toEqual([240, 260]);
  });

  it("a TV hangs flush on the nearest wall within 150 cm: 100 wide, 6 thick, 60 tall, at its mount height", () => {
    const d = dev("tv", { x: 300, y: 40, z: 88 });
    const sol = buildScene(floor({ devices: [d] })).solids.find((s) => s.kind === "device")!;
    expect([prism(sol).z0, prism(sol).z1]).toEqual([deviceZ(d), deviceZ(d) + 60]);
    expect([prism(sol).z0, prism(sol).z1]).toEqual([88, 148]);
    expect(span(xs(sol))).toEqual([250, 350]);
    expect(span(ys(sol))).toEqual([10, 16]); // the face of an external wall (20 thick) is 10 off its line
    const dflt = buildScene(floor({ devices: [dev("tv", { x: 300, y: 40 })] })).solids.find((s) => s.kind === "device")!;
    expect(prism(dflt).z0).toBe(deviceZ(dev("tv")));
  });

  it("a free-standing TV stands 30 cm up, and its top is deviceSolidTop", () => {
    const d = dev("tv", { x: 500, y: 500 });
    const sol = buildScene(floor({ outline: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], devices: [d] })).solids.find((s) => s.kind === "device")!;
    expect(prism(sol).z1).toBe(deviceSolidTop(d));
    expect(prism(sol).z0).toBe(30);
    expect(round(area(sol))).toBe(600);
  });

  /** What each device type becomes. Written out on purpose (finding 17). */
  const KIND: Record<DeviceType, "radiator" | "speaker" | "tv" | "none"> = {
    light: "none", camera: "none", motion: "none", radar: "none", access_point: "none", ac: "none", speaker: "speaker", cover: "none",
    switch: "none", plug: "none", contact: "none", vibration: "none", lock: "none", temp: "none", humidity: "none", climate: "none",
    boiler: "none", battery: "none", inverter: "none", media: "speaker", tv: "tv", other: "none", heater: "radiator", computer: "none",
    server: "none", ups: "none", printer: "none", car: "none", person: "none", vacuum: "none",
  };
  it("decides every DeviceType: a solid for the three, a point at deviceZ for the rest", () => {
    expect(Object.keys(KIND).sort()).toEqual([...DEVICE_TYPES].sort());
    for (const t of DEVICE_TYPES) {
      expect(DEVICE_SOLID[t], t).toBe(KIND[t]);
      const d = t === "heater" ? dev(t, { x: undefined, y: undefined, a: [100, 50], b: [300, 50] }) : dev(t);
      const out = buildScene(floor({ devices: [d] })).solids.filter((s) => s.kind === "device");
      expect(out, t).toHaveLength(1);
      expect(out[0].tag).toBe(t);
      expect(out[0].ref.entity).toBe(`x.${t}`);
      expect(out[0].ref.index).toBe(0);
      if (KIND[t] === "none") { expect(out[0].shape, t).toEqual({ type: "point", at: [300, 250], z: deviceZ(d) }); }
      else expect(out[0].shape.type, t).toBe("prism");
    }
  });

  it("a heater placed as a point, with no bar, is a marker; a device with a bar is a point at its middle", () => {
    expect(buildScene(floor({ devices: [dev("heater")] })).solids.find((s) => s.kind === "device")!.shape).toEqual({ type: "point", at: [300, 250], z: deviceZ(dev("heater")) });
    const bar = dev("camera", { x: undefined, y: undefined, a: [100, 50], b: [300, 90] });
    expect(buildScene(floor({ devices: [bar] })).solids.find((s) => s.kind === "device")!.shape).toEqual({ type: "point", at: [200, 70], z: deviceZ(bar) });
  });
});

describe("scene: whole-scene properties", () => {
  it("builds the demo's both floors with a wall, room, furniture and device each", () => {
    const g = buildScene(demoFloors()[0]);
    for (const k of ["floor", "wall", "room", "furniture", "stair", "device"]) expect(g.solids.some((s) => s.kind === k), k).toBe(true);
    expect(g.solids.filter((s) => s.kind === "furniture")).toHaveLength(2);
    expect(g.solids.filter((s) => s.kind === "device")).toHaveLength(8);
    expect(g.solids.filter((s) => s.kind === "device" && s.shape.type === "prism").map((s) => s.tag)).toEqual(["heater"]);
    for (const s of g.solids.filter((x) => x.kind === "wall" && x.tag !== "glass" && x.tag !== "door-leaf")) expect(prism(s).z1).toBeLessThanOrEqual(floorHeight(demoFloors()[0]));
  });

  it("is deterministic, JSON-safe, with unique ids", () => {
    for (const f of demoFloors()) {
      const a = buildScene(f), b = buildScene(JSON.parse(JSON.stringify(f)));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.parse(JSON.stringify(a))).toEqual(a);
      expect(new Set(a.solids.map((s) => s.id)).size).toBe(a.solids.length);
    }
  });

  it("bounds hold every solid, in cm, z up; elevation lifts the whole scene", () => {
    const f = floor({ furniture: [{ id: "f", symbol: "cabinet", x: 300, y: 250, rot: 0, w: 60, h: 40 }] });
    const sc = buildScene(f);
    expect(sc.bounds.min).toEqual([-10, -10, -25]);
    expect(sc.bounds.max).toEqual([610, 510, 250]);
    const up = buildScene(f, { elevation: 275 });
    expect(up.bounds.min).toEqual([-10, -10, 250]);
    expect(up.bounds.max).toEqual([610, 510, 525]);
    const tall = buildScene(floor({ furniture: [{ id: "f", symbol: "tree", x: 300, y: 250, rot: 0, w: 60, h: 40, height: 700 }] }));
    expect(tall.bounds.max[2]).toBe(700);
    for (const s of sc.solids) {
      const pts = s.shape.type === "prism" ? s.shape.base.map((p: number[]) => [p[0], p[1]]) : [s.shape.at];
      for (const [x, y] of pts) { expect(x).toBeGreaterThanOrEqual(sc.bounds.min[0]); expect(x).toBeLessThanOrEqual(sc.bounds.max[0]); expect(y).toBeGreaterThanOrEqual(sc.bounds.min[1]); expect(y).toBeLessThanOrEqual(sc.bounds.max[1]); }
    }
    expect(buildScene(floor({ outline: [] as never, owk: undefined })).bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });
});

describe("scene: hostile layouts never throw and keep the good pieces", () => {
  it("skips the bad piece, keeps the rest", () => {
    const bad = floor({
      outline: [[0, 0], [600, 0], [600, 500], [0, 500]],
      rooms: [
        { id: "a", name: "ok", area: "", kind: "room", pts: [[10, 10], [200, 10], [200, 200], [10, 200]], wk: ["wall", "wall", "wall", "wall"] },
        { id: "b", name: "x", area: "", kind: "room", pts: 5 as never, wk: 7 as never },
        { id: "c", name: "x", area: "", kind: "room", pts: [[NaN, 0], [Infinity, 1], [3, 4]], wk: [] },
        null as never, { id: "d", name: "x", area: "", kind: "bogus" as never, pts: [[0, 0], [1, 0], [1, 1]], wk: [] },
      ],
      walls: [{ id: "w", a: [NaN, 0], b: [1, 1], kind: "wall" }, { id: "w2", a: "x" as never, b: null as never, kind: "wall" }, { id: "w3", a: [400, 400], b: [500, 400], kind: "wall", height: -5 }, { id: "w4", a: [400, 450], b: [500, 450], kind: "wall" }],
      doors: [{ id: "d", name: "d", kind: "door", a: [NaN, 0], b: [1, 1] }, { id: "e", name: "e", kind: "nope" as never, a: [100, 0], b: [190, 0], height: NaN, sill: Infinity }, 5 as never],
      openings: "no" as never,
      stairs: [{ id: "s", name: "s", pts: "x" as never, shape: "straight", steps: 3, rot: 0 }],
      furniture: [
        { id: "f1", symbol: "table", x: NaN, y: 0, rot: 0, w: 10, h: 10 }, { id: "f2", symbol: "table", x: 0, y: 0, rot: 0, w: -10, h: 10 },
        { id: "f3", symbol: "nope" as never, x: 0, y: 0, rot: 0, w: 10, h: 10 }, { id: "f4", symbol: "sofa", x: 100, y: 100, rot: 0, w: 100, h: 50 }, { id: "f5", symbol: "sofa", x: 1, y: 1, rot: 0, w: 10, h: 10, height: 0 },
      ],
      unlinked: [{ id: "u", type: "ac", x: NaN, y: 0, rot: 0, scale: 1 }, { id: "u2", type: "zzz" as never, x: 50, y: 50, rot: 0, scale: -1 }],
      devices: [{ id: "x", type: "tv", entity: "a.b", x: NaN, y: 1 } as never, null as never, { id: "y", type: "light", entity: "a.c", x: 5, y: 5 } as never, { id: "z", type: "heater", entity: "a.d", a: [1, 1], b: [1, 1] } as never],
    });
    let sc!: ReturnType<typeof buildScene>;
    expect(() => { sc = buildScene(bad); }).not.toThrow();
    expect(sc.solids.some((s) => s.kind === "room" && s.ref.room === 0)).toBe(true);
    expect(sc.solids.some((s) => s.kind === "furniture" && s.ref.index === 3)).toBe(true);
    expect(sc.solids.some((s) => s.kind === "wall" && s.ref.poly === "w" && s.ref.index === 3)).toBe(true);
    // a negative height is junk and reads as the default (heights.ts), so that wall stands at the storey height
    expect(sc.solids.find((s) => s.kind === "wall" && s.ref.poly === "w" && s.ref.index === 2)).toMatchObject({ shape: { z1: 250 } });
    expect(sc.solids.some((s) => s.kind === "device" && s.ref.entity === "a.c")).toBe(true);
    expect(sc.solids.some((s) => s.kind === "furniture" && [0, 1, 2, 4].includes(s.ref.index as number))).toBe(false);
    expect(sc.solids.some((s) => s.kind === "room" && [1, 2, 4].includes(s.ref.room as number))).toBe(false);
    // every number in every solid is finite: JSON would turn NaN or Infinity into null
    expect(JSON.parse(JSON.stringify(sc))).toEqual(sc);
    expect(sc.bounds.min.every(Number.isFinite) && sc.bounds.max.every(Number.isFinite)).toBe(true);
  });

  it("junk in place of a floor, and a floor named __proto__, build an empty or normal scene", () => {
    for (const junk of [null, undefined, 5, "x", [], {}, { outline: 5, rooms: 5, walls: 5, doors: 5, devices: 5, furniture: 5, unlinked: 5, stairs: 5, openings: 5 }])
      expect(() => buildScene(junk as never), String(junk)).not.toThrow();
    const layout = JSON.parse(JSON.stringify(demo)); layout.floors = JSON.parse(`{"__proto__": ${JSON.stringify(layout.floors.ground)}}`);
    const f = Object.getOwnPropertyDescriptor(layout.floors, "__proto__")!.value as Floor;
    expect(() => buildScene(f)).not.toThrow();
    expect(buildScene(f).solids.length).toBeGreaterThan(10);
  });

  it("5000 furniture pieces build, all of them", () => {
    const furniture = Array.from({ length: 5000 }, (_, i) => ({ id: `f${i}`, symbol: "table" as const, x: i, y: i % 300, rot: i % 360, w: 50, h: 50 }));
    const sc = buildScene(floor({ furniture }));
    expect(sc.solids.filter((s) => s.kind === "furniture")).toHaveLength(5000);
  });

  it("does not change the floor it is given", () => {
    const f = demoFloors()[0], before = JSON.stringify(f);
    buildScene(f);
    expect(JSON.stringify(f)).toBe(before);
  });
});
