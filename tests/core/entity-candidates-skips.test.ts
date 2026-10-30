import { describe, it, expect } from "vitest";
import { entityCandidates, type HaData } from "../../src/core/ha";
import type { Layout } from "../../src/core/schema";

// S40 review: each reason entityCandidates skips an entity, one at a time. The first S40.4 test placed AND catalogued
// the same entity, so removing the catalogue branch left it green.

const ha: HaData = {
  floors: [], areas: [], devices: [{ id: "hub", name: "Hub" }],
  entities: [
    { id: "sensor.hub_free", name: "Hub free", domain: "sensor", dev: "hub" },
    { id: "sensor.hub_catalogued", name: "Hub catalogued", domain: "sensor", dev: "hub" },
    { id: "sensor.hub_door", name: "Hub door", domain: "sensor", dev: "hub" },
  ],
};
const layout = (over: (l: Layout) => void): Layout => {
  const l = { version: 2, unit: "cm", north: 0, floors: { ground: { title: "Ground", outline: [], walls: [], rooms: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], devices: [] } }, catalog: [] } as unknown as Layout;
  over(l);
  return l;
};

describe("entityCandidates skips", () => {
  it("lists all three when nothing is taken (the control)", () => {
    expect(entityCandidates(layout(() => {}), ha, "hub", []).map((r) => r.entity)).toEqual(["sensor.hub_catalogued", "sensor.hub_door", "sensor.hub_free"]);
  });
  it("skips an entity in the catalogue that is not placed on any floor", () => {
    const l = layout((x) => { x.catalog.push({ id: "c-1", floor: "ground", room: "", type: "temp", name: "Hub catalogued", entity: "sensor.hub_catalogued" }); });
    expect(l.floors.ground.devices).toHaveLength(0); // catalogued, not placed
    expect(entityCandidates(l, ha, "hub", []).map((r) => r.entity)).toEqual(["sensor.hub_door", "sensor.hub_free"]);
  });
  it("skips an entity attached to a door", () => {
    const l = layout((x) => { x.floors.ground.doors.push({ id: "d-1", a: [0, 0], b: [90, 0], kind: "door", sensors: ["sensor.hub_door"] } as never); });
    expect(entityCandidates(l, ha, "hub", []).map((r) => r.entity)).toEqual(["sensor.hub_catalogued", "sensor.hub_free"]);
  });
});
