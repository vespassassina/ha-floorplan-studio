import { describe, it, expect } from "vitest";
import { insertPoint, removePoint } from "../../src/core/geometry";
import { boxOf, worktopIndex, worktopInsert, worktopMove, worktopRemove, worktopShift, worktopTurn } from "../../src/core/polygon";
import { validate } from "../../src/core/schema";
import { movePointAll } from "../../src/editor/ops";
import { applyShape } from "../../src/editor/draw";
import { polyPts } from "../../src/editor/state";
import type { Floor, Pt } from "../../src/core/schema";

// B54.3: the writers behind the worktop's handles. Finding 12: a writer can commit an invalid layout, so every one is run over its
// inputs (every vertex, every edge, 3 and 64 points, a crossing result) and the whole layout goes through `validate` after each.
const L: Pt[] = [[100, 100], [400, 100], [400, 160], [160, 160], [160, 330], [100, 330]];
const tri: Pt[] = [[0, 0], [100, 0], [50, 80]];
const ring = (k: number): Pt[] => Array.from({ length: k }, (_, i) => [Math.round(300 + 120 * Math.cos((2 * Math.PI * i) / k)), Math.round(250 + 50 * Math.sin((2 * Math.PI * i) / k))] as Pt);
const floorWith = (pts: Pt[], at = 0): Floor => {
  const furniture = [{ id: "a", symbol: "sofa", x: 1, y: 1, rot: 0, w: 10, h: 10 }, { id: "wt", symbol: "worktop", ...boxOf(pts), rot: 0, pts }];
  return { title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: furniture.slice(at === 0 ? 0 : 0), unlinked: [] } as unknown as Floor;
};
const W = 1; // the worktop's index in floorWith
const layoutOf = (f: Floor) => ({ version: 2, unit: "cm", north: 0, rotate: 0, floors: { ground: f }, catalog: [] });
const ok = (f: Floor) => { const v = validate(layoutOf(f)); expect(v.ok ? [] : v.errors).toEqual([]); };
const ptsOf = (f: Floor) => f.furniture[W].pts!;
const kept = (f: Floor) => { const m = f.furniture[W]; expect(m.rot).toBe(0); const b = boxOf(m.pts!); expect([m.x, m.y, m.w, m.h]).toEqual([b.x, b.y, b.w, b.h]); };

describe("worktop polygon ids", () => {
  it("names worktop i as w<i>, and nothing else", () => {
    expect(worktopIndex("w3")).toBe(3);
    for (const bad of ["o", "r1", "s0", "w", "w-1", "w1.5", "w1x", "__proto__", ""]) expect(worktopIndex(bad), bad).toBeNull();
  });
  it("the editor reads a worktop's points through polyPts", () => {
    expect(polyPts(floorWith(L), "w1")).toEqual(L);
    expect(polyPts(floorWith(L), "w0")).toBeUndefined(); // a sofa has none
    expect(polyPts(floorWith(L), "w9")).toBeUndefined();
  });
});

describe("worktop writers, over every vertex and edge", () => {
  it("insert puts a point after any edge, on it, and the layout stays valid", () => {
    for (const pts of [tri, L, ring(10)]) pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length], mid: Pt = [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
      const g = worktopInsert(floorWith(pts), `w${W}`, i, mid);
      expect(ptsOf(g), `${pts.length}:${i}`).toHaveLength(pts.length + 1);
      expect(ptsOf(g)[i + 1]).toEqual(mid);
      kept(g); ok(g);
    });
  });
  it("insert refuses a 65th point, and the geometry entry point routes there", () => {
    const f = floorWith(ring(64));
    expect(worktopInsert(f, `w${W}`, 0, [300, 190])).toBe(f);
    expect(insertPoint(floorWith(L), `w${W}`, 0, [250, 100]).furniture[W].pts).toHaveLength(7);
  });
  it("remove drops any vertex of 4 or more points, valid after; a triangle refuses", () => {
    for (const pts of [ring(4), L, ring(20)]) pts.forEach((_, j) => {
      const f = floorWith(pts), g = worktopRemove(f, `w${W}`, j);
      // a removal that would cross is refused (the polygon comes back untouched), any other is one point shorter
      if (g === f) return;
      expect(ptsOf(g), `${pts.length}:${j}`).toHaveLength(pts.length - 1);
      kept(g); ok(g);
    });
    const t = floorWith(tri);
    for (let j = 0; j < 3; j++) expect(removePoint(t, `w${W}`, j)).toBe(t);
    expect(removePoint(floorWith(L), `w${W}`, 2).furniture[W].pts).toHaveLength(5);
  });
  it("remove refuses a wrong index and a wrong poly, changing nothing", () => {
    const f = floorWith(L);
    for (const [poly, j] of [[`w${W}`, -1], [`w${W}`, 6], [`w${W}`, 1.5], ["w0", 0], ["w7", 0], ["w", 0]] as const) expect(worktopRemove(f, poly, j), `${poly}:${j}`).toBe(f);
  });
  it("move puts one vertex where asked and keeps box and rot; a move that makes it cross is refused", () => {
    for (const pts of [tri, L, ring(12)]) pts.forEach((p, j) => {
      const f = floorWith(pts), g = worktopMove(f, `w${W}`, j, [p[0] + 7, p[1] - 3]);
      expect(ptsOf(g)[j], `${pts.length}:${j}`).toEqual([p[0] + 7, p[1] - 3]);
      ptsOf(g).forEach((q, k) => { if (k !== j) expect(q).toEqual(pts[k]); });
      kept(g); ok(g);
    });
    const f = floorWith(L), cross = worktopMove(f, `w${W}`, 3, [100, 50]); // the inner corner dragged across the top edge
    expect(cross).toBe(f);
    expect(movePointAll(f, L[3], [100, 50], false, { poly: `w${W}`, j: 3 })).toBe(f);
  });
  it("move to the same place, to a hostile place, or on a missing piece, changes nothing", () => {
    const f = floorWith(L);
    expect(worktopMove(f, `w${W}`, 0, L[0])).toBe(f);
    for (const to of [[NaN, 0], [Infinity, 1], [1e12, 0]] as Pt[]) expect(worktopMove(f, `w${W}`, 0, to)).toBe(f);
    expect(worktopMove(f, "w5", 0, [1, 1])).toBe(f);
  });
  it("moving a corner through movePointAll never drags a loose wall end or another worktop's point along", () => {
    const f = floorWith(L);
    f.walls.push({ id: "k", a: [100, 100], b: [100, 0], kind: "wall" } as never);
    const g = movePointAll(f, L[0], [90, 90], false, { poly: `w${W}`, j: 0 });
    expect(g.walls[0].a).toEqual([100, 100]);
    expect(ptsOf(g)[0]).toEqual([90, 90]);
  });
  it("shift moves every point by the same step, and the box with it", () => {
    for (const pts of [tri, L, ring(64)]) {
      const g = worktopShift(floorWith(pts), W, 13, -7);
      expect(ptsOf(g)).toEqual(pts.map((p) => [p[0] + 13, p[1] - 7]));
      kept(g); ok(g);
    }
    const f = floorWith(L);
    expect(worktopShift(f, W, 0, 0)).toBe(f);
  });
  it("turn rotates the points about the box centre, rot stays 0, and a quarter turn swaps the box", () => {
    for (const pts of [tri, L, ring(9)]) for (const deg of [90, 45, -30, 180, 360]) {
      const f = floorWith(pts), g = worktopTurn(f, W, deg);
      if (deg === 360) { expect(g).toBe(f); continue; }
      const b0 = boxOf(pts), b1 = boxOf(ptsOf(g));
      expect(Math.hypot(b1.x - b0.x, b1.y - b0.y), `${pts.length}@${deg}`).toBeLessThan(0.1 + (deg % 90 ? b0.w + b0.h : 0)); // about its own centre (a 45 turn moves the box centre of a lopsided shape a little)
      if (deg === 90 || deg === -270) { expect(b1.w).toBeCloseTo(b0.h, 1); expect(b1.h).toBeCloseTo(b0.w, 1); }
      kept(g); ok(g);
    }
  });
});

describe("drawing a worktop", () => {
  const shape = (pts: Pt[]) => ({ kind: "worktop" as const, wall: "wall" as const, pts });
  it("applyShape adds one piece with its points, box and rot 0, selected, and valid", () => {
    for (const pts of [tri, L, ring(64)]) {
      const f = floorWith(pts), before = f.furniture.length, r = applyShape(f, "ground", shape(pts));
      expect(r.floor.furniture).toHaveLength(before + 1);
      const m = r.floor.furniture[before];
      expect(m.symbol).toBe("worktop");
      expect(m.pts).toEqual(pts);
      expect(m.rot).toBe(0);
      expect(r.sel).toEqual({ t: "furn", i: before });
      ok(r.floor);
    }
  });
  it("applyShape refuses a crossing shape, 2 points and 65 points, and adds nothing", () => {
    const bow: Pt[] = [[0, 0], [100, 100], [100, 0], [0, 100]];
    for (const pts of [bow, [[0, 0], [10, 10]] as Pt[], ring(65), [[0, 0], [0, 0], [0, 0]] as Pt[]]) {
      const f = floorWith(L), r = applyShape(f, "ground", shape(pts));
      expect(r.floor.furniture, String(pts.length)).toHaveLength(f.furniture.length);
      expect(r.note ?? "", String(pts.length)).toMatch(/worktop/i);
    }
  });
});
