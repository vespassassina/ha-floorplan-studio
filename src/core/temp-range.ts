import { ROOM_OWNS } from "./render";
import type { Layout, Room } from "./schema";

/**
 * S42.1 (spec docs/specs/temp-range.md): when a room is too cold or too hot. Pure: the layout, the room, its reading in
 * °C and the previous state in, the new state and the flag out. The card keeps the state between samples (S42.4), the
 * replay passes it frame to frame. Every input is untrusted (finding 1): junk reads as "no range" or "no reading", and
 * nothing here throws.
 */

/** °C. A room goes out past its bound and comes back in only this far inside it. Fixed, not a setting (spec 7). */
export const TEMP_BAND = 0.5;
/** Minutes a room must stay out before it warns, when the house range names no `hold` (spec 2). */
export const TEMP_HOLD_DEFAULT = 5;

export interface TempWarnState { out: "hot" | "cold" | null; since: number | null }
export interface TempWarnResult extends TempWarnState { warn: "hot" | "cold" | null }

const CLEAR: TempWarnResult = { out: null, since: null, warn: null };
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);

/**
 * `reading` is the room's mean in °C (null when it has none). `prev` is what this returned last time, `now` is ms.
 * The room's `tempRange` replaces the house range whole; `{}` means never. A room kind the heat map does not read
 * (`ROOM_OWNS`) never warns. Out means under `min` or over `max`; back in only at `min + TEMP_BAND` or `max - TEMP_BAND`.
 * `warn` is the side once the room has been out, without a break, for `hold` minutes (the house's, default 5; 0 is at once).
 * Back in, or no reading, clears at once and forgets the onset.
 */
export function tempWarn(room: Room, layout: Layout, reading: number | null, prev: TempWarnState, now: number): TempWarnResult {
  const house = isObj(layout) && isObj(layout.tempRange) ? layout.tempRange : undefined;
  const mine = isObj(room) && isObj(room.tempRange) ? room.tempRange : undefined;
  const range = mine ?? house;
  const t = num(reading);
  if (!range || t === undefined || !isObj(room) || !ROOM_OWNS[room.kind] || !Number.isFinite(now)) return CLEAR;
  const min = num(own(range, "min")), max = num(own(range, "max"));
  const was = isObj(prev) ? prev : { out: null, since: null };

  const hot = max !== undefined && (t > max || (was.out === "hot" && t > max - TEMP_BAND));
  const cold = !hot && min !== undefined && (t < min || (was.out === "cold" && t < min + TEMP_BAND));
  const out = hot ? "hot" : cold ? "cold" : null;
  if (!out) return CLEAR;

  // The onset survives only while the room stays out on the same side; a clock that went back restarts it.
  const since = out === was.out && num(was.since) !== undefined && (was.since as number) <= now ? (was.since as number) : now;
  const holdMin = house ? num(own(house, "hold")) ?? TEMP_HOLD_DEFAULT : TEMP_HOLD_DEFAULT;
  return { out, since, warn: now - since >= holdMin * 60_000 ? out : null };
}
