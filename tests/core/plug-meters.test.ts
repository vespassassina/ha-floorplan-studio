// B53.13: attach just a plug's switch to an electric piece, and the plug's power and energy sensors on the same HA device join the piece.
// Registry rows are the shape of `hass.entities` (the frontend's entity registry display list: entity_id, device_id, entity_category;
// the card reads `device_id` and `entity_category`); `states` are what `hass.states` holds. The device class is read from the state,
// as `_powerLinks` does.
import { describe, expect, it } from "vitest";
import { plugMeters } from "../../src/core/plug-meters";
import { pieceDevice } from "../../src/core/solids";
import type { Layout } from "../../src/core/schema";

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes });
const REG = {
  "switch.fridge_plug": { device_id: "dev1" }, "sensor.fridge_plug_power": { device_id: "dev1" }, "sensor.fridge_plug_energy": { device_id: "dev1" },
  "sensor.fridge_plug_voltage": { device_id: "dev1" }, "sensor.fridge_plug_linkquality": { device_id: "dev1", entity_category: "diagnostic" },
  "switch.other_plug": { device_id: "dev2" }, "sensor.other_power": { device_id: "dev2" }, "sensor.other_power_b": { device_id: "dev2" },
  "sensor.stray_power": { device_id: "dev3" },
};
const STATES = {
  "switch.fridge_plug": st("on"), "sensor.fridge_plug_power": st("42", { device_class: "power", unit_of_measurement: "W" }),
  "sensor.fridge_plug_energy": st("48.2", { device_class: "energy", unit_of_measurement: "kWh" }), "sensor.fridge_plug_voltage": st("230", { device_class: "voltage", unit_of_measurement: "V" }),
  "sensor.fridge_plug_linkquality": st("90", { device_class: "power" }),
  "switch.other_plug": st("on"), "sensor.other_power": st("1", { device_class: "power", unit_of_measurement: "W" }), "sensor.other_power_b": st("2", { device_class: "power", unit_of_measurement: "W" }),
  "sensor.stray_power": st("9", { device_class: "power", unit_of_measurement: "W" }),
};
const piece = (symbol: string, extra: Record<string, unknown> = {}) => ({ id: "p", symbol, x: 10, y: 10, rot: 0, w: 60, h: 60, ...extra });
const layoutOf = (...furniture: unknown[]): Layout => ({ version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { g: { title: "G", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture, unlinked: [] } } }) as unknown as Layout;
const attached = (l: Layout) => (l.floors.g.furniture[0] as unknown as { attached?: string[] }).attached;

describe("plugMeters: a plug's own sensors join the piece it powers", () => {
  it("adds the power sensor and the energy sensor of the plug's device, and nothing else on it", () => {
    const out = plugMeters(layoutOf(piece("fridge", { entity: "switch.fridge_plug" })), REG, STATES);
    expect(attached(out)).toEqual(["sensor.fridge_plug_power", "sensor.fridge_plug_energy"]);
  });
  it("works for a plug in attached, with another entity as the main one", () => {
    const out = plugMeters(layoutOf(piece("washer", { entity: "sensor.washer_state", attached: ["switch.fridge_plug"] })), REG, STATES);
    expect(attached(out)).toEqual(["switch.fridge_plug", "sensor.fridge_plug_power", "sensor.fridge_plug_energy"]);
  });
  it("a sensor the user attached wins: no second power sensor, and no repeat", () => {
    const l = layoutOf(piece("fridge", { entity: "switch.fridge_plug", attached: ["sensor.fridge_plug_power"] }));
    expect(attached(plugMeters(l, REG, STATES))).toEqual(["sensor.fridge_plug_power", "sensor.fridge_plug_energy"]);
    const own = layoutOf(piece("fridge", { entity: "switch.fridge_plug", attached: ["sensor.mine_power"] }));
    expect(attached(plugMeters(own, REG, { ...STATES, "sensor.mine_power": st("5", { device_class: "power", unit_of_measurement: "W" }) }))).toEqual(["sensor.mine_power", "sensor.fridge_plug_energy"]);
  });
  it("two power sensors on one device are a guess: none is added (as findPowerSensor)", () => {
    expect(attached(plugMeters(layoutOf(piece("fridge", { entity: "switch.other_plug" })), REG, STATES))).toBeUndefined();
  });
  it("every electric piece takes it; a piece that cannot link, and a main entity that is not a plug, take nothing", () => {
    for (const s of ["tv", "speaker", "computer", "washer", "dryer", "dishwasher", "fridge", "stove", "treadmill", "robot-vacuum", "robot-dock"])
      expect(attached(plugMeters(layoutOf(piece(s, { entity: "switch.fridge_plug" })), REG, STATES)), s).toEqual(["sensor.fridge_plug_power", "sensor.fridge_plug_energy"]);
    expect(attached(plugMeters(layoutOf(piece("desk", { entity: "switch.fridge_plug" })), REG, STATES))).toBeUndefined();
    expect(attached(plugMeters(layoutOf(piece("plant", { entity: "switch.fridge_plug" })), REG, STATES))).toBeUndefined();
    expect(attached(plugMeters(layoutOf(piece("fridge", { entity: "binary_sensor.door" })), REG, STATES))).toBeUndefined();
  });
  it("the piece's device then carries them (a tv too)", () => {
    const out = plugMeters(layoutOf(piece("tv", { entity: "switch.fridge_plug" })), REG, STATES);
    expect(pieceDevice(out.floors.g.furniture[0])).toMatchObject({ type: "tv", entity: "switch.fridge_plug", attached: ["sensor.fridge_plug_power", "sensor.fridge_plug_energy"] });
  });
  it("is cheap when there is nothing to do: the same layout object, the same pieces", () => {
    const l = layoutOf(piece("sofa"), piece("fridge", { entity: "binary_sensor.door" }));
    expect(plugMeters(l, REG, STATES)).toBe(l);
    expect(plugMeters(l, undefined, STATES)).toBe(l);
    expect(plugMeters(l, REG, undefined)).toBe(l);
  });
  it("does not change the layout it was given", () => {
    const l = layoutOf(piece("fridge", { entity: "switch.fridge_plug" }));
    const before = JSON.stringify(l);
    plugMeters(l, REG, STATES);
    expect(JSON.stringify(l)).toBe(before);
  });
  it("stays within the attached cap", () => {
    const many = Array.from({ length: 24 }, (_, i) => `sensor.s${i}`);
    expect(attached(plugMeters(layoutOf(piece("fridge", { entity: "switch.fridge_plug", attached: many })), REG, STATES))).toHaveLength(24);
  });
  it("hostile registry and states never throw", () => {
    const l = layoutOf(piece("fridge", { entity: "switch.fridge_plug" }), null, 5, piece("tv", { entity: 5 }), piece("fridge", { attached: "x" }));
    const trap = new Proxy({}, { get() { throw new Error("boom"); }, ownKeys() { throw new Error("boom"); } });
    for (const [r, s] of [[trap, STATES], [REG, trap], [null, null], [{ "switch.fridge_plug": null }, STATES], [{ "switch.fridge_plug": { device_id: 5 } }, STATES], [[], []]] as const)
      expect(() => plugMeters(l, r as never, s as never)).not.toThrow();
  });
});
