import { describe, expect, it } from "vitest";
import { weatherMood } from "../../src/card/three/weather";

describe("S82: weatherMood", () => {
  it("maps clear/sunny and unknown/hostile inputs to clear with zero particles or fog", () => {
    for (const v of ["sunny", "clear-night", "unknown", "", null, undefined, 42, "__proto__"]) {
      expect(weatherMood(v), String(v)).toEqual({ kind: "clear", sunScale: 1, hemiSky: null, fogDensity: 0, rate: 0, speed: 0 });
    }
  });

  it("maps cloudy, fog, rain, pouring, and snow conditions cleanly", () => {
    expect(weatherMood("cloudy")).toMatchObject({ kind: "cloudy", rate: 0, fogDensity: 0 });
    expect(weatherMood("cloudy").sunScale).toBeLessThan(1);

    expect(weatherMood("fog")).toMatchObject({ kind: "fog", rate: 0 });
    expect(weatherMood("fog").fogDensity).toBeGreaterThan(0);

    expect(weatherMood("rainy")).toMatchObject({ kind: "rain" });
    expect(weatherMood("rainy").rate).toBeGreaterThan(0);
    expect(weatherMood("pouring").rate).toBeGreaterThan(weatherMood("rainy").rate);
    expect(weatherMood("lightning-rainy").kind).toBe("rain");

    expect(weatherMood("snowy")).toMatchObject({ kind: "snow" });
    expect(weatherMood("snowy").rate).toBeGreaterThan(0);
    expect(weatherMood("snowy").speed).toBeLessThan(weatherMood("rainy").speed);
  });
});
