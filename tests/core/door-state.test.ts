import { describe, it, expect } from "vitest";
import type { Door } from "../../src/core/schema";
import { doorStateOf } from "../../src/core/door-state";

// S24.3 (G3): the facts tell an open door from an unlocked one; the plan still draws both red (Diego, 2026-09-28).
const st = (state: string) => ({ state, attributes: {}, last_changed: "" });
const d = { id: "d", name: "D", kind: "door", a: [0, 0], b: [90, 0], sensors: ["binary_sensor.c"], locks: ["lock.a", "lock.b"] } as unknown as Door;

describe("doorStateOf: contact and unlocked apart, open as drawn", () => {
  it("a lock left unlocked is unlocked, not contact; the plan's open stays red", () => {
    expect(doorStateOf(d, { "binary_sensor.c": st("off"), "lock.a": st("locked"), "lock.b": st("unlocked") })).toEqual({ open: true, contact: false, unlocked: true, alarm: false, cover: false });
  });
  it("a contact sensor on is contact, not unlocked", () => {
    expect(doorStateOf(d, { "binary_sensor.c": st("on"), "lock.a": st("locked"), "lock.b": st("locked") })).toEqual({ open: true, contact: true, unlocked: false, alarm: false, cover: false });
  });
  it("unavailable is neither", () => {
    expect(doorStateOf(d, { "binary_sensor.c": st("unavailable"), "lock.a": st("unavailable") })).toMatchObject({ open: false, contact: false, unlocked: false });
  });
});
