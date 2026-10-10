import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { buildScene, ICON_MARGIN, type Solid } from "../../src/core/scene";
import { deviceSolidTop, FURNITURE_SOLID, DEVICE_SOLID } from "../../src/core/solids";
import { deviceZ, edgeHeight, floorHeight, furnitureBottom, furnitureHeight, radiatorSpan, unlinkedHeight, wallHeight, doorSpan, openingSpan } from "../../src/core/heights";
import { stairSteps } from "../../src/core/geometry";
import { treeShape } from "../../src/core/tree";
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

describe("scene: wall corners are closed (S12.3)", () => {
  // Two walls meeting at a corner each end on the corner's centre point, so the outer corner is a notch of half a wall
  // thick, seen from any 3D angle. Each end that meets another wall runs on by half of that wall's thickness.
  it("a rectangle of external walls (20 thick) overlaps at every corner: each wall runs 10 past its corner", () => {
    const sc = buildScene(floor());
    const top = edge0(sc)[0], right = sc.solids.find((s) => s.kind === "wall" && s.ref.poly === "o" && s.ref.index === 1)!;
    expect(span(xs(top))).toEqual([-10, 610]);
    expect(span(ys(right))).toEqual([-10, 510]);
  });

  it("a lone wall end, and a T-joint (the end meets the middle of another wall), is not extended", () => {
    const f = floor({ owk: ["none", "none", "none", "none"], walls: [{ id: "a", a: [100, 100], b: [300, 100], kind: "wall" }, { id: "b", a: [200, 100], b: [200, 300], kind: "wall" }, { id: "c", a: [400, 400], b: [500, 400], kind: "wall" }] });
    const sc = buildScene(f);
    const get = (i: number) => sc.solids.find((s) => s.ref.poly === "w" && s.ref.index === i)!;
    expect(span(xs(get(0)))).toEqual([100, 300]);
    expect(span(ys(get(1)))).toEqual([100, 300]); // b starts on the middle of a: no extension
    expect(span(xs(get(2)))).toEqual([400, 500]);
  });

  it("a corner of a thin wall and a thick one runs on by the other wall's half thickness, not its own", () => {
    const f = floor({ owk: ["none", "none", "none", "none"], walls: [{ id: "a", a: [100, 100], b: [300, 100], kind: "wall" }, { id: "b", a: [100, 100], b: [100, 300], kind: "external" }] });
    const sc = buildScene(f);
    const a = sc.solids.find((s) => s.ref.poly === "w" && s.ref.index === 0)!, b = sc.solids.find((s) => s.ref.poly === "w" && s.ref.index === 1)!;
    expect(span(xs(a))).toEqual([90, 300]); // 10 thick wall, meets a 20 thick one: 10 past the corner
    expect(span(ys(b))).toEqual([95, 300]); // the 20 thick wall meets a 10 thick one: 5 past
  });

  // S12.4 look at the first-floor shot: a partition ending on a wall that is drawn as two collinear pieces (the two rooms'
  // edges) was taken for a corner, ran on to the outside face of that wall, and its other colour fought the wall's there:
  // a dark sliver down the facade.
  it("a partition that ends on a wall drawn in two collinear pieces stays inside it: it is a T-joint, not a corner", () => {
    const f = floor({ owk: ["none", "none", "none", "none"], walls: [
      { id: "l", a: [0, 0], b: [400, 0], kind: "external" }, { id: "r", a: [400, 0], b: [800, 0], kind: "external" }, { id: "p", a: [400, 0], b: [400, 300], kind: "wall" },
    ] });
    const sc = buildScene(f), get = (i: number) => sc.solids.find((s) => s.ref.poly === "w" && s.ref.index === i)!;
    expect(span(ys(get(2)))).toEqual([0, 300]); // not -10, the face of the wall it ends on
    expect(span(xs(get(0)))).toEqual([0, 400]); // two collinear pieces are one wall: neither runs on into the other
    expect(span(xs(get(1)))).toEqual([400, 800]);
  });

  it("a partition whose end meets a through wall drawn as two pieces, from either side of the joint, is left alone", () => {
    const f = floor({ owk: ["none", "none", "none", "none"], walls: [
      { id: "l", a: [0, 300], b: [400, 300], kind: "wall" }, { id: "r", a: [800, 300], b: [400, 300], kind: "wall" }, { id: "p", a: [400, 300], b: [400, 0], kind: "wall" },
    ] });
    const sc = buildScene(f), get = (i: number) => sc.solids.find((s) => s.ref.poly === "w" && s.ref.index === i)!;
    expect(span(xs(get(0)))).toEqual([0, 400]);
    expect(span(xs(get(1)))).toEqual([400, 800]);
    expect(span(ys(get(2)))).toEqual([0, 300]);
  });

  it("a door at a corner keeps its gap: nothing but the header stands over it below the head", () => {
    const f = floor({ doors: [{ id: "d", a: [0, 0], b: [90, 0], kind: "door", sensors: [] } as never] });
    const low = edge0(buildScene(f)).filter((s) => prism(s).z0 < 100);
    expect(low.length).toBeGreaterThan(0);
    for (const s of low) expect(span(xs(s))[0] >= 90 || span(xs(s))[1] <= 0).toBe(true); // the corner's overrun (x < 0) or the wall beyond the door
  });
});

describe("scene: which way a wall faces, for a viewer that lowers the near walls (S12.4)", () => {
  const wallOf = (sc: ReturnType<typeof buildScene>, poly: string, index: number) => sc.solids.find((s) => s.kind === "wall" && s.ref.poly === poly && s.ref.index === index)!;
  it("an outline edge faces out of the house, whichever way the outline is wound", () => {
    for (const outline of [[[0, 0], [600, 0], [600, 500], [0, 500]], [[0, 0], [0, 500], [600, 500], [600, 0]]] as [number, number][][]) {
      const sc = buildScene(floor({ outline, owk: ["external", "external", "external", "external"] }));
      for (const s of sc.solids.filter((x) => x.kind === "wall")) {
        const f = s.ref.faces!, mid = [(Math.min(...xs(s)) + Math.max(...xs(s))) / 2, (Math.min(...ys(s)) + Math.max(...ys(s))) / 2];
        expect(f).toHaveLength(1);
        expect(Math.hypot(f[0][0], f[0][1])).toBeCloseTo(1, 6);
        // stepping from the wall's middle along its face leaves the 600 x 500 box, stepping against it stays inside
        const out = [mid[0] + f[0][0] * 30, mid[1] + f[0][1] * 30], inn = [mid[0] - f[0][0] * 30, mid[1] - f[0][1] * 30];
        const inBox = (p: number[]) => p[0] > 0 && p[0] < 600 && p[1] > 0 && p[1] < 500;
        expect(inBox(out)).toBe(false);
        expect(inBox(inn)).toBe(true);
      }
    }
  });
  it("a wall between two rooms faces both ways; a free wall has both sides", () => {
    const f = floor({
      rooms: [{ id: "a", name: "A", kind: "room", pts: [[0, 0], [300, 0], [300, 500], [0, 500]] }, { id: "b", name: "B", kind: "room", pts: [[300, 0], [600, 0], [600, 500], [300, 500]] }] as never,
      walls: [{ id: "w", a: [100, 250], b: [200, 250], kind: "wall" }],
    });
    const sc = buildScene(f), both = (faces: number[][]) => faces.some((p) => faces.some((q) => p[0] * q[0] + p[1] * q[1] < -0.99));
    const shared = sc.solids.find((s) => s.kind === "wall" && s.ref.poly === "r0" && s.ref.index === 1)!;
    expect(both(shared.ref.faces!)).toBe(true);
    expect(both(wallOf(sc, "w", 0).ref.faces!)).toBe(true);
  });
  it("an opening's glass and leaf name the wall they stand in, and that wall exists", () => {
    const sc = buildScene(floor({ doors: [{ id: "d", a: [100, 0], b: [200, 0], kind: "window", sensors: [] }, { id: "e", a: [300, 500], b: [390, 500], kind: "door", sensors: [] }] as never }));
    const infill = sc.solids.filter((s) => s.kind === "opening");
    expect(infill.length).toBe(2);
    for (const o of infill) expect(sc.solids.some((w) => w.kind === "wall" && `${w.ref.poly}:${w.ref.index}` === o.ref.wall)).toBe(true);
  });
});

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
    expect(full).toEqual([[-10, 100], [190, 610]]); // the ends run 10 past the corners (S12.3)
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
    expect(g.solids.filter((s) => s.tag === "glass")).toHaveLength(2); // the patio door and, since S27.C, the kitchen's full-height window
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

  it("the grey tile beside the demo house is its garden and pavement rooms: flat tiles outside the slab, not a stray solid (S12.4)", () => {
    const f = demoFloors()[0], sc = buildScene(f);
    const slab = prism(sc.solids.find((s) => s.kind === "floor")!);
    const [x0, x1] = span(slab.base.map((p: number[]) => p[0])), [y0, y1] = span(slab.base.map((p: number[]) => p[1]));
    const outside = sc.solids.filter((s) => s.kind === "room" && (s.tag === "garden" || s.tag === "pavement"));
    expect(outside.length).toBeGreaterThan(0);
    for (const r of outside) {
      const [rx0, rx1] = span(xs(r)), [ry0, ry1] = span(ys(r));
      expect(rx1 > x1 || ry1 > y1 || rx0 < x0 || ry0 < y0, `${r.id} lies beyond the outline`).toBe(true);
      expect(prism(r).z1 - prism(r).z0, `${r.id} is a flat tile`).toBeLessThan(5);
    }
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

describe("scene: a shed that touches the garden's edge", () => {
  // Diego, 2026-10-06: "in 3d mode i cannot see the floor of the garden shed". A shed built against the garden's border has corners ON
  // its edge, and the even-odd test calls such a corner outside, so the shed was never lifted above the garden and its floor was hidden.
  const WK = ["none", "none", "none", "none"] as const;
  const garden = { id: "b", name: "Garden", area: "", kind: "garden", pts: [[0, 0], [500, 0], [500, 500], [0, 500]], wk: [...WK] };
  const cases: Record<string, number[][]> = {
    "a corner on the garden's corner": [[0, 0], [100, 0], [100, 100], [0, 100]],
    "a side along the garden's edge": [[200, 0], [300, 0], [300, 100], [200, 100]],
    "the far corner on the edge": [[400, 400], [500, 400], [500, 500], [400, 500]],
    // Diego, 2026-10-07: the garden house's floor was missing in 3D; its wall stands a few cm over the garden's border.
    "a corner 6 cm outside the garden": [[400, 400], [506, 400], [506, 500], [400, 500]],
    "a turned shed with two corners 20 cm outside": [[380, 400], [520, 380], [520, 500], [400, 520]],
  };
  for (const [name, pts] of Object.entries(cases)) it(`lifts a shed over the garden: ${name}`, () => {
    for (const order of [0, 1]) {
      const shed = { id: "s", name: "Shed", area: "", kind: "room", pts, wk: [...WK] };
      const f = floor({ owk: [...WK], rooms: order ? [garden, shed] : [shed, garden] } as never);
      const r = buildScene(f).solids.filter((s) => s.kind === "room");
      const small = r.find((s) => s.ref.room === (order ? 1 : 0))!, big = r.find((s) => s.ref.room === (order ? 0 : 1))!;
      expect(prism(small).z0, `order ${order}`).toBeGreaterThanOrEqual(prism(big).z1);
    }
  });
  it("a narrow room beside the garden does not nest in it, however close its far corners are", () => {
    const a = { id: "a", name: "A", area: "", kind: "garden", pts: [[0, 0], [500, 0], [500, 500], [0, 500]], wk: [...WK] };
    const b = { id: "b", name: "B", area: "", kind: "room", pts: [[500, 0], [520, 0], [520, 100], [500, 100]], wk: [...WK] };
    const r = buildScene(floor({ owk: [...WK], rooms: [a, b] } as never)).solids.filter((s) => s.kind === "room");
    expect(r.map((s) => prism(s).z0)).toEqual([0, 0]);
  });
  it("two rooms side by side do not nest", () => {
    const a = { id: "a", name: "A", area: "", kind: "room", pts: [[0, 0], [100, 0], [100, 100], [0, 100]], wk: [...WK] };
    const b = { id: "b", name: "B", area: "", kind: "room", pts: [[100, 0], [150, 0], [150, 100], [100, 100]], wk: [...WK] };
    const r = buildScene(floor({ owk: [...WK], rooms: [a, b] } as never)).solids.filter((s) => s.kind === "room");
    expect(r.map((s) => prism(s).z0)).toEqual([0, 0]);
  });
});

describe("scene: furniture, unlinked, stairs", () => {
  const piece = (symbol: FurnitureSymbol, o = {}) => ({ id: "f", symbol, x: 300, y: 200, rot: 0, w: 120, h: 70, ...o });
  /** What a symbol becomes. Written out on purpose (finding 17). */
  const SYMBOL_DECISION: Record<FurnitureSymbol, "box" | "pole" | "flat"> = {
    table: "box", sofa: "box", bed: "box", cabinet: "box", chair: "box", sink: "box", toilet: "box", shower: "box", bathtub: "box", tv: "box", computer: "box", speaker: "box",
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
      expect(prism(sol[0]).z0).toBe(furnitureBottom(m as never));
      expect(prism(sol[0]).z1).toBe(furnitureBottom(m as never) + (SYMBOL_DECISION[s] === "pole" ? treeShape(m as never)!.trunkTop : furnitureHeight(m as never))); // a tree's trunk stops under its crown (S28.7)
      if (SYMBOL_DECISION[s] === "pole") { expect(area(sol[0])).toBeLessThan(m.w * m.h / 10); expect(sol[0].ref.size).toEqual([120, 70]); }
      else expect(round(area(sol[0]))).toBe(120 * 70);
    }
  });

  // S28.7: the trunk is cut where treeShape says, and the solid carries the crown's z range for the viewer.
  it("a tree's trunk ends at treeShape's trunk top, and the solid names the crown's z range and turn", () => {
    for (const o of [{}, { w: 90, h: 240 }, { height: 700 }, { height: 700, elevation: 0, rot: 30, w: 50, h: 300 }]) {
      const m = piece("tree", o), sc = buildScene(floor({ furniture: [m] }), { elevation: 15 }), sol = sc.solids.find((x) => x.kind === "furniture")!, t = treeShape(m as never)!;
      const z0 = furnitureBottom(m as never) + 15;
      expect(prism(sol).z0).toBe(z0);
      expect(prism(sol).z1).toBeCloseTo(z0 + t.trunkTop, 6);
      expect(sol.ref.crown).toEqual({ z0: z0 + t.crownBottom, z1: z0 + t.crownTop, rot: m.rot });
    }
  });
  it("only a tree has a crown; junk sizes give none and no throw", () => {
    const sc = buildScene(floor({ furniture: [piece("table"), piece("patio-wood"), piece("tree", { w: 0 }), piece("tree", { h: -4 }), piece("tree", { w: NaN })] }));
    expect(sc.solids.filter((x) => x.kind === "furniture" && x.ref.crown)).toHaveLength(0);
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
    server: "none", ups: "none", printer: "none", car: "none", person: "none", vacuum: "none", siren: "none", alarm: "none",
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
      if (KIND[t] === "none") { expect(out[0].shape, t).toEqual({ type: "point", at: [300, 250], z: Math.min(deviceZ(d), floorHeight(floor()) - ICON_MARGIN) }); } // a ceiling light is held under the wall top (3D fixes)
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
    expect(g.solids.filter((s) => s.kind === "device")).toHaveLength(12); // 8, and the four icons stacked in the Hall (S27.C, for spiderfy)
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

describe("a room's own sensors (S12.5)", () => {
  it("a device in a room's temps, humidity or motion list is marked hidden; every other device is not", () => {
    const rooms = [{ id: "r", name: "R", area: "", kind: "room", pts: [[0, 0], [300, 0], [300, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"], temps: ["sensor.t"], motion: ["binary_sensor.m"] }] as unknown as Floor["rooms"];
    const devices = [
      { id: "t", type: "temp", entity: "sensor.t", x: 10, y: 10 }, { id: "m", type: "motion", entity: "binary_sensor.m", x: 20, y: 10 },
      { id: "m2", type: "motion", entity: "binary_sensor.other", x: 30, y: 10 }, { id: "l", type: "light", entity: "light.a", x: 40, y: 10 }, null,
    ] as unknown as Floor["devices"];
    const sc = buildScene(floor({ rooms, devices }));
    const hidden = sc.solids.filter((s) => s.kind === "device").map((s) => [s.ref.index, !!s.ref.hidden]);
    expect(hidden).toEqual([[0, true], [1, true], [2, false], [3, false]]);
  });
});

describe("scene: a device's point stays under the wall top (3D fixes)", () => {
  // Diego: icons fly over the house. A ceiling light is 250 cm by default and the walls are 250, so its icon floated at the wall top.
  const dv = (type: DeviceType, o: Record<string, unknown> = {}) => ({ id: `d.${type}`, type, x: 300, y: 250, entity: `x.${type}`, ...o }) as never;
  const zOf = (f: Floor, i = 0) => { const s = buildScene(f).solids.find((x) => x.kind === "device" && x.ref.index === i)!; return s.shape.type === "point" ? s.shape.z : NaN; };

  it("a ceiling light, a camera and a user z above the walls are held ICON_MARGIN under them; every default point is", () => {
    const top = floorHeight(floor());
    expect(ICON_MARGIN).toBe(25);
    expect(zOf(floor({ devices: [dv("light")] }))).toBe(215); // the preset, already under the cap of 225
    expect(zOf(floor({ devices: [dv("camera", { z: 400 })] }))).toBe(top - ICON_MARGIN);
    for (const t of DEVICE_TYPES) {
      if (DEVICE_SOLID[t] !== "none") continue;
      expect(zOf(floor({ devices: [dv(t)] })), t).toBeLessThanOrEqual(top - ICON_MARGIN);
    }
  });
  it("a low device keeps its own height, and so does a high one on a taller floor", () => {
    expect(zOf(floor({ devices: [dv("plug")] }))).toBe(deviceZ(dv("plug")));
    expect(zOf(floor({ devices: [dv("camera", { z: 187 })] }))).toBe(187);
    expect(zOf(floor({ height: 320, devices: [dv("light")] }))).toBe(215); // 215 is under 320 - 25: untouched
    expect(zOf(floor({ height: 230, devices: [dv("light")] }))).toBe(205); // a low ceiling: the margin binds, 230 - 25
  });
  it("the cap never goes below the slab", () => {
    expect(zOf(floor({ height: 5, devices: [dv("light")] }))).toBe(0); // walls of 5 cm: the cap is the slab, not below it
  });
  it("the elevation lifts the capped height with the floor", () => {
    const s = buildScene(floor({ devices: [dv("camera", { z: 400 })] }), { elevation: 275 }).solids.find((x) => x.kind === "device")!;
    expect(s.shape).toMatchObject({ type: "point", z: 275 + 225 }); // capped at 250 - 25, then lifted
  });
});
