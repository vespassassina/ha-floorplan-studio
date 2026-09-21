import { describe, it, expect, vi } from "vitest";
import { entitiesForType, type HaData } from "../../src/core";
import { haData, type PickerHass } from "../../src/editor/hass-pickers";

const S = (attributes: Record<string, unknown> = {}) => ({ state: "on", attributes });
const answers: Record<string, unknown> = {
  "config/floor_registry/list": [{ floor_id: "gf", name: "Ground" }],
  "config/area_registry/list": [{ area_id: "living", name: "Living", floor_id: "gf" }, { area_id: "loft", name: "Loft" }],
  "config/device_registry/list": [{ id: "dev1", area_id: "living" }],
  "config/entity_registry/list": [
    { entity_id: "light.own_area", area_id: "loft", device_id: "dev1", name: "Named in registry" }, // its own area beats its device's
    { entity_id: "light.via_device", device_id: "dev1", original_name: "Via device" },
    { entity_id: "light.off", disabled_by: "user" },
    { entity_id: "sensor.registry_only", original_name: "Registry only" },
  ],
};
const hass = (over: Record<string, () => unknown> = {}): PickerHass => ({
  callWS: vi.fn(async (m: { type: string }): Promise<never> => { if (over[m.type]) return over[m.type]() as never; if (m.type in answers) return answers[m.type] as never; throw new Error("unknown"); }),
  states: { "light.own_area": S({ friendly_name: "Own area lamp" }), "light.via_device": S(), "sensor.t": S({ device_class: "temperature", friendly_name: "T" }), "light.off": S(), "switch.no_registry": S() },
});
const boom = () => { throw new Error("no such command"); };

describe("haData", () => {
  it("gives floors, areas, and entities with the area each sits in", async () => {
    const d = (await haData(hass()))!;
    expect(d.floors).toEqual([{ id: "gf", name: "Ground" }]);
    expect(d.areas).toEqual([{ id: "living", name: "Living", floor_id: "gf" }, { id: "loft", name: "Loft" }]);
    const by = Object.fromEntries(d.entities.map((e) => [e.id, e]));
    expect(by["light.own_area"]).toMatchObject({ name: "Own area lamp", area: "loft", domain: "light" });
    expect(by["light.via_device"]).toMatchObject({ name: "Via device", area: "living" });
    expect(by["sensor.t"]).toMatchObject({ area: null, dc: "temperature" });
    expect(by["sensor.registry_only"]).toMatchObject({ name: "Registry only" });
    expect(by["switch.no_registry"]).toMatchObject({ name: "switch.no_registry", area: null });
    expect(by["light.off"]).toBeUndefined(); // a disabled entity is not offered
  });

  it("an older HA with no floor registry still gives areas and entities", async () => {
    const d = (await haData(hass({ "config/floor_registry/list": boom })))!;
    expect(d.floors).toEqual([]);
    expect(d.areas.length).toBe(2);
  });

  it("when neither the area nor the entity registry answers, gives nothing so the editor keeps its text fields", async () => {
    expect(await haData(hass({ "config/area_registry/list": boom, "config/entity_registry/list": boom }))).toBeUndefined();
  });
});

describe("entitiesForType", () => {
  const ha: HaData = { floors: [], areas: [], entities: [
    { id: "light.a", name: "A", domain: "light" }, { id: "switch.plug", name: "P", domain: "switch", dc: "outlet" }, { id: "switch.wall", name: "W", domain: "switch" },
    { id: "sensor.t", name: "T", domain: "sensor", dc: "temperature" }, { id: "sensor.h", name: "H", domain: "sensor", dc: "humidity" }, { id: "sensor.plain", name: "X", domain: "sensor" },
    { id: "binary_sensor.m", name: "M", domain: "binary_sensor", dc: "motion" }, { id: "binary_sensor.d", name: "D", domain: "binary_sensor", dc: "door" },
  ] };
  const ids = (l: HaData["entities"]) => l.map((e) => e.id).sort();
  it("matches by domain and device class", () => {
    expect(ids(entitiesForType(ha, "light").match)).toEqual(["light.a"]);
    expect(ids(entitiesForType(ha, "plug").match)).toEqual(["switch.plug"]);
    expect(ids(entitiesForType(ha, "switch").match)).toEqual(["switch.wall"]);
    expect(ids(entitiesForType(ha, "temp").match)).toEqual(["sensor.t"]);
    expect(ids(entitiesForType(ha, "humidity").match)).toEqual(["sensor.h"]);
    expect(ids(entitiesForType(ha, "motion").match)).toEqual(["binary_sensor.m"]);
    expect(ids(entitiesForType(ha, "contact").match)).toEqual(["binary_sensor.d"]);
  });
  it("what does not match is still offered as the rest, and a type with no rule matches everything", () => {
    const r = entitiesForType(ha, "light");
    expect(r.match.length + r.rest.length).toBe(ha.entities.length);
    expect(entitiesForType(ha, "server")).toEqual({ match: ha.entities, rest: [] });
  });
});
