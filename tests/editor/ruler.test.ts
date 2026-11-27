import { describe, expect, it } from "vitest";
import { formatRulerMeasure, rulerSvg } from "../../src/editor/ruler";

describe("S83: Studio measurement ruler", () => {
  it("formats short (<1 m), long (>=1 m), diagonal, and zero measurements accurately", () => {
    expect(formatRulerMeasure([100, 100], [100, 100])).toMatchObject({ cm: 0, dx: 0, dy: 0, label: "0 cm" });
    expect(formatRulerMeasure([0, 0], [85, 0])).toMatchObject({ cm: 85, dx: 85, dy: 0, label: "85 cm" });
    expect(formatRulerMeasure([0, 0], [300, 400])).toMatchObject({ cm: 500, dx: 300, dy: 400, label: "5.00 m · 500 cm" });
    expect(formatRulerMeasure([10, 20], [355, 20]).status).toContain("3.45 m (345 cm)");
    expect(formatRulerMeasure([10, 20], [355, 20]).status).toContain("Δx 345 cm, Δy 0 cm");
  });

  it("renders SVG line, endpoints, and upright label only when active", () => {
    expect(rulerSvg(null, 1, 0)).toBe("");
    expect(rulerSvg({ a: null, b: null, locked: false }, 1, 0)).toBe("");
    const one = rulerSvg({ a: [10, 20], b: null, locked: false }, 1, 0);
    expect(one).toContain("ruler-pt");
    expect(one).not.toContain("ruler-ln");
    const both = rulerSvg({ a: [0, 0], b: [200, 0], locked: true }, 1, 90);
    expect(both).toContain("ruler-ln");
    expect(both).toContain("2.00 m · 200 cm");
    expect(both).toContain("rotate(-90");
  });
});
