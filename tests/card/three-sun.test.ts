import { describe, expect, it } from "vitest";
import { sunDir, sunLook, WARM_RGB } from "../../src/card/three/sun";

// S38.1 (spec criterion 1): where the sun is on the plan. Plan frame: x east (right), y south (down), z up; the result is a
// unit vector from the house toward the sun. Plan bearing = azimuth + north, clockwise from plan-up, so bearing 0 is (0, -1).
const EL = 30, C = Math.cos((EL * Math.PI) / 180), S = Math.sin((EL * Math.PI) / 180);
const near = (a: readonly number[] | null, b: readonly number[]) => { expect(a).not.toBeNull(); b.forEach((v, i) => expect(a![i]).toBeCloseTo(v, 9)); };

describe("sunDir: the 12 cases", () => {
  // [azimuth, north, horizontal x, horizontal y]: bearing (az + north) 0 up, 90 right, 180 down, 270 left
  const cases: [number, number, number, number][] = [
    [0, 0, 0, -1], [90, 0, 1, 0], [180, 0, 0, 1], [270, 0, -1, 0],
    [0, 90, 1, 0], [90, 90, 0, 1], [180, 90, -1, 0], [270, 90, 0, -1],
    [0, 270, -1, 0], [90, 270, 0, -1], [180, 270, 1, 0], [270, 270, 0, 1],
  ];
  for (const [az, north, hx, hy] of cases) {
    it(`azimuth ${az}, north ${north}`, () => near(sunDir(az, EL, north), [hx * C, hy * C, S]));
  }
  it("is a unit vector", () => { const d = sunDir(123, 47, 61)!; expect(Math.hypot(...d)).toBeCloseTo(1, 12); });
  it("straight overhead is straight up", () => near(sunDir(10, 90, 0), [0, 0, 1]));
});

describe("sunDir: no sun", () => {
  it("is null at or below the horizon", () => { expect(sunDir(180, 0, 0)).toBeNull(); expect(sunDir(180, -5, 0)).toBeNull(); });
  it("is null for what is not a finite number", () => {
    const junk: unknown[] = [undefined, null, Number.NaN, Infinity, "12", {}, [], true];
    for (const j of junk) { expect(sunDir(j as number, 40, 0), `azimuth ${String(j)}`).toBeNull(); expect(sunDir(180, j as number, 0), `elevation ${String(j)}`).toBeNull(); expect(sunDir(180, 40, j as number), `north ${String(j)}`).toBeNull(); }
  });
  it("is null out of range", () => {
    expect(sunDir(360, 40, 0)).toBeNull(); expect(sunDir(-1, 40, 0)).toBeNull();
    expect(sunDir(180, 91, 0)).toBeNull(); expect(sunDir(180, 40, 360)).toBeNull(); expect(sunDir(180, 40, -1)).toBeNull();
  });
});

describe("sunLook: strength and warmth by elevation", () => {
  it("is full strength and white from 30 and 15 degrees up", () => {
    expect(sunLook(30)).toEqual({ k: 1, rgb: [1, 1, 1] });
    expect(sunLook(60).k).toBe(1);
    expect(sunLook(15).rgb).toEqual([1, 1, 1]);
  });
  it("falls linearly to 60 percent at the horizon", () => { expect(sunLook(0).k).toBeCloseTo(0.6, 12); expect(sunLook(15).k).toBeCloseTo(0.8, 12); });
  it("turns warm under 15 degrees, #ffd9a0 at the horizon", () => {
    expect(sunLook(0).rgb).toEqual(WARM_RGB);
    expect(WARM_RGB.map((v) => Math.round(v * 255))).toEqual([0xff, 0xd9, 0xa0]);
    const mid = sunLook(7.5).rgb;
    expect(mid[0]).toBe(1); expect(mid[1]).toBeCloseTo((1 + WARM_RGB[1]) / 2, 12); expect(mid[2]).toBeCloseTo((1 + WARM_RGB[2]) / 2, 12);
  });
});
