// Opus review of B53.10-B53.13, 2026-11-06. States are copied from what the integrations send (finding 21):
//  - Home Connect fridge: `binary_sensor.fridge_door` (device_class door), `sensor.fridge_temperature` (device_class temperature, a number),
//    `switch.fridge_child_lock` and `switch.fridge_supermode`, both normally off. A plug is not among them.
//  - Home Connect / Miele washer: `sensor.washer_selected_program` is free text ("cotton"); `sensor.washer_operation_state` says ready / run.
//  - HACS Olen plant: state `problem`, attribute `moisture_status: "Low"`. Core `plant`: state `problem`, attribute `problem: "moisture low"`.
//  - Core vacuum (2026.8): no `battery_level` attribute; the charge is a `sensor.*` with device_class battery on the same HA device.
import { describe, expect, it } from "vitest";
import { linkStatus, linkText } from "../../src/core/link";
import { plugMeters } from "../../src/core/plug-meters";
import { pieceDevice } from "../../src/core/solids";
import type { Layout } from "../../src/core/schema";

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes });
const power = (w: string) => st(w, { device_class: "power", unit_of_measurement: "W", state_class: "measurement" });

describe("a switch is the plug only when the piece's main entity, or the plug plugMeters found", () => {
  const FRIDGE = { entity: "binary_sensor.fridge_door", attached: ["switch.fridge_child_lock", "sensor.fridge_temperature"] };
  const S = { "binary_sensor.fridge_door": st("off", { device_class: "door" }), "switch.fridge_child_lock": st("off"), "sensor.fridge_temperature": st("4", { device_class: "temperature", unit_of_measurement: "°C" }) };
  it("a Home Connect fridge with its child lock off does not read 'Off at the plug'", () => {
    const s = linkStatus("fridge", FRIDGE, S, 0);
    expect(s.plugOff).toBe(false);
    expect(linkText("fridge", s)).toBe("Idle");
  });
  it("the same switch named as a plug by plugMeters does", () => {
    const s = linkStatus("fridge", { ...FRIDGE, plugs: ["switch.fridge_child_lock"] }, S, 0);
    expect(s.plugOff).toBe(true);
    expect(linkText("fridge", s)).toBe("Off at the plug");
  });
  it("a main entity that is a switch is a plug", () => {
    expect(linkStatus("fridge", { entity: "switch.fridge_plug" }, { "switch.fridge_plug": st("off") }, 0).plugOff).toBe(true);
  });
  it("junk in plugs is ignored", () => {
    expect(() => linkStatus("fridge", { ...FRIDGE, plugs: "switch.fridge_child_lock" as never }, S, 0)).not.toThrow();
    expect(linkStatus("fridge", { ...FRIDGE, plugs: [5, null] as never }, S, 0).plugOff).toBe(false);
  });
  describe("plugMeters names the plug: a switch on a device with a power or energy sensor", () => {
    const REG = {
      "binary_sensor.fridge_door": { device_id: "hc" }, "switch.fridge_child_lock": { device_id: "hc" }, "sensor.fridge_temperature": { device_id: "hc" },
      "switch.plug_a": { device_id: "plug" }, "sensor.plug_a_energy": { device_id: "plug" },
    };
    const STATES = { ...S, "switch.plug_a": st("off"), "sensor.plug_a_energy": st("3", { device_class: "energy", unit_of_measurement: "kWh" }) };
    const layoutOf = (m: unknown): Layout => ({ version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { g: { title: "G", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [m], unlinked: [] } } }) as unknown as Layout;
    const fridge = (extra: Record<string, unknown>) => ({ id: "p", symbol: "fridge", x: 10, y: 10, rot: 0, w: 60, h: 60, ...extra });
    it("the child lock is not a plug; the smart plug is, even when its sensors were attached by hand", () => {
      const a = plugMeters(layoutOf(fridge(FRIDGE)), REG, STATES).floors.g.furniture[0] as unknown as { plugs?: string[] };
      expect(a.plugs ?? []).toEqual([]);
      const b = plugMeters(layoutOf(fridge({ entity: "binary_sensor.fridge_door", attached: ["switch.plug_a", "sensor.plug_a_energy"] })), REG, STATES).floors.g.furniture[0] as unknown as { plugs?: string[] };
      expect(b.plugs).toEqual(["switch.plug_a"]);
    });
    it("the piece's device carries them, and a real-shaped fridge with the child lock off does not say 'Off at the plug'", () => {
      const out = plugMeters(layoutOf(fridge({ entity: "binary_sensor.fridge_door", attached: ["switch.fridge_child_lock", "switch.plug_a"] })), REG, STATES);
      const d = pieceDevice(out.floors.g.furniture[0]) as unknown as { plugs?: string[] };
      expect(d.plugs).toEqual(["switch.plug_a"]);
      const s = linkStatus("fridge", { entity: "binary_sensor.fridge_door", attached: ["switch.fridge_child_lock"], plugs: d.plugs }, STATES, 0);
      expect(s.plugOff).toBe(false);
    });
  });
});

describe("an unknown text sensor does not decide; only an idle word does", () => {
  const M = { entity: "sensor.washer_selected_program", attached: ["switch.washer_plug", "sensor.washer_plug_power"] };
  const S = (program: string, w: string) => ({ "sensor.washer_selected_program": st(program), "switch.washer_plug": st("on"), "sensor.washer_plug_power": power(w) });
  it("a plug at 1200 W plus a selected program 'cotton' reads Running", () => {
    const s = linkStatus("washer", M, S("cotton", "1200"), 0);
    expect(s.running).toBe(true);
    expect(linkText("washer", s)).toBe("Running");
  });
  it("and at 2 W it is idle", () => expect(linkStatus("washer", M, S("cotton", "2"), 0).running).toBe(false));
  it("every idle word says not running, whatever the plug draws", () => {
    for (const w of ["ready", "inactive", "off", "idle", "standby", "stop", "stopped", "finished", "end", "none", "pause", "paused", "delayed_start", "Ready"])
      expect(linkStatus("washer", M, S(w, "1200"), 0).running, w).toBe(false);
  });
  it("a running word still wins", () => expect(linkStatus("washer", M, S("run", "0"), 0).running).toBe(true));
});

describe("a piece whose entities are all unavailable says so, as classOf does", () => {
  it("every entity dead: dead, and the text is 'Unavailable', not 'Idle'", () => {
    const s = linkStatus("washer", { entity: "sensor.a", attached: ["switch.b"] }, { "sensor.a": st("unavailable"), "switch.b": st("unknown") }, 0);
    expect(s.dead).toBe(true);
    expect(linkText("washer", s)).toBe("Unavailable");
  });
  it("one alive entity: not dead", () => {
    const s = linkStatus("washer", { entity: "sensor.a", attached: ["switch.b"] }, { "sensor.a": st("unavailable"), "switch.b": st("on") }, 0);
    expect(s.dead).toBe(false);
    expect(linkText("washer", s)).not.toBe("Unavailable");
  });
  it("entities with no state at all are not dead (nothing was read)", () => {
    expect(linkStatus("washer", { entity: "sensor.a" }, {}, 0).dead).toBe(false);
  });
  it("a dead plant and a dead robot say it too", () => {
    expect(linkText("plant", linkStatus("plant", { entity: "sensor.m" }, { "sensor.m": st("unavailable") }, 0))).toBe("Unavailable");
    expect(linkText("robot-vacuum", linkStatus("robot-vacuum", { entity: "vacuum.r" }, { "vacuum.r": st("unavailable") }, 0))).toBe("Unavailable");
  });
});

describe("plant.*: both shapes of 'moisture low'", () => {
  const p = (state: string, attrs: Record<string, unknown>) => linkStatus("plant", { entity: "plant.fern" }, { "plant.fern": st(state, attrs) }, 0).thirsty;
  it("HACS Olen: moisture_status Low", () => expect(p("problem", { moisture_status: "Low" })).toBe(true));
  it("core: the problem attribute contains 'moisture low', any case, with other problems beside it", () => {
    expect(p("problem", { problem: "moisture low" })).toBe(true);
    expect(p("problem", { problem: "Moisture low, conductivity high" })).toBe(true);
  });
  it("another problem, or no problem, is not thirst", () => {
    expect(p("problem", { problem: "temperature low" })).toBe(false);
    expect(p("ok", { problem: "none" })).toBe(false);
    expect(p("ok", { moisture_status: "Low" })).toBe(false);
    expect(p("problem", { problem: 5 })).toBe(false);
  });
});

describe("the vacuum's battery", () => {
  const REG = { "vacuum.robo": { device_id: "rb" }, "sensor.robo_battery": { device_id: "rb", entity_category: "diagnostic" }, "sensor.other_battery": { device_id: "x" }, "sensor.robo_error": { device_id: "rb" } };
  const STATES = {
    "vacuum.robo": st("docked"), "sensor.robo_battery": st("88", { device_class: "battery", unit_of_measurement: "%" }),
    "sensor.other_battery": st("12", { device_class: "battery", unit_of_measurement: "%" }), "sensor.robo_error": st("none"),
  };
  const layoutOf = (m: unknown): Layout => ({ version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { g: { title: "G", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [m], unlinked: [] } } }) as unknown as Layout;
  const robot = (symbol: string, extra: Record<string, unknown> = {}) => ({ id: "p", symbol, x: 10, y: 10, rot: 0, w: 35, h: 35, entity: "vacuum.robo", ...extra });
  const attached = (l: Layout) => (l.floors.g.furniture[0] as unknown as { attached?: string[] }).attached;
  it("plugMeters attaches the battery sensor of the vacuum's device, a diagnostic one too, and no other device's", () => {
    for (const s of ["robot-vacuum", "robot-dock"]) expect(attached(plugMeters(layoutOf(robot(s)), REG, STATES)), s).toEqual(["sensor.robo_battery"]);
  });
  it("a battery the user attached wins; another piece takes none", () => {
    expect(attached(plugMeters(layoutOf(robot("robot-vacuum", { attached: ["sensor.other_battery"] })), REG, STATES))).toEqual(["sensor.other_battery"]);
    expect(attached(plugMeters(layoutOf({ ...robot("fridge") }), REG, STATES))).toBeUndefined();
  });
  it("the status then reads it when the vacuum has no battery_level, and the attribute stays the first choice", () => {
    const m = { entity: "vacuum.robo", attached: ["sensor.robo_battery"] };
    expect(linkStatus("robot-vacuum", m, STATES, 0).battery).toBe(88);
    expect(linkStatus("robot-vacuum", m, { ...STATES, "vacuum.robo": st("docked", { battery_level: 71 }) }, 0).battery).toBe(71);
  });
});
