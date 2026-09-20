import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { placedEntities, unplacedCatalog } from "../../src/core/bind";

const clone = () => structuredClone(demo) as unknown as Layout;

describe("placedEntities", () => {
  it("counts the entity of every device on every floor, and not a bound switch", () => {
    const l = clone();
    const set = placedEntities(l);
    expect(set.has("light.demo_living")).toBe(true);
    expect(set.has("switch.demo_living_relay")).toBe(false); // bound to a light, but not an icon of its own
    expect(set.has("light.demo_bedroom")).toBe(true); // second floor
    expect(set.has("binary_sensor.demo_garage_door")).toBe(false);
  });

  it("counts a switch once it is a device of its own, even when lights name it", () => {
    const l = clone();
    l.floors.ground.devices.push({ id: "switch-relay", type: "switch", entity: "switch.demo_living_relay", x: 10, y: 10 });
    expect(placedEntities(l).has("switch.demo_living_relay")).toBe(true);
  });
});

describe("unplacedCatalog", () => {
  it("keeps a bound switch that is not placed, and unplaced entries; a bound light's own entity is placed", () => {
    const ids = unplacedCatalog(clone()).map((c) => c.id);
    expect(ids).toContain("contact-garage");
    expect(ids).toContain("switch-living-relay");
    expect(ids).not.toContain("light-living");
  });

  it("drops the switch once it is placed as an icon", () => {
    const l = clone();
    l.floors.ground.devices.push({ id: "switch-relay", type: "switch", entity: "switch.demo_living_relay", x: 10, y: 10 });
    expect(unplacedCatalog(l).map((c) => c.id)).not.toContain("switch-living-relay");
  });
});
