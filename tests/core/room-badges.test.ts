import { describe, it, expect } from "vitest";
import { BADGE_KINDS, BADGE_OF, badgeInfo, badgeKinds } from "../../src/core/room-badges";
import { DEVICE_TYPES, type Device, type DeviceType, type Floor, type Pt } from "../../src/core/schema";
import type { StateOverlay } from "../../src/core/render";

// B55.2 (docs/specs/batch-s52.md F33, F35, F38; criterion 9): which device types feed a badge, and what its bubble says.
const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const dev = (type: DeviceType, entity: string, x = 100, y = 100, name = entity): Device => ({ id: entity, type, entity, name, x, y }) as Device;
const floor = (devices: Device[], room: Record<string, unknown> = {}): Floor =>
  ({ title: "G", outline: [], owk: [], rooms: [{ id: "r1", name: "Office", area: "", kind: "room", pts: sq(0, 0, 400, 300), wk: ["wall", "wall", "wall", "wall"], badges: { corner: "ne" }, ...room }], walls: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], devices, unlinked: [] }) as unknown as Floor;
const NOW = Date.parse("2026-11-07T12:00:00Z");
const st = (state: string, attributes: Record<string, unknown> = {}, last_changed = "2026-11-07T12:00:00Z") => ({ state, attributes, last_changed });
const info = (f: Floor, state: StateOverlay | undefined, extra: Record<string, unknown> = {}) => badgeInfo(f, 0, { state, now: NOW, ...extra });
const one = (f: Floor, state: StateOverlay | undefined, kind: string, extra: Record<string, unknown> = {}) => info(f, state, extra).find((b) => b.kind === kind);

describe("BADGE_OF", () => {
  it("decides every device type (finding 17): a new type fails here until someone says what it does", () => {
    expect(Object.keys(BADGE_OF).sort()).toEqual([...DEVICE_TYPES].sort());
    for (const type of DEVICE_TYPES) {
      const v = BADGE_OF[type];
      expect(v === null || BADGE_KINDS.includes(v), type).toBe(true);
    }
  });
  it("maps the types the spec names, and nothing else to a badge", () => {
    const fed = DEVICE_TYPES.filter((t) => BADGE_OF[t] !== null).map((t) => `${t}:${BADGE_OF[t]}`).sort();
    expect(fed).toEqual(["ac:climate", "climate:climate", "heater:climate", "light:lights", "motion:motion", "radar:motion"]);
  });
});

describe("badgeKinds: an icon only for a source the room has", () => {
  it("is empty for a room with no source", () => {
    expect(badgeKinds(floor([dev("temp", "sensor.t")]), 0)).toEqual([]);
  });
  it("lists lights, climate, motion, energy in that order, one per source", () => {
    const f = floor([dev("light", "light.a"), dev("ac", "climate.ac"), dev("radar", "binary_sensor.r")], { power: ["sensor.p"] });
    expect(badgeKinds(f, 0)).toEqual(["lights", "climate", "motion", "energy"]);
  });
  it("a room motion list, a power list or a water list is a source on its own", () => {
    expect(badgeKinds(floor([], { motion: ["binary_sensor.m"] }), 0)).toEqual(["motion"]);
    expect(badgeKinds(floor([], { power: ["sensor.p"] }), 0)).toEqual(["energy"]);
    expect(badgeKinds(floor([], { water: ["sensor.w"] }), 0)).toEqual(["energy"]);
  });
  it("counts only the devices inside the room", () => {
    expect(badgeKinds(floor([dev("light", "light.out", 900, 900)]), 0)).toEqual([]);
  });
  it("never throws on junk", () => {
    expect(badgeKinds(floor([], { motion: 5, power: "x", water: [5, null] }), 0)).toEqual([]);
    expect(badgeKinds(floor([]), 7)).toEqual([]);
    expect(badgeKinds({} as Floor, 0)).toEqual([]);
  });
});

describe("badgeInfo: lights", () => {
  const f = floor([dev("light", "light.a", 50, 50, "Desk"), dev("light", "light.b", 60, 60, "Ceiling"), dev("light", "light.c", 70, 70, "Shelf")]);
  it("says how many are on and names them; lit while any is on", () => {
    const b = one(f, { "light.a": st("on"), "light.b": st("off"), "light.c": st("on") }, "lights")!;
    expect(b.on).toBe(true);
    expect(b.rows).toEqual(["2 of 3 on", "Desk", "Shelf"]);
  });
  it("is unlit with none on, and with no state at all", () => {
    expect(one(f, { "light.a": st("off") }, "lights")!.on).toBe(false);
    expect(one(f, { "light.a": st("off") }, "lights")!.rows).toEqual(["0 of 3 on"]);
    expect(one(f, undefined, "lights")!.on).toBe(false);
  });
});

describe("badgeInfo: climate", () => {
  const f = floor([dev("climate", "climate.c")]);
  it("heating is orange: the action, the setpoint and the reading", () => {
    const b = one(f, { "climate.c": st("heat", { hvac_action: "heating", temperature: 21, current_temperature: 19.5 }) }, "climate")!;
    expect(b.tone).toBe("heat");
    expect(b.rows).toEqual(["Heating to 21 °C, now 19.5 °C"]);
  });
  it("cooling is blue", () => {
    const b = one(f, { "climate.c": st("cool", { hvac_action: "cooling", temperature: 24, current_temperature: 26 }) }, "climate")!;
    expect(b.tone).toBe("cool");
    expect(b.rows).toEqual(["Cooling to 24 °C, now 26 °C"]);
  });
  it("idle, off and unavailable are grey and say so", () => {
    expect(one(f, { "climate.c": st("heat", { hvac_action: "idle", current_temperature: 20 }) }, "climate")).toMatchObject({ tone: "", rows: ["Idle, now 20 °C"] });
    expect(one(f, { "climate.c": st("off") }, "climate")).toMatchObject({ tone: "", rows: ["Off"] });
    expect(one(f, { "climate.c": st("unavailable") }, "climate")).toMatchObject({ tone: "", rows: ["Unavailable"] });
    expect(one(f, undefined, "climate")).toMatchObject({ tone: "", rows: ["Unavailable"] });
  });
  it("leaves out a setpoint or reading that is missing or not a number, never prints NaN", () => {
    const b = one(f, { "climate.c": st("heat", { hvac_action: "heating", temperature: "hot", current_temperature: null }) }, "climate")!;
    expect(b.rows).toEqual(["Heating"]);
  });
  it("names each device when there are several; heating wins the colour", () => {
    const two = floor([dev("climate", "climate.a", 10, 10, "Hall"), dev("ac", "climate.b", 20, 20, "Bedroom")]);
    const b = one(two, { "climate.a": st("cool", { hvac_action: "cooling" }), "climate.b": st("heat", { hvac_action: "heating" }) }, "climate")!;
    expect(b.tone).toBe("heat");
    expect(b.rows).toEqual(["Hall: Cooling", "Bedroom: Heating"]);
  });
});

describe("badgeInfo: motion", () => {
  const f = floor([dev("motion", "binary_sensor.m")], { motion: ["binary_sensor.room"] });
  it("is red and says Motion now while a source is on", () => {
    const b = one(f, { "binary_sensor.m": st("off", {}, "2026-11-07T11:00:00Z"), "binary_sensor.room": st("on") }, "motion")!;
    expect(b.on).toBe(true);
    expect(b.rows).toEqual(["Motion now"]);
  });
  it("counts the last motion back from `now`, the replay time in a replay", () => {
    const state = { "binary_sensor.m": st("off", {}, "2026-11-07T11:48:00Z"), "binary_sensor.room": st("off", {}, "2026-11-07T11:30:00Z") };
    expect(one(f, state, "motion")).toMatchObject({ on: false, rows: ["12 min ago"] });
    // the same states at an earlier replay time: the age counts back from that time, not from the clock
    expect(one(f, state, "motion", { now: Date.parse("2026-11-07T11:51:00Z") })!.rows).toEqual(["3 min ago"]);
  });
  it("under a minute reads Just now; hours and days use the Attention row's units", () => {
    expect(one(f, { "binary_sensor.m": st("off", {}, "2026-11-07T11:59:30Z") }, "motion")!.rows).toEqual(["Just now"]);
    expect(one(f, { "binary_sensor.m": st("off", {}, "2026-11-07T09:00:00Z") }, "motion")!.rows).toEqual(["3 h ago"]);
  });
  it("says so when nothing was seen, and ignores unavailable sources", () => {
    expect(one(f, undefined, "motion")!.rows).toEqual(["No motion recorded"]);
    expect(one(f, { "binary_sensor.m": st("unavailable") }, "motion")!.rows).toEqual(["No motion recorded"]);
  });
});

describe("badgeInfo: energy", () => {
  const f = floor([], { power: ["sensor.p1", "sensor.p2"], water: ["sensor.w"] });
  it("sums power in kW to two decimals, lit above plug_watts", () => {
    const b = one(f, { "sensor.p1": st("600", { unit_of_measurement: "W" }), "sensor.p2": st("0.65", { unit_of_measurement: "kW" }), "sensor.w": st("1.5", { unit_of_measurement: "L/min", friendly_name: "Flow" }) }, "energy")!;
    expect(b.on).toBe(true);
    expect(b.rows).toEqual(["1.25 kW", "1.5 L/min"]);
  });
  it("is unlit at or under the threshold; the threshold is plug_watts", () => {
    const state = { "sensor.p1": st("2", { unit_of_measurement: "W" }) };
    expect(one(f, state, "energy")!.on).toBe(false); // the default is 2 W: not more than it
    expect(one(f, { "sensor.p1": st("3", { unit_of_measurement: "W" }) }, "energy")!.on).toBe(true);
    expect(one(f, { "sensor.p1": st("30", { unit_of_measurement: "W" }) }, "energy", { plugWatts: 50 })!.on).toBe(false);
  });
  it("water alone never lights the badge; it shows as the sensor reports it", () => {
    const w = floor([], { water: ["sensor.w", "sensor.w2"] });
    const b = one(w, { "sensor.w": st("12.5", { unit_of_measurement: "m³", friendly_name: "Today" }), "sensor.w2": st("3", { unit_of_measurement: "L/min", friendly_name: "Flow" }) }, "energy")!;
    expect(b.on).toBe(false);
    expect(b.rows).toEqual(["Today: 12.5 m³", "Flow: 3 L/min"]);
  });
  it("skips unreadable sensors and sensors in another unit; no NaN", () => {
    const b = one(f, { "sensor.p1": st("unavailable"), "sensor.p2": st("abc", { unit_of_measurement: "W" }), "sensor.w": st("unknown") }, "energy")!;
    expect(b.on).toBe(false);
    expect(b.rows).toEqual(["No reading"]);
    expect(JSON.stringify(b)).not.toMatch(/NaN/);
  });
});

describe("badgeInfo: hostile input", () => {
  it("never throws and keeps names as plain text (the caller escapes)", () => {
    const f = floor([dev("light", "light.a", 50, 50, '"><script>')], { motion: ["__proto__"], power: ["constructor"] });
    const state = { "light.a": st("on") } as StateOverlay;
    expect(() => info(f, state)).not.toThrow();
    expect(one(f, state, "lights")!.rows).toEqual(["1 of 1 on", '"><script>']);
    expect(() => badgeInfo(f, -1, { state, now: NOW })).not.toThrow();
    expect(() => badgeInfo(f, 0, { state: "x" as unknown as StateOverlay, now: NaN })).not.toThrow();
  });
});
