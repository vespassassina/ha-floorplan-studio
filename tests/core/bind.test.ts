import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { groupKind, placedEntities, unplacedCatalog } from "../../src/core/bind";

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

// S4.5 (Opus review pair: break it by removing the `devs.length !== is.length` guard, which makes a selection with one
// missing/duplicate index still read as "same kind" — the "keeps clear of a mixed or partial selection" case below then passes).
describe("groupKind", () => {
  it("is the shared kind for two or more lights, or two or more motion sensors", () => {
    const l = clone(), f = l.floors.ground;
    f.devices.push({ id: "motion-2", type: "motion", entity: "binary_sensor.demo_kitchen_motion", x: 1, y: 1 });
    expect(groupKind(f, [0, 1])).toBe("light"); // demo devices 0, 1 are both lights
    expect(groupKind(f, [5, f.devices.length - 1])).toBe("motion"); // demo device 5 plus the pushed one
  });

  it("is undefined for a single device, an empty selection, a mixed kind, a non-groupable type, or an index off the end", () => {
    const l = clone(), f = l.floors.ground;
    expect(groupKind(f, [0])).toBeUndefined(); // one light alone
    expect(groupKind(f, [])).toBeUndefined();
    expect(groupKind(f, [0, 5])).toBeUndefined(); // a light and a motion sensor
    expect(groupKind(f, [2, 3])).toBeUndefined(); // switch + plug: neither light nor motion
    expect(groupKind(f, [0, 99])).toBeUndefined();
  });

  it("skips a device with no entity: an unbound light does not count towards the kind", () => {
    const l = clone(), f = l.floors.ground;
    f.devices.push({ id: "unbound-light", type: "light", entity: "", x: 2, y: 2 });
    expect(groupKind(f, [0, f.devices.length - 1])).toBeUndefined();
  });
});
