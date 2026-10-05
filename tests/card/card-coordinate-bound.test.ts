import { afterEach, describe, expect, it } from "vitest";
import demo from "../../demo/layout.json";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard } from "../../src/card/floorplan-studio-card";

// S12 review finding S3: a layout with coordinates near 1.7e308 must show the card's usual "could not be used" line, in 2D and in 3D.
describe("card: a layout beyond the coordinate bound", () => {
  afterEach(() => { document.body.innerHTML = ""; });
  for (const view of ["2d", "3d"]) it(`says why instead of drawing (${view})`, async () => {
    const layout = structuredClone(demo) as any;
    layout.floors.ground.rooms[0].pts[1] = [1.7e308, 0];
    const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
    document.body.appendChild(el);
    el.setConfig({ layout, view } as never);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("svg")).toBeNull();
    expect(el.shadowRoot!.querySelector("canvas")).toBeNull();
    expect(el.shadowRoot!.textContent).toMatch(/The plan could not be used: .*10000000 cm/);
  });
});
