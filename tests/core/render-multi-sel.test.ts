import { describe, expect, it } from "vitest";
import { DEVICE_TYPES, type Device, type Floor } from "../../src/core/schema";
import { layerHides } from "../../src/core/layers";
import { renderFloor } from "../../src/core/render";

// S26.4 (U18): the plan draws a multi-selection, `{ t: "devs", is }`, as it draws a single `{ t: "dev", i }`.

const floorOf = (devices: Device[]): Floor =>
  ({ title: "T", outline: [[0, 0], [600, 0], [600, 400], [0, 400]], rooms: [], walls: [], doors: [], openings: [], extras: [], stairs: [], devices, furniture: [], unlinked: [] }) as unknown as Floor;
const pt = (type: string, n: number): Device => ({ id: `d${n}`, name: `D${n}`, type, entity: `sensor.e${n}`, x: 60 + n * 30, y: 100 }) as unknown as Device;
/** The `data-x` indices of the icon groups that carry class `sel`. */
const selOf = (svg: string) => [...svg.matchAll(/<g data-x="(\d+)" class="([^"]*)"/g)].filter((m) => m[2].split(" ").includes("sel")).map((m) => Number(m[1]));

describe("S26.4 renderFloor draws a multi-selection", () => {
  const f = floorOf(DEVICE_TYPES.map((t, n) => pt(t, n)));

  it("gives every selected member .sel, whatever its type, and nobody else", () => {
    const every = DEVICE_TYPES.map((_, n) => n);
    expect(selOf(renderFloor(f, { scale: 1, selection: { t: "devs", is: every } }))).toEqual(every);
    for (const [n, t] of DEVICE_TYPES.entries()) {
      const svg = renderFloor(f, { scale: 1, selection: { t: "devs", is: [n, 0] } });
      expect(selOf(svg), t).toEqual([...new Set([0, n])].sort((a, b) => a - b));
    }
  });

  it("draws the same member the single selection draws", () => {
    const one = renderFloor(f, { scale: 1, selection: { t: "dev", i: 2 } });
    expect(renderFloor(f, { scale: 1, selection: { t: "devs", is: [2] } })).toBe(one);
  });

  it("is byte for byte the old markup when it selects nothing", () => {
    const plain = renderFloor(f, { scale: 1 });
    expect(renderFloor(f, { scale: 1, selection: { t: "devs", is: [] } })).toBe(plain);
    expect(renderFloor(f, { scale: 1, selection: null })).toBe(plain);
  });

  it("draws a selected member under a hidden layer, and only the selected ones", () => {
    const g = floorOf([pt("light", 0), pt("light", 1), pt("plug", 2)]);
    const svg = renderFloor(g, { scale: 1, hiddenLayers: ["lights"], selection: { t: "devs", is: [1] } });
    expect([...svg.matchAll(/data-x="(\d+)"/g)].map((m) => m[1])).toEqual(["1", "2"]);
    expect(layerHides(["lights"], "dev", 1, "light", { t: "devs", is: [1] } as never)).toBe(false);
    expect(layerHides(["lights"], "dev", 0, "light", { t: "devs", is: [1] } as never)).toBe(true);
    expect(layerHides(["lights"], "unl", 1, "light", { t: "devs", is: [1] } as never)).toBe(true);
  });

  it("never throws on junk and selects nothing from it", () => {
    const g = floorOf([pt("light", 0), pt("light", 1)]);
    const plain = renderFloor(g, { scale: 1 });
    for (const is of [undefined, null, 1, "0", { 0: 1 }, [NaN], [-1], [9], [0.5], ["0"], [null], [Infinity]]) {
      expect(renderFloor(g, { scale: 1, selection: { t: "devs", is } as never }), JSON.stringify(is)).toBe(plain);
    }
    expect(renderFloor(g, { scale: 1, hiddenLayers: ["lights"], selection: { t: "devs", is: "0" } as never })).not.toContain("data-x");
    expect(selOf(renderFloor(g, { scale: 1, selection: { t: "devs", is: [0, 0, NaN, 1.5, 7] } }))).toEqual([0]);
  });
});
