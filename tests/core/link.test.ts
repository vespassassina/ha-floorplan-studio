// B53.11: what a linked appliance or plant says about itself. Every state below is copied from the shape Home Assistant sends (finding 21).
import { describe, expect, it } from "vitest";
import { APPLIANCES, LINKABLE, LINKED, MIN_MOISTURE, linkActive, linkOn, linkStatus, linkText } from "../../src/core/link";
import { FURNITURE_SYMBOLS } from "../../src/core/schema";

const NOW = Date.parse("2026-11-06T10:00:00Z");
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes });

// Home Connect (core integration `home_connect`): `sensor.washer_operation_state` is an enum sensor with the states inactive, ready,
// delayed_start, run, pause, action_required, finished, aborting, error. `sensor.washer_remaining_program_time` is device_class timestamp,
// its state an ISO 8601 time with offset (the end of the program). `sensor.washer_power` is a plug-style reading in W (device_class power).
const washerRunning = {
  "sensor.washer_operation_state": st("run", { device_class: "enum", options: ["inactive", "ready", "run", "finished"] }),
  "sensor.washer_remaining_program_time": st("2026-11-06T10:42:00+00:00", { device_class: "timestamp" }),
  "sensor.washer_power": st("412.5", { device_class: "power", unit_of_measurement: "W", state_class: "measurement" }),
};
const washer = { entity: "sensor.washer_operation_state", attached: ["sensor.washer_remaining_program_time", "sensor.washer_power"] };

describe("the pieces that link", () => {
  it("the appliances, the plant and the car, and nothing else", () => {
    // B53.13 added the rest of the electric pieces: tests/core/link-electric.test.ts lists every symbol.
    expect([...LINKABLE].filter((s) => !["tv", "speaker", "computer", "treadmill", "robot-vacuum", "robot-dock"].includes(s)).sort()).toEqual(["car", "dishwasher", "dryer", "fridge", "plant", "stove", "washer"]);
    expect([...APPLIANCES].sort()).toEqual(["dishwasher", "dryer", "fridge", "stove", "washer"]);
  });
  it("every symbol is decided: linked or not, never by default", () => {
    for (const s of FURNITURE_SYMBOLS) expect(typeof LINKABLE.includes(s), s).toBe("boolean");
    for (const s of LINKED) expect(LINKABLE).toContain(s);
    expect(LINKABLE).not.toContain("rug");
    expect(LINKABLE).not.toContain("sofa");
  });
});

describe("an appliance", () => {
  it("runs on its state word, with the minutes left from the end time", () => {
    const s = linkStatus("washer", washer, washerRunning, NOW);
    expect(s).toMatchObject({ running: true, remaining: 42, alert: null, thirsty: false });
    expect(linkText("washer", s)).toBe("Running · 42 min left");
  });
  it("is idle on ready, whatever the other sensors keep", () => {
    const idle = { ...washerRunning, "sensor.washer_operation_state": st("ready", { device_class: "enum" }), "sensor.washer_power": st("0.4", { device_class: "power", unit_of_measurement: "W" }) };
    const s = linkStatus("washer", washer, idle, NOW);
    expect(s.running).toBe(false);
    expect(s.remaining).toBeNull();
    expect(linkText("washer", s)).toBe("Idle");
  });
  it("runs on power alone when no state sensor is attached: above 5 W, not at 5", () => {
    const plug = (w: string, unit = "W") => ({ "sensor.dw_power": st(w, { device_class: "power", unit_of_measurement: unit }) });
    expect(linkStatus("dishwasher", { entity: "sensor.dw_power" }, plug("5.1"), NOW).running).toBe(true);
    expect(linkStatus("dishwasher", { entity: "sensor.dw_power" }, plug("5"), NOW).running).toBe(false);
    expect(linkStatus("dishwasher", { entity: "sensor.dw_power" }, plug("0.9", "kW"), NOW).running).toBe(true);
    expect(linkStatus("dishwasher", { entity: "sensor.dw_power" }, plug("900", "mW"), NOW).running).toBe(false);
  });
  it("reads minutes left from a duration sensor by its unit", () => {
    const dur = (n: string, unit: string) => ({ "sensor.d_state": st("running"), "sensor.d_left": st(n, { device_class: "duration", unit_of_measurement: unit }) });
    const d = { entity: "sensor.d_state", attached: ["sensor.d_left"] };
    expect(linkStatus("dryer", d, dur("37", "min"), NOW).remaining).toBe(37);
    expect(linkStatus("dryer", d, dur("1.5", "h"), NOW).remaining).toBe(90);
    expect(linkStatus("dryer", d, dur("600", "s"), NOW).remaining).toBe(10);
    expect(linkStatus("dryer", d, dur("5", "d"), NOW).remaining).toBeNull();
  });
  it("a finished program (an end time in the past) has no minutes left", () => {
    const past = { ...washerRunning, "sensor.washer_remaining_program_time": st("2026-11-06T09:00:00+00:00", { device_class: "timestamp" }) };
    expect(linkStatus("washer", washer, past, NOW)).toMatchObject({ running: true, remaining: null });
    expect(linkText("washer", linkStatus("washer", washer, past, NOW))).toBe("Running");
  });
  it("a stove is on while its switch is on; a washer's switch alone is not 'running'", () => {
    expect(linkStatus("stove", { entity: "switch.stove" }, { "switch.stove": st("on") }, NOW).running).toBe(true);
    expect(linkStatus("washer", { entity: "switch.washer" }, { "switch.washer": st("on") }, NOW).running).toBe(false);
  });
  it("a fridge door that is open is the alert; a closed one is idle", () => {
    // ZHA / Zigbee2MQTT contact sensor on the fridge door: binary_sensor, device_class door, on = open.
    const f = { entity: "binary_sensor.fridge_door" };
    const open = linkStatus("fridge", f, { "binary_sensor.fridge_door": st("on", { device_class: "door" }) }, NOW);
    expect(open.alert).toBe("door");
    expect(linkText("fridge", open)).toBe("Door open");
    const shut = linkStatus("fridge", f, { "binary_sensor.fridge_door": st("off", { device_class: "door" }) }, NOW);
    expect(shut.alert).toBeNull();
    expect(linkText("fridge", shut)).toBe("Idle");
  });
  it("an error word is the alert", () => {
    const s = linkStatus("washer", { entity: "sensor.w" }, { "sensor.w": st("Error") }, NOW);
    expect(s.alert).toBe("error");
    expect(linkText("washer", s)).toBe("Error");
  });
  it("a binary_sensor with device_class running that is on is running", () => {
    expect(linkStatus("dryer", { entity: "binary_sensor.d" }, { "binary_sensor.d": st("on", { device_class: "running" }) }, NOW).running).toBe(true);
    expect(linkStatus("dryer", { entity: "binary_sensor.d" }, { "binary_sensor.d": st("off", { device_class: "running" }) }, NOW).running).toBe(false);
  });
  it("is on exactly while it runs", () => {
    expect(linkOn("washer", linkStatus("washer", washer, washerRunning, NOW))).toBe(true);
    expect(linkOn("washer", linkStatus("washer", washer, {}, NOW))).toBe(false);
  });
});

describe("a plant", () => {
  // Xiaomi Mi Flora (core `xiaomi_ble`) and the HA `plant` integration: `sensor.<plant>_moisture`, device_class moisture, unit %.
  // The `plant.<name>` entity (legacy integration) is `ok` or `problem`, with `moisture_status` `Low` and `moisture` among its attributes.
  const flora = (n: string) => ({ "sensor.fern_moisture": st(n, { device_class: "moisture", unit_of_measurement: "%", state_class: "measurement" }) });
  const fern = { entity: "sensor.fern_moisture" };
  it("is thirsty below the threshold: 20 by default, not at 20", () => {
    expect(linkStatus("plant", fern, flora("14"), NOW)).toMatchObject({ moisture: 14, thirsty: true });
    expect(linkStatus("plant", fern, flora("20"), NOW).thirsty).toBe(false);
    expect(linkStatus("plant", fern, flora("19"), NOW).thirsty).toBe(true);
    expect(MIN_MOISTURE).toBe(20);
  });
  it("uses the piece's own minMoisture", () => {
    expect(linkStatus("plant", { ...fern, minMoisture: 35 }, flora("30"), NOW).thirsty).toBe(true);
    expect(linkStatus("plant", { ...fern, minMoisture: 10 }, flora("14"), NOW).thirsty).toBe(false);
    expect(linkStatus("plant", { ...fern, minMoisture: 0 }, flora("14"), NOW).thirsty).toBe(true); // 0 is not a valid threshold: the default
    expect(linkStatus("plant", { ...fern, minMoisture: 99.5 }, flora("30"), NOW).thirsty).toBe(false);
  });
  it("prefers a moisture sensor to a humidity one, in whatever order they are attached", () => {
    const both = { "sensor.air": st("60", { device_class: "humidity", unit_of_measurement: "%" }), ...flora("14") };
    expect(linkStatus("plant", { entity: "sensor.air", attached: ["sensor.fern_moisture"] }, both, NOW).moisture).toBe(14);
    expect(linkStatus("plant", { entity: "sensor.air" }, both, NOW).moisture).toBe(60);
  });
  it("needs a percent: a moisture in another unit or out of range is not read", () => {
    expect(linkStatus("plant", fern, { "sensor.fern_moisture": st("14", { device_class: "moisture", unit_of_measurement: "lx" }) }, NOW).moisture).toBeNull();
    expect(linkStatus("plant", fern, flora("140"), NOW).moisture).toBeNull();
    expect(linkStatus("plant", fern, flora("unavailable"), NOW)).toMatchObject({ moisture: null, thirsty: false });
  });
  it("reads a plant.* entity in problem with a low moisture_status when no number is attached", () => {
    const p = { entity: "plant.fern" };
    expect(linkStatus("plant", p, { "plant.fern": st("problem", { moisture_status: "Low", moisture: 8 }) }, NOW).thirsty).toBe(true);
    expect(linkStatus("plant", p, { "plant.fern": st("problem", { moisture_status: "Low" }) }, NOW)).toMatchObject({ thirsty: true, moisture: null });
    expect(linkStatus("plant", p, { "plant.fern": st("problem", { battery: "Low" }) }, NOW).thirsty).toBe(false);
    expect(linkStatus("plant", p, { "plant.fern": st("ok", { moisture_status: "Low" }) }, NOW).thirsty).toBe(false);
  });
  it("a number wins over the plant entity's verdict", () => {
    const both = { "plant.fern": st("problem", { moisture_status: "Low" }), ...flora("55") };
    expect(linkStatus("plant", { entity: "plant.fern", attached: ["sensor.fern_moisture"] }, both, NOW).thirsty).toBe(false);
  });
  it("says what it knows", () => {
    expect(linkText("plant", linkStatus("plant", fern, flora("14"), NOW))).toBe("Needs water · 14 %");
    expect(linkText("plant", linkStatus("plant", fern, flora("48"), NOW))).toBe("Moisture 48 %");
    expect(linkText("plant", linkStatus("plant", { entity: "plant.f" }, { "plant.f": st("problem", { moisture_status: "Low" }) }, NOW))).toBe("Needs water");
    expect(linkText("plant", linkStatus("plant", fern, {}, NOW))).toBe("");
  });
  it("is active exactly while thirsty, and never painted on (Opus review: the blue glow is its look, amber would clash); an appliance rule never reads a plant", () => {
    expect(linkActive("plant", linkStatus("plant", fern, flora("14"), NOW))).toBe(true);
    expect(linkActive("plant", linkStatus("plant", fern, flora("48"), NOW))).toBe(false);
    expect(linkOn("plant", linkStatus("plant", fern, flora("14"), NOW))).toBe(false);
    expect(linkStatus("plant", { entity: "sensor.p" }, { "sensor.p": st("run") }, NOW).running).toBe(false);
  });
});

describe("hostile input (finding 1)", () => {
  it("never throws and reads nothing from junk", () => {
    const junk: unknown[] = [null, undefined, 5, "x", [], { entity: 5 }, { entity: "sensor.a", attached: "sensor.b" }, { entity: "__proto__.x", attached: [null, {}, "constructor.y"] }];
    for (const m of junk) for (const sym of ["washer", "plant", "x", null]) {
      const s = linkStatus(sym, m as never, { "sensor.a": st("run") }, NOW);
      expect(typeof s.running).toBe("boolean");
    }
    const trap = new Proxy({}, { get() { throw new Error("boom"); }, has() { throw new Error("boom"); } });
    expect(() => linkStatus("washer", { entity: "sensor.a" }, trap as never, NOW)).not.toThrow();
    expect(linkStatus("washer", { entity: "sensor.a" }, { "sensor.a": { state: 5 as never, attributes: null as never } }, NOW).running).toBe(false);
    expect(linkStatus("washer", { entity: "sensor.a" }, { "sensor.a": st("run", { device_class: { toString() { throw new Error("x"); } } }) }, NOW).running).toBe(true);
  });
  it("a state of the Object prototype's own names is just a word", () => {
    expect(linkStatus("washer", { entity: "sensor.a" }, { "sensor.a": st("__proto__") }, NOW).running).toBe(false);
    expect(linkStatus("washer", { entity: "sensor.a" }, { "sensor.a": st("constructor") }, NOW).running).toBe(false);
  });
});
