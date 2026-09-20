import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout, Pt } from "../../src/core/schema";
import { Draw, applyShape } from "../../src/editor/draw";

const ground = () => structuredClone((demo as unknown as Layout).floors.ground);
const TH = 14;
const click = (d: Draw, ...pts: Pt[]) => pts.map((p) => d.click(p, TH));

describe("Draw state machine", () => {
  it("collects points and finishes a polygon with 4 points", () => {
    const d = new Draw("room");
    expect(click(d, [0, 0], [100, 0], [100, 100], [0, 100])).toEqual(["add", "add", "add", "add"]);
    expect(d.finish()).toEqual({ kind: "room", wall: "wall", pts: [[0, 0], [100, 0], [100, 100], [0, 100]] });
    expect(d.points).toEqual([]);
  });

  it("finish with fewer than 3 polygon points, or fewer than 2 line points, gives nothing", () => {
    const a = new Draw("room"); click(a, [0, 0], [100, 0]);
    expect(a.finish()).toBeNull();
    const b = new Draw("wall", "fence"); click(b, [0, 0]);
    expect(b.finish()).toBeNull();
    expect(new Draw("zone").finish()).toBeNull();
  });

  it("a click on the first point closes a polygon of 3 or more points, without adding a point", () => {
    const d = new Draw("room");
    click(d, [0, 0], [100, 0], [100, 100]);
    expect(d.click([6, 4], TH)).toBe("finish");
    expect(d.points).toHaveLength(3);
  });

  it("a click on the first point of a 2-point polygon does not close it and adds nothing", () => {
    const d = new Draw("room");
    click(d, [0, 0], [100, 0]);
    expect(d.click([3, 3], TH)).toBe("ignore");
    expect(d.points).toEqual([[0, 0], [100, 0]]);
  });

  it("closing tests the raw pointer, not the snapped point", () => {
    const d = new Draw("water");
    click(d, [0, 0], [100, 0], [100, 100]);
    expect(d.click([50, 50], TH, [2, 2])).toBe("finish");
  });

  it("a click on the last point (double-click) adds no duplicate", () => {
    const d = new Draw("room");
    click(d, [0, 0], [100, 0], [100, 100]);
    expect(d.click([100, 100], TH)).toBe("ignore");
    expect(d.points).toHaveLength(3);
  });

  it("walls chain; a click on the first point after three corners closes the loop (S1.48)", () => {
    const d = new Draw("wall", "fence");
    click(d, [0, 0], [100, 0], [100, 100]);
    expect(d.click([5, 3], TH, [5, 3])).toBe("finish");
    expect(d.finish()!.pts).toEqual([[0, 0], [100, 0], [100, 100], [0, 0]]); // closed exactly, not at the click
  });

  it("two corners cannot close a loop, and a click far from the first point just chains", () => {
    const a = new Draw("wall"); click(a, [0, 0], [100, 0]);
    expect(a.click([0, 0], TH)).toBe("add");
    const b = new Draw("wall"); click(b, [0, 0], [100, 0], [100, 100]);
    expect(b.click([30, 0], TH)).toBe("add");
  });

  it("opening and structure line finish by themselves at the second point", () => {
    for (const k of ["opening", "extra"] as const) {
      const d = new Draw(k);
      expect(d.click([0, 0], TH)).toBe("add");
      expect(d.click([120, 0], TH)).toBe("finish");
      expect(d.finish()).toEqual({ kind: k, wall: "wall", pts: [[0, 0], [120, 0]] });
    }
  });

  it("backspace removes the last point and stops at none", () => {
    const d = new Draw("room");
    click(d, [0, 0], [100, 0]);
    expect(d.backspace()).toBe(true);
    expect(d.points).toEqual([[0, 0]]);
    expect(d.backspace()).toBe(true);
    expect(d.backspace()).toBe(false);
  });

  it("cancel drops the points; rubber is the points plus the pointer, or null with no point", () => {
    const d = new Draw("room");
    expect(d.rubber([5, 5])).toBeNull();
    click(d, [0, 0], [100, 0]);
    expect(d.rubber([50, 60])).toEqual([[0, 0], [100, 0], [50, 60]]);
    d.cancel();
    expect(d.points).toEqual([]);
    expect(d.rubber([5, 5])).toBeNull();
  });
});

describe("applyShape, closed walls (S1.48)", () => {
  const ring: Pt[] = [[1000, 0], [1200, 0], [1200, 100], [1000, 100], [1000, 0]];
  const made = (wall: "wall" | "external" | "boundary" | "fence" | "edge", pts: Pt[] = ring) => applyShape(ground(), "ground", { kind: "wall", wall, pts });
  it("a closed loop of walls becomes a room and leaves no wall behind", () => {
    const r = made("wall");
    expect(r.floor.walls).toEqual([]);
    const room = r.floor.rooms.at(-1)!;
    expect(room).toMatchObject({ name: "New room", area: "", kind: "room", wk: ["wall", "wall", "wall", "wall"] });
    expect(room.pts).toHaveLength(4);
    expect(room.pts.map((p) => p.join()).sort()).toEqual(ring.slice(0, 4).map((p) => p.join()).sort()); // the ring starts at the closing wall
    expect(r.sel).toEqual({ t: "room", i: r.floor.rooms.length - 1 });
    expect(r.note).toBe("Room created from 4 walls");
  });
  it("wall and external give a room, dotted a zone, fence and edge a garden", () => {
    expect(made("external").floor.rooms.at(-1)).toMatchObject({ kind: "room", wk: ["external", "external", "external", "external"] });
    expect(made("boundary").floor.rooms.at(-1)).toMatchObject({ kind: "zone", wk: ["boundary", "boundary", "boundary", "boundary"] });
    expect(made("fence").floor.rooms.at(-1)).toMatchObject({ kind: "garden", wk: ["fence", "fence", "fence", "fence"] });
    expect(made("edge").floor.rooms.at(-1)).toMatchObject({ kind: "garden" });
  });
  it("an open chain stays walls", () => {
    const r = made("wall", ring.slice(0, 4));
    expect(r.floor.walls).toHaveLength(3);
    expect(r.floor.rooms).toHaveLength(ground().rooms.length);
  });
  it("a chain that comes back to an intermediate corner stays walls, with no stray wall taken", () => {
    const tail: Pt[] = [[1000, 0], [1200, 0], [1200, 100], [1100, 100], [1200, 0]]; // the ring is (1200,0),(1200,100),(1100,100); the chain starts elsewhere
    const r = made("wall", tail);
    expect(r.floor.walls).toHaveLength(4);
    expect(r.floor.rooms).toHaveLength(ground().rooms.length);
    expect(r.note).toBeUndefined();
  });
  it("a figure-eight closed on an intermediate corner stays walls", () => {
    const eight: Pt[] = [[900, 50], [1100, 50], [1200, 0], [1200, 100], [1100, 50], [1000, 0], [1000, 100], [1100, 50]];
    const r = made("wall", eight);
    expect(r.floor.walls).toHaveLength(7);
    expect(r.floor.rooms).toHaveLength(ground().rooms.length);
  });
  it("the outline is not converted", () => {
    const f = ground();
    const o = f.outline;
    const r = applyShape(f, "ground", { kind: "wall", wall: "wall", pts: [...o, o[0]] });
    expect(r.floor.outline).toEqual(f.outline);
    expect(r.floor.rooms.at(-1)!.kind).toBe("room"); // a ring drawn over the outline is a ring of walls: a room
  });
});

describe("applyShape", () => {
  const sq: Pt[] = [[1000, 0], [1200, 0], [1200, 100], [1000, 100]];

  it("adds a room with defaults and selects it", () => {
    const f = ground(), r = applyShape(f, "ground", { kind: "room", wall: "wall", pts: sq });
    const room = r.floor.rooms[f.rooms.length];
    expect(room).toEqual({ id: "room-ground-8", name: "New room", area: "new-room", label: "", kind: "room", pts: sq, wk: ["wall", "wall", "wall", "wall"] });
    expect(r.sel).toEqual({ t: "room", i: f.rooms.length });
    expect(f.rooms).toHaveLength(7); // input untouched
  });

  it("zone and water are dotted with their own names and areas", () => {
    const z = applyShape(ground(), "ground", { kind: "zone", wall: "wall", pts: sq }).floor.rooms.at(-1)!;
    expect([z.kind, z.name, z.area, z.wk]).toEqual(["zone", "New zone", "new-zone", ["boundary", "boundary", "boundary", "boundary"]]);
    const w = applyShape(ground(), "ground", { kind: "water", wall: "wall", pts: sq }).floor.rooms.at(-1)!;
    expect([w.kind, w.name, w.area, w.wk]).toEqual(["water", "New water", "", ["boundary", "boundary", "boundary", "boundary"]]);
  });

  it("a room corner drawn on another room's edge is stitched into it; a zone's is not", () => {
    const tri: Pt[] = [[250, 400], [300, 500], [200, 500]]; // (250,400) lies on the Living/Hall edge
    const room = applyShape(ground(), "ground", { kind: "room", wall: "wall", pts: tri }).floor;
    expect(room.rooms[0].pts.some((p) => p[0] === 250 && p[1] === 400)).toBe(true);
    const zone = applyShape(ground(), "ground", { kind: "zone", wall: "wall", pts: tri }).floor;
    expect(zone.rooms[0].pts).toEqual(ground().rooms[0].pts);
  });

  it("outline replaces the floor outline", () => {
    const f = applyShape(ground(), "ground", { kind: "outline", wall: "wall", pts: sq }).floor;
    expect(f.outline).toEqual(sq);
  });

  it("a wall chain makes one wall per segment, sharing points, with the chosen kind and distinct ids", () => {
    const r = applyShape(ground(), "ground", { kind: "wall", wall: "fence", pts: [[0, 700], [100, 700], [100, 800]] });
    expect(r.floor.walls).toEqual([
      { id: "wall-ground-1", a: [0, 700], b: [100, 700], kind: "fence" },
      { id: "wall-ground-2", a: [100, 700], b: [100, 800], kind: "fence" },
    ]);
    expect(r.sel).toEqual({ t: "wall", i: 1 });
  });

  it("opening and structure line", () => {
    const r = applyShape(ground(), "ground", { kind: "opening", wall: "wall", pts: [[0, 0], [120, 0]] });
    expect(r.floor.openings).toEqual([{ id: "opening-ground-1", a: [0, 0], b: [120, 0] }]);
    expect(r.sel).toEqual({ t: "opening", i: 0 });
    const x = applyShape(ground(), "ground", { kind: "extra", wall: "wall", pts: [[0, 0], [120, 0]] });
    expect(x.floor.extras).toEqual([{ id: "extra-ground-1", name: "New line", a: [0, 0], b: [120, 0] }]);
    expect(x.sel).toBeNull(); // extras have no selection type
  });
});
