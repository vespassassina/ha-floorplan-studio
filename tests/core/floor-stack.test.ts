import { describe, it, expect } from "vitest";
import { floorBelow, floorsBelow, floorShift } from "../../src/core";

const fl = (offset?: unknown) => ({ title: "x", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...(offset === undefined ? {} : { offset }) });
const house = (): any => ({ version: 2, unit: "cm", north: 0, floors: { ground: fl([100, 40]), first: fl([-30, 7]), attic: fl() }, catalog: [] });

describe("floor stack helpers (S27.3)", () => {
  it("floorBelow is the key before, or null", () => {
    const l = house();
    expect(floorBelow(l, "first")).toBe("ground");
    expect(floorBelow(l, "attic")).toBe("first");
    expect(floorBelow(l, "ground")).toBeNull();
    expect(floorBelow(l, "nope")).toBeNull();
  });
  it("floorsBelow lists every lower key, nearest first", () => {
    const l = house();
    expect(floorsBelow(l, "attic")).toEqual(["first", "ground"]);
    expect(floorsBelow(l, "first")).toEqual(["ground"]);
    expect(floorsBelow(l, "ground")).toEqual([]);
    expect(floorsBelow(l, "nope")).toEqual([]);
  });
  it("floorShift is from.offset - to.offset, asymmetric", () => {
    const l = house();
    expect(floorShift(l, "ground", "first")).toEqual([130, 33]);
    expect(floorShift(l, "first", "ground")).toEqual([-130, -33]);
    expect(floorShift(l, "attic", "first")).toEqual([30, -7]);
    expect(floorShift(l, "first", "first")).toEqual([0, 0]);
  });
  it("an unknown key reads as offset [0, 0]", () => {
    const l = house();
    expect(floorShift(l, "nope", "first")).toEqual([30, -7]);
    expect(floorShift(l, "ground", "nope")).toEqual([100, 40]);
  });
  it("junk offsets read as [0, 0] and never throw", () => {
    const l = house();
    for (const bad of ["1,2", [1], [1, 2, 3], [NaN, 0], [0, Infinity], [2e7, 0], null, {}, 5, ["1", "2"]]) {
      l.floors.first.offset = bad;
      expect(floorShift(l, "ground", "first")).toEqual([100, 40]);
      expect(floorShift(l, "first", "attic")).toEqual([0, 0]);
    }
  });
  it("never throws on a broken layout", () => {
    for (const l of [null, undefined, 5, {}, { floors: null }, { floors: [] }, { floors: { a: null, b: 5 } }] as any[]) {
      expect(floorBelow(l, "a")).toBeNull();
      expect(floorsBelow(l, "b")).toEqual(l?.floors && typeof l.floors === "object" && !Array.isArray(l.floors) ? ["a"] : []);
      expect(floorShift(l, "a", "b")).toEqual([0, 0]);
    }
  });
  it("a floor whose key is __proto__ is an ordinary floor", () => {
    const floors: any = Object.create(null);
    Object.defineProperty(floors, "__proto__", { value: fl([5, 6]), enumerable: true, writable: true, configurable: true });
    Object.defineProperty(floors, "up", { value: fl([1, 1]), enumerable: true, writable: true, configurable: true });
    const l: any = { floors };
    expect(floorBelow(l, "up")).toBe("__proto__");
    expect(floorsBelow(l, "up")).toEqual(["__proto__"]);
    expect(floorBelow(l, "__proto__")).toBeNull();
    expect(floorShift(l, "__proto__", "up")).toEqual([4, 5]);
    expect(floorShift(l, "up", "__proto__")).toEqual([-4, -5]);
  });
  it("a plain object with an inherited toString key is not a floor", () => {
    const l = house();
    expect(floorShift(l, "toString", "first")).toEqual([30, -7]);
    expect(floorBelow(l, "constructor")).toBeNull();
  });
});
