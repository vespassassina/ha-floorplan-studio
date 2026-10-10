import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import stress from "../fixtures/stress-layout.json";
import house from "../fixtures/align-house.json";
import { alignFloor } from "../../src/core/align";
import { validate } from "../../src/core/schema";
import type { Floor, Layout } from "../../src/core/schema";

const blank = (outline: [number, number][] = []): Floor => ({
  title: "T", outline, rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [],
});
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const clone = <T,>(x: T): T => structuredClone(x);

describe("alignFloor (S27.4)", () => {
  it("the fixture is a valid layout", () => {
    expect(validate(house).ok).toBe(true);
  });

  it("aligns the first floor of the L-shaped house within 2 cm, score over 90 %", () => {
    const l = house as unknown as Layout;
    const r = alignFloor(l.floors.first, l.floors.ground);
    expect(r).not.toBeNull();
    // The first floor is stored shifted by [137.4, -61.7], so the move that lays it back is the opposite.
    expect(Math.abs(r!.t[0] - -137.4)).toBeLessThan(2);
    expect(Math.abs(r!.t[1] - 61.7)).toBeLessThan(2);
    expect(r!.score).toBeGreaterThan(90);
    expect(r!.weak).toBe(false);
  });

  it("finds the move whichever way the shift points", () => {
    const l = clone(house) as unknown as Layout;
    for (const [dx, dy] of [[300, 200], [-480, 33.3], [7, -250], [0.5, 0.5]]) {
      const up = l.floors.first;
      const moved: Floor = { ...up, outline: up.outline.map(([x, y]) => [x + dx, y + dy] as [number, number]), walls: up.walls.map((w) => ({ ...w, a: [w.a[0] + dx, w.a[1] + dy], b: [w.b[0] + dx, w.b[1] + dy] })) };
      const r = alignFloor(moved, l.floors.ground)!;
      // Stored first floor sits at +[137.4,-61.7]; moving it by [dx,dy] more asks for the opposite sum.
      expect(Math.abs(r.t[0] - (-137.4 - dx))).toBeLessThan(2);
      expect(Math.abs(r.t[1] - (61.7 - dy))).toBeLessThan(2);
    }
  });

  it("the demo's identical floors give [0, 0] and 100 %", () => {
    const l = demo as unknown as Layout;
    const r = alignFloor(l.floors.first, l.floors.ground)!;
    expect(r.t).toEqual([0, 0]);
    expect(r.score).toBe(100);
    expect(r.weak).toBe(false);
  });

  it("a tie goes to the smaller move", () => {
    // A 400 wide box over a 800 wide one: flush left (t = -300) and flush right (t = +100) both fit three sides.
    const lower = blank(rect(0, 0, 800, 400));
    const upper = blank(rect(300, 0, 700, 400));
    const r = alignFloor(upper, lower)!;
    expect(Math.abs(r.t[0] - 100)).toBeLessThan(2);
    expect(Math.abs(r.t[1])).toBeLessThan(2);
    // The mirror case picks the left end.
    const r2 = alignFloor(blank(rect(100, 0, 500, 400)), lower)!;
    expect(Math.abs(r2.t[0] - -100)).toBeLessThan(2);
  });

  it("a floor that matches nothing is weak, and says so", () => {
    const lower = blank(rect(0, 0, 800, 400));
    const upper = blank([[0, 0], [90, 130], [200, 0]]);
    const r = alignFloor(upper, lower);
    expect(r).not.toBeNull();
    expect(r!.score).toBeLessThan(50);
    expect(r!.weak).toBe(true);
  });

  it("uses external walls, and falls back to room edges when there is no outline", () => {
    const lower = blank();
    lower.rooms.push({ id: "r", name: "R", area: "", kind: "room", pts: rect(0, 0, 500, 300), wk: [] });
    const upper = blank();
    upper.rooms.push({ id: "r", name: "R", area: "", kind: "room", pts: rect(120, 80, 620, 380), wk: [] });
    const r = alignFloor(upper, lower)!;
    expect(r.t[0]).toBeCloseTo(-120, 0);
    expect(r.t[1]).toBeCloseTo(-80, 0);
    // An external wall counts where there is no outline.
    const a = blank(), b = blank();
    b.walls.push({ id: "w", a: [0, 0], b: [400, 0], kind: "external" }, { id: "w2", a: [400, 0], b: [400, 300], kind: "external" });
    a.walls.push({ id: "w", a: [50, 70], b: [450, 70], kind: "external" }, { id: "w2", a: [450, 70], b: [450, 370], kind: "external" });
    const r2 = alignFloor(a, b)!;
    expect(r2.t[0]).toBeCloseTo(-50, 0);
    expect(r2.t[1]).toBeCloseTo(-70, 0);
    // An inner wall is not structure.
    const c = blank(rect(0, 0, 100, 100));
    c.walls.push({ id: "i", a: [0, 50], b: [100, 50], kind: "wall" });
    const d = blank(rect(0, 0, 100, 100));
    expect(alignFloor(c, d)!.score).toBe(100);
  });

  it("never throws, and returns null when there is nothing to match", () => {
    const e = blank();
    expect(alignFloor(e, e)).toBeNull();
    expect(alignFloor(blank(rect(0, 0, 10, 10)), e)).toBeNull();
    expect(alignFloor(e, blank(rect(0, 0, 10, 10)))).toBeNull();
    const junk = [null, undefined, 5, "x", [], {}, { outline: 5, rooms: 5, walls: "x" }, { outline: [[NaN, 0], [0, NaN], [Infinity, 1]], rooms: [null, 5], walls: [null, { a: 1, b: 2 }] }];
    for (const a of junk) for (const b of junk) expect(() => alignFloor(a as any, b as any)).not.toThrow();
    const nan = blank([[NaN, NaN], [1, NaN], [NaN, 4]]);
    expect(alignFloor(nan, blank(rect(0, 0, 100, 100)))).toBeNull();
    const mixed = blank([[0, 0], [NaN, 0], [100, 0], [100, 100], [0, 100]]);
    expect(() => alignFloor(mixed, blank(rect(0, 0, 100, 100)))).not.toThrow();
  });

  it("a 10 000-point outline gives a result or null, and is quick", () => {
    const big: [number, number][] = [];
    for (let i = 0; i < 10000; i++) big.push([Math.round(5000 * Math.cos((i / 10000) * 2 * Math.PI)), Math.round(5000 * Math.sin((i / 10000) * 2 * Math.PI))]);
    const a = blank(big), b = blank(big.map(([x, y]) => [x + 40, y - 25] as [number, number]));
    const t0 = performance.now();
    const r = alignFloor(a, b);
    const ms = performance.now() - t0;
    expect(r === null || typeof r.score === "number").toBe(true);
    if (r) { expect(Math.abs(r.t[0] - 40)).toBeLessThan(5); expect(Math.abs(r.t[1] + 25)).toBeLessThan(5); }
    expect(ms).toBeLessThan(8000);
  });

  it("the stress layout's floors align in under 200 ms", () => {
    const l = stress as unknown as Layout;
    const keys = Object.keys(l.floors);
    for (let i = 1; i < keys.length; i++) {
      const t0 = performance.now();
      const r = alignFloor(l.floors[keys[i]], l.floors[keys[i - 1]]);
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(200);
      if (r) { expect(Number.isFinite(r.t[0]) && Number.isFinite(r.t[1])).toBe(true); expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100); }
    }
  });
});
