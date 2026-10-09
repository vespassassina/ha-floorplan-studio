import { describe, expect, it } from "vitest";
import { FLOORPLAN_CSS, renderFloor } from "../../src/core";
import type { Floor } from "../../src/core";

// S24.5: renderFloor's `locate`, the ring round what a search or the Outline went to. One draw path (finding 8): the
// editor passes it today, the card can pass it tomorrow, and both get the same ring.
const floor = {
  title: "G", outline: [], walls: [], stairs: [], openings: [], extras: [], unlinked: [], doors: [], rooms: [],
  devices: [{ id: "a", type: "light", entity: "light.a", name: "A", x: 100, y: 100 }, { id: "b", type: "light", entity: "light.b", name: "B", x: 300, y: 100 }],
  furniture: [{ symbol: "bed", x: 500, y: 300, w: 160, h: 200, rot: 0 }],
} as unknown as Floor;
const rings = (svg: string) => svg.match(/<circle class="locate"[^>]*>/g) ?? [];

describe("S24.5 locate ring", () => {
  it("rings the device it names and no other, inside its own group, centred on the icon; nothing without the option or off the floor", () => {
    expect(rings(renderFloor(floor, { scale: 1 }))).toEqual([]);
    expect(rings(renderFloor(floor, { scale: 1, locate: null }))).toEqual([]);
    expect(rings(renderFloor(floor, { scale: 1, locate: { t: "dev", i: 7 } }))).toEqual([]);
    const svg = renderFloor(floor, { scale: 1, locate: { t: "dev", i: 1 } });
    expect(rings(svg)).toHaveLength(1);
    expect(svg).toMatch(/<g data-x="1"[^>]*>(?:(?!<g data-x=)[\s\S])*<circle class="locate" cx="12" cy="12" r="16"\/><\/g>/);
    expect(svg).not.toMatch(/<g data-x="0"[^>]*>(?:(?!<\/g>)[\s\S])*class="locate"/);
  });

  it("rings a furniture piece round its middle, wide enough for the piece", () => {
    const svg = renderFloor(floor, { scale: 1, locate: { t: "furn", i: 0 } });
    expect(rings(svg)).toEqual(['<circle class="locate" cx="500" cy="300" r="108"/>']);
  });

  it("the ring pulses three times and stands still under reduced motion (the pixel is checked in studio-find.spec.ts)", () => {
    expect(FLOORPLAN_CSS).toContain("animation:fp-locate .8s ease-out 3");
    expect(FLOORPLAN_CSS).toContain("@media (prefers-reduced-motion:reduce){.locate{animation:none;opacity:1}}");
  });
});
