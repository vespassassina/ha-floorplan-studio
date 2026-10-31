import { describe, expect, it } from "vitest";
import { TempWatch } from "../../src/core/temp-watch";

// S42.4: the onset memory shared by the card and the studio's live view. Time is passed in, so no clock is faked here.
const st = (state: string) => ({ state, attributes: { unit_of_measurement: "°C" }, last_changed: "2026-10-31T09:30:15Z" });
const sq = [[0, 0], [400, 0], [400, 400], [0, 400]];
const layout = (hold?: number) => ({
  v: 2, tempRange: { min: 17, max: 26, ...(hold === undefined ? {} : { hold }) },
  floors: { g: { rooms: [{ id: "k", name: "Kitchen", kind: "room", area: "", pts: sq, wk: [], temps: ["s"] }], devices: [] } },
}) as never;
const MIN = 60_000;

describe("TempWatch", () => {
  it("out for 4 min 59 s does not warn, 5 min does; it says when to look again", () => {
    const w = new TempWatch(() => {}), L = layout();
    expect(w.sync(L, { s: st("27.4") }, 1000)).toBe(5 * MIN);
    expect(w.warn).toBeUndefined();
    expect(w.sync(L, { s: st("27.5") }, 1000 + 5 * MIN - 1000)).toBe(1000);
    expect(w.warn).toBeUndefined();
    expect(w.sync(L, { s: st("27.6") }, 1000 + 5 * MIN)).toBeNull();
    expect(w.warn).toEqual({ k: "hot" });
  });
  it("coming back in clears at once and forgets the onset", () => {
    const w = new TempWatch(() => {}), L = layout(0);
    w.sync(L, { s: st("27.4") }, 0);
    expect(w.warn).toEqual({ k: "hot" });
    w.sync(L, { s: st("25.4") }, 10);
    expect(w.warn).toBeUndefined();
    expect(w.sync(L, { s: st("27.4") }, 20)).toBeNull(); // hold 0: warns on the first sample
    expect(w.warn).toEqual({ k: "hot" });
  });
  it("keeps the same object while nothing changed, a new one when a room's side changes", () => {
    const w = new TempWatch(() => {}), L = layout(0);
    w.sync(L, { s: st("27.4") }, 0);
    const a = w.warn;
    w.sync(L, { s: st("27.8") }, 5);
    expect(w.warn).toBe(a);
    w.sync(L, { s: st("15") }, 10);
    expect(w.warn).toEqual({ k: "cold" });
    expect(w.warn).not.toBe(a);
  });
  it("junk in: no layout, no states, no throw", () => {
    const w = new TempWatch(() => {});
    expect(() => w.sync(undefined, undefined, 0)).not.toThrow();
    expect(() => w.sync({ floors: 5 } as never, {}, 1)).not.toThrow();
    expect(w.warn).toBeUndefined();
  });
});
