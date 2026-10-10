import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import stress from "../fixtures/stress-layout.json";
import house from "../fixtures/align-house.json";
import { alignFloor, alignKey } from "../../src/core/align";
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

  it("lays a floor that is only a few cm off, in x, y and diagonal (review 27, finding 1)", () => {
    const l = clone(house) as unknown as Layout;
    const up = l.floors.first;
    for (const d of [1.5, 3, 4.5, 6, 9, 12]) {
      for (const [dx, dy] of [[d, 0], [0, -d * 0.7], [d * 0.8, d * 0.6]]) {
        // Stored, the first floor is 137.4 / -61.7 off the ground floor; start from laid on it, then d off.
        const mv = (p: [number, number]): [number, number] => [p[0] - 137.4 + dx, p[1] + 61.7 + dy];
        const moved: Floor = { ...up, outline: up.outline.map(mv), walls: up.walls.map((w) => ({ ...w, a: mv(w.a), b: mv(w.b) })), rooms: up.rooms.map((r) => ({ ...r, pts: r.pts.map(mv) })) };
        const r = alignFloor(moved, l.floors.ground)!;
        const ex = Math.abs(r.t[0] + dx), ey = Math.abs(r.t[1] + dy);
        expect(Math.max(ex, ey), `off by ${dx},${dy}`).toBeLessThan(1);
      }
    }
  });

  it("lays a plain rectangle that is 8 cm off", () => {
    const lower = blank(rect(0, 0, 800, 400));
    for (const [dx, dy] of [[8, 0], [0, -8], [-5.6, 5.6], [1.5, 0], [3, 3]]) {
      const r = alignFloor(blank(rect(dx, dy, 800 + dx, 400 + dy)), lower)!;
      expect(Math.abs(r.t[0] + dx), `dx ${dx} dy ${dy}`).toBeLessThan(1);
      expect(Math.abs(r.t[1] + dy), `dx ${dx} dy ${dy}`).toBeLessThan(1);
    }
  });

  it("a tie goes to the smaller move whatever the corner order (review 27, finding 2)", () => {
    const lower = blank(rect(0, 0, 1000, 1000));
    const r = alignFloor(blank(rect(150, 820, 250, 920)), lower)!;
    expect(Math.abs(r.t[0] - -150)).toBeLessThan(2);
    expect(Math.abs(r.t[1] - 80)).toBeLessThan(2);
    const r2 = alignFloor(blank(rect(700, 150, 800, 250)), lower)!;
    expect(Math.abs(r2.t[0] - 200)).toBeLessThan(2);
    expect(Math.abs(r2.t[1] - -150)).toBeLessThan(2);
    const r3 = alignFloor(blank(rect(100, 100, 200, 200)), lower)!;
    expect(Math.abs(r3.t[0] - -100)).toBeLessThan(2);
    expect(Math.abs(r3.t[1] - -100)).toBeLessThan(2);
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

  it("a smaller floor near one corner stays in that corner (review 27 re-check, blocker)", () => {
    // Near corner scored 50.0 on the rough samples, far corners 52.4: the near one was dropped and never refined.
    const r = alignFloor(blank(rect(26, 23.7, 861, 229.7)), blank(rect(0, 0, 1341, 422)))!;
    expect(Math.abs(r.t[0] - -26)).toBeLessThan(2);
    expect(Math.abs(r.t[1] - -23.7)).toBeLessThan(2);
  });

  it("200 seeded smaller floors, each a few cm off one corner of the lower one, never land in another corner", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let wrong = 0;
    for (let n = 0; n < 200; n++) {
      const W = 600 + rnd() * 1000, H = 300 + rnd() * 500;
      const w = W * (0.3 + rnd() * 0.5), h = H * (0.3 + rnd() * 0.5);
      const ox = rnd() * 40, oy = rnd() * 40;
      const corner = n % 4, left = corner % 2 === 0, top = corner < 2;
      const x0 = left ? ox : W - ox - w, y0 = top ? oy : H - oy - h;
      const r = alignFloor(blank(rect(x0, y0, x0 + w, y0 + h)), blank(rect(0, 0, W, H)))!;
      const ex = left ? -ox : ox, ey = top ? -oy : oy;
      if (Math.abs(r.t[0] - ex) > 3 || Math.abs(r.t[1] - ey) > 3) wrong++;
    }
    expect(wrong).toBe(0);
  });

  it("a rectangle a few cm inside a larger floor lands within 0.5 cm on each axis (review 27 re-check, minor)", () => {
    const lower = blank(rect(0, 0, 900, 700));
    for (const o of [2, 0.5, 3.5]) {
      const r = alignFloor(blank(rect(o, o, o + 500, o + 300)), lower)!;
      expect(Math.abs(r.t[0] + o), `o ${o}`).toBeLessThan(0.5);
      expect(Math.abs(r.t[1] + o), `o ${o}`).toBeLessThan(0.5);
    }
  });
});

describe("alignKey (S28.12)", () => {
  const base = (): Floor => ({
    ...blank(rect(0, 0, 800, 600)), owk: ["external", "external", "external", "external"],
    walls: [{ a: [0, 0], b: [800, 0], kind: "external" } as any, { a: [400, 0], b: [400, 600], kind: "internal" } as any],
  });

  it("is equal for a floor and its copy with another offset, another title and a moved internal wall", () => {
    const a = base(), b = clone(a);
    b.offset = [137.4, -61.7]; b.title = "Other"; (b.walls[1] as any).a = [450, 0];
    expect(alignKey(b)).toBe(alignKey(a));
    expect(typeof alignKey(a)).toBe("string");
  });

  it("differs for a moved outline point, an added external wall and a changed owk", () => {
    const a = base(), k = alignKey(a);
    const moved = clone(a); moved.outline[2] = [800, 601];
    const added = clone(a); added.walls.push({ a: [0, 600], b: [800, 600], kind: "external" } as any);
    const kind = clone(a); kind.owk = ["external", "external", "window", "external"] as any;
    const keys = [alignKey(moved), alignKey(added), alignKey(kind)];
    for (const x of keys) expect(x).not.toBe(k);
    expect(new Set(keys).size).toBe(3);
  });

  it("follows the rooms only when there is no outline and no external wall (what the search reads)", () => {
    const room = (x: number) => ({ ...blank(), rooms: [{ name: "R", kind: "living", pts: rect(x, 0, x + 300, 300) }] }) as unknown as Floor;
    expect(alignKey(room(0))).not.toBe(alignKey(room(5)));
  });

  it("never throws on junk", () => {
    for (const j of [null, undefined, 5, "x", [], {}, { outline: 5, walls: "w", rooms: 7, owk: { a: 1 } }, { outline: [[NaN, 1], null, "a"], walls: [null, { a: 3 }], rooms: [null] }, { walls: [{ kind: "external", a: [Infinity, 0], b: [1, 1] }] }]) {
      expect(() => alignKey(j as any), JSON.stringify(j)).not.toThrow();
      expect(typeof alignKey(j as any)).toBe("string");
    }
    const circ: any = { outline: [] }; circ.self = circ;
    expect(() => alignKey(circ)).not.toThrow();
  });
});

