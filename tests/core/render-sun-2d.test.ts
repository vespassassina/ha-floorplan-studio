import { describe, expect, it } from "vitest";
import { renderFloor, type Floor, type Pt } from "../../src/core";

const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

const floor = (): Floor => ({
  title: "Ground",
  outline: sq(0, 0, 800, 600),
  rooms: [
    { id: "r0", name: "Living", area: "living", kind: "room", pts: sq(0, 0, 800, 600), wk: ["wall", "wall", "wall", "wall"] },
    { id: "r1", name: "Garden", area: "garden", kind: "garden", pts: sq(-200, -200, 1200, 1000), wk: ["boundary", "boundary", "boundary", "boundary"] },
  ],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], unlinked: [],
  furniture: [
    { id: "f1", symbol: "tree", x: 900, y: 200, rot: 0, w: 180, h: 180 },
    { id: "f2", symbol: "car", x: -100, y: 300, rot: 0, w: 450, h: 180, entity: "device_tracker.car" },
  ],
});

describe("S81: 2D sun wedge & outdoor directional shadows", () => {
  it("emits no sun shadows or wedge when sun is omitted, at night, below horizon, or in heat mode", () => {
    const f = floor();
    expect(renderFloor(f, { scale: 1 })).not.toContain("data-sun-wedge");
    expect(renderFloor(f, { scale: 1, sun: { azimuth: 180, elevation: 40, north: 0 }, night: true })).not.toContain("data-sun-wedge");
    expect(renderFloor(f, { scale: 1, sun: { azimuth: 180, elevation: -5, north: 0 } })).not.toContain("data-sun-wedge");
    expect(renderFloor(f, { scale: 1, sun: { azimuth: 180, elevation: 40, north: 0 }, heat: "temperature" })).not.toContain("data-sun-wedge");
  });

  it("casts house, tree, and parked car shadows away from the sun and omits away car shadows", () => {
    const f = floor();
    // Sun from south (azimuth 180, north 0) -> shadows project north (negative y)
    const south = renderFloor(f, {
      scale: 1,
      sun: { azimuth: 180, elevation: 45, north: 0 },
      state: { "device_tracker.car": { state: "home", attributes: {}, last_changed: "" } },
    });
    expect(south).toContain("data-sun-wedge");
    expect(south).toContain('data-sun-sh="house"');
    expect(south).toContain('data-sun-sh="tree"');
    expect(south).toContain('data-sun-sh="car"');
    const treeCySouth = Number(south.match(/data-sun-sh="tree"[^>]*cy="([^"]+)"/)?.[1]);
    expect(treeCySouth).toBeLessThan(200); // shifted north of tree y=200

    // Sun from north (azimuth 0, north 0) -> shadows project south (positive y)
    const north = renderFloor(f, {
      scale: 1,
      sun: { azimuth: 0, elevation: 45, north: 0 },
      state: { "device_tracker.car": { state: "not_home", attributes: {}, last_changed: "" } },
    });
    const treeCyNorth = Number(north.match(/data-sun-sh="tree"[^>]*cy="([^"]+)"/)?.[1]);
    expect(treeCyNorth).toBeGreaterThan(200); // shifted south of tree y=200
    expect(north).not.toContain('data-sun-sh="car"'); // away car casts no shadow
  });
});
