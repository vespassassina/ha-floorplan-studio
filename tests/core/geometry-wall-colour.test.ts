// B53.9: `Room.wc` and `Floor.owc` run parallel to `wk` and `owk`. Every edit that splices the kinds must splice the colours
// (CLAUDE.md finding 12): a writer can commit an invalid layout, and Save then refuses a length that no longer matches.
import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Floor, Pt, WallKind } from "../../src/core/schema";
import { validate } from "../../src/core/schema";
import { insertPoint, removePoint, stitch, deleteEdge, mergeCorners } from "../../src/core/geometry";

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const COL = ["#aa0000", null, "#00bb00", "#0000cc"] as (string | null)[];
const room = (id: string, pts: Pt[], wc?: (string | null)[]) => ({ id, name: id, area: id, label: "", kind: "room" as const, pts, wk: pts.map((): WallKind => "wall"), ...(wc ? { wc } : {}) });
const floor = (): Floor => ({
  ...(structuredClone(demo.floors.ground) as unknown as Floor),
  outline: rect(0, 0, 200, 100), owk: ["external", "external", "external", "external"], owc: [...COL],
  rooms: [room("a", rect(0, 0, 100, 100), [...COL]), room("b", rect(100, 0, 200, 100), [...COL])],
  stairs: [], doors: [], walls: [], openings: [], extras: [], devices: [], furniture: [],
});
const parallel = (f: Floor) => {
  expect(f.owc!.length).toBe(f.outline.length);
  for (const r of f.rooms) expect(r.wc!.length).toBe(r.pts.length);
};

describe("wc and owc follow the points", () => {
  it("insertPoint copies the colour of the edge it splits", () => {
    const g = insertPoint(floor(), "r0", 2, [50, 100]);
    parallel(g);
    expect(g.rooms[0].wc).toEqual(["#aa0000", null, "#00bb00", "#00bb00", "#0000cc"]);
    const o = insertPoint(floor(), "o", 0, [100, 0]);
    parallel(o);
    expect(o.owc).toEqual(["#aa0000", "#aa0000", null, "#00bb00", "#0000cc"]);
  });
  it("removePoint drops the colour of the removed point's edge", () => {
    const g = removePoint(floor(), "r0", 1);
    parallel(g);
    expect(g.rooms[0].wc).toEqual(["#aa0000", "#00bb00", "#0000cc"]);
    const o = removePoint(floor(), "o", 3);
    parallel(o);
    expect(o.owc).toEqual(["#aa0000", null, "#00bb00"]);
  });
  it("stitch splits the colour on every polygon it cuts", () => {
    // (100, 50) lies on the shared edge x=100 and on neither polygon's corner.
    const g = stitch(floor(), [100, 50]);
    parallel(g);
    expect(g.rooms[0].pts.length).toBe(5);
    expect(g.rooms[1].pts.length).toBe(5);
  });
  it("deleteEdge keeps the colours of the pieces it cuts", () => {
    const f = floor();
    const g = deleteEdge(f, "o", 0);
    parallel(g);
    const h = deleteEdge(f, "r0", 1); // the shared edge, cut where the segment ends
    parallel(h);
  });
  it("a half-edge delete cuts a longer edge and both pieces keep the colour", () => {
    const f = floor();
    f.rooms[0].pts = rect(0, 0, 100, 100);
    f.walls = [];
    const g = deleteEdge({ ...f, rooms: [f.rooms[0], { ...room("c", [[0, 0], [50, 0], [50, 50], [0, 50]], [...COL]) }] }, "r1", 0);
    parallel(g);
  });
  it("mergeCorners drops the colour with the doubled corner", () => {
    const f = floor();
    f.rooms[0].pts = [[0, 0], [1, 0], [100, 0], [100, 100], [0, 100]];
    f.rooms[0].wk = ["wall", "wall", "wall", "wall", "wall"];
    f.rooms[0].wc = ["#aa0000", "#111111", "#00bb00", "#0000cc", "#222222"];
    f.rooms[1].pts = rect(100, 0, 200, 100);
    const g = mergeCorners(f, 3);
    parallel(g);
    expect(g.rooms[0].pts.length).toBe(4);
    expect(g.rooms[0].wc).toEqual(["#111111", "#00bb00", "#0000cc", "#222222"]);
  });
  it("a floor without wc stays without it", () => {
    const f = floor();
    delete f.owc;
    for (const r of f.rooms) delete r.wc;
    for (const g of [insertPoint(f, "r0", 0, [50, 0]), removePoint(f, "r0", 1), stitch(f, [100, 50]), mergeCorners(f, 3), deleteEdge(f, "o", 0)]) {
      expect(g.owc).toBeUndefined();
      expect(g.rooms.every((r) => r.wc === undefined)).toBe(true);
    }
  });
  it("every edit leaves a floor that validates", () => {
    const wrap = (fl: Floor) => ({ version: 2, floors: { ground: fl } });
    const base = demo as unknown as { [k: string]: unknown };
    for (const g of [insertPoint(floor(), "o", 1, [200, 50]), removePoint(floor(), "r1", 0), stitch(floor(), [100, 50]), mergeCorners(floor(), 3), deleteEdge(floor(), "o", 0)]) {
      const layout = { ...structuredClone(base), floors: { ...(structuredClone(base).floors as object), ground: g } };
      const res = validate(layout as never);
      const errs = res.ok ? [] : res.errors;
      expect(errs.filter((e) => /wc|owc/.test(e)), wrap(g).version + "").toEqual([]);
    }
  });
});
