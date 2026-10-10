import { describe, expect, it } from "vitest";
import { FLOORPLAN_CSS, floorSwitch } from "../../src/core/render";

// S27.6: which way the plan moves when the floor changes. Keys are the floors in stacking order, lowest first.
const KEYS = ["cellar", "ground", "first", "attic"];

describe("S27.6 floorSwitch", () => {
  it("goes up when the new floor is higher in the list, down when it is lower", () => {
    expect(floorSwitch(KEYS, "ground", "first", false)).toEqual({ dir: "up" });
    expect(floorSwitch(KEYS, "first", "ground", false)).toEqual({ dir: "down" });
    expect(floorSwitch(KEYS, "cellar", "attic", false)).toEqual({ dir: "up" });
    expect(floorSwitch(KEYS, "attic", "cellar", false)).toEqual({ dir: "down" });
  });
  it("is null for the same floor, an unknown key, reduced motion", () => {
    expect(floorSwitch(KEYS, "ground", "ground", false)).toBeNull();
    expect(floorSwitch(KEYS, "ground", "nope", false)).toBeNull();
    expect(floorSwitch(KEYS, "nope", "ground", false)).toBeNull();
    expect(floorSwitch(KEYS, "ground", "first", true)).toBeNull();
    expect(floorSwitch(KEYS, "first", "ground", true)).toBeNull();
  });
  it("never throws on junk, and a key that is a property of Object is just unknown", () => {
    for (const k of [null, undefined, 5, "ground", {}, [null], [5, 6]]) expect(() => floorSwitch(k as never, "ground", "first", false)).not.toThrow();
    expect(floorSwitch(null as never, "a", "b", false)).toBeNull();
    expect(floorSwitch(["__proto__", "constructor"], "constructor", "__proto__", false)).toEqual({ dir: "down" });
    expect(floorSwitch(KEYS, "__proto__", "ground", false)).toBeNull();
    expect(floorSwitch(KEYS, 1 as never, 2 as never, false)).toBeNull();
    expect(floorSwitch(KEYS, "ground", "first", "yes" as never)).toEqual({ dir: "up" });
  });
  it("has its keyframes and rules in the stylesheet, and none under reduced motion", () => {
    expect(FLOORPLAN_CSS).toMatch(/@keyframes fp-floor-in-up\{from\{[^}]*translateY\(-16px\)/);
    expect(FLOORPLAN_CSS).toMatch(/@keyframes fp-floor-in-down\{from\{[^}]*translateY\(16px\)/);
    expect(FLOORPLAN_CSS).toMatch(/\[data-switch="up"\]\{animation:fp-floor-in-up 220ms/);
    expect(FLOORPLAN_CSS).toMatch(/\[data-switch="down"\]\{animation:fp-floor-in-down 220ms/);
    expect(FLOORPLAN_CSS).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\[data-switch\]\{animation:none/);
  });
});
