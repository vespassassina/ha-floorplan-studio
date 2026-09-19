import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { placedEntities, unplacedCatalog } from "../../src/core/bind";

const clone = () => structuredClone(demo) as unknown as Layout;

describe("placedEntities", () => {
  it("counts entity and bound of every device on every floor", () => {
    const l = clone();
    const set = placedEntities(l);
    expect(set.has("light.demo_living")).toBe(true);
    expect(set.has("switch.demo_living_relay")).toBe(true);
    expect(set.has("light.demo_bedroom")).toBe(true); // second floor
    expect(set.has("binary_sensor.demo_garage_door")).toBe(false);
  });

  it("ignores a device without bound", () => {
    const l = clone();
    for (const f of Object.values(l.floors)) for (const d of f.devices) delete (d as any).bound;
    expect(placedEntities(l).has("switch.demo_living_relay")).toBe(false);
  });
});

describe("unplacedCatalog", () => {
  it("leaves out a bound pair together and keeps unplaced entries", () => {
    const ids = unplacedCatalog(clone()).map((c) => c.id);
    expect(ids).toContain("contact-garage");
    expect(ids).not.toContain("light-living");
    expect(ids).not.toContain("switch-living-relay");
  });

  it("brings the switch back when the binding is removed", () => {
    const l = clone();
    for (const f of Object.values(l.floors)) for (const d of f.devices) delete (d as any).bound;
    expect(unplacedCatalog(l).map((c) => c.id)).toContain("switch-living-relay");
  });
});
