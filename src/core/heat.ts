import type { Device, DeviceType, Floor } from "./schema";
import { meanValue } from "./readings";
import { roomAt, roomList, ROOM_OWNS, type StateOverlay } from "./render";
import { meanText } from "./state-text";

// S34.6: the heat map's maths (spec docs/specs/extras-s34.md, H1 to H3). Pure: which sensors feed a room, what they read,
// where that sits on the fixed scale. Layout, states and the mode are untrusted (finding 1): nothing here throws.
// `render.ts` is imported for functions only, used at call time; this file touches none of it at load, so the cycle
// render -> heat -> render (S34.7) is safe. `room-info.ts` is left out on purpose: it reads render's constants at load.

export type HeatKind = "off" | "temperature" | "humidity";
export const HEAT_KINDS: readonly HeatKind[] = ["off", "temperature", "humidity"];

/** The mode a `heat_map` value names. Absent (or YAML's empty `null`) is `off` without a warning; anything else that is not
 *  one of the three exact words is `off` with `warn` set, so the caller says so once. Exact match: `Temperature` is junk. */
export function heatKindOf(raw: unknown): { kind: HeatKind; warn: boolean } {
  if (raw === undefined || raw === null) return { kind: "off", warn: false };
  const kind = typeof raw === "string" ? HEAT_KINDS.find((k) => k === raw) : undefined;
  return kind ? { kind, warn: false } : { kind: "off", warn: true };
}

/** The fixed, absolute scale (H3, Q1). `from`, `mid`, `to` are in `unit`; `tokens` are the three colours, cold or dry end first. */
export const HEAT_SCALE: Record<Exclude<HeatKind, "off">, { from: number; mid: number; to: number; unit: string; tokens: readonly [string, string, string] }> = {
  temperature: { from: 16, mid: 21, to: 26, unit: "°C", tokens: ["--fp-heat-cool", "--fp-heat-mid", "--fp-heat-hot"] },
  humidity: { from: 30, mid: 50, to: 70, unit: "%", tokens: ["--fp-hum-dry", "--fp-hum-mid", "--fp-hum-wet"] },
};

/** What a device type feeds the map with. Every type is a decision (finding 17): a `climate` reads at the radiator and its state is a mode, so it is no source. */
export const HEAT_SOURCE: Record<DeviceType, HeatKind | null> = {
  heater: null, light: null, switch: null, plug: null, temp: "temperature", humidity: "humidity", motion: null, contact: null, camera: null, climate: null, ac: null, tv: null,
  computer: null, media: null, cover: null, battery: null, inverter: null, server: null, access_point: null, lock: null, vibration: null, other: null, boiler: null, car: null,
  ups: null, printer: null, speaker: null, person: null, radar: null, vacuum: null, siren: null, alarm: null, fan: null,
};

const NB = " ";
const scaleOf = (kind: HeatKind) => (kind === "temperature" || kind === "humidity" ? HEAT_SCALE[kind] : undefined);

/** A reading the map accepts, as a number in the kind's own unit (°F becomes °C), or null. Unit rules (H3): temperature takes
 *  `°C`, `°F`, or no unit (taken as °C); humidity `%` or none; any other unit is not a reading. Bounds (H3): -60..90 °C,
 *  0..100 %, ends included, checked after the °F conversion. The bounds drop an obviously faulty sensor from the mean. */
function inScale(kind: "temperature" | "humidity", n: number, unit: string): number | null {
  if (kind === "humidity") return (unit === "%" || unit === "") && n >= 0 && n <= 100 ? n : null;
  const c = unit === "°F" ? ((n - 32) * 5) / 9 : unit === "°C" || unit === "" ? n : NaN;
  return c >= -60 && c <= 90 ? c : null;
}

const pointOf = (d: Device): [number, number] | null => {
  const x = (d as { x?: unknown }).x, y = (d as { y?: unknown }).y;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
};

/**
 * What room `i` of floor `f` reads in heat mode `kind`, or null (no heat: the room keeps its own fill and prints nothing).
 * H2: the room's own `temps` (or `humidity`) list when any of it is readable, so the colour and the printed number are the
 * ones the readout builds; else the sensor devices of that kind whose floor point `roomAt` puts in this room. A kind that
 * `ROOM_OWNS` denies (fill, structure, zone) never heats. `text` is the mean in the sensors' own unit (°F stays °F; a sensor with no unit is read as the scale's, so it prints °C or %); `t` is its place on `HEAT_SCALE`, in °C for temperature, clamped to 0..1 and rounded to 0.001. `c` (temperature only, S42.4) is the mean in °C, unrounded: what `tempWarn` takes, so the readout, the map and the warning cannot disagree.
 */
export function roomHeat(f: Floor, i: number, kind: HeatKind, state: StateOverlay | undefined): { text: string; t: number; c?: number } | null {
  const sc = scaleOf(kind);
  const r = Array.isArray(f?.rooms) && Number.isInteger(i) ? f.rooms[i] : undefined;
  if (!sc || (kind !== "temperature" && kind !== "humidity") || !r || typeof r !== "object" || !ROOM_OWNS[r.kind]) return null;
  const keep = (n: number, unit: string) => inScale(kind, n, unit) !== null;
  let m = meanValue(roomList(r, kind === "temperature" ? "temps" : "humidity"), state, keep);
  if (!m) {
    const feeders = (Array.isArray(f.devices) ? f.devices : []).flatMap((d) => {
      const at = d && typeof d === "object" && HEAT_SOURCE[d.type] === kind && typeof d.entity === "string" && d.entity ? pointOf(d) : null;
      return at && roomAt(f, at) === i ? [d.entity as string] : [];
    });
    m = meanValue(feeders, state, keep);
  }
  const v = m && inScale(kind, m.n, m.unit);
  if (!m || v === null || v === undefined) return null;
  const t = Math.min(1, Math.max(0, (v - sc.from) / (sc.to - sc.from)));
  return { text: `${meanText(m.n)}${NB}${m.unit || sc.unit}`, t: Math.round(t * 1000) / 1000, ...(kind === "temperature" ? { c: v } : {}) };
}

/** True when any room of `f` reads in heat mode `kind`: the one check behind "no readings" in the Studio's status bar and the card's legend. */
export function anyRoomHeated(f: Floor, kind: HeatKind, state: StateOverlay | undefined): boolean {
  return Array.isArray(f?.rooms) && f.rooms.some((_, i) => roomHeat(f, i, kind, state) !== null);
}

/** The legend a host draws in its chrome (H5): three stops, the two end labels as real text, the unit; null for `off`. */
export function heatLegend(kind: HeatKind): { kind: HeatKind; unit: string; from: string; to: string; stops: { at: number; token: string }[] } | null {
  const sc = scaleOf(kind);
  return sc ? { kind, unit: sc.unit, from: `${sc.from}${NB}${sc.unit}`, to: `${sc.to}${NB}${sc.unit}`, stops: sc.tokens.map((token, k) => ({ at: k / 2, token })) } : null;
}
