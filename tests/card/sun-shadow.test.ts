import { describe, expect, it } from "vitest";
import { SHADOW_MIN_EL, sunDir, sunShadowBox } from "../../src/card/three/sun";

describe("S80: sunShadowBox", () => {
  const bounds = { min: [0, 0, 0], max: [1000, 800, 300] };

  it("positions the shadow camera along the sun vector in Three.js coordinates (x, z, y)", () => {
    const dir = sunDir(180, 45, 0)!; // due south -> plan (0, +y, +z) -> three (0, +y, +z)
    const box = sunShadowBox(bounds, dir)!;
    expect(box).not.toBeNull();
    expect(box.target).toEqual([500, 150, 400]);
    expect(box.pos[0]).toBeCloseTo(500, 1);
    expect(box.pos[1]).toBeGreaterThan(box.target[1]);
    expect(box.pos[2]).toBeGreaterThan(box.target[2]);
    expect(box.half).toBeGreaterThanOrEqual(300);
    expect(box.near).toBeGreaterThanOrEqual(10);
    expect(box.far).toBeGreaterThan(box.near);
  });

  it("clamps very low sun elevations to SHADOW_MIN_EL for clean shadows", () => {
    const low = sunDir(90, 1, 0)!;
    const box = sunShadowBox(bounds, low)!;
    const dy = box.pos[1] - box.target[1];
    const dist = Math.hypot(box.pos[0] - box.target[0], dy, box.pos[2] - box.target[2]);
    const elDeg = (Math.asin(dy / dist) * 180) / Math.PI;
    expect(elDeg).toBeCloseTo(SHADOW_MIN_EL, 1);
  });

  it("returns null for missing/invalid bounds or null sun direction", () => {
    const dir = sunDir(180, 45, 0)!;
    expect(sunShadowBox(bounds, null)).toBeNull();
    expect(sunShadowBox(null, dir)).toBeNull();
    expect(sunShadowBox({ min: [0, 0, 0], max: [0, 0, 0] }, dir)).toBeNull();
    expect(sunShadowBox({ min: [NaN, 0, 0], max: [100, 100, 100] }, dir)).toBeNull();
  });
});
