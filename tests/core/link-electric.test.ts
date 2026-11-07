// B53.13: any electric piece links, usually through a smart plug; the robot vacuum links a vacuum.* entity. Every state below is copied
// from the shape Home Assistant sends (finding 21):
//  - Zigbee smart plug (ZHA / Zigbee2MQTT, SONOFF S31 and the like): `switch.fridge_plug` on/off; `sensor.fridge_plug_power` device_class power,
//    unit W, state_class measurement; `sensor.fridge_plug_energy` device_class energy, unit kWh, state_class total_increasing.
//  - A daily meter is a core `utility_meter` sensor: device_class energy, unit kWh, attribute meter_period "daily"; Tasmota's own is `..._energy_today`.
//  - HA `vacuum` domain states: cleaning, docked, idle, paused, returning, error; attribute battery_level (0 to 100) on most integrations.
import { describe, expect, it } from "vitest";
import { ELECTRIC, LINKABLE, LINKED, linkOn, linkStatus, linkText, meterLines, meterOf } from "../../src/core/link";
import { FURNITURE_SYMBOLS } from "../../src/core/schema";

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes });
const power = (w: string, unit = "W") => st(w, { device_class: "power", unit_of_measurement: unit, state_class: "measurement" });
const energy = (n: string, extra: Record<string, unknown> = {}) => st(n, { device_class: "energy", unit_of_measurement: "kWh", state_class: "total_increasing", ...extra });
const PLUGGED = { entity: "switch.fridge_plug", attached: ["sensor.fridge_plug_power", "sensor.fridge_plug_energy"] };

describe("which symbols link: each one decided", () => {
  const WHY: Record<string, boolean> = {
    tv: true, speaker: true, computer: true, washer: true, dryer: true, dishwasher: true, fridge: true, stove: true, treadmill: true, "robot-vacuum": true, "robot-dock": true,
    plant: true, car: true,
    desk: false, counter: false, table: false, sofa: false, bed: false, cabinet: false, chair: false, sink: false, toilet: false, shower: false, bathtub: false, "sofa-l": false,
    "coffee-table": false, bookcase: false, buffet: false, wardrobe: false, dresser: false, nightstand: false, armchair: false, rug: false, "barbell-rack": false,
    "weight-rack": false, "chaise-longue": false, "cube-shelf": false, mirror: false, "mirror-stand": false, tree: false, "patio-wood": false, "patio-concrete": false, worktop: false,
  };
  it("the table covers every symbol, so a new one fails here until someone decides", () => {
    expect(Object.keys(WHY).sort()).toEqual([...FURNITURE_SYMBOLS].sort());
  });
  for (const s of FURNITURE_SYMBOLS) it(`${s}: ${WHY[s] ? "links" : "does not"}`, () => expect(LINKABLE.includes(s), s).toBe(WHY[s]));
  it("ELECTRIC is the eleven; LINKABLE is ELECTRIC, the car and the plant", () => {
    expect([...ELECTRIC].sort()).toEqual(["computer", "dishwasher", "dryer", "fridge", "robot-dock", "robot-vacuum", "speaker", "stove", "treadmill", "tv", "washer"]);
    expect([...LINKABLE].sort()).toEqual([...ELECTRIC, "car", "plant"].sort());
    for (const s of ["tv", "speaker", "computer"]) expect(LINKED, s).not.toContain(s); // they keep their own device rules
    for (const s of ["treadmill", "robot-vacuum", "robot-dock"]) expect(LINKED, s).toContain(s);
  });
});

describe("a plug behind an appliance", () => {
  it("off at the plug: not working, and it says so", () => {
    const s = linkStatus("fridge", PLUGGED, { "switch.fridge_plug": st("off"), "sensor.fridge_plug_power": power("0") }, 0);
    expect(s).toMatchObject({ running: false, plugOff: true });
    expect(linkText("fridge", s)).toBe("Off at the plug");
  });
  it("on with power under the threshold is idle; at 5 W still idle; above is working", () => {
    const on = (w: string) => linkStatus("fridge", PLUGGED, { "switch.fridge_plug": st("on"), "sensor.fridge_plug_power": power(w) }, 0);
    expect(on("3.2")).toMatchObject({ running: false, plugOff: false });
    expect(linkText("fridge", on("3.2"))).toBe("Idle");
    expect(on("5").running).toBe(false);
    expect(on("5.1").running).toBe(true);
    expect(linkText("fridge", on("312"))).toBe("Running");
    expect(on("312").watts).toBe(312);
  });
  it("an unreadable power sensor does not make it work, and a plug that is on is not 'off'", () => {
    const s = linkStatus("washer", PLUGGED, { "switch.fridge_plug": st("on"), "sensor.fridge_plug_power": power("unavailable") }, 0);
    expect(s).toMatchObject({ running: false, plugOff: false, watts: null });
  });
  it("the plug that is off says so only while the appliance is not working by its own state", () => {
    const s = linkStatus("washer", { entity: "sensor.washer_state", attached: ["switch.washer_plug"] }, { "sensor.washer_state": st("run"), "switch.washer_plug": st("off") }, 0);
    expect(s.running).toBe(true);
    expect(linkText("washer", s)).toBe("Running");
  });
  it("the appliance's own program state wins over the plug's power, both ways; the plug still fills in the watts", () => {
    const m = { entity: "sensor.washer_state", attached: ["switch.washer_plug", "sensor.washer_plug_power"] };
    const ready = linkStatus("washer", m, { "sensor.washer_state": st("ready"), "switch.washer_plug": st("on"), "sensor.washer_plug_power": power("240") }, 0);
    expect(ready).toMatchObject({ running: false, watts: 240 });
    const run = linkStatus("washer", m, { "sensor.washer_state": st("run"), "switch.washer_plug": st("on"), "sensor.washer_plug_power": power("2") }, 0);
    expect(run).toMatchObject({ running: true, watts: 2 });
  });
  it("a stove: power decides when it is read; its switch alone still means on", () => {
    const m = { entity: "switch.stove_plug", attached: ["sensor.stove_plug_power"] };
    expect(linkStatus("stove", { entity: "switch.stove_plug" }, { "switch.stove_plug": st("on") }, 0).running).toBe(true);
    expect(linkStatus("stove", m, { "switch.stove_plug": st("on"), "sensor.stove_plug_power": power("1") }, 0).running).toBe(false);
    expect(linkStatus("stove", m, { "switch.stove_plug": st("on"), "sensor.stove_plug_power": power("1800") }, 0).running).toBe(true);
  });
  it("kW is converted", () => {
    expect(linkStatus("fridge", PLUGGED, { "sensor.fridge_plug_power": power("0.9", "kW") }, 0).watts).toBe(900);
  });
});

describe("watts and kilowatt-hours", () => {
  const base = { "switch.fridge_plug": st("on"), "sensor.fridge_plug_power": power("312") };
  it("the total when there is no daily meter", () => {
    expect(meterOf(PLUGGED.attached, { ...base, "sensor.fridge_plug_energy": energy("48.26") })).toEqual({ watts: 312, kwh: { n: 48.26, today: false } });
  });
  it("today's meter wins over the total, in any order: by meter_period, or by a today / daily name", () => {
    const a = ["sensor.fridge_plug_energy", "sensor.fridge_daily_energy"], b = ["sensor.fridge_daily_energy", "sensor.fridge_plug_energy"];
    const s = { "sensor.fridge_plug_energy": energy("48.26"), "sensor.fridge_daily_energy": energy("1.4", { meter_period: "daily" }) };
    expect(meterOf(a, s).kwh).toEqual({ n: 1.4, today: true });
    expect(meterOf(b, s).kwh).toEqual({ n: 1.4, today: true });
    const tas = { "sensor.t_energy_total": energy("9"), "sensor.t_energy_today": energy("0.7") };
    expect(meterOf(["sensor.t_energy_total", "sensor.t_energy_today"], tas).kwh).toEqual({ n: 0.7, today: true });
  });
  it("Wh is converted; another unit, a non-energy class and junk are not read", () => {
    expect(meterOf(["sensor.e"], { "sensor.e": st("1500", { device_class: "energy", unit_of_measurement: "Wh" }) }).kwh).toEqual({ n: 1.5, today: false });
    expect(meterOf(["sensor.e"], { "sensor.e": st("15", { device_class: "energy", unit_of_measurement: "J" }) }).kwh).toBeNull();
    expect(meterOf(["sensor.e"], { "sensor.e": st("15", { unit_of_measurement: "kWh" }) }).kwh).toBeNull();
    expect(meterOf(["sensor.e"], { "sensor.e": st("abc", { device_class: "energy", unit_of_measurement: "kWh" }) }).kwh).toBeNull();
    expect(meterOf(["sensor.e"], { "sensor.e": st("-3", { device_class: "energy", unit_of_measurement: "kWh" }) }).kwh).toBeNull();
    expect(meterOf(["sensor.e"], null)).toEqual({ watts: null, kwh: null });
  });
  it("the lines: watts, then energy with 'today' only for a daily meter", () => {
    expect(meterLines({ watts: 312, kwh: { n: 1.4, today: true } })).toEqual(["312 W", "1.4 kWh today"]);
    expect(meterLines({ watts: 4.46, kwh: { n: 48.26, today: false } })).toEqual(["4.5 W", "48.26 kWh"]);
    expect(meterLines({ watts: null, kwh: null })).toEqual([]);
    expect(meterLines({ watts: 0, kwh: null })).toEqual(["0 W"]);
  });
});

describe("a robot vacuum", () => {
  const V = { entity: "vacuum.robo" };
  const v = (state: string, attrs: Record<string, unknown> = {}) => linkStatus("robot-vacuum", V, { "vacuum.robo": st(state, attrs) }, 0);
  it("cleaning and returning work and are away from home; docked, idle and paused are idle", () => {
    expect(v("cleaning")).toMatchObject({ running: true, away: true, vac: "cleaning" });
    expect(v("returning")).toMatchObject({ running: true, away: true, vac: "returning" });
    for (const w of ["docked", "idle", "paused"]) expect(v(w), w).toMatchObject({ running: false, away: false, vac: w });
    expect(v("error")).toMatchObject({ running: false, alert: "error", vac: "error" });
    expect(v("unavailable")).toMatchObject({ running: false, vac: null });
    expect(v("banana")).toMatchObject({ running: false, vac: null });
  });
  it("the text names the state and the battery", () => {
    expect(linkText("robot-vacuum", v("cleaning", { battery_level: 63 }))).toBe("Cleaning · 63 %");
    expect(linkText("robot-vacuum", v("docked", { battery_level: 100 }))).toBe("Docked · 100 %");
    expect(linkText("robot-vacuum", v("returning"))).toBe("Returning");
    expect(linkText("robot-vacuum", v("paused", { battery_level: 40 }))).toBe("Paused · 40 %");
    expect(linkText("robot-vacuum", v("idle"))).toBe("Idle");
    expect(linkText("robot-vacuum", v("error", { battery_level: 40 }))).toBe("Error · 40 %");
  });
  it("battery: the attribute, else an attached battery sensor; nothing out of range", () => {
    const m = { entity: "vacuum.robo", attached: ["sensor.robo_battery"] };
    const s = { "vacuum.robo": st("docked"), "sensor.robo_battery": st("88", { device_class: "battery", unit_of_measurement: "%" }) };
    expect(linkStatus("robot-vacuum", m, s, 0).battery).toBe(88);
    expect(linkStatus("robot-vacuum", m, { ...s, "vacuum.robo": st("docked", { battery_level: 71 }) }, 0).battery).toBe(71);
    expect(v("docked", { battery_level: 140 }).battery).toBeNull();
    expect(v("docked", { battery_level: "full" }).battery).toBeNull();
  });
  it("is on while it works", () => {
    expect(linkOn("robot-vacuum", v("cleaning"))).toBe(true);
    expect(linkOn("robot-vacuum", v("docked"))).toBe(false);
  });
});

describe("a dock", () => {
  const D = { entity: "vacuum.robo" };
  it("speaks for the same vacuum but never works or goes away itself", () => {
    const s = linkStatus("robot-dock", D, { "vacuum.robo": st("cleaning", { battery_level: 63 }) }, 0);
    expect(s).toMatchObject({ running: false, away: false, vac: "cleaning" });
    expect(linkText("robot-dock", s)).toBe("Cleaning · 63 %");
    expect(linkText("robot-dock", linkStatus("robot-dock", D, { "vacuum.robo": st("docked", { battery_level: 100 }) }, 0))).toBe("Docked · 100 %");
  });
  it("with no vacuum, a plug on the dock works as on any appliance", () => {
    const s = linkStatus("robot-dock", { entity: "switch.dock_plug" }, { "switch.dock_plug": st("off") }, 0);
    expect(linkText("robot-dock", s)).toBe("Off at the plug");
  });
});

describe("hostile input (finding 1)", () => {
  it("junk states never throw and read as nothing", () => {
    const junk: unknown = { "switch.a": { state: 5, attributes: null }, "sensor.b": { state: "1", attributes: { device_class: {}, unit_of_measurement: [] } }, "vacuum.c": { state: "cleaning", attributes: { battery_level: {} } } };
    for (const sym of ["fridge", "robot-vacuum", "robot-dock", "treadmill"]) {
      const m = { entity: "vacuum.c", attached: ["switch.a", "sensor.b", "sensor.zzz"] };
      expect(() => linkStatus(sym, m, junk as never, 0), sym).not.toThrow();
    }
    expect(() => meterOf(["sensor.b", "__proto__.x"], junk as never)).not.toThrow();
    const trap = new Proxy({}, { get() { throw new Error("boom"); } });
    expect(() => meterOf(["sensor.b"], trap as never)).not.toThrow();
  });
});
