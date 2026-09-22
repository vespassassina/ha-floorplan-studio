import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { applyHaNames, typeForEntity, type HaData } from "../../src/core/ha";
import { migrate } from "../../src/core/migrate";
import v1 from "../../demo/layout.v1.json";
import type { Layout } from "../../src/core/schema";

type Ent = HaData["entities"][number];
const ent = (id: string, domain: string, dc?: string): Ent => ({ id, name: id, domain, dc });

describe("typeForEntity (S4.18): a reverse domain/device_class guess for placing an HA entity as a device", () => {
  it("maps every device_class the forward TYPE_RULES already distinguish unambiguously", () => {
    expect(typeForEntity(ent("light.x", "light"))).toBe("light");
    expect(typeForEntity(ent("lock.x", "lock"))).toBe("lock");
    expect(typeForEntity(ent("camera.x", "camera"))).toBe("camera");
    expect(typeForEntity(ent("cover.x", "cover"))).toBe("cover");
    expect(typeForEntity(ent("switch.x", "switch", "outlet"))).toBe("plug");
    expect(typeForEntity(ent("switch.x", "switch"))).toBe("switch");
    expect(typeForEntity(ent("sensor.x", "sensor", "temperature"))).toBe("temp");
    expect(typeForEntity(ent("sensor.x", "sensor", "humidity"))).toBe("humidity");
    expect(typeForEntity(ent("sensor.x", "sensor", "battery"))).toBe("battery");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "motion"))).toBe("motion");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "occupancy"))).toBe("motion");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "door"))).toBe("contact");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "garage_door"))).toBe("contact");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "vibration"))).toBe("vibration");
  });
  it("defaults a genuinely ambiguous domain to its most common member, correctable afterward via the device panel's type field", () => {
    expect(typeForEntity(ent("climate.x", "climate"))).toBe("climate"); // not ac or heater: those add heater/ac-only UI a guess should not turn on
    expect(typeForEntity(ent("media_player.x", "media_player"))).toBe("media"); // not tv
  });
  it("falls back to other for a domain with no rule and a sensor/binary_sensor with no recognised device_class", () => {
    expect(typeForEntity(ent("vacuum.x", "vacuum"))).toBe("other");
    expect(typeForEntity(ent("sensor.x", "sensor", "pressure"))).toBe("other");
    expect(typeForEntity(ent("sensor.x", "sensor"))).toBe("other");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "moisture"))).toBe("other");
  });
});

const L = demo as unknown as Layout;
const ha: HaData = {
  floors: [{ id: "downstairs", name: "Downstairs" }],
  areas: [{ id: "kitchen", name: "The Kitchen" }, { id: "living", name: "Living" }],
  entities: [],
};

describe("migrate keeps the HA links and invents none (S1.37)", () => {
  it("a v1 file has no ha and no entity", () => {
    const l = migrate(v1);
    for (const f of Object.values(l.floors)) { expect("ha" in f).toBe(false); for (const r of f.rooms) expect("entity" in r).toBe(false); }
  });
  it("a v2 file with every link keeps each one byte for byte", () => {
    const src = structuredClone(L) as any;
    src.floors.ground.ha = "downstairs";
    src.floors.ground.rooms[5].entity = "sensor.pond";
    src.floors.ground.furniture[0].name = "Sofa";
    src.floors.ground.furniture[0].entity = "media_player.tv";
    const out = migrate(src) as any;
    expect(out.floors.ground.ha).toBe("downstairs");
    expect(out.floors.ground.rooms[5].entity).toBe("sensor.pond");
    expect(out.floors.ground.furniture[0].name).toBe("Sofa");
    expect(out.floors.ground.furniture[0].entity).toBe("media_player.tv");
  });
});

describe("applyHaNames (S1.37)", () => {
  const linked = () => {
    const l = structuredClone(L) as any;
    l.floors.ground.ha = "downstairs";
    l.floors.ground.rooms[1].area = "kitchen"; l.floors.ground.rooms[1].name = "Old kitchen";
    return l as Layout;
  };
  it("renames a linked floor and a linked room and counts both", () => {
    const l = linked(), r = applyHaNames(l, ha);
    expect(r.changed).toBe(2); // the floor and the kitchen; the demo living room is already called Living
    expect(r.layout.floors.ground.title).toBe("Downstairs");
    expect(r.layout.floors.ground.rooms[1].name).toBe("The Kitchen");
  });
  it("leaves an unknown area id, an empty one, an unlinked floor and their names alone", () => {
    const l = linked() as any;
    l.floors.ground.rooms[0].area = "bogus"; l.floors.ground.rooms[0].name = "Mine";
    l.floors.ground.rooms[2].area = ""; l.floors.ground.rooms[2].name = "Custom";
    l.floors.first.title = "Upper";
    const r = applyHaNames(l, { ...ha, areas: [{ id: "kitchen", name: "The Kitchen" }] });
    expect(r.changed).toBe(2);
    expect(r.layout.floors.ground.rooms[0].name).toBe("Mine");
    expect(r.layout.floors.ground.rooms[2].name).toBe("Custom");
    expect(r.layout.floors.first.title).toBe("Upper");
  });
  it("does not change the object passed in", () => {
    const l = linked(), before = structuredClone(l);
    applyHaNames(l, ha);
    expect(l).toEqual(before);
  });
  it("break it: names that already match report 0 changed and return a deep-equal layout, twice over", () => {
    const first = applyHaNames(linked(), ha).layout, second = applyHaNames(first, ha);
    expect(second.changed).toBe(0);
    expect(second.layout).toEqual(first);
  });
  it("a layout with no links reports 0, and empty or hostile HA data never throws", () => {
    expect(applyHaNames(L, { floors: [{ id: "x", name: "X" }], areas: [], entities: [] }).changed).toBe(0);
    const plain = structuredClone(L) as any;
    for (const f of Object.values<any>(plain.floors)) for (const r of f.rooms) r.area = "";
    expect(applyHaNames(plain, ha).changed).toBe(0);
    expect(applyHaNames(linked(), { floors: [], areas: [], entities: [] }).changed).toBe(0);
    expect(applyHaNames(linked(), { floors: null, areas: [{ id: "kitchen", name: 5 }, null] } as any).changed).toBe(0);
  });
});
