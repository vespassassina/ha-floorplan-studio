import { afterEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { keyMinute, replayEntities, replayTime, sameStates, withTimeout, DAY_MINUTES } from "../../src/card/card-replay";

const L = demo as unknown as Layout;

describe("replayEntities: what one floor asks the recorder for", () => {
  const ground = replayEntities(L.floors.ground, "sun.sun");
  it("holds the devices, the bound relay of a lamp, the room sensors and the sun", () => {
    expect(ground).toContain("light.demo_living");
    expect(ground).toContain("switch.demo_living_relay"); // `bound`, so Turn off and the lit lamp read the relay too
    expect(ground).toContain("sun.sun");
  });
  it("holds nothing from another floor", () => expect(ground).not.toContain("light.demo_bedroom"));
  it("lists each entity once, and takes a room's temps, humidity and motion", () => {
    expect(new Set(ground).size).toBe(ground.length);
    const f = { ...L.floors.ground, rooms: [{ ...L.floors.ground.rooms[0], temps: ["sensor.t1"], humidity: ["sensor.h1"], motion: ["binary_sensor.m1", "sensor.t1"] }] };
    const got = replayEntities(f, "sun.alt");
    expect(got).toEqual(expect.arrayContaining(["sensor.t1", "sensor.h1", "binary_sensor.m1", "sun.alt"]));
    expect(got.filter((e) => e === "sensor.t1")).toHaveLength(1);
  });
  it("never throws on a floor with junk in it", () => {
    const junk = { devices: [null, { entity: 5, bound: {} }, { type: "light", entity: "light.x", bound: 7 }], rooms: [{ temps: "no", motion: [3, "binary_sensor.k"] }, null], doors: [{ sensors: 1 }, null], unlinked: 5 } as never;
    expect(replayEntities(junk, "sun.sun").sort()).toEqual(["binary_sensor.k", "light.x", "sun.sun"]);
  });
});

describe("replayTime: HH:MM in the user's locale and HA's own 12 or 24 hour setting", () => {
  const at = new Date(2026, 9, 28, 15, 7).getTime(); // 15:07 local; the zone is the browser's
  it("24 hour", () => expect(replayTime(at, { locale: { language: "en", time_format: "24" } })).toBe("15:07"));
  it("12 hour", () => expect(replayTime(at, { locale: { language: "en", time_format: "12" } })).toMatch(/^0?3:07\sPM$/));
  it("the language decides when the setting is language or missing", () => {
    expect(replayTime(at, { language: "de" })).toBe("15:07");
    expect(replayTime(at, { language: "en-US", locale: { time_format: "language" } })).toMatch(/PM$/);
  });
  it("junk is not a throw", () => expect(replayTime(at, { language: "not a locale!!" })).toMatch(/15:07|3:07/));
});

describe("keyMinute: the bar's keys over minutes, 0 to 1440", () => {
  const k = (key: string, v: number) => keyMinute(key, v);
  it("arrows move 5 minutes, either side", () => { expect(k("ArrowRight", 100)).toBe(105); expect(k("ArrowUp", 100)).toBe(105); expect(k("ArrowLeft", 100)).toBe(95); expect(k("ArrowDown", 100)).toBe(95); });
  it("Page Up and Page Down move an hour", () => { expect(k("PageUp", 100)).toBe(160); expect(k("PageDown", 100)).toBe(40); });
  it("Home and End are the ends", () => { expect(k("Home", 777)).toBe(0); expect(k("End", 777)).toBe(DAY_MINUTES); });
  it("never leaves the range", () => { expect(k("ArrowLeft", 2)).toBe(0); expect(k("PageUp", 1430)).toBe(DAY_MINUTES); });
  it("any other key is not the bar's", () => { expect(k("a", 5)).toBeNull(); expect(k("Enter", 5)).toBeNull(); });
});

describe("sameStates: when nothing the plan reads has changed", () => {
  const attrs = {};
  const e = (state: string, lc = "2026-10-28T08:00:00.000Z", attributes: Record<string, unknown> = attrs) => ({ state, last_changed: lc, attributes });
  const a = { "light.a": e("on"), "sensor.b": e("1") };
  it("equal rows are the same", () => expect(sameStates(a, { "light.a": { ...a["light.a"] }, "sensor.b": { ...a["sensor.b"] } })).toBe(true));
  it("a changed state, time or attribute object is not", () => {
    expect(sameStates(a, { ...a, "light.a": e("off") })).toBe(false);
    expect(sameStates(a, { ...a, "sensor.b": e("1", "2026-10-28T09:00:00.000Z") })).toBe(false);
    expect(sameStates(a, { ...a, "sensor.b": e("1", undefined, { x: 1 }) })).toBe(false);
  });
  it("an entity that appears or goes is a change", () => {
    expect(sameStates(a, { "light.a": a["light.a"] })).toBe(false);
    expect(sameStates({ "light.a": a["light.a"] }, a)).toBe(false);
    expect(sameStates(undefined, a)).toBe(false);
  });
});

describe("withTimeout", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); }); // spies before the clock (CLAUDE.md finding 15)
  it("passes the answer through and clears its timer", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve(7), 20000)).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects with a timeout after the time, not before", async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => undefined), 20000);
    const seen = vi.fn();
    p.catch(seen);
    await vi.advanceTimersByTimeAsync(19999);
    expect(seen).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ code: "timeout" }));
  });
  it("passes a rejection through", async () => {
    await expect(withTimeout(Promise.reject({ code: "x", message: "no" }), 1000)).rejects.toEqual({ code: "x", message: "no" });
  });
});
