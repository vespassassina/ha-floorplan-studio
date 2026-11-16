import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { LAMP_KINDS, type Floor } from "../../src/core";
import { makeBuildScene } from "../../src/core/scene-build";
import { liveDeps, sceneDeps } from "../../src/core/three-deps";
import { makeLiveOf } from "../../src/core/live-build";

const buildScene = makeBuildScene(sceneDeps);
const liveOf = makeLiveOf(liveDeps);

const floorWithLamp = (lamp?: Record<string, unknown>, extra?: Record<string, unknown>): Floor => {
  const f = structuredClone(demo).floors.ground as unknown as Floor;
  const light = f.devices.find((d) => d.type === "light")!;
  if (lamp) (light as unknown as Record<string, unknown>).lamp = lamp;
  if (extra) Object.assign(light, extra);
  return f;
};

describe("S62.3: 3D lamp shapes & live pools", () => {
  it("builds 3D solids for every kind in LAMP_KINDS", () => {
    for (const kind of LAMP_KINDS) {
      const f = floorWithLamp({ kind });
      const scene = buildScene(f);
      const lampSolids = scene.solids.filter((s) => s.kind === "device" && s.ref.body === "lamp");
      expect(lampSolids.length, kind).toBeGreaterThan(0);
    }
  });

  it("mounts ceiling and spot lamps at room ceiling height", () => {
    for (const kind of ["ceiling", "spot"] as const) {
      const f = floorWithLamp({ kind });
      f.rooms[0].height = 310;
      const scene = buildScene(f);
      const lampSolid = scene.solids.find((s) => s.kind === "device" && s.ref.body === "lamp");
      expect(lampSolid?.shape.type).toBe("prism");
      if (lampSolid?.shape.type === "prism") expect(lampSolid.shape.z1).toBe(310);
    }
  });

  it("passes lamp metadata into LiveLight when lit", () => {
    const f = floorWithLamp({ kind: "flood", angle: 75, reach: 280 }, { rot: 90 });
    const light = f.devices.find((d) => d.type === "light")!;
    const live = liveOf(f, {
      scale: 1,
      state: { [light.entity]: { state: "on", attributes: { brightness: 255 }, last_changed: "2026-11-15T12:00:00Z" } },
    }, Date.now());
    expect(live.lights).toHaveLength(1);
    expect(live.lights[0].lamp).toEqual({ kind: "flood", angle: 75, reach: 280, rot: 90 });
  });
});
