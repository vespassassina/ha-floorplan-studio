import { describe, it, expect } from "vitest";
import type { Device, DeviceType, Floor, Pt, RoomKind } from "../../src/core/schema";
import { DEVICE_TYPES, ROOM_KINDS } from "../../src/core/schema";
import { ROOM_OWNS } from "../../src/core/render";
import { meanReading, meanValue } from "../../src/core/readings";
import { HEAT_KINDS, HEAT_SCALE, HEAT_SOURCE, heatKindOf, heatLegend, roomHeat, type HeatKind } from "../../src/core/heat";

// S34.6 (spec docs/specs/extras-s34.md, H2, H3, criterion 9). Pure maths: what a room reads in a heat mode.
// The state shape is what Home Assistant sends (state text, attributes, last_changed), as in room-info.test.ts.
const st = (state: string, unit?: string) => ({ state, attributes: unit === undefined ? {} : { unit_of_measurement: unit }, last_changed: "2026-10-17T10:00:00Z" });
const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const dev = (type: DeviceType, entity: string, x: number, y: number): Device => ({ id: entity, type, entity, name: entity, x, y }) as Device;
const room = (name: string, pts: Pt[], extra: Record<string, unknown> = {}) => ({ id: name, name, area: "", kind: "room", pts, wk: ["wall", "wall", "wall", "wall"], ...extra });
const floor = (rooms: unknown[], devices: Device[] = []): Floor => ({ title: "G", outline: [], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [], devices, rooms }) as unknown as Floor;
const N = " ";

describe("meanValue", () => {
  it("is the number and unit behind meanReading, which formats it unchanged", () => {
    const s = { "a": st("21", "°C"), "b": st("22.5", "°C"), "c": st("70", "°F") };
    expect(meanValue(["a", "b", "c"], s)).toEqual({ n: 21.75, unit: "°C" });
    expect(meanReading(["a", "b", "c"], s)).toBe(`21.8${N}°C`);
    expect(meanValue(["x"], s)).toBeNull();
    expect(meanValue(["a"], undefined)).toBeNull();
  });
  it("applies a keep test per reading before it picks the unit", () => {
    const s = { "a": st("999", "°F"), "b": st("21", "°C") };
    expect(meanValue(["a", "b"], s)).toEqual({ n: 999, unit: "°F" });
    expect(meanValue(["a", "b"], s, (_n, unit) => unit === "°C")).toEqual({ n: 21, unit: "°C" });
  });
});

describe("heatKindOf", () => {
  it("reads the three kinds, absent as off, junk as off with a warn flag", () => {
    expect(heatKindOf("temperature")).toEqual({ kind: "temperature", warn: false });
    expect(heatKindOf("humidity")).toEqual({ kind: "humidity", warn: false });
    expect(heatKindOf("off")).toEqual({ kind: "off", warn: false });
    expect(heatKindOf(undefined)).toEqual({ kind: "off", warn: false });
    expect(heatKindOf(null)).toEqual({ kind: "off", warn: false });
    for (const junk of ["Temperature", " humidity", "heat", "", 3, true, {}, [], ["temperature"], "__proto__", "constructor", "toString"]) {
      expect(heatKindOf(junk), String(junk)).toEqual({ kind: "off", warn: true });
    }
  });
});

describe("the tables iterate their unions (findings 17, 20)", () => {
  it("HEAT_KINDS is off, temperature, humidity; every kind but off has a scale and a legend", () => {
    expect([...HEAT_KINDS]).toEqual(["off", "temperature", "humidity"]);
    for (const k of HEAT_KINDS) {
      if (k === "off") { expect(heatLegend(k), k).toBeNull(); expect(Object.keys(HEAT_SCALE)).not.toContain(k); continue; }
      const sc = HEAT_SCALE[k], lg = heatLegend(k);
      expect(sc.from < sc.mid && sc.mid < sc.to, k).toBe(true);
      expect(lg?.stops.length, k).toBe(3);
      expect(lg?.unit, k).toBe(sc.unit);
    }
    expect(Object.keys(HEAT_SCALE).sort()).toEqual(["humidity", "temperature"]);
  });
  it("the legend gives the two end labels in real text and the three tokens", () => {
    expect(heatLegend("temperature")).toEqual({ kind: "temperature", unit: "°C", from: `16${N}°C`, to: `26${N}°C`, stops: [{ at: 0, token: "--fp-heat-cool" }, { at: 0.5, token: "--fp-heat-mid" }, { at: 1, token: "--fp-heat-hot" }] });
    expect(heatLegend("humidity")).toEqual({ kind: "humidity", unit: "%", from: `30${N}%`, to: `70${N}%`, stops: [{ at: 0, token: "--fp-hum-dry" }, { at: 0.5, token: "--fp-hum-mid" }, { at: 1, token: "--fp-hum-wet" }] });
  });
  it("HEAT_SOURCE names a decision for every device type: temp and humidity only", () => {
    const want: Record<DeviceType, HeatKind | null> = Object.fromEntries(DEVICE_TYPES.map((t) => [t, t === "temp" ? "temperature" : t === "humidity" ? "humidity" : null])) as Record<DeviceType, HeatKind | null>;
    expect(Object.keys(HEAT_SOURCE).sort()).toEqual([...DEVICE_TYPES].sort());
    for (const t of DEVICE_TYPES) expect(HEAT_SOURCE[t], t).toBe(want[t]);
    expect(HEAT_SOURCE.temp).toBe("temperature");
    expect(HEAT_SOURCE.humidity).toBe("humidity");
    expect(HEAT_SOURCE.climate).toBeNull();
  });
  it("only a kind that ROOM_OWNS heats, over every RoomKind, with its own list and with a device in it", () => {
    for (const k of ROOM_KINDS) {
      const f = floor([room("R", sq(0, 0, 400, 400), { kind: k as RoomKind, temps: ["t1"] })], [dev("temp", "t2", 100, 100)]);
      const own = roomHeat(f, 0, "temperature", { t1: st("21", "°C") });
      const dv = roomHeat(f, 0, "temperature", { t2: st("21", "°C") });
      if (ROOM_OWNS[k]) { expect(own, k).not.toBeNull(); expect(dv, k).not.toBeNull(); } // the list is unreadable, so the device in it feeds
      else { expect(own, k).toBeNull(); expect(dv, k).toBeNull(); }
    }
  });
});

describe("roomHeat, temperature (H2, H3)", () => {
  const f = floor([room("Living", sq(0, 0, 400, 400), { temps: ["t1", "t2"] })]);
  it("gives text and t on the fixed scale: 16 is 0, 21 is 0.5, 26 is 1", () => {
    expect(roomHeat(f, 0, "temperature", { t1: st("16", "°C"), t2: st("16", "°C") })).toMatchObject({ text: `16${N}°C`, t: 0 });
    expect(roomHeat(f, 0, "temperature", { t1: st("21", "°C"), t2: st("21", "°C") })).toMatchObject({ text: `21${N}°C`, t: 0.5 });
    expect(roomHeat(f, 0, "temperature", { t1: st("26", "°C"), t2: st("26", "°C") })).toMatchObject({ text: `26${N}°C`, t: 1 });
    expect(roomHeat(f, 0, "temperature", { t1: st("23", "°C"), t2: st("24", "°C") })).toMatchObject({ text: `23.5${N}°C`, t: 0.75 });
  });
  it("converts °F for t and keeps °F in the text: 75.2 is 24 degrees, t 0.8", () => {
    expect(roomHeat(f, 0, "temperature", { t1: st("75.2", "°F"), t2: st("75.2", "°F") })).toMatchObject({ text: `75.2${N}°F`, t: 0.8 });
  });
  it("clamps t past the ends and prints the real number", () => {
    expect(roomHeat(f, 0, "temperature", { t1: st("15", "°C"), t2: st("15", "°C") })).toMatchObject({ text: `15${N}°C`, t: 0 });
    expect(roomHeat(f, 0, "temperature", { t1: st("30", "°C"), t2: st("30", "°C") })).toMatchObject({ text: `30${N}°C`, t: 1 });
  });
  it("a sensor with no unit is taken as °C and its text says °C", () => {
    expect(roomHeat(f, 0, "temperature", { t1: st("23"), t2: st("23") })).toMatchObject({ text: `23${N}°C`, t: 0.7 });
  });
  it("a value that is not a reading is not one: out of range, another unit, text, comma, NaN, Infinity", () => {
    const one = floor([room("Living", sq(0, 0, 400, 400), { temps: ["t1"] })]);
    const bad: Array<[string, string?]> = [["95", "°C"], ["-61", "°C"], ["91", "°C"], ["200", "°F"], ["-100", "°F"], ["21", "K"], ["21", "%"], ["12,5", "°C"], ["NaN", "°C"], ["Infinity", "°C"], ["-Infinity"], ["unknown", "°C"], ["unavailable", "°C"], [""], ["1e3"], ["abc"]];
    for (const [s, u] of bad) expect(roomHeat(one, 0, "temperature", { t1: st(s, u) }), `${s} ${u}`).toBeNull();
    // the ends of the accepted range are readings
    expect(roomHeat(one, 0, "temperature", { t1: st("90", "°C") })?.t).toBe(1);
    expect(roomHeat(one, 0, "temperature", { t1: st("-60", "°C") })?.t).toBe(0);
  });
  it("one unavailable and one readable sensor use the readable one; a faulty one is left out, not averaged in", () => {
    expect(roomHeat(f, 0, "temperature", { t1: st("unavailable"), t2: st("23", "°C") })).toMatchObject({ text: `23${N}°C`, t: 0.7 });
    expect(roomHeat(f, 0, "temperature", { t1: st("95", "°C"), t2: st("23", "°C") })).toMatchObject({ text: `23${N}°C`, t: 0.7 });
    // a faulty first reading does not pick the unit: the °C one is read
    expect(roomHeat(f, 0, "temperature", { t1: st("200", "°F"), t2: st("23", "°C") })).toMatchObject({ text: `23${N}°C`, t: 0.7 });
  });
  it("two units in one list: the first readable unit wins, as the readout does", () => {
    expect(roomHeat(f, 0, "temperature", { t1: st("21", "°C"), t2: st("75.2", "°F") })).toMatchObject({ text: `21${N}°C`, t: 0.5 });
  });
  it("never throws on untrusted shapes", () => {
    const junk = [undefined, null, 5, "x", {}, [], { rooms: 5 }, { rooms: [null] }, { rooms: [{ kind: "room" }] }, { rooms: [{ kind: "room", temps: 5 }], devices: 5 }, { rooms: [{ kind: "room", pts: [[0, 0]], temps: [3, null, "t1"] }], devices: [null, 3, { type: "temp" }] }];
    for (const j of junk) for (const i of [0, -1, 1.5, NaN, 99]) for (const s of [undefined, null, {}, { t1: null }, { t1: { state: 3 } }, { __proto__: null }]) {
      expect(() => roomHeat(j as unknown as Floor, i, "temperature", s as never)).not.toThrow();
      expect(roomHeat(j as unknown as Floor, i, "temperature", s as never)).toBeNull();
    }
    expect(roomHeat(f, 0, "off", { t1: st("21", "°C") })).toBeNull();
    expect(roomHeat(f, 0, "bogus" as HeatKind, { t1: st("21", "°C") })).toBeNull();
    expect(roomHeat(floor([room("__proto__", sq(0, 0, 9, 9), { temps: ["__proto__"] })]), 0, "temperature", {})).toBeNull();
  });
});

describe("roomHeat, humidity", () => {
  const f = floor([room("Bath", sq(0, 0, 400, 400), { humidity: ["h1"], temps: ["t1"] })]);
  it("reads the humidity list on 30 to 70 %: 54 is 0.6; a temperature in the list is not a humidity", () => {
    expect(roomHeat(f, 0, "humidity", { h1: st("54", "%") })).toEqual({ text: `54${N}%`, t: 0.6 });
    expect(roomHeat(f, 0, "humidity", { h1: st("30", "%") })?.t).toBe(0);
    expect(roomHeat(f, 0, "humidity", { h1: st("70") })).toEqual({ text: `70${N}%`, t: 1 });
    expect(roomHeat(f, 0, "humidity", { h1: st("20", "%") })).toEqual({ text: `20${N}%`, t: 0 });
    expect(roomHeat(f, 0, "humidity", { h1: st("85", "%") })).toEqual({ text: `85${N}%`, t: 1 });
    expect(roomHeat(f, 0, "humidity", { t1: st("54", "%") })).toBeNull();
  });
  it("101 and -1 are not readings, 0 and 100 are; a °C unit is not a humidity", () => {
    expect(roomHeat(f, 0, "humidity", { h1: st("101", "%") })).toBeNull();
    expect(roomHeat(f, 0, "humidity", { h1: st("-1", "%") })).toBeNull();
    expect(roomHeat(f, 0, "humidity", { h1: st("0", "%") })?.t).toBe(0);
    expect(roomHeat(f, 0, "humidity", { h1: st("100", "%") })?.t).toBe(1);
    expect(roomHeat(f, 0, "humidity", { h1: st("54", "°C") })).toBeNull();
  });
});

describe("roomHeat, sources (Q2: own list first, else the sensors standing in the room)", () => {
  // Living 0..400 holds a Reading corner zone 300..400 and a Study to its right.
  const rooms = [room("Living", sq(0, 0, 400, 400), { temps: ["list1"] }), room("Study", sq(400, 0, 400, 400)), room("Corner", sq(300, 300, 100, 100), { kind: "zone" })];
  const devices = [dev("temp", "in_living", 100, 100), dev("temp", "in_corner", 350, 350), dev("temp", "in_study", 500, 100), dev("temp", "nowhere", 5000, 5000), dev("humidity", "h_study", 500, 100), dev("climate", "c_study", 500, 100)];
  const f = floor(rooms, devices);
  const s = { list1: st("20", "°C"), in_living: st("26", "°C"), in_corner: st("26", "°C"), in_study: st("22", "°C"), nowhere: st("26", "°C"), h_study: st("60", "%"), c_study: st("heat", "°C") };
  it("the room's own list wins over a device in it", () => {
    expect(roomHeat(f, 0, "temperature", s)).toMatchObject({ text: `20${N}°C`, t: 0.4 });
  });
  it("with no readable list, the temp devices in the room feed it; a device in a zone feeds the room under it", () => {
    expect(roomHeat(f, 0, "temperature", { ...s, list1: st("unavailable") })).toMatchObject({ text: `26${N}°C`, t: 1 });
    expect(roomHeat(f, 0, "temperature", { ...s, list1: st("unavailable"), in_living: st("unknown") })).toMatchObject({ text: `26${N}°C`, t: 1 }); // the corner sensor, under the zone
    expect(roomHeat(f, 1, "temperature", s)).toMatchObject({ text: `22${N}°C`, t: 0.6 });
  });
  it("a device in no room feeds nothing; a zone never heats; a climate is not a source; humidity reads humidity devices", () => {
    expect(roomHeat(f, 2, "temperature", s)).toBeNull();
    expect(roomHeat(f, 1, "temperature", { c_study: st("heat", "°C") })).toBeNull();
    expect(roomHeat(f, 1, "humidity", s)).toEqual({ text: `60${N}%`, t: 0.75 });
    expect(roomHeat(f, 1, "humidity", { in_study: st("22", "°C") })).toBeNull();
  });
  it("a sensor named by two rooms feeds both", () => {
    const g = floor([room("A", sq(0, 0, 100, 100), { temps: ["shared"] }), room("B", sq(200, 0, 100, 100), { temps: ["shared"] })]);
    const sh = { shared: st("21", "°C") };
    expect(roomHeat(g, 0, "temperature", sh)?.t).toBe(0.5);
    expect(roomHeat(g, 1, "temperature", sh)?.t).toBe(0.5);
  });
});

describe("roomHeat drops impossible readings from placed sensors (H3 bounds)", () => {
  it("averages 120 and 22 degC placed sensors to 22, not 71", () => {
    const f = floor([room("A", sq(0, 0, 400, 400))], [dev("temp", "sensor.bad", 100, 100), dev("temp", "sensor.ok", 200, 200)]);
    const h = roomHeat(f, 0, "temperature", { "sensor.bad": st("120", "°C"), "sensor.ok": st("22", "°C") });
    expect(h?.text).toBe(`22${N}°C`);
  });
});

// S42.4: `c` is the room's mean in °C, the number `tempWarn` takes. Same rule as `t` and `text`, so the readout, the heat map and the warning agree.
describe("roomHeat().c (S42.4)", () => {
  const f = floor([room("Living", sq(0, 0, 400, 400), { temps: ["t1", "t2"] })]);
  it("is the mean in °C", () => {
    expect(roomHeat(f, 0, "temperature", { t1: st("23", "°C"), t2: st("24.5", "°C") })!.c).toBe(23.75);
  });
  it("converts °F: 75.2 °F is 24 °C while the text keeps °F", () => {
    const h = roomHeat(f, 0, "temperature", { t1: st("75.2", "°F"), t2: st("75.2", "°F") })!;
    expect(h.c).toBeCloseTo(24, 9);
    expect(h.text).toBe(`75.2${N}°F`);
  });
  it("a sensor with no unit is °C", () => {
    expect(roomHeat(f, 0, "temperature", { t1: st("23"), t2: st("23") })!.c).toBe(23);
  });
  it("none without a reading, and humidity has no °C", () => {
    expect(roomHeat(f, 0, "temperature", {})).toBeNull();
    const h = floor([room("Bath", sq(0, 0, 400, 400), { humidity: ["h1"] })]);
    expect(roomHeat(h, 0, "humidity", { h1: st("55", "%") })!.c).toBeUndefined();
  });
});
