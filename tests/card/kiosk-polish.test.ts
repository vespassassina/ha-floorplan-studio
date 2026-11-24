import { describe, it, expect } from "vitest";
import { formatClock, formatWeatherChip, parseIdleSec } from "../../src/card/card-kiosk";

describe("Sprint 65: kiosk polish helpers", () => {
  it("parseIdleSec clamps valid values to 5..86400 and rejects junk/non-positive values", () => {
    expect(parseIdleSec(undefined)).toBe(0);
    expect(parseIdleSec(null)).toBe(0);
    expect(parseIdleSec("30")).toBe(0);
    expect(parseIdleSec(NaN)).toBe(0);
    expect(parseIdleSec(Infinity)).toBe(0);
    expect(parseIdleSec(0)).toBe(0);
    expect(parseIdleSec(4)).toBe(0);
    expect(parseIdleSec(5)).toBe(5);
    expect(parseIdleSec(60.4)).toBe(60);
    expect(parseIdleSec(999999)).toBe(86400);
  });

  it("formatClock formats 24-hour HH:MM", () => {
    const t = new Date(2026, 10, 24, 9, 5, 0).getTime();
    expect(formatClock(t)).toBe("09:05");
    const t2 = new Date(2026, 10, 24, 21, 47, 0).getTime();
    expect(formatClock(t2)).toBe("21:47");
  });

  it("formatWeatherChip formats temperature and condition cleanly and ignores dead/bad states", () => {
    expect(formatWeatherChip({ state: "partlycloudy", attributes: { temperature: 21.4, temperature_unit: "°C" } })).toBe("21.4 °C · Partlycloudy");
    expect(formatWeatherChip({ state: "clear-night", attributes: { temperature: 14 } })).toBe("14 °C · Clear night");
    expect(formatWeatherChip({ state: "rainy", attributes: {} })).toBe("Rainy");
    expect(formatWeatherChip({ state: "unavailable", attributes: { temperature: 20 } })).toBe("");
    expect(formatWeatherChip({ state: "unknown" })).toBe("");
    expect(formatWeatherChip(null)).toBe("");
    expect(formatWeatherChip(undefined)).toBe("");
  });
});
