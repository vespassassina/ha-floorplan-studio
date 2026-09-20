import { describe, it, expect } from "vitest";
import { renderFloor } from "../../src/core/render";
import { migrate } from "../../src/core/migrate";
import demo from "../../demo/layout.json";

const L = migrate(demo as unknown);
const floor = Object.values(L.floors)[0];
const tempDev = floor.devices.find((d) => d.type === "temp")!;
const st = (state: string) => ({ [tempDev.entity]: { state, attributes: { unit_of_measurement: "°C" }, last_changed: new Date().toISOString() } });

describe("a sensor value that is not a number", () => {
  it("shows an en dash, never the raw state", () => {
    for (const bad of ["not-a-number", "", "NaN", "Infinity", "12,5", "on"]) {
      const html = renderFloor(floor, { scale: 1, state: st(bad) as never });
      expect(html, bad).not.toContain(`${bad} °C`);
      expect(html, bad).toContain(">–<");
    }
  });
  it("still shows a real reading, including a negative and a decimal", () => {
    for (const good of ["21.5", "-3.2", "0"]) {
      expect(renderFloor(floor, { scale: 1, state: st(good) as never })).toContain(`${good} °C`);
    }
  });
});
