import { describe, it, expect } from "vitest";
import { FURNITURE_SYMBOLS, validate, type Layout, type Pt } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";
import { isSimplePolygon, boxOf } from "../../src/core/polygon";
import { FURNITURE_AREAS, FURNITURE_LABELS } from "../../src/editor/furniture-menu";

// B54.1, spec item 20 and criterion 4: a worktop is a furniture piece with `pts`, a simple polygon of 3 to 64 points.
// Layout files are untrusted (finding 1): validate never throws and migrate copies `pts` only where validate accepts it.
const ring = (n: number): Pt[] => Array.from({ length: n }, (_, i) => [200 + 100 * Math.cos((2 * Math.PI * i) / n), 200 + 60 * Math.sin((2 * Math.PI * i) / n)] as Pt);
const tee: Pt[] = [[0, 0], [300, 0], [300, 60], [160, 60], [160, 200], [140, 200], [140, 60], [0, 60]];
const worktop = (pts: unknown, extra: Record<string, unknown> = {}) => ({ id: "w1", symbol: "worktop", x: 200, y: 200, rot: 0, w: 200, h: 120, pts, ...extra });
const layoutOf = (m: unknown) => ({ version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { Ground: { title: "G", outline: [[0, 0], [1000, 0], [1000, 800], [0, 800]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [m], unlinked: [] } } });
const errorsOf = (m: unknown): string[] => { const r = validate(layoutOf(m)); return r.ok ? [] : r.errors; };
const furnitureOf = (l: unknown) => (l as Layout).floors.Ground.furniture[0] as unknown as Record<string, unknown>;

describe("isSimplePolygon", () => {
  it("accepts a triangle, a ring of 64 and a concave tee", () => {
    expect(isSimplePolygon([[0, 0], [10, 0], [0, 10]])).toBe(true);
    expect(isSimplePolygon(ring(64))).toBe(true);
    expect(isSimplePolygon(tee)).toBe(true);
  });
  it("refuses a bow tie, a repeated point, a collinear spike and a flat polygon", () => {
    expect(isSimplePolygon([[0, 0], [100, 100], [100, 0], [0, 100]])).toBe(false);
    expect(isSimplePolygon([[0, 0], [100, 0], [100, 0], [0, 100]])).toBe(false);
    expect(isSimplePolygon([[0, 0], [100, 0], [50, 0], [50, 80]])).toBe(false);
    expect(isSimplePolygon([[0, 0], [50, 0], [100, 0]])).toBe(false);
  });
  it("refuses a vertex that touches another edge", () => {
    expect(isSimplePolygon([[0, 0], [100, 0], [100, 100], [50, 0], [0, 100]])).toBe(false);
  });
});

describe("boxOf", () => {
  it("is the bounding box's centre and size", () => {
    expect(boxOf([[10, 20], [110, 20], [10, 100]])).toEqual({ x: 60, y: 60, w: 100, h: 80 });
  });
});

describe("validate: worktop", () => {
  it("accepts 3, 6 and 64 points and a concave tee", () => {
    for (const p of [ring(3), ring(6), ring(64), tee]) expect(errorsOf(worktop(p)), String(p.length)).toEqual([]);
  });
  it("refuses a worktop with no pts, 2 points, 65 points, a non-finite point, a crossing, and names the piece", () => {
    const bad: [string, unknown][] = [["none", undefined], ["two", ring(3).slice(0, 2)], ["65", ring(65)], ["NaN", [[0, 0], [10, 0], [NaN, 5]]], ["Infinity", [[0, 0], [10, 0], [Infinity, 5]]],
      ["bow tie", [[0, 0], [100, 100], [100, 0], [0, 100]]], ["not a list", 5], ["string points", [["a", "b"], [1, 2], [3, 4]]], ["short point", [[0], [1, 2], [3, 4]]], ["far", [[0, 0], [10, 0], [1e8, 5]]]];
    for (const [label, p] of bad) { const e = errorsOf(worktop(p)); expect(e.length, label).toBeGreaterThan(0); expect(e.join("\n"), label).toMatch(/w1/); }
  });
  it("refuses pts on every other symbol", () => {
    for (const s of FURNITURE_SYMBOLS.filter((x) => x !== "worktop")) expect(errorsOf({ ...worktop(ring(4)), symbol: s }).join("\n"), s).toMatch(/w1 pts is only allowed on a worktop/);
  });
  it("never throws on hostile pieces", () => {
    for (const m of [worktop({ length: 5, 0: 1 }), worktop([null, null, null]), worktop([{}, {}, {}]), worktop(Symbol.iterator), worktop([[0, 0], [1, 0], { valueOf() { throw new Error("x"); } }]), worktop(new Proxy([], { get() { throw new Error("x"); } })), null, 5])
      expect(() => validate(layoutOf(m))).not.toThrow();
  });
});

describe("migrate: worktop", () => {
  it("keeps good pts and the result validates", () => {
    const l = migrate(layoutOf(worktop(tee)));
    expect(furnitureOf(l).pts).toEqual(tee);
    expect(validate(l).ok).toBe(true);
  });
  it("copies no pts from a shape it does not know, and from other symbols", () => {
    for (const p of [5, "x", { length: 4 }, [[0, 0], [1, 0]], [[0, 0], [1, 0], [NaN, 1]], ring(65), [[0, 0], [100, 100], [100, 0], [0, 100]]]) {
      expect("pts" in furnitureOf(migrate(layoutOf(worktop(p)))), JSON.stringify(p)).toBe(false);
    }
    expect("pts" in furnitureOf(migrate(layoutOf({ ...worktop(ring(4)), symbol: "table" })))).toBe(false);
  });
  it("does not let a __proto__ key through", () => {
    const l = migrate(layoutOf(JSON.parse('{"id":"w1","symbol":"worktop","x":0,"y":0,"rot":0,"w":50,"h":50,"pts":[[0,0],[1,0],[0,1]],"__proto__":{"pts":[1]}}')));
    expect(({} as any).pts).toBeUndefined();
    expect(l).toBeTruthy();
  });
});

describe("worktop is decided everywhere an enumeration forces it", () => {
  it("is in FURNITURE_SYMBOLS, has a label and one menu area (Kitchen and dining)", () => {
    expect(FURNITURE_SYMBOLS).toContain("worktop");
    expect(FURNITURE_LABELS.worktop).toBe("Worktop");
    expect(FURNITURE_AREAS.find(([, s]) => s.includes("worktop"))?.[0]).toBe("Kitchen and dining");
  });
});
