import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { LAMP_KINDS, renderFloor, type Floor } from "../../src/core";
import { lampRenderer } from "../../src/card/lamp";

const floorWithLamp = (lamp?: Record<string, unknown>, extra?: Record<string, unknown>): Floor => {
  const f = structuredClone(demo).floors.ground as unknown as Floor;
  const light = f.devices.find((d) => d.type === "light")!;
  if (lamp) (light as unknown as Record<string, unknown>).lamp = lamp;
  if (extra) Object.assign(light, extra);
  return f;
};

describe("S62.2: 2D and 2.5D lamp symbols & emissions", () => {
  it("renders a distinct symbol and emission for every kind in LAMP_KINDS when lit", () => {
    const outputs = new Map<string, string>();
    for (const kind of LAMP_KINDS) {
      const f = floorWithLamp({ kind });
      const light = f.devices.find((d) => d.type === "light")!;
      const svg = renderFloor(f, {
        scale: 1,
        lampLib: lampRenderer,
        state: { [light.entity]: { state: "on", attributes: { rgb_color: [255, 200, 100], brightness: 200 }, last_changed: "2026-11-15T12:00:00Z" } },
      });
      expect(svg, kind).toContain(`class="dev dev-light`);
      expect(svg, kind).toContain(`class="aura`);
      outputs.set(kind, svg);
    }
    expect(new Set(outputs.values()).size).toBe(LAMP_KINDS.length);
  });

  it("emits distinct aura classes for spot, strip, flood, and pole", () => {
    for (const kind of ["spot", "strip", "flood", "pole"] as const) {
      const f = floorWithLamp({ kind });
      const light = f.devices.find((d) => d.type === "light")!;
      const svg = renderFloor(f, {
        scale: 1,
        lampLib: lampRenderer,
        state: { [light.entity]: { state: "on", attributes: {}, last_changed: "2026-11-15T12:00:00Z" } },
      });
      expect(svg).toContain(`lamp-aura-${kind}`);
    }
  });

  it("lifts ceiling and spot lamps to room ceiling height in 2.5D", () => {
    for (const kind of ["ceiling", "spot"] as const) {
      const f = floorWithLamp({ kind });
      f.rooms[0].height = 320;
      const svgTall = renderFloor(f, { scale: 1, view: "2.5d", lampLib: lampRenderer });
      f.rooms[0].height = 200;
      const svgShort = renderFloor(f, { scale: 1, view: "2.5d", lampLib: lampRenderer });
      expect(svgTall).toContain(`class="stem"`);
      expect(svgTall).not.toBe(svgShort);
    }
  });

  it("keeps the plain light icon and aura when d.lamp is absent", () => {
    const f = floorWithLamp();
    const light = f.devices.find((d) => d.type === "light")!;
    const withLib = renderFloor(f, {
      scale: 1,
      lampLib: lampRenderer,
      state: { [light.entity]: { state: "on", attributes: {}, last_changed: "2026-11-15T12:00:00Z" } },
    });
    const withoutLib = renderFloor(f, {
      scale: 1,
      state: { [light.entity]: { state: "on", attributes: {}, last_changed: "2026-11-15T12:00:00Z" } },
    });
    expect(withLib).toBe(withoutLib);
  });

  it("clips flood cone to the room ahead", () => {
    const f = floorWithLamp({ kind: "flood", angle: 60, reach: 300 }, { rot: 90 });
    const light = f.devices.find((d) => d.type === "light")!;
    const svg = renderFloor(f, {
      scale: 1,
      lampLib: lampRenderer,
      state: { [light.entity]: { state: "on", attributes: {}, last_changed: "2026-11-15T12:00:00Z" } },
    });
    expect(svg).toContain("lamp-aura-flood");
    expect(svg).toContain("clip-path=\"url(#fp-aura-");
  });
});
