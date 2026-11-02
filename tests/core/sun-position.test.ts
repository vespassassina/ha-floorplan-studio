import { describe, expect, it } from "vitest";
import { sunPosition } from "../../src/core/sun-position";

// Reference values come from an independent calculation (Spencer's declination and equation of time with the textbook hour-angle
// formula, in Python, not the NOAA series the code uses), and for the noons from solstice geometry: elevation = 90 - |latitude - declination|.
// The code is meant to be good to about 1 degree, so every check is within 1.
const near = (got: { azimuth: number; elevation: number } | null, az: number, el: number) => {
  expect(got).not.toBeNull();
  const d = Math.abs(((got!.azimuth - az + 540) % 360) - 180); // the shortest way round the compass
  expect(d, `azimuth ${got!.azimuth} vs ${az}`).toBeLessThan(1);
  expect(Math.abs(got!.elevation - el), `elevation ${got!.elevation} vs ${el}`).toBeLessThan(1);
};

describe("sunPosition", () => {
  it("Berlin, summer noon (2026-06-21 11:08 UTC): due south, 60.9 degrees (90 - 52.52 + 23.44)", () => near(sunPosition(1782040080000, 52.52, 13.4), 180.13, 60.93));
  it("Berlin, winter morning (2026-12-21 08:30 UTC): south-east and low", () => near(sunPosition(1797841800000, 52.52, 13.4), 144.83, 6.97));
  it("Sydney, summer noon (2026-12-21 02:00 UTC): to the north, 79.4 degrees", () => near(sunPosition(1797818400000, -33.87, 151.21), 350.96, 79.43));
  it("Sydney, the same day at 15:00 UTC (02:00 local): below the horizon, to the south", () => near(sunPosition(1797865200000, -33.87, 151.21), 162.13, -30.54));
  it("Tromso, polar night noon (2026-12-21 11:00 UTC): just below the horizon", () => near(sunPosition(1797850800000, 69.65, 18.96), 184.14, -3.13));
  it("morning is east of south and afternoon west of it, so they differ (not a mirror of one value)", () => {
    const am = sunPosition(Date.UTC(2026, 9, 28, 7, 0), 52.52, 13.4)!, pm = sunPosition(Date.UTC(2026, 9, 28, 14, 0), 52.52, 13.4)!;
    expect(am.azimuth).toBeLessThan(180);
    expect(pm.azimuth).toBeGreaterThan(180);
    expect(am.elevation).toBeGreaterThan(0);
  });
  it("returns the same answer for the same input", () => expect(sunPosition(1782040080000, 52.52, 13.4)).toEqual(sunPosition(1782040080000, 52.52, 13.4)));
  it("azimuth stays in [0, 360) over a day", () => {
    for (let h = 0; h < 24; h += 0.5) { const p = sunPosition(Date.UTC(2026, 2, 3, 0, h * 60), 40, -75)!; expect(p.azimuth).toBeGreaterThanOrEqual(0); expect(p.azimuth).toBeLessThan(360); }
  });
  it("is null, never a throw, for junk", () => {
    const t = 1782040080000;
    const bad: unknown[] = [NaN, Infinity, -Infinity, "52", null, undefined, {}, [], 91, -90.5];
    for (const j of bad) expect(sunPosition(t, j, 13.4), `latitude ${String(j)}`).toBeNull();
    for (const j of [NaN, Infinity, "13", null, undefined, 181, -181]) expect(sunPosition(t, 52.5, j), `longitude ${String(j)}`).toBeNull();
    for (const j of [NaN, Infinity, "now", null, undefined, 1e17, new Date()]) expect(sunPosition(j, 52.5, 13.4), `time ${String(j)}`).toBeNull();
  });
});
