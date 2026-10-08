import { describe, expect, it } from "vitest";
import { areaChoices, areaMenuEntities, placeableDevicesInArea, unplacedDevicesInArea, type HaData } from "../../src/core/ha";
import type { Layout } from "../../src/core/schema";

// S24.6 (U16): room-scoped lists show what Place would, and an area once.
const layout = (): Layout => ({
  version: 2, unit: "cm", north: 0,
  floors: { ground: { title: "Ground", outline: [], walls: [], rooms: [{ id: "r1", name: "Kitchen", area: "kitchen", kind: "room", pts: [[0, 0], [100, 0], [100, 100]], wk: [] }], stairs: [], doors: [], openings: [], extras: [], furniture: [], devices: [], unlinked: [] } },
  catalog: [],
} as unknown as Layout);

const ha = (): HaData => ({
  floors: [{ id: "f0", name: "Ground" }, { id: "f1", name: "First" }],
  areas: [
    { id: "kitchen", name: "Kitchen", floor_id: "f0" },
    { id: "hall_0", name: "Stair hall", floor_id: "f0" },
    { id: "hall_1", name: "Stair hall", floor_id: "f1" },
    { id: "hall_1", name: "Stair hall", floor_id: "f1" }, // the same area twice, as a registry merge can send it
    { id: "attic", name: "attic" },
  ],
  devices: [{ id: "d_plug", name: "Kettle plug" }],
  entities: [
    { id: "light.kitchen", name: "Kitchen light", domain: "light", area: "kitchen" },
    { id: "switch.kettle", name: "Kettle plug", domain: "switch", dc: "outlet", area: "kitchen", dev: "d_plug" },
    { id: "sensor.kettle_power", name: "Kettle plug power", domain: "sensor", dc: "power", area: "kitchen" },
    { id: "scene.kitchen_bright", name: "Kitchen bright", domain: "scene", area: "kitchen" },
    { id: "sensor.kitchen_battery", name: "Kitchen battery", domain: "sensor", dc: "battery", area: "kitchen" },
  ],
});

describe("areaMenuEntities: the room right-click lists what Place lists", () => {
  it("leaves out the noise Place leaves out: a loose power sensor, a scene, a battery", () => {
    const ids = areaMenuEntities(layout(), ha(), "kitchen").map((e) => e.id).sort();
    expect(ids).toEqual(["light.kitchen", "switch.kettle"]);
    // ...which the old source list did show, so this test fails on it.
    expect(unplacedDevicesInArea(layout(), ha(), "kitchen").map((e) => e.id)).toContain("scene.kitchen_bright");
    expect(ids).toEqual(placeableDevicesInArea(layout(), ha(), "kitchen").map((e) => e.id).sort());
  });
  it("nothing without HA or an area", () => {
    expect(areaMenuEntities(layout(), undefined, "kitchen")).toEqual([]);
    expect(areaMenuEntities(layout(), ha(), "")).toEqual([]);
  });
});

describe("areaChoices: an area once, by name, its floor when two share a name", () => {
  it("dedupes by id and adds the floor to a repeated name", () => {
    const c = areaChoices(ha());
    expect(c.map((a) => a.id)).toEqual(["attic", "kitchen", "hall_0", "hall_1"]);
    expect(c.find((a) => a.id === "hall_0")!.label).toBe("Stair hall - Ground");
    expect(c.find((a) => a.id === "hall_1")!.label).toBe("Stair hall - First");
    expect(c.find((a) => a.id === "kitchen")!.label).toBe("Kitchen");
    expect(c.find((a) => a.id === "hall_1")!.name).toBe("Stair hall"); // the name the room takes stays HA's own
  });
  it("a repeated name with no floor falls back to the id; junk rows are skipped", () => {
    const h = { floors: [], areas: [{ id: "a", name: "Hall" }, { id: "b", name: "hall " }, null, { id: 3, name: "x" }, { id: "c" }] } as unknown as HaData;
    expect(areaChoices(h).map((a) => a.label)).toEqual(["Hall - a", "hall - b"]);
  });
});
