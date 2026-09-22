import { describe, it, expect } from "vitest";
import { areaMove, type HaData } from "../../src/core";

const ha = (entities: HaData["entities"]): HaData => ({ floors: [], areas: [{ id: "living", name: "Living" }, { id: "kitchen", name: "Kitchen" }], entities });

describe("areaMove: what to write so an entity sits in a room's HA area", () => {
  it("nothing when the entity already is in that area, is unknown, or the room has no area", () => {
    const h = ha([{ id: "light.a", name: "A", domain: "light", area: "living" }]);
    expect(areaMove(h, "light.a", "living")).toBeNull();
    expect(areaMove(h, "light.nope", "living")).toBeNull();
    expect(areaMove(h, "light.a", "")).toBeNull();
    expect(areaMove(h, "", "living")).toBeNull();
  });
  it("an entity that is the only one of its device moves the device", () => {
    const h = ha([{ id: "light.a", name: "A", domain: "light", area: "kitchen", dev: "d1" }]);
    expect(areaMove(h, "light.a", "living")).toEqual({ kind: "device", id: "d1", area: "living" });
  });
  it("an entity whose device has other entities moves only itself, so the others stay put", () => {
    const h = ha([{ id: "sensor.t", name: "T", domain: "sensor", area: "kitchen", dev: "d2" }, { id: "sensor.h", name: "H", domain: "sensor", area: "kitchen", dev: "d2" }]);
    expect(areaMove(h, "sensor.t", "living")).toEqual({ kind: "entity", id: "sensor.t", area: "living" });
  });
  it("an entity with no device (a helper) moves itself", () => {
    const h = ha([{ id: "light.h", name: "H", domain: "light", area: null }]);
    expect(areaMove(h, "light.h", "living")).toEqual({ kind: "entity", id: "light.h", area: "living" });
  });
});
