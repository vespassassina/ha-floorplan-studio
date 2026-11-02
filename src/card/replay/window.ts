import type { HistoryIndex } from "./history";

// R2.5: the replay's window (docs/specs/replay-2.md items 10, 11 and 13). Pure. Lives in the replay chunk.

export interface ReplayWindow {
  hours: number;
  /** Minutes one arrow key moves. */
  arrow: number;
  /** Minutes Page Up and Page Down move. */
  page: number;
}
/** The lengths the bar offers, shortest first and the first is the default. 7 days passed its gate (R2.7, docs/DECISIONS.md). */
export const WINDOWS: readonly ReplayWindow[] = [
  { hours: 24, arrow: 5, page: 60 },
  { hours: 48, arrow: 10, page: 60 },
  { hours: 168, arrow: 30, page: 360 },
];
export const windowOf = (hours: number): ReplayWindow => WINDOWS.find((w) => w.hours === hours) ?? WINDOWS[0];

/** A first row this close to the start is the recorder's start-time row with a rounding; it is not a purge. */
const PURGE_SLACK_MS = 60000;

/** When history begins, if the recorder had purged part of the window: the earliest first row of any entity, when it lies later than the
 * window's start. With `include_start_time_state` an entity the recorder kept answers with a row at the start, so one such entity means
 * the window is whole. null: whole, or nothing to say. */
export function purgedFrom(index: HistoryIndex, startMs: number): number | null {
  let first = Infinity;
  for (const rows of index.values()) first = Math.min(first, rows[0].lu * 1000);
  return first > startMs + PURGE_SLACK_MS && first !== Infinity ? first : null;
}

/** A moment's short weekday ("Mon"), in the card's language: a window over 24 h shows each clock time twice, so the time names its day. */
export function weekday(ms: number, hass: { language?: string; locale?: { language?: string } } | undefined): string {
  const o: Intl.DateTimeFormatOptions = { weekday: "short" };
  try { return new Intl.DateTimeFormat(hass?.language ?? hass?.locale?.language, o).format(ms); } catch { return new Intl.DateTimeFormat(undefined, o).format(ms); }
}

/** A moment with its date, in the language and 12 or 24 hour setting the card's time uses (`replayTime` in card-replay.ts reads the same two fields). */
export function dayAndTime(ms: number, hass: { language?: string; locale?: { language?: string; time_format?: string } } | undefined): string {
  const tf = hass?.locale?.time_format, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...(tf === "12" ? { hour12: true } : tf === "24" ? { hour12: false, hourCycle: "h23" as const } : {}) };
  try { return new Intl.DateTimeFormat(hass?.language ?? hass?.locale?.language, o).format(ms); } catch { return new Intl.DateTimeFormat(undefined, o).format(ms); }
}
