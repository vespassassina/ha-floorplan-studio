// R2.7: the fixture of the 7-day gate (docs/specs/replay-2.md item 12): the measured worst floor, 93 entities and 180,000 rows over 7 days.
// Runs in the page (replay-gate-workload.ts) and in vitest, so it imports nothing and touches no DOM. Deterministic: no Math.random.
//
// Where the shape comes from (finding 21): the reply of `history/history_during_period` is `{ [entity_id]: CompressedState[] }`
// (`homeassistant/components/history/websocket_api.py`); a row is `{ s, a?, lu }` with `lu` in float seconds
// (`recorder/models/state.py`). With include_start_time_state the first row sits AT the start. Call (A) (light, climate, media_player...)
// has `a` on every row; call (B) (minimal_response) has `a` on the first row only (`recorder/history/modern.py`). The mix follows the
// 2026-10-30 measurement in the spec: one power sensor wrote 13,001 rows a day (55 % of the floor), the rest are room sensors.

export const GATE_ROWS = 180000;
export const GATE_ENTITIES = 93;

export type GateRow = { s: string; a?: Record<string, unknown>; lu: number };
/** Entity groups: how many entities, rows each, the device type the floor puts them as, and the rows' shape. */
interface Group { prefix: string; n: number; rows: number; type: string; full: boolean; states: (i: number, k: number) => string; attrs: (i: number) => Record<string, unknown> }

const toggle = (a: string, b: string) => (_i: number, k: number) => (k % 2 ? b : a);
const reading = (base: number) => (i: number, k: number) => String(base + ((i * 7 + k * 13) % 80) / 10);
const GROUPS: Group[] = [
  { prefix: "light.l", n: 16, rows: 300, type: "light", full: true, states: toggle("off", "on"), attrs: (i) => ({ friendly_name: `Lamp ${i}`, supported_color_modes: ["brightness", "color_temp"], color_mode: "brightness", brightness: 100 + i, rgb_color: [255, 200, 100], supported_features: 44 }) },
  { prefix: "climate.c", n: 3, rows: 400, type: "climate", full: true, states: toggle("heat", "off"), attrs: (i) => ({ friendly_name: `Heat ${i}`, hvac_modes: ["off", "heat"], temperature: 21, current_temperature: 20.5, min_temp: 7, max_temp: 35 }) },
  { prefix: "media_player.m", n: 1, rows: 600, type: "tv", full: true, states: (_i, k) => ["off", "idle", "playing"][k % 3], attrs: () => ({ friendly_name: "TV", volume_level: 0.3, source: "HDMI 1" }) },
  { prefix: "sensor.t", n: 20, rows: 1500, type: "temp", full: false, states: reading(18), attrs: () => ({ unit_of_measurement: "°C", device_class: "temperature", friendly_name: "Temperature" }) },
  { prefix: "sensor.h", n: 14, rows: 700, type: "humidity", full: false, states: reading(40), attrs: () => ({ unit_of_measurement: "%", device_class: "humidity", friendly_name: "Humidity" }) },
  { prefix: "binary_sensor.motion", n: 24, rows: 600, type: "motion", full: false, states: toggle("off", "on"), attrs: () => ({ device_class: "motion", friendly_name: "Motion" }) },
  { prefix: "binary_sensor.door", n: 14, rows: 120, type: "contact", full: false, states: toggle("off", "on"), attrs: () => ({ device_class: "door", friendly_name: "Door" }) },
];
const POWER = "sensor.power";
/** Contacts from this one on belong to a door only (a contact that is also a device gives the same onset twice, and `onsets` keeps one). */
const DOOR_SENSORS_FROM = 8;

/** mulberry32: a small seeded generator, so every run (and every machine) parses the same bytes. */
function prng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** `n` sorted times in [start, end), the first at `start` (the start-time state). */
function times(n: number, start: number, end: number, rnd: () => number): Float64Array {
  const t = new Float64Array(n);
  t[0] = start;
  for (let i = 1; i < n; i++) t[i] = start + 1 + rnd() * (end - start - 2);
  return t.sort();
}

export interface Gate { reply: Record<string, GateRow[]>; asked: string[]; floor: unknown; rows: number }

/** The reply for the window [startSec, endSec], the entities asked for, and a layout floor that stands each on the plan the way a house does. */
export function gateFixture(startSec: number, endSec: number): Gate {
  const rnd = prng(2026), reply: Record<string, GateRow[]> = {}, devices: object[] = [], motion: string[][] = [];
  let rows = 0;
  const put = (id: string, n: number, g: Pick<Group, "full" | "states" | "attrs">, i: number) => {
    const t = times(n, startSec, endSec, rnd), a = g.attrs(i), list: GateRow[] = new Array(n);
    for (let k = 0; k < n; k++) list[k] = k === 0 || g.full ? { s: g.states(i, k), a: { ...a }, lu: t[k] } : { s: g.states(i, k), lu: t[k] };
    reply[id] = list;
    rows += n;
  };
  for (const g of GROUPS) {
    for (let i = 0; i < g.n; i++) {
      const id = `${g.prefix}${i}`;
      put(id, g.rows, g, i);
      // Motion sensors are the rooms' own (item 4); everything else is a device at a point of the 4 x 4 grid of 300 cm rooms.
      if (g.type === "motion") (motion[i % 16] ??= []).push(id);
      else if (g.type === "contact" && i >= DOOR_SENSORS_FROM) continue; // these stand in a door's `sensors` only
      else devices.push({ id, type: g.type, entity: id, x: 50 + ((i % 16) % 4) * 300 + (i % 3) * 80, y: 50 + Math.floor((i % 16) / 4) * 300 });
    }
  }
  // The power sensor takes what is left of 180,000 rows, as it does on the measured floor.
  put(POWER, GATE_ROWS - rows, { full: false, states: reading(200), attrs: () => ({ unit_of_measurement: "W", device_class: "power", friendly_name: "Power" }) }, 0);
  devices.push({ id: POWER, type: "inverter", entity: POWER, x: 20, y: 20 });
  const rooms = Array.from({ length: 16 }, (_, i) => {
    const x = (i % 4) * 300, y = Math.floor(i / 4) * 300;
    return { id: `room-${i}`, name: `Room ${i}`, kind: "room", pts: [[x, y], [x + 300, y], [x + 300, y + 300], [x, y + 300]], motion: motion[i] ?? [] };
  });
  // A door on the wall between two rooms, one sensor each.
  const doors = Array.from({ length: 6 }, (_, i) => ({ id: `door-${i}`, name: `Door ${i}`, kind: "door", a: [300 * ((i % 3) + 1), 100 + Math.floor(i / 3) * 300], b: [300 * ((i % 3) + 1), 200 + Math.floor(i / 3) * 300], sensors: [`binary_sensor.door${DOOR_SENSORS_FROM + i}`] }));
  return { reply, asked: Object.keys(reply), floor: { title: "Gate", outline: [], rooms, walls: [], stairs: [], doors, openings: [], extras: [], devices, furniture: [], unlinked: [] }, rows };
}
