import { describe, expect, it } from "vitest";
import type { Pt, Trace } from "../../src/core";
import { alignTraceToNorth, calibrateTraceFromTwoPoints, fitTraceToRoof, simplifyRoofOutline } from "../../src/editor/aerial-roof";

describe("S93: Aerial / drone roof photo import", () => {
  it("fits a North-up aerial photo centered over the roof outline with overhang margin", () => {
    const outline: Pt[] = [[0, 0], [800, 0], [800, 600], [0, 600]];
    const fit0 = fitTraceToRoof(outline, 1600, 1200, 0, 100);
    expect(fit0.rot).toBe(0);
    expect(fit0.w).toBe(1067); // max(1000, 800 * 4/3) = 1066.67 -> 1067
    expect(fit0.x).toBe(Math.round(400 - fit0.w / 2));

    const fit90 = fitTraceToRoof(outline, 1000, 1000, 90, 100);
    expect(fit90.rot).toBe(270); // -90 stored in [0, 360)
  });

  it("aligns an existing trace image to layout.north about its centre", () => {
    const t: Trace = { src: "data:image/png;base64,AA==", x: 0, y: 0, w: 1000, rot: 0, alpha: 0.5, on: true };
    const aligned = alignTraceToNorth(t, 90, 1);
    expect(aligned.rot).toBe(270);
    // Centre of 1000x1000 at (0,0) rot 0 is (500,500). At rot 270, top-left is (0, 1000).
    expect(aligned.x).toBe(0);
    expect(aligned.y).toBe(1000);
  });

  it("calibrates trace width from two reference points and rejects degenerate input", () => {
    const t: Trace = { src: "data:image/png;base64,AA==", x: 0, y: 0, w: 1000, rot: 0, alpha: 0.5, on: true };
    const scaled = calibrateTraceFromTwoPoints(t, [100, 100], [300, 100], 800);
    expect(scaled?.w).toBe(4000);
    expect(calibrateTraceFromTwoPoints(t, [100, 100], [100, 100], 800)).toBeNull();
    expect(calibrateTraceFromTwoPoints(t, [100, 100], [200, 100], -5)).toBeNull();
  });

  it("simplifies collinear and near-duplicate roof vertices while preserving corners", () => {
    const raw: Pt[] = [[0, 0], [200, 2], [400, 0], [402, 1], [400, 300], [0, 300]];
    const simp = simplifyRoofOutline(raw, 12);
    expect(simp).toEqual([[0, 0], [400, 0], [400, 300], [0, 300]]);
  });
});
