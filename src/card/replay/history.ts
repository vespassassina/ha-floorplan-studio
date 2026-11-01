import type { HassEntity } from "../floorplan-studio-card";

// S39.1: reading Home Assistant's history for the replay. Loaded lazily (`import("./replay/history")`), so the card file
// does not carry it. The parser is pure: no DOM, no hass. The open bar's markup (bar.ts, S40.1) rides in the same chunk.
export { barView } from "./bar";
export { EVENTS_MARKER, EVENT_RULES, NO_EVENT, neighbour, onsets } from "./events";

/** Only this module holds it, so a test can prove the card file does not contain the parser. */
export const REPLAY_CHUNK = "fp-replay-v1";

/**
 * One parsed row. Times are float seconds since the epoch, as HA sends them.
 * Source of the reply shape (checked 2026-10-28): `homeassistant/components/history/websocket_api.py` answers
 * `history/history_during_period` with { [entity_id]: CompressedState[] }; `homeassistant/components/recorder/models/state.py`
 * builds a row as { s, a?, lu, lc? } (`lc` left out when equal to `lu`); `homeassistant/const.py` has COMPRESSED_STATE_* "s" "a" "lc" "lu".
 */
export interface HistoryRow { state: string; attributes: Record<string, unknown>; lu: number; lc: number }
/** A Map, not an object: an entity id such as `__proto__` cannot reach a prototype. */
export type HistoryIndex = Map<string, HistoryRow[]>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** What a Date can hold, in seconds: past it `toISOString()` throws RangeError, and stateAt runs inside render. */
const MAX_SECONDS = 8.64e12;
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_SECONDS;

const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

/** The reply is untrusted (finding 1): whatever is not as HA documents it is dropped, nothing throws. */
export function parseHistory(reply: unknown, asked: readonly string[]): HistoryIndex {
  const index: HistoryIndex = new Map();
  if (!isObject(reply)) return index;
  for (const id of new Set(asked)) {
    // Own keys only (`reply["constructor"]` would find Object's), and never a name that is not an entity id.
    if (RESERVED.has(id) || !Object.prototype.hasOwnProperty.call(reply, id)) continue;
    const list = reply[id];
    if (!Array.isArray(list)) continue;
    const rows: { state: string; a: Record<string, unknown> | null; lu: number; lc: number }[] = [];
    for (const r of list) {
      if (!isObject(r) || typeof r.s !== "string" || !isTime(r.lu)) continue;
      rows.push({ state: r.s, a: isObject(r.a) ? r.a : null, lu: r.lu, lc: isTime(r.lc) ? r.lc : r.lu });
    }
    if (!rows.length) continue;
    rows.sort((x, y) => x.lu - y.lu); // HA sorts, but we do not rely on it
    // A row without attributes keeps the last ones seen: that is how HA's compressed form saves bytes.
    let last: Record<string, unknown> = {};
    index.set(id, rows.map((r) => ({ state: r.state, attributes: (last = r.a ?? last), lu: r.lu, lc: r.lc })));
  }
  return index;
}

/** For each entity, the last row at or before `tMs`; an entity with none is absent. */
export function stateAt(index: HistoryIndex, tMs: number): Record<string, HassEntity> {
  const out: Record<string, HassEntity> = Object.create(null);
  for (const [id, rows] of index) {
    let lo = 0;
    let hi = rows.length; // first row after t
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].lu * 1000 <= tMs) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) continue;
    const r = rows[lo - 1];
    out[id] = { state: r.state, attributes: r.attributes, last_changed: new Date(r.lc * 1000).toISOString() };
  }
  return out;
}

/** Domains whose changing attributes the plan draws (a lamp's colour, a cover's position): their rows keep every attribute. */
const ATTRIBUTE_DOMAINS = new Set(["light", "climate", "media_player", "cover", "fan", "vacuum", "water_heater", "humidifier"]);

/**
 * The messages for one floor's entities, each entity in exactly one (spec replay-2, item 1). The attribute domains ask for every change
 * with attributes; the rest ask for significant changes only and minimal rows (HA keeps `a` on the first row, so unit and device class
 * survive, and drops it from the later ones, which the parser carries forward). An empty group sends nothing.
 */
export function historyRequests(entityIds: readonly string[], startMs: number, endMs: number) {
  const ids = [...new Set(entityIds)].sort();
  const base = { type: "history/history_during_period" as const, start_time: new Date(startMs).toISOString(), end_time: new Date(endMs).toISOString(), include_start_time_state: true, no_attributes: false };
  const full = ids.filter((id) => ATTRIBUTE_DOMAINS.has(id.split(".")[0]));
  const lean = ids.filter((id) => !ATTRIBUTE_DOMAINS.has(id.split(".")[0]));
  return [
    { ...base, entity_ids: full, significant_changes_only: false, minimal_response: false },
    { ...base, entity_ids: lean, significant_changes_only: true, minimal_response: true },
  ].filter((m) => m.entity_ids.length);
}

/**
 * Asks for a floor's history and parses it. Both calls start together; one failing fails the floor. `send` is the caller's: it owns the
 * connection and the timeout of each call, so a call that never answers rejects on its own.
 */
export async function fetchHistory(send: (m: ReturnType<typeof historyRequests>[number]) => Promise<unknown>, entityIds: readonly string[], startMs: number, endMs: number): Promise<HistoryIndex> {
  const parts = await Promise.all(historyRequests(entityIds, startMs, endMs).map(async (m) => parseHistory(await send(m), m.entity_ids)));
  return new Map(parts.flatMap((p) => [...p]));
}
