import { describe, it, expect, beforeEach } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { validate } from "../../src/core";
import { EditorState } from "../../src/editor/state";
import { fromShown, parseShown, toShown } from "../../src/editor/temp-range-ops";

// S42.5 (spec decision 15, criterion 8): the editor writes the house range and a room's override. EditorState.edit does not
// validate (CLAUDE.md finding 12), so every combination the fields can produce is run and the layout must stay valid.
const fresh = () => structuredClone(demo) as unknown as Layout;
const steps = (st: EditorState) => { let n = 0; while (st.undo()) n++; return n; };

describe("units", () => {
  it("shows Celsius as is and Fahrenheit rounded to 0.1", () => {
    expect(toShown(20, "°C")).toBe(20);
    expect(toShown(20, "°F")).toBe(68);
    expect(toShown(21.1, "°F")).toBe(70);
  });
  it("stores 0.1 °C: 70 °F is 21.1, 64.4 °F is 18", () => {
    expect(fromShown(70, "°F")).toBe(21.1);
    expect(fromShown(64.4, "°F")).toBe(18);
    expect(fromShown(17.26, "°C")).toBe(17.3);
  });
  it("parses a comma, empty as unset, junk as an error", () => {
    expect(parseShown("68,0", "°F")).toEqual({ ok: true, c: 20 });
    expect(parseShown("  ", "°C")).toEqual({ ok: true, c: undefined });
    expect(parseShown("warm", "°C").ok).toBe(false);
    expect(parseShown("1e999", "°C").ok).toBe(false);
  });
});

describe("house range", () => {
  beforeEach(() => localStorage.clear());
  it("sets min, max and hold, each one undo step", () => {
    const st = new EditorState(fresh());
    expect(st.setHouseRange({ min: 17 })).toBe(true);
    expect(st.setHouseRange({ max: 26 })).toBe(true);
    expect(st.setHouseRange({ hold: 7 })).toBe(true);
    expect(st.layout.tempRange).toEqual({ min: 17, max: 26, hold: 7 });
    expect(steps(st)).toBe(3);
    expect(st.layout.tempRange).toBeUndefined();
  });
  it("records no step for an unchanged value", () => {
    const st = new EditorState(fresh());
    st.setHouseRange({ min: 17 });
    expect(st.setHouseRange({ min: 17 })).toBe(false);
    expect(st.setHouseRange({ max: undefined })).toBe(false);
    expect(steps(st)).toBe(1);
  });
  it("removes the key when the last field is cleared", () => {
    const st = new EditorState(fresh());
    st.setHouseRange({ min: 17 });
    expect(st.setHouseRange({ min: undefined })).toBe(true);
    expect("tempRange" in st.layout).toBe(false);
  });
  it("refuses min above max, a gap under 1, and a bad hold, and writes nothing", () => {
    const st = new EditorState(fresh());
    st.setHouseRange({ min: 17, max: 26 });
    for (const bad of [{ min: 27 }, { max: 17.5 }, { max: 17 }, { hold: 2.5 }, { hold: 500 }, { hold: -1 }, { min: 200 }, { max: Number.NaN }]) {
      expect(st.setHouseRange(bad)).toBe(false);
      expect(st.layout.tempRange).toEqual({ min: 17, max: 26 });
    }
    expect(steps(st)).toBe(1);
  });
  it("never commits a layout validate refuses, over every combination", () => {
    const mins = [undefined, -60, 10, 17, 30], maxes = [undefined, 12, 18, 26, 200], holds = [undefined, 0, 5, 2.5, 500];
    for (const min of mins) for (const max of maxes) for (const hold of holds) {
      const st = new EditorState(fresh());
      st.setHouseRange({ min }); st.setHouseRange({ max }); st.setHouseRange({ hold });
      st.setHouseRange({ min, max, hold });
      expect(validate(st.layout).ok, JSON.stringify({ min, max, hold })).toBe(true);
    }
  });
});

describe("room override", () => {
  beforeEach(() => localStorage.clear());
  it("Use house range off writes {} (never warns), on removes it, each one step", () => {
    const st = new EditorState(fresh());
    expect(st.setRoomRange(0, {})).toBe(true);
    expect(st.f.rooms[0].tempRange).toEqual({});
    expect(st.setRoomRange(0, {})).toBe(false);
    expect(st.setRoomRange(0, null)).toBe(true);
    expect("tempRange" in st.f.rooms[0]).toBe(false);
    expect(st.setRoomRange(0, null)).toBe(false);
    expect(steps(st)).toBe(2);
  });
  it("sets min and max of the room; clearing both keeps {} until the box is ticked", () => {
    const st = new EditorState(fresh());
    st.setRoomRange(0, { min: 18 }); st.setRoomRange(0, { min: 18, max: 25 });
    expect(st.f.rooms[0].tempRange).toEqual({ min: 18, max: 25 });
    st.setRoomRange(0, {});
    expect(st.f.rooms[0].tempRange).toEqual({});
  });
  it("never commits a layout validate refuses, over every combination", () => {
    const mins = [undefined, -60, 10, 20, 30], maxes = [undefined, 10, 20.5, 26, 101];
    for (const min of mins) for (const max of maxes) for (const house of [false, true]) {
      const st = new EditorState(fresh());
      if (house) st.setHouseRange({ min: 17, max: 26 });
      st.setRoomRange(0, { min, max });
      st.setRoomRange(0, { min }); st.setRoomRange(0, { min, max });
      st.setRoomRange(1, null);
      expect(validate(st.layout).ok, JSON.stringify({ min, max, house })).toBe(true);
    }
  });
  it("is not blocked by the plan lock: a range is a setting, not geometry", () => {
    const st = new EditorState(fresh());
    st.planLocked = true;
    expect(st.setRoomRange(0, { min: 18 })).toBe(true);
  });
});

describe("S42 review: a range write clears a stale plan-lock refusal", () => {
  it("an unchanged house or room range after a refused geometry edit does not leave planBlocked set", () => {
    for (const write of [(st: EditorState) => st.setHouseRange({}), (st: EditorState) => st.setRoomRange(0, null)]) {
      const st = new EditorState(fresh());
      st.planLocked = true;
      const key = Object.keys(st.layout.floors)[0]!;
      expect(st.setPose(key, { rot: 45, off: [10, 0] })).toBe(false);
      expect(st.planBlocked).toBe(true);
      expect(write(st)).toBe(false); // unchanged: no step
      expect(st.planBlocked, "the banner would say the plan is locked for a write the lock allows").toBe(false);
    }
  });
});
