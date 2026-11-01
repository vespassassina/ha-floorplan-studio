import { describe, expect, it } from "vitest";
import { EVENTS_MARKER, EVENT_RULES, NO_EVENT, onsets, type EventTools } from "../../src/card/replay/events";
import { parseHistory } from "../../src/card/replay/history";
import { coverActive } from "../../src/core/cover";
import { doorStateOf } from "../../src/core/door-state";
import { DEVICE_TYPES } from "../../src/core/schema";

// Row shapes, as Home Assistant sends them (checked on a real HA, 2026-10-31; source: homeassistant/components/recorder/history/modern.py
// and recorder/models/state.py): with include_start_time_state the first row is the state at the start (its `lu` is the start time).
// The lean call (minimal_response, no_attributes false) sends `{s, a, lu}` first and `{s, lu}` after. The full call sends
// `{s, a, lu}` on every row. `lu` is float seconds. parseHistory carries the first row's attributes forward.
const tools: EventTools = { doorStateOf, coverActive };
const idx = (rows: Record<string, unknown[]>) => parseHistory(rows, Object.keys(rows));
const floor = (p: { devices?: object[]; doors?: object[]; rooms?: object[] }) =>
  ({ devices: p.devices ?? [], doors: p.doors ?? [], rooms: p.rooms ?? [] }) as never;
const dev = (type: string, entity: string) => ({ id: entity, type, entity, x: 0, y: 0 });
const run = (entity: string, type: string, rows: unknown[]) => onsets(idx({ [entity]: rows }), floor({ devices: [dev(type, entity)] }), tools);
const ms = (s: number) => s * 1000;
const LINEAR_MS = 1000;

describe("the table", () => {
  it("names every device type: a rule or a reason to have none (finding 17)", () => {
    for (const t of DEVICE_TYPES) {
      const rule = Object.prototype.hasOwnProperty.call(EVENT_RULES, t), none = NO_EVENT.includes(t);
      expect(rule !== none, `${t}: exactly one of EVENT_RULES and NO_EVENT`).toBe(true);
    }
    for (const t of [...Object.keys(EVENT_RULES), ...NO_EVENT]) expect(DEVICE_TYPES as readonly string[], `${t} is not a device type`).toContain(t);
  });
  it("holds a marker only the chunk carries", () => {
    expect(EVENTS_MARKER).toBe("fp-events-v1");
  });
});

describe("one entity per group", () => {
  it("lamp: a light turning on, not off; asymmetric times", () => {
    const o = run("light.a", "light", [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1100.25 }, { s: "off", lu: 1300.5 }, { s: "on", lu: 1700.75 }]);
    expect(o).toEqual([
      { entity: "light.a", t: ms(1100.25), group: "lamp", kind: "light" },
      { entity: "light.a", t: ms(1700.75), group: "lamp", kind: "light" },
    ]);
  });
  it("motion and radar turn on", () => {
    expect(run("binary_sensor.m", "motion", [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1010.5 }, { s: "off", lu: 1020 }])).toEqual([{ entity: "binary_sensor.m", t: ms(1010.5), group: "motion", kind: "motion" }]);
    expect(run("binary_sensor.r", "radar", [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1033 }])).toEqual([{ entity: "binary_sensor.r", t: ms(1033), group: "motion", kind: "radar" }]);
  });
  it("a room's motion sensor turns on", () => {
    const f = floor({ rooms: [{ id: "r1", motion: ["binary_sensor.rm"] }] });
    expect(onsets(idx({ "binary_sensor.rm": [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1042 }] }), f, tools)).toEqual([{ entity: "binary_sensor.rm", t: ms(1042), group: "motion", kind: "room" }]);
  });
  it("opening: a contact sensor on; a cover open or opening; a lock unlocked or jammed", () => {
    expect(run("binary_sensor.c", "contact", [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1005 }])).toEqual([{ entity: "binary_sensor.c", t: ms(1005), group: "opening", kind: "contact" }]);
    const gar = { device_class: "garage" };
    expect(run("cover.g", "cover", [{ s: "closed", a: gar, lu: 1000 }, { s: "opening", a: gar, lu: 1010 }, { s: "open", a: gar, lu: 1020 }, { s: "closed", a: gar, lu: 1030 }, { s: "open", a: gar, lu: 1040 }]).map((e) => e.t)).toEqual([ms(1010), ms(1040)]);
    // a curtain is not an opening: coverActive says no
    expect(run("cover.k", "cover", [{ s: "closed", a: { device_class: "curtain" }, lu: 1000 }, { s: "open", a: { device_class: "curtain" }, lu: 1010 }])).toEqual([]);
    expect(run("lock.l", "lock", [{ s: "locked", a: {}, lu: 1000 }, { s: "unlocking", lu: 1005 }, { s: "unlocked", lu: 1006 }, { s: "jammed", lu: 1007 }, { s: "locked", lu: 1009 }, { s: "jammed", lu: 1011 }]).map((e) => e.t)).toEqual([ms(1006), ms(1011)]);
  });
  it("a door or window opens by its sensor, its lock or its cover (doorStateOf)", () => {
    const f = floor({ doors: [{ id: "d1", name: "Front", kind: "door", sensors: ["binary_sensor.ds"], locks: ["lock.dl"] }, { id: "d2", name: "Gate", kind: "door", cover: "cover.dc" }] });
    const o = onsets(idx({
      "binary_sensor.ds": [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1050 }, { s: "off", lu: 1060 }],
      "lock.dl": [{ s: "locked", a: {}, lu: 1000 }, { s: "unlocked", lu: 1200 }],
      "cover.dc": [{ s: "closed", a: {}, lu: 1000 }, { s: "open", lu: 1300 }],
    }), f, tools);
    expect(o).toEqual([
      { entity: "binary_sensor.ds", t: ms(1050), group: "opening", kind: "door" },
      { entity: "lock.dl", t: ms(1200), group: "opening", kind: "door" },
      { entity: "cover.dc", t: ms(1300), group: "opening", kind: "door" },
    ]);
  });
  it("a door on an entity with 60,000 rows is read in linear time (Opus review: it filtered every row for every moment)", () => {
    const rows: unknown[] = [{ s: "off", a: {}, lu: 1000 }];
    for (let i = 1; i < 60000; i++) rows.push({ s: i % 2 ? "on" : "off", lu: 1000 + i });
    const index = idx({ "binary_sensor.busy": rows });
    const f = floor({ doors: [{ id: "d1", name: "Front", kind: "door", sensors: ["binary_sensor.busy"] }] });
    const t0 = performance.now();
    const o = onsets(index, f, tools);
    const took = performance.now() - t0;
    expect(o).toHaveLength(30000); // every odd row is an off to on
    expect(o[0]).toEqual({ entity: "binary_sensor.busy", t: ms(1001), group: "opening", kind: "door" });
    expect(took).toBeLessThan(LINEAR_MS);
  });
  it("a door whose two sensors both read on is one onset, and a sensor dropping out between is none", () => {
    const f = floor({ doors: [{ id: "d1", name: "Front", kind: "door", sensors: ["binary_sensor.a", "binary_sensor.b"] }] });
    const o = onsets(idx({
      "binary_sensor.a": [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1100 }, { s: "unavailable", lu: 1200 }, { s: "on", lu: 1300 }],
      "binary_sensor.b": [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1150 }],
    }), f, tools);
    expect(o.map((e) => e.t)).toEqual([ms(1100)]);
    // one sensor alone: nothing else holds the door open while it is dead
    const g = floor({ doors: [{ id: "d1", name: "Front", kind: "door", sensors: ["binary_sensor.a"] }] });
    expect(onsets(idx({ "binary_sensor.a": [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1100 }, { s: "unavailable", lu: 1200 }, { s: "on", lu: 1300 }] }), g, tools).map((e) => e.t)).toEqual([ms(1100)]);
  });
  it("alarm: triggered, and arming or disarming; siren, vibration and a leak or smoke sensor on", () => {
    const rows = [{ s: "disarmed", a: {}, lu: 1000 }, { s: "arming", lu: 1010 }, { s: "armed_away", lu: 1020 }, { s: "armed_home", lu: 1030 }, { s: "pending", lu: 1040 }, { s: "triggered", lu: 1050 }, { s: "disarmed", lu: 1060 }];
    expect(run("alarm_control_panel.p", "alarm", rows).map((e) => [e.t, e.group, e.kind])).toEqual([[ms(1020), "alarm", "alarm"], [ms(1050), "alarm", "alarm"], [ms(1060), "alarm", "alarm"]]);
    expect(run("switch.s", "siren", [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1101 }]).map((e) => [e.t, e.group])).toEqual([[ms(1101), "alarm"]]);
    expect(run("binary_sensor.v", "vibration", [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1102 }]).map((e) => [e.t, e.group])).toEqual([[ms(1102), "alarm"]]);
    // `other` counts only as a leak or smoke sensor, by device_class (attention's hazard rule); the class rides on the first row
    expect(run("binary_sensor.w", "other", [{ s: "off", a: { device_class: "moisture" }, lu: 1000 }, { s: "on", lu: 1103 }]).map((e) => [e.t, e.group])).toEqual([[ms(1103), "alarm"]]);
    expect(run("binary_sensor.o", "other", [{ s: "off", a: { device_class: "door" }, lu: 1000 }, { s: "on", lu: 1104 }])).toEqual([]);
  });
  it("a type with no rule gives nothing, however it changes", () => {
    for (const t of NO_EVENT) expect(run("x.y", t, [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1100 }]), t).toEqual([]);
  });
});

describe("what is not an onset", () => {
  it("unavailable between two on rows gives one onset, not two", () => {
    // on, unavailable, on: the sensor dropped out and came back in the state it had
    const o = run("binary_sensor.m", "motion", [{ s: "on", a: {}, lu: 1000 }, { s: "unavailable", lu: 1100 }, { s: "on", lu: 1200 }, { s: "unknown", lu: 1250 }, { s: "off", lu: 1300 }, { s: "unavailable", lu: 1310 }, { s: "on", lu: 1400 }]);
    expect(o.map((e) => e.t)).toEqual([ms(1400)]);
  });
  it("the start row gives none, whatever it says", () => {
    expect(run("light.a", "light", [{ s: "on", a: {}, lu: 1000 }])).toEqual([]);
    expect(run("alarm_control_panel.p", "alarm", [{ s: "triggered", a: {}, lu: 1000 }])).toEqual([]);
  });
  it("a repeated on is not a new onset", () => {
    expect(run("light.a", "light", [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1100 }, { s: "on", a: { brightness: 3 }, lu: 1200 }]).map((e) => e.t)).toEqual([ms(1100)]);
  });
  it("two devices on one entity count once; the output is in time order", () => {
    const f = floor({ devices: [dev("light", "light.a"), dev("light", "light.a"), dev("light", "light.b")] });
    const o = onsets(idx({ "light.a": [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1500 }], "light.b": [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu: 1200 }] }), f, tools);
    expect(o.map((e) => e.entity)).toEqual(["light.b", "light.a"]);
  });
});

describe("untrusted input (finding 1)", () => {
  it("junk rows, missing lu and non-string s do not throw", () => {
    const rows = [null, 5, "x", {}, { s: "off", a: {}, lu: 1000 }, { s: 7, lu: 1010 }, { s: "on" }, { s: "on", lu: "x" }, { s: "on", lu: 1100 }];
    expect(run("light.a", "light", rows).map((e) => e.t)).toEqual([ms(1100)]);
  });
  it("a floor of the wrong shape, and an index with missing entities, give nothing", () => {
    for (const f of [null, undefined, 5, "x", {}, { devices: 5, doors: "x", rooms: { a: 1 } }, { devices: [null, 3, { type: 5, entity: {} }], doors: [null, { sensors: 5 }, { sensors: [1, null] }], rooms: [null, { motion: "x" }, { motion: [4] }] }]) {
      expect(() => onsets(idx({}), f as never, tools)).not.toThrow();
      expect(onsets(idx({}), f as never, tools)).toEqual([]);
    }
    expect(() => onsets(idx({ "light.a": [{ s: "on", lu: 5 }] }), floor({ devices: [{ type: "__proto__", entity: "light.a" } as never, { type: "constructor", entity: "light.a" } as never] }), tools)).not.toThrow();
  });
});
