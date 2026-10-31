import { roomHeat } from "./heat";
import type { StateOverlay } from "./render";
import type { Layout } from "./schema";
import { tempHoldMs, tempWarn, type TempWarnState } from "./temp-range";

/**
 * S42.4 (docs/specs/temp-range.md, decision 8): the onset memory behind `tempWarn`, for a host that sees live states (the
 * card, the studio's live view). It lives in the host's memory only: after a page load a room already out waits the hold
 * again. Core, not the card, so both hosts run the same code (finding 8).
 */
export class TempWatch {
  /** Rooms that warn, by room id; the same object while nothing changed, so a host can compare it by reference. */
  warn: Readonly<Record<string, "hot" | "cold">> | undefined = undefined;
  private mem = new Map<string, TempWarnState>();
  private seen: [unknown, unknown] = [undefined, undefined];
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** `wake` asks the host for a render when the hold of a room that is out elapses. */
  constructor(private wake: () => void) {}

  /**
   * Call before a render. Does nothing when the layout and the states are the ones it saw (the host renders for many other
   * reasons). Otherwise decides every room of every floor and returns the ms until the next held room warns, or null.
   * A room that is out but not yet held warns when its hold elapses even if no state arrives (a sensor that reports only on
   * change would otherwise never wake the card), so a timer asks `wake` then. `now` is ms.
   */
  sync(layout: Layout | null | undefined, state: StateOverlay | undefined, now: number): number | null {
    if (layout === this.seen[0] && state === this.seen[1]) return null;
    this.stop();
    this.seen = [layout, state];
    const warn: Record<string, "hot" | "cold"> = {};
    const kept = new Map<string, TempWarnState>();
    let due: number | null = null;
    const floors = layout && typeof layout.floors === "object" && layout.floors ? Object.values(layout.floors) : [];
    for (const f of floors) {
      (Array.isArray(f?.rooms) ? f.rooms : []).forEach((r, i) => {
        const id = typeof r?.id === "string" ? r.id : "";
        const res = tempWarn(r, layout!, id ? roomHeat(f, i, "temperature", state)?.c ?? null : null, this.mem.get(id) ?? { out: null, since: null }, now);
        if (!res.out) return;
        kept.set(id, res);
        if (res.warn) warn[id] = res.warn;
        else due = Math.min(due ?? Infinity, res.since! + tempHoldMs(layout!) - now);
      });
    }
    this.mem = kept;
    const same = Object.keys(warn).length === Object.keys(this.warn ?? {}).length && Object.entries(warn).every(([k, v]) => this.warn?.[k] === v);
    if (!same) this.warn = Object.keys(warn).length ? warn : undefined;
    // +1 ms: a timer that fires a hair early finds the room not yet held, and this schedules again.
    if (due !== null) this.timer = setTimeout(() => { this.stop(); this.wake(); }, due + 1);
    return due;
  }

  /** Cancel the re-check and forget what was seen, so the next `sync` decides again. The host calls it when it is removed; the onset memory stays, as the host may come back. */
  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.seen = [undefined, undefined];
  }
}
