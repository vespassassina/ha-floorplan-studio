import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout, Pt } from "../../src/core/schema";
import { Draw, applyShape, roomKindFor, snapRay } from "../../src/editor/draw";
import { validate, WALL_KINDS } from "../../src/core/schema";
import type { WallKind } from "../../src/core/schema";

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
  it("a ring of 13 walls stays walls and the note says why; 12 walls convert", () => {
    const n = (k: number): Pt[] => Array.from({ length: k + 1 }, (_, i): Pt => [Math.round(2000 + 100 * Math.cos(((i % k) * 2 * Math.PI) / k)), Math.round(100 * Math.sin(((i % k) * 2 * Math.PI) / k))]);
    const big = applyShape(ground(), "ground", { kind: "wall", wall: "wall", pts: n(13) });
    expect(big.floor.walls).toHaveLength(13);
    expect(big.floor.rooms).toHaveLength(ground().rooms.length);
    expect(big.note).toBe("13 walls, too many to make a room (max 12)");
    const ok = applyShape(ground(), "ground", { kind: "wall", wall: "wall", pts: n(12) });
    expect(ok.floor.walls).toHaveLength(0);
    expect(ok.note).toBe("Room created from 12 walls");
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
    expect(room).toEqual({ id: "room-ground-8", name: "New room", area: "new-room", kind: "room", pts: sq, wk: ["wall", "wall", "wall", "wall"] });
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

  it("Opus review: redrawing the outline with a different point count rebuilds owk to the new length, and validate passes", () => {
    const before = ground();
    expect(before.outline).toHaveLength(4);
    expect(before.owk).toEqual(["external", "external", "external", "external"]);
    const fivePts: Pt[] = [[0, 0], [900, 0], [900, 400], [900, 700], [0, 700]];
    const f = applyShape(before, "ground", { kind: "outline", wall: "wall", pts: fivePts }).floor;
    expect(f.owk).toHaveLength(f.outline.length); // must have owk.length === outline.length
    expect(f.owk).toEqual(["external", "external", "external", "external", "external"]);
    const l = structuredClone(demo as unknown as Layout); l.floors.ground = f;
    expect(validate(l).ok).toBe(true);
  });

  it("redrawing the outline with the same point count keeps the old kinds", () => {
    const before = ground();
    before.owk = ["none", "external", "fence", "edge"];
    const same: Pt[] = [[0, 0], [900, 0], [900, 700], [0, 700]];
    const f = applyShape(before, "ground", { kind: "outline", wall: "wall", pts: same }).floor;
    expect(f.owk).toEqual(["none", "external", "fence", "edge"]);
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
    expect(x.sel).toEqual({ t: "extra", i: 0 }); // S4.13: selected on finish, like an opening
  });
});

describe("room kind follows the ring's wall kinds (Opus review)", () => {
  it("roomKindFor: all boundary is a zone, all fence or edge a garden, anything else a room", () => {
    expect(roomKindFor(["boundary", "boundary", "boundary"])).toBe("zone");
    expect(roomKindFor(["fence", "edge", "fence"])).toBe("garden");
    expect(roomKindFor(["boundary", "wall", "boundary", "boundary"])).toBe("room");
    expect(roomKindFor(["fence", "boundary", "edge"])).toBe("room");
    expect(roomKindFor(["external", "external", "external"])).toBe("room");
  });
  it("a dotted chain that closes over an older wall makes a room, and the layout validates", () => {
    const f = ground();
    f.walls.push({ id: "old", a: [1000, 0], b: [1100, 0], kind: "wall" });
    const r = applyShape(f, "ground", { kind: "wall", wall: "boundary", pts: [[1100, 0], [1100, 100], [1000, 100], [1000, 0]] });
    const room = r.floor.rooms.at(-1)!;
    expect(room.kind).toBe("room");
    expect(room.wk.filter((k) => k === "wall")).toHaveLength(1);
    expect(room.wk.filter((k) => k === "boundary")).toHaveLength(3);
    const l = structuredClone(demo as unknown as Layout); l.floors.ground = r.floor;
    expect(validate(l).ok).toBe(true);
  });
  it("every combination of wall kinds around a 4-ring gives a room that validates", () => {
    const ring: Pt[] = [[1000, 0], [1100, 0], [1100, 100], [1000, 100]];
    let n = 0;
    for (const combo of WALL_KINDS.flatMap((a) => WALL_KINDS.flatMap((b) => WALL_KINDS.flatMap((c) => WALL_KINDS.map((d) => [a, b, c, d] as WallKind[]))))) {
      const f = ground();
      ring.forEach((p, i) => f.walls.push({ id: `w${i}`, a: p, b: ring[(i + 1) % 4], kind: combo[i] }));
      // closing wall last: the chain is the walls drawn now; older ones stay in place
      const last = f.walls.pop()!;
      const r = applyShape(f, "ground", { kind: "wall", wall: last.kind, pts: [last.a, last.b] });
      const l = structuredClone(demo as unknown as Layout); l.floors.ground = r.floor;
      expect(validate(l).ok, combo.join()).toBe(true);
      if (r.floor.rooms.length > f.rooms.length) n++;
    }
    expect(n).toBe(WALL_KINDS.length ** 4);
  });
});

describe("S4.2: drawing a room for an HA area not on the plan", () => {
  it("the new room or zone takes the area's id and name; without a preset it stays 'New room'", () => {
    const d = new Draw("room", "wall", { id: "garage_2", name: "Garage" });
    click(d, [0, 0], [100, 0], [100, 100]);
    const s = d.finish()!;
    const r = applyShape(ground(), "ground", s);
    const room = r.floor.rooms[r.floor.rooms.length - 1];
    expect(room).toMatchObject({ name: "Garage", area: "garage_2", kind: "room" });
    expect(validate({ ...(demo as unknown as Layout), floors: { ...(demo as unknown as Layout).floors, ground: r.floor } }).ok).toBe(true);
    const z = new Draw("zone", "wall", { id: "nook", name: "Nook" }); click(z, [0, 0], [100, 0], [100, 100]);
    const zf = applyShape(ground(), "ground", z.finish()!).floor;
    expect(zf.rooms[zf.rooms.length - 1]).toMatchObject({ name: "Nook", area: "nook", kind: "zone" });
    const plain = new Draw("room"); click(plain, [0, 0], [100, 0], [100, 100]);
    const pf = applyShape(ground(), "ground", plain.finish()!).floor;
    expect(pf.rooms[pf.rooms.length - 1]).toMatchObject({ name: "New room", area: "new-room" });
  });
});

describe("snapRay (S26.7)", () => {
  const polar = (deg: number, r: number): Pt => [100 + r * Math.cos((deg * Math.PI) / 180), 50 + r * Math.sin((deg * Math.PI) / 180)];
  const from: Pt = [100, 50];
  const angleOf = (p: Pt) => ((Math.atan2(p[1] - from[1], p[0] - from[0]) * 180) / Math.PI + 360) % 360;
  const len = (p: Pt) => Math.hypot(p[0] - from[0], p[1] - from[1]);

  // The plan says "352 gives 0", but 352 is 8 from 360 and 7 from 345: the nearest ray is 345. 353 and up wrap to 0.
  it("17 degrees gives 15, 23 gives 30, 352 gives 345, 353 and 358 give 0", () => {
    // The point is whole cm, so the angle is exact only to half a cm over the 200 cm run: 0.25 degrees (R1a).
    const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(0.25);
    near(angleOf(snapRay(from, polar(17, 200), 15, 10)), 15);
    near(angleOf(snapRay(from, polar(23, 200), 15, 10)), 30);
    near(angleOf(snapRay(from, polar(352, 200), 15, 10)), 345);
    for (const d of [353, 358]) {
      const a = angleOf(snapRay(from, polar(d, 200), 15, 10));
      near(Math.min(a, 360 - a), 0);
    }
  });

  it("rounds the length to the grid: 0 means 1 cm, 5 and 10 as given", () => {
    expect(len(snapRay(from, polar(0, 203.4), 15, 0))).toBeCloseTo(203, 6);
    expect(len(snapRay(from, polar(0, 203.4), 15, 5))).toBeCloseTo(205, 6);
    expect(len(snapRay(from, polar(0, 203.4), 15, 10))).toBeCloseTo(200, 6);
    expect(len(snapRay(from, polar(0, 206), 15, 10))).toBeCloseTo(210, 6);
  });

  // Opus review R1a: a stored wall end is a whole number of cm, like every other draw snap (round()).
  it("gives whole centimetres on every 15 degree multiple, for every grid", () => {
    for (let deg = 0; deg < 360; deg += 15)
      for (const grid of [0, 5, 10, 25])
        for (const r of [37, 203.4, 450.7]) {
          const q = snapRay([200, 100], [200 + r * Math.cos((deg * Math.PI) / 180), 100 + r * Math.sin((deg * Math.PI) / 180)], 15, grid);
          expect([deg, grid, r, Number.isInteger(q[0]), Number.isInteger(q[1])]).toEqual([deg, grid, r, true, true]);
        }
  });
  it("a vertical wall from (200,100) with the pointer at (202,450) ends at exactly [200,450]", () => {
    expect(snapRay([200, 100], [202, 450], 15, 10)).toEqual([200, 450]);
  });

  it("p equal to from, or junk, never throws and gives a finite point or p back", () => {
    expect(snapRay(from, [100, 50], 15, 10)).toEqual([100, 50]);
    const nan: Pt = [NaN, 3];
    expect(() => snapRay(from, nan, 15, 10)).not.toThrow();
    expect(snapRay(from, nan, 15, 10)).toEqual(nan);
    expect(snapRay([NaN, 0], [5, 5], 15, 10)).toEqual([5, 5]);
    expect(snapRay(from, [300, 80], 0, 10)).toEqual([300, 80]);
    expect(snapRay(from, [300, 80], NaN, 10)).toEqual([300, 80]);
  });

  it("does not touch its inputs", () => {
    const p: Pt = [300, 80], f: Pt = [100, 50];
    snapRay(f, p, 15, 10);
    expect(p).toEqual([300, 80]); expect(f).toEqual([100, 50]);
  });
});

describe("Draw typed length (S26.8)", () => {
  const typeAll = (d: Draw, text: string) => [...text].map((c) => d.type(c));
  const drawn = (kind: "wall" | "room" = "wall") => { const d = new Draw(kind); d.click([0, 0], TH); return d; };
  const last = (d: Draw) => d.points[d.points.length - 1];

  it("350 is centimetres along the direction to the pointer", () => {
    const d = drawn(); typeAll(d, "350");
    expect(d.typed).toBe("350");
    expect(d.placeTyped([10, 0])).toBe("add");
    expect(last(d)[0]).toBeCloseTo(350, 9); expect(last(d)[1]).toBeCloseTo(0, 9);
    expect(d.typed).toBe(""); // consumed
  });

  it("3.5m is metres; the direction is the pointer's, whatever its distance", () => {
    const d = drawn(); typeAll(d, "3.5m");
    expect(d.placeTyped([0, -9999])).toBe("add");
    expect(last(d)[0]).toBeCloseTo(0, 9); expect(last(d)[1]).toBeCloseTo(-350, 9);
    const e = drawn(); typeAll(e, "200");
    e.placeTyped([30, 40]); // 3-4-5 direction
    expect(Math.hypot(...last(e))).toBeCloseTo(200, 9);
    expect(last(e)[0]).toBeCloseTo(120, 9);
  });

  it("the stored end is whole cm: a 350 cm wall at 15 degrees ends on integers, within 0.71 cm of the typed length", () => {
    const d = drawn(); typeAll(d, "350");
    const a = (15 * Math.PI) / 180;
    d.placeTyped([Math.cos(a) * 40, Math.sin(a) * 40]);
    const [x, y] = last(d);
    expect(Number.isInteger(x)).toBe(true); expect(Number.isInteger(y)).toBe(true);
    expect(Math.abs(Math.hypot(x, y) - 350)).toBeLessThan(0.71);
    expect(Math.abs((Math.atan2(y, x) * 180) / Math.PI - 15)).toBeLessThan(0.12);
  });

  it("refuses and adds nothing: empty, 0, negative, over 10 000 cm, no point yet, no direction", () => {
    const d = drawn();
    expect(d.placeTyped([100, 0])).toBe("ignore"); // empty
    for (const t of ["0", "0m", "0.0", "10001", "100.01m", "."]) {
      d.typed = ""; typeAll(d, t);
      expect(d.placeTyped([100, 0]), t).toBe("ignore");
      expect(d.points, t).toHaveLength(1);
    }
    expect(d.type("-")).toBe(false); // a minus cannot be typed...
    d.typed = "-5"; // ...and a buffer set by hand is still refused
    expect(d.placeTyped([100, 0])).toBe("ignore");
    expect(d.points).toHaveLength(1);
    const none = new Draw("wall"); typeAll(none, "100");
    expect(none.placeTyped([100, 0])).toBe("ignore");
    expect(none.points).toEqual([]);
    const same = drawn(); typeAll(same, "100");
    expect(same.placeTyped([0, 0])).toBe("ignore"); // pointer on the last point: no direction
    expect(same.placeTyped([NaN, 0])).toBe("ignore");
    expect(same.points).toHaveLength(1);
  });

  it("10 000 cm itself is allowed", () => {
    const d = drawn(); typeAll(d, "10000");
    expect(d.placeTyped([1, 0])).toBe("add");
    const e = drawn(); typeAll(e, "100m");
    expect(e.placeTyped([1, 0])).toBe("add");
  });

  it("type takes digits, one dot, and a closing m; nothing else", () => {
    const d = drawn();
    expect(typeAll(d, "1a.2.3m4")).toEqual([true, false, true, true, false, true, true, false]);
    expect(d.typed).toBe("1.23m");
    expect(d.type("")).toBe(false); expect(d.type("12")).toBe(false);
    const e = drawn();
    expect(e.type("m")).toBe(false); // m needs a number first
    expect(e.type(".")).toBe(true);
  });

  it("untype removes the last character; an empty buffer stays empty", () => {
    const d = drawn(); typeAll(d, "12");
    d.untype(); expect(d.typed).toBe("1");
    d.untype(); d.untype(); expect(d.typed).toBe("");
  });

  it("the buffer is bounded", () => {
    const d = drawn(); typeAll(d, "1".repeat(30));
    expect(d.typed.length).toBeLessThanOrEqual(8);
  });

  it("cancel, finish and a click clear the buffer; a refusal keeps it", () => {
    const a = drawn(); typeAll(a, "5"); a.cancel(); expect(a.typed).toBe("");
    const b = drawn(); typeAll(b, "5"); b.click([100, 0], TH); expect(b.typed).toBe("");
    const c = drawn(); c.click([100, 0], TH); typeAll(c, "5"); c.finish(); expect(c.typed).toBe("");
    const d = drawn(); typeAll(d, "0"); d.placeTyped([5, 0]); expect(d.typed).toBe("0");
  });

  it("an opening finishes on its second point, like a click", () => {
    const d = new Draw("opening"); d.click([0, 0], TH); typeAll(d, "90");
    expect(d.placeTyped([1, 0])).toBe("finish");
    expect(d.finish()!.pts[1][0]).toBeCloseTo(90, 9);
  });
});
