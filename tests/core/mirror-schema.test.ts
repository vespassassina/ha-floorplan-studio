import { describe, it, expect } from "vitest";
import { FURNITURE_SYMBOLS, validate, type Layout } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";

// B53.2, spec items 17 and 18: `mirror: true` flips the L sofa. It is valid on `sofa-l` only, and a layout file is untrusted
// input (finding 1): validate never throws and names the piece, migrate keeps `mirror` only where validate would accept it.
const piece = (symbol: string, extra: Record<string, unknown> = {}) => ({ id: "m1", name: "Couch", symbol, x: 100, y: 100, rot: 0, w: 240, h: 160, ...(symbol === "worktop" ? { pts: [[0, 0], [100, 0], [100, 40], [40, 40], [40, 90], [0, 90]] } : {}), ...extra });
const layoutOf = (m: unknown) => ({ version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { Ground: { title: "G", outline: [[0, 0], [1000, 0], [1000, 800], [0, 800]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [m], unlinked: [] } } });
const errorsOf = (m: unknown): string[] => { const r = validate(layoutOf(m)); return r.ok ? [] : r.errors; };
const furnitureOf = (l: unknown) => (l as Layout).floors.Ground.furniture[0] as unknown as Record<string, unknown>;

describe("validate: mirror", () => {
  it("accepts true on a sofa-l, and none", () => {
    expect(errorsOf(piece("sofa-l", { mirror: true }))).toEqual([]);
    expect(errorsOf(piece("sofa-l"))).toEqual([]);
  });
  it("refuses it on every other symbol and names the piece", () => {
    for (const s of FURNITURE_SYMBOLS.filter((x) => x !== "sofa-l")) {
      const e = errorsOf(piece(s, { mirror: true }));
      expect(e.length, s).toBe(1);
      expect(e[0], s).toMatch(/m1 mirror is only allowed on a sofa-l/);
    }
  });
  it("refuses a value that is not true, on a sofa-l", () => {
    for (const bad of [false, "true", 1, null, {}, [], "yes"]) expect(errorsOf(piece("sofa-l", { mirror: bad })).join("\n"), String(bad)).toMatch(/m1 mirror must be true/);
  });
  it("never throws on hostile pieces", () => {
    for (const m of [{ symbol: "sofa-l", mirror: Symbol.iterator }, { symbol: "__proto__", mirror: true }, { symbol: "sofa-l", mirror: { valueOf() { throw new Error("x"); } } }, null, 5])
      expect(() => validate(layoutOf(m))).not.toThrow();
  });
});

describe("migrate: mirror", () => {
  it("keeps true on a sofa-l", () => {
    expect(furnitureOf(migrate(layoutOf(piece("sofa-l", { mirror: true })))).mirror).toBe(true);
  });
  it("drops it from other symbols and from a sofa-l when it is not true, and the result validates", () => {
    for (const [s, v] of [["sofa", true], ["table", true], ["sofa-l", false], ["sofa-l", "true"], ["sofa-l", 1], ["sofa-l", null], ["car", true]] as const) {
      const l = migrate(layoutOf(piece(s, { mirror: v })));
      expect("mirror" in furnitureOf(l), `${s} ${String(v)}`).toBe(false);
      expect(validate(l).ok, `${s} ${String(v)}`).toBe(true);
    }
  });
});
