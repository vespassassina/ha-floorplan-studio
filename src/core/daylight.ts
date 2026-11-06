// Outdoor shade by day (Diego, 2026-11-06): how dark the garden, terrace, pavement and pond look, from the weather entity's
// condition and the hour. 0 is none, the cap is .35 of --fp-night. Night has its own moonlight; this is the day only.
const WEATHER: Readonly<Record<string, number>> = {
  sunny: 0, "clear-night": 0, windy: 0.03, "windy-variant": 0.06, partlycloudy: 0.05, cloudy: 0.1, fog: 0.12, snowy: 0.08, "snowy-rainy": 0.16,
  rainy: 0.16, hail: 0.2, pouring: 0.24, lightning: 0.26, "lightning-rainy": 0.28, exceptional: 0.2,
};
const CAP = 0.35;

/** Shade (0..0.35) from a weather condition and the local hour (0..24). Unknown condition counts as clear; the hour adds up to .12 away from 8 to 18. */
export function outdoorShade(condition: unknown, hour: number): number {
  const w = typeof condition === "string" && Object.prototype.hasOwnProperty.call(WEATHER, condition) ? WEATHER[condition] : 0;
  const h = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 13;
  const away = Math.max(0, Math.abs(h - 13) - 5); // hours outside 08..18
  return Math.min(CAP, w + Math.min(0.12, away * 0.04));
}
