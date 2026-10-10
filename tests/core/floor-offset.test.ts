import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { migrate } from "../../src/core/migrate";
import { validate } from "../../src/core/schema";

const plain = () => structuredClone(demo) as any;
const errorsOf = (l: any) => { const r = validate(l); return r.ok ? [] : r.errors; };
const withOffset = (v: unknown, key = "ground") => { const l = plain(); l.floors[key].offset = v; return l; };

const GOOD: [string, unknown][] = [["[0,0]", [0, 0]], ["[137,-61]", [137, -61]], ["[1.5,2]", [1.5, 2]], ["at the limit", [1e7, -1e7]]];
const BAD: [string, unknown][] = [
  ["a string", "1,2"], ["one number", [1]], ["three numbers", [1, 2, 3]], ["NaN", [NaN, 0]], ["Infinity", [0, Infinity]],
  ["past the limit", [2e7, 0]], ["null", null], ["an object", { 0: 1, 1: 2 }], ["numbers as text", ["1", "2"]], ["a number", 5],
];

describe("Floor.offset (S27.2)", () => {
  it("absent is valid", () => {
    expect(errorsOf(plain())).toEqual([]);
  });
  for (const [label, v] of GOOD) {
    it(`validate accepts ${label}; migrate keeps it as written`, () => {
      expect(errorsOf(withOffset(v))).toEqual([]);
      expect(migrate(withOffset(v)).floors.ground.offset).toEqual(v);
    });
  }
  for (const [label, v] of BAD) {
    it(`validate reports ${label} and does not throw`, () => {
      const errs = errorsOf(withOffset(v));
      expect(errs.some((e) => /offset/.test(e))).toBe(true);
    });
    it(`migrate drops ${label}; the result opens and validates`, () => {
      const m = migrate(withOffset(v));
      expect("offset" in m.floors.ground).toBe(false);
      expect(validate(m).ok).toBe(true);
    });
  }
  it("migrate does not change its input", () => {
    const l = withOffset("1,2");
    migrate(l);
    expect(l.floors.ground.offset).toBe("1,2");
  });
  it("works on a floor whose key is __proto__", () => {
    const l = plain();
    const f = l.floors.ground;
    const floors = JSON.parse(`{"__proto__": ${JSON.stringify({ ...f, offset: [3, 4] })}}`);
    l.floors = floors;
    expect(errorsOf(l)).toEqual([]);
    const m = migrate(l);
    expect(Object.getOwnPropertyDescriptor(m.floors, "__proto__")?.value.offset).toEqual([3, 4]);
    floors["__proto__"].offset = [NaN, 0];
    const bad = JSON.parse(JSON.stringify(l).replace(/"offset":\[3,4\]/, `"offset":"x"`));
    expect(errorsOf(bad).some((e) => /offset/.test(e))).toBe(true);
    expect("offset" in Object.getOwnPropertyDescriptor(migrate(bad).floors, "__proto__")!.value).toBe(false);
  });
});
