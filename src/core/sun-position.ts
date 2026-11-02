/** Where the sun stands at a moment and a place, in degrees: azimuth clockwise from north (as Home Assistant's sun entity reports it),
 * elevation above the horizon. Home Assistant's recorder does not keep those two attributes, so a replay works them out from the
 * replayed time. NOAA's low-precision series (solar declination and the equation of time), good to about 1 degree; no refraction.
 * Anything that is not a finite time and a real latitude and longitude is null, never a throw (layout and config are untrusted). */
export interface SunPosition { azimuth: number; elevation: number }

const RAD = Math.PI / 180, DEG = 180 / Math.PI;

export function sunPosition(ms: unknown, latitude: unknown, longitude: unknown): SunPosition | null {
  if (typeof ms !== "number" || typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(ms) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || Math.abs(ms) > 8.64e15) return null;
  const jd = ms / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = (357.52911 + T * (35999.05029 - T * 0.0001537)) * RAD;
  const e = 0.016708634 - T * (0.000042037 + T * 0.0000001267);
  const C = Math.sin(M) * (1.914602 - T * (0.004817 + T * 0.000014)) + Math.sin(2 * M) * (0.019993 - T * 0.000101) + Math.sin(3 * M) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * RAD;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const eps = (23.439291 - T * 0.013004 + 0.00256 * Math.cos(omega)) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2, l0 = L0 * RAD;
  const eqTime = 4 * DEG * (y * Math.sin(2 * l0) - 2 * e * Math.sin(M) + 4 * e * y * Math.sin(M) * Math.cos(2 * l0) - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * e * e * Math.sin(2 * M));
  const utcMinutes = (((ms / 60000) % 1440) + 1440) % 1440;
  const hourAngle = ((utcMinutes + eqTime + 4 * longitude) / 4 - 180) * RAD;
  const lat = latitude * RAD;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl))) * DEG;
  // atan2 gives the bearing from south, west positive; +180 turns it to clockwise from north.
  const fromSouth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) * DEG;
  const azimuth = (((fromSouth + 180) % 360) + 360) % 360;
  return { azimuth, elevation };
}
