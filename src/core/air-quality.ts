// S94: Air quality (CO2, VOC, formaldehyde, PM2.5, PM5, PM10, CO, gas, AQI) and smoke detection rules.
import type { StateOverlay } from "./render";
import type { Floor, Pt } from "./schema";

const BAD_WORDS = new Set(["poor", "very_poor", "bad", "very_bad", "unhealthy", "hazardous", "danger", "critical", "high", "alert"]);
const SMOKE_WORDS = new Set(["on", "detected", "smoke", "alarm", "triggered", "unsafe", "true"]);

/** True when an air-quality sensor entity (CO2, VOC, formaldehyde, PM2.5/PM5/PM10, CO, gas, AQI, or binary alert) reads very bad. */
export function isAirQualityBad(s: StateOverlay[string] | undefined, entityId = ""): boolean {
  if (!s || typeof s.state !== "string") return false;
  const raw = s.state.trim().toLowerCase();
  if (!raw || raw === "unavailable" || raw === "unknown" || raw === "off" || raw === "clear" || raw === "good" || raw === "ok") return false;
  if (entityId.startsWith("binary_sensor.") && raw === "on") return true;
  if (BAD_WORDS.has(raw)) return true;
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  const dc = typeof s.attributes?.device_class === "string" ? s.attributes.device_class.toLowerCase() : "";
  const u = typeof s.attributes?.unit_of_measurement === "string" ? s.attributes.unit_of_measurement.toLowerCase() : "";
  const id = entityId.toLowerCase();
  const has = (k: string) => dc.includes(k) || id.includes(k);
  if (has("carbon_dioxide") || has("co2")) return n >= 1500;
  if (has("carbon_monoxide") || /(?:^|[._])co(?:$|[._])/.test(id)) return n >= 35;
  if (has("formaldehyde") || has("hcho")) return u.includes("mg") ? n >= 0.1 : n >= 100;
  if (has("volatile_organic") || has("voc") || has("tvoc")) return u.includes("mg") ? n >= 2 : n >= 500;
  if (has("pm25") || has("pm2_5") || has("pm2")) return n >= 55;
  if (has("pm5")) return n >= 100;
  if (has("pm10")) return n >= 150;
  if (has("gas") || has("methane") || has("lpg")) return n >= 500;
  if (has("aqi") || has("air_quality")) return n >= 150;
  return false;
}

/** True when a smoke detector entity reports smoke/alarm. */
export function isSmokeDetected(s: StateOverlay[string] | undefined): boolean {
  if (!s || typeof s.state !== "string") return false;
  return SMOKE_WORDS.has(s.state.trim().toLowerCase());
}

export interface RoomHazard { airBad: boolean; smoke: boolean }

/** Computes per-room air-quality and smoke warnings from both room-attached sensor lists and placed devices inside each room. */
export function roomHazards(
  f: Floor,
  state: StateOverlay | undefined,
  roomOf: (f: Floor, p: Pt) => number,
): Map<number, RoomHazard> {
  const out = new Map<number, RoomHazard>();
  if (!state) return out;
  const mark = (ri: number, key: "airBad" | "smoke") => {
    if (ri < 0) return;
    const cur = out.get(ri) ?? { airBad: false, smoke: false };
    cur[key] = true;
    out.set(ri, cur);
  };
  (Array.isArray(f.rooms) ? f.rooms : []).forEach((r, i) => {
    if (!r) return;
    if (Array.isArray(r.airQuality) && r.airQuality.some((e) => typeof e === "string" && isAirQualityBad(state[e], e))) mark(i, "airBad");
    if (Array.isArray(r.smoke) && r.smoke.some((e) => typeof e === "string" && isSmokeDetected(state[e]))) mark(i, "smoke");
  });
  for (const d of Array.isArray(f.devices) ? f.devices : []) {
    if (!d || (d.type !== "air_quality" && d.type !== "smoke")) continue;
    const at: Pt = "a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y];
    if (!Number.isFinite(at[0]) || !Number.isFinite(at[1])) continue;
    if (d.type === "smoke") {
      if (isSmokeDetected(state[d.entity])) mark(roomOf(f, at), "smoke");
    } else {
      const bad = isAirQualityBad(state[d.entity], d.entity) || (Array.isArray(d.airSensors) && d.airSensors.some((e) => typeof e === "string" && isAirQualityBad(state[e], e)));
      if (bad) mark(roomOf(f, at), "airBad");
    }
  }
  return out;
}
