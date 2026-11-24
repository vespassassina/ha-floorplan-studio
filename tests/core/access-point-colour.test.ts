import { describe, it, expect } from "vitest";
import { classOf, DEVICE_COLOURS, deviceColourVars, FLOORPLAN_CSS } from "../../src/core/render";
import type { Device } from "../../src/core/schema";

const ap: Device = { id: "ap1", type: "access_point", entity: "binary_sensor.mesh_node", name: "Mesh Node", x: 100, y: 100 };
const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-11-24T12:00:00Z" });

describe("GitHub Issue #3: access_point on-state colour rule", () => {
  it("defines --fp-dev-access_point, its .on rule, and its -ink rule in FLOORPLAN_CSS", () => {
    expect(DEVICE_COLOURS.access_point).toBe("#2c7fb8");
    expect(FLOORPLAN_CSS).toContain("--fp-dev-access_point:");
    expect(FLOORPLAN_CSS).toContain(".dev-access_point.on{--fp-dev:var(--fp-dev-access_point)}");
    expect(FLOORPLAN_CSS).toContain(".dev-access_point.on{--fp-dev-ink:var(--fp-dev-access_point-ink)}");
  });

  it("classOf treats on, home, and connected as active for access_point", () => {
    expect(classOf(ap, { scale: 1, state: { [ap.entity]: st("on") } })).toBe("on");
    expect(classOf(ap, { scale: 1, state: { [ap.entity]: st("home") } })).toBe("on");
    expect(classOf(ap, { scale: 1, state: { [ap.entity]: st("connected") } })).toBe("on");
    expect(classOf(ap, { scale: 1, state: { [ap.entity]: st("off") } })).toBe("off");
    expect(classOf(ap, { scale: 1, state: { [ap.entity]: st("not_home") } })).toBe("off");
    expect(classOf(ap, { scale: 1, state: { [ap.entity]: st("unavailable") } })).toBe("unavailable");
  });

  it("deviceColourVars emits --fp-dev-access_point and --fp-dev-access_point-ink for custom colours", () => {
    const vars = deviceColourVars({ access_point: "#00cc66" });
    expect(vars).toContain("--fp-dev-access_point:#00cc66");
    expect(vars.some((v) => v.startsWith("--fp-dev-access_point-ink:"))).toBe(true);
  });
});
