import { describe, it, expect } from "vitest";
import { doorStateOf } from "../../src/core/door-state";
import type { Door } from "../../src/core/schema";

// S25.D1: a door is closed only when it has a sensor and every sensor says off. Everything else is a hole in the wall.
const st = (s: unknown) => ({ state: s as string, attributes: {}, last_changed: "2026-10-09T10:00:00Z" });
const door = (extra: Partial<Door> = {}): Door => ({ id: "d", name: "d", kind: "door", a: [0, 0], b: [90, 0], ...extra });

describe("doorStateOf.closed", () => {
  it("is false with no sensor, however the state looks", () => {
    expect(doorStateOf(door(), {}).closed).toBe(false);
    expect(doorStateOf(door(), undefined).closed).toBe(false);
    expect(doorStateOf(door({ sensors: [] }), {}).closed).toBe(false);
  });
  it("is true when the one sensor says off", () => {
    expect(doorStateOf(door({ sensors: ["binary_sensor.a"] }), { "binary_sensor.a": st("off") }).closed).toBe(true);
  });
  it("is false for on, unavailable, unknown, a missing entry and any odd value (untrusted state)", () => {
    for (const v of ["on", "unavailable", "unknown", "", null, 0, {}]) expect(doorStateOf(door({ sensors: ["binary_sensor.a"] }), { "binary_sensor.a": st(v) } as never).closed, String(v)).toBe(false);
    expect(doorStateOf(door({ sensors: ["binary_sensor.a"] }), {}).closed).toBe(false);
  });
  it("needs every sensor off", () => {
    const d = door({ sensors: ["binary_sensor.a", "binary_sensor.b"] });
    expect(doorStateOf(d, { "binary_sensor.a": st("off"), "binary_sensor.b": st("off") }).closed).toBe(true);
    expect(doorStateOf(d, { "binary_sensor.a": st("off"), "binary_sensor.b": st("unavailable") }).closed).toBe(false);
  });
  it("is false when a lock is unlocked, and never throws on a sensors list that is not a list", () => {
    expect(doorStateOf(door({ sensors: ["binary_sensor.a"], locks: ["lock.l"] }), { "binary_sensor.a": st("off"), "lock.l": st("unlocked") }).closed).toBe(false);
    expect(doorStateOf(door({ sensors: 5 as never }), {}).closed).toBe(false);
    expect(doorStateOf(door({ sensors: [7, null] as never }), {}).closed).toBe(false);
  });
});
