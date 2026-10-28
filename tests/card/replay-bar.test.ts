import { afterEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import { DEVICE_TYPES, FURNITURE_SYMBOLS, type DeviceType, type FurnitureSymbol, type Layout } from "../../src/core/schema";
import { keyMinute, replayEntities, replayStates, replayTime, sameStates, withTimeout, DAY_MINUTES } from "../../src/card/card-replay";

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

// S3 of the Opus review: the fetch must ask for everything the floor draws or attention reads.
describe("replayEntities: every member of an enumeration is a decision (CLAUDE.md finding 17)", () => {
  const floor = (patch: Record<string, unknown>) => ({ ...L.floors.ground, devices: [], rooms: [], doors: [], unlinked: [], furniture: [], ...patch }) as never;
  // What the fetch asks for a device of each type. A new DeviceType is a type error here until someone writes its line down.
  const DEVICE_ASKS: Record<DeviceType, "entity"> = Object.fromEntries(DEVICE_TYPES.map((t) => [t, "entity"])) as Record<DeviceType, "entity">;
  it("asks for the entity of a device of every type", () => {
    expect(Object.keys(DEVICE_ASKS).sort()).toEqual([...DEVICE_TYPES].sort());
    for (const type of DEVICE_TYPES) {
      const got = replayEntities(floor({ devices: [{ id: "d", type, entity: `sensor.t_${type}`, x: 1, y: 1 }] }), "sun.sun");
      expect(got, type).toContain(`sensor.t_${type}`);
    }
  });
  it("does not ask for the room a person is in: person positions are a non-goal (spec), decided", () => {
    const got = replayEntities(floor({ devices: [{ id: "p", type: "person", entity: "person.ann", room: "sensor.where", x: 1, y: 1 }] }), "sun.sun");
    expect(got).toContain("person.ann");
    expect(got).not.toContain("sensor.where");
  });
  // The furniture symbols that read an entity: every symbol is listed, with what it asks for.
  const FURNITURE_ASKS: Record<FurnitureSymbol, "entity" | "entity+attached"> = Object.fromEntries(FURNITURE_SYMBOLS.map((s) => [s, s === "car" ? "entity+attached" : "entity"])) as Record<FurnitureSymbol, "entity" | "entity+attached">;
  it("asks for the entity of a piece of furniture of every symbol, and the attached entities of a car", () => {
    expect(Object.keys(FURNITURE_ASKS).sort()).toEqual([...FURNITURE_SYMBOLS].sort());
    for (const symbol of FURNITURE_SYMBOLS) {
      const m = { id: "m", symbol, x: 1, y: 1, rot: 0, w: 10, h: 10, entity: `sensor.f_${symbol}`, ...(symbol === "car" ? { attached: ["sensor.car_battery", "device_tracker.car", 5, ""] } : {}) };
      const got = replayEntities(floor({ furniture: [m] }), "sun.sun");
      expect(got, symbol).toContain(`sensor.f_${symbol}`);
      if (FURNITURE_ASKS[symbol] === "entity+attached") expect(got).toEqual(expect.arrayContaining(["sensor.car_battery", "device_tracker.car"]));
      else expect(got).not.toContain("sensor.car_battery");
    }
  });
  it("asks for the power sensor a plug is linked to, but only for plugs of this floor", () => {
    const f = floor({ devices: [{ id: "a", type: "plug", entity: "switch.plug_a", x: 1, y: 1 }, { id: "b", type: "light", entity: "light.b", x: 1, y: 1 }] });
    const got = replayEntities(f, "sun.sun", { powerLinks: { "switch.plug_a": "sensor.plug_a_power", "switch.plug_other_floor": "sensor.other_power" } });
    expect(got).toContain("sensor.plug_a_power");
    expect(got).not.toContain("sensor.other_power");
  });
  it("asks for the battery sensors of the HA device behind a placed entity (what attention reads), from the registry", () => {
    const f = floor({ devices: [{ id: "l", type: "lock", entity: "lock.front", x: 1, y: 1 }], furniture: [{ id: "m", symbol: "tv", x: 1, y: 1, rot: 0, w: 10, h: 10, entity: "media_player.tv" }] });
    const reg = { "lock.front": { device_id: "dev1" }, "sensor.front_battery": { device_id: "dev1" }, "sensor.front_rssi": { device_id: "dev1" }, "media_player.tv": { device_id: "dev2" }, "sensor.tv_battery": { device_id: "dev2" }, "sensor.elsewhere_battery": { device_id: "dev9" } };
    const states = { "sensor.front_battery": { attributes: { device_class: "battery" } }, "sensor.front_rssi": { attributes: { device_class: "signal_strength" } }, "sensor.tv_battery": { attributes: { device_class: "battery" } }, "sensor.elsewhere_battery": { attributes: { device_class: "battery" } } };
    const got = replayEntities(f, "sun.sun", { registry: reg, liveStates: states });
    expect(got).toEqual(expect.arrayContaining(["sensor.front_battery", "sensor.tv_battery"]));
    expect(got).not.toContain("sensor.front_rssi");
    expect(got).not.toContain("sensor.elsewhere_battery");
  });
});

describe("replayStates: the end of the slider is live (S39 polish)", () => {
  // A card with a replay whose floor history is ready and whose last drawn frame is `past`; only the fields replayStates reads.
  const past = { "light.x": { state: "on", attributes: {} } } as never;
  const fh = { status: "ready", missing: 0 };
  const card = (drawnT: number) => ({
    _floorKey: () => "ground",
    _hass: { states: { "light.x": { state: "on", attributes: { rgb_color: [89, 0, 255] } } } },
    _replay: { end: 1000, t: drawnT, drawnT, floors: new Map([["ground", fh]]), drawn: { floor: fh, states: past } },
  }) as never;
  it("before the end it returns the states last drawn from the recorder", () => expect(replayStates(card(999))).toBe(past));
  it("at the end it returns nothing, so every reader falls back to the live states and the real clock", () => expect(replayStates(card(1000))).toBeUndefined());
  it("no replay is live too", () => expect(replayStates({ _replay: null } as never)).toBeUndefined());
});
