import { describe, it, expect } from "vitest";
import type { Device, DeviceType, Layout } from "../../src/core/schema";
import { ATTENTION_KINDS, attention } from "../../src/core/attention";

// S42.3 (docs/specs/temp-range.md, decision 12): a room that warns is listed, with its reading and the bound it broke.
const NB = " "; // the narrow no-break space `roomHeat` puts between number and unit
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T10:00:00Z" });
const dev = (type: DeviceType, entity: string, extra: Record<string, unknown> = {}): Device => ({ id: `id-${entity}`, type, entity, x: 10, y: 10, ...extra }) as Device;
const room = (extra: Record<string, unknown> = {}) => ({
  id: "k", name: "Kitchen", area: "", kind: "room", pts: [[0, 0], [400, 0], [400, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"], temps: ["sensor.t"], ...extra,
});
const lay = (roomExtra: Record<string, unknown> = {}, devices: Device[] = [], top: Record<string, unknown> = {}): Layout =>
  ({
    version: 2, unit: "cm", north: 0, catalog: [], tempRange: { min: 17, max: 26 }, ...top,
    floors: { g: { title: "Ground", outline: [], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [], devices, rooms: [room(roomExtra)] } },
  }) as unknown as Layout;
const temp = (n: string, unit = "°C") => ({ "sensor.t": st(n, { unit_of_measurement: unit, device_class: "temperature" }) });

describe("too-hot and too-cold", () => {
  it("pins the full order: the two after smoke, before battery-low", () => {
    expect(ATTENTION_KINDS).toEqual(["alarm-triggered", "alarm-armed", "open", "jammed", "unlocked", "leak", "smoke", "too-hot", "too-cold", "battery-low", "unavailable"]);
  });

  it("lists a hot room with its name, the reading as roomHeat prints it, and the bound", () => {
    const a = attention(lay(), temp("27.4"), undefined, { k: "hot" });
    expect(a.items).toHaveLength(1);
    expect(a.items[0]).toMatchObject({ kind: "too-hot", floor: "g", name: "Kitchen", state: `27.4${NB}°C`, bound: 26, at: { what: "room", index: 0, id: "k" } });
    expect(a.floors.g!.count).toBe(1);
  });

  it("lists a cold room against min; a room's own range replaces the house bound", () => {
    expect(attention(lay(), temp("15.5"), undefined, { k: "cold" }).items[0]).toMatchObject({ kind: "too-cold", bound: 17, state: `15.5${NB}°C` });
    expect(attention(lay({ tempRange: { min: 19 } }), temp("15.5"), undefined, { k: "cold" }).items[0]).toMatchObject({ bound: 19 });
  });

  it("converts the bound to the sensors' unit and rounds it to 0.5", () => {
    // 26 °C = 78.8 °F -> 79; 17 °C = 62.6 °F -> 62.5
    expect(attention(lay(), temp("82", "°F"), undefined, { k: "hot" }).items[0]).toMatchObject({ bound: 79, state: `82${NB}°F` });
    expect(attention(lay(), temp("58", "°F"), undefined, { k: "cold" }).items[0]).toMatchObject({ bound: 62.5 });
  });

  it("lists nothing without warnings, for an unknown room, for junk, or with no reading", () => {
    expect(attention(lay(), temp("27.4")).items).toEqual([]);
    expect(attention(lay(), temp("27.4"), undefined, {}).items).toEqual([]);
    expect(attention(lay(), temp("27.4"), undefined, { nope: "hot" }).items).toEqual([]);
    expect(attention(lay(), temp("27.4"), undefined, { k: "warm" } as never).items).toEqual([]);
    expect(attention(lay(), temp("27.4"), undefined, null as never).items).toEqual([]);
    expect(attention(lay(), temp("27.4"), undefined, [] as never).items).toEqual([]);
    expect(attention(lay(), {}, undefined, { k: "hot" }).items).toEqual([]);
  });

  it("a room id of __proto__ or an inherited warning does not throw or leak", () => {
    expect(() => attention(lay({ id: "__proto__", name: "__proto__" }), temp("27.4"), undefined, JSON.parse('{"__proto__":"hot"}'))).not.toThrow();
    expect(attention(lay(), temp("27.4"), undefined, Object.create({ k: "hot" })).items).toEqual([]);
  });

  it("sorts after smoke and before battery-low", () => {
    const l = lay({}, [dev("other", "binary_sensor.smoke", { name: "Smoke" }), dev("motion", "binary_sensor.m", { name: "Remote" })]);
    const a = attention(l, { ...temp("27.4"), "binary_sensor.smoke": st("on", { device_class: "smoke" }), "binary_sensor.m": st("off", { battery: 3 }) }, undefined, { k: "hot" });
    expect(a.items.map((i) => i.kind)).toEqual(["smoke", "too-hot", "battery-low"]);
  });
});
