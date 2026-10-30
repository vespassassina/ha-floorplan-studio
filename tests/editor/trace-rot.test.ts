import { describe, it, expect } from "vitest";
import { traceRotStored, traceRotShown } from "../../src/editor/trace";
import { validate, type Layout } from "../../src/core/schema";
import demo from "../../demo/layout.json";

// S40 review: a typed Rotation of -0.04 rounded up to 360, which validate refuses. Round first, then fold into [0, 360).
const withRot = (rot: number): Layout => {
  const l = structuredClone(demo) as unknown as Layout;
  const f = Object.values(l.floors)[0];
  f.trace = { src: "data:image/png;base64,AAAA", x: 0, y: 0, w: 100, rot, alpha: 0.5, on: true };
  return l;
};

describe("traceRotStored", () => {
  const cases: [number, number][] = [
    [-180, 180], [-179.96, 180], [-0.05, 0], [-0.04, 0], [0, 0], [0.04, 0], [179.95, 180], [179.96, 180], [180, 180],
    [-90, 270], [12.3, 12.3], [-0.06, 359.9], [359.96, 0], [360, 0],
  ];
  for (const [typed, stored] of cases) {
    it(`${typed} is stored as ${stored} and the layout validates`, () => {
      const rot = traceRotStored(typed);
      expect(rot).toBe(stored);
      expect(Object.is(rot, -0)).toBe(false);
      expect(rot >= 0 && rot < 360).toBe(true);
      expect(validate(withRot(rot)).ok).toBe(true);
    });
  }
  it("shows a stored value in -180..180", () => {
    expect(traceRotShown(270)).toBe(-90);
    expect(traceRotShown(180)).toBe(180);
    expect(traceRotShown(0)).toBe(0);
    expect(traceRotShown(359.9)).toBe(-0.1);
  });
});
