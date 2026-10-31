import { describe, expect, it, vi } from "vitest";
import { TempWatch } from "../../src/core/temp-watch";
import { tempRangeOf } from "../../src/core/temp-range";

// Opus review of Sprint 42, item 3: with no range that can warn, the watch must not read a single room's heat.
const heat = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../src/core/heat", async (orig) => {
  const m = await orig<typeof import("../../src/core/heat")>();
  return { ...m, roomHeat: (...a: Parameters<typeof m.roomHeat>) => { heat.calls++; return m.roomHeat(...a); } };
});

const st = (state: string) => ({ state, attributes: { unit_of_measurement: "°C" }, last_changed: "2026-10-31T09:30:15Z" });
const sq = [[0, 0], [400, 0], [400, 400], [0, 400]];
const layout = (top: Record<string, unknown>, room: Record<string, unknown> = {}) => ({
  v: 2, ...top,
  floors: { g: { rooms: [{ id: "k", name: "Kitchen", kind: "room", area: "", pts: sq, wk: [], temps: ["s"], ...room }], devices: [] } },
}) as never;

describe("the watch reads heat only for a room with a range", () => {
  it("no tempRange anywhere: 0 roomHeat calls", () => {
    heat.calls = 0;
    new TempWatch(() => {}).sync(layout({}), { s: st("40") }, 0);
    expect(heat.calls).toBe(0);
  });
  it("a house range with a room's `{}` (never): 0 calls; an empty house range: 0 calls", () => {
    heat.calls = 0;
    new TempWatch(() => {}).sync(layout({ tempRange: { min: 17, max: 26 } }, { tempRange: {} }), { s: st("40") }, 0);
    new TempWatch(() => {}).sync(layout({ tempRange: {} }), { s: st("40") }, 0);
    expect(heat.calls).toBe(0);
  });
  it("a range that applies: the room is read (the spy sees the real call)", () => {
    heat.calls = 0;
    const w = new TempWatch(() => {});
    w.sync(layout({ tempRange: { max: 26, hold: 0 } }), { s: st("40") }, 0);
    expect(heat.calls).toBe(1);
    expect(w.warn).toEqual({ g: { k: "hot" } });
  });
  it("tempRangeOf: the room's range replaces the house's; no bound means none", () => {
    const L = layout({ tempRange: { min: 17, max: 26 } }) as any, room = L.floors.g.rooms[0];
    expect(tempRangeOf(room, L)).toEqual({ min: 17, max: 26 });
    expect(tempRangeOf({ ...room, tempRange: { max: 20 } }, L)).toEqual({ max: 20 });
    expect(tempRangeOf({ ...room, tempRange: {} }, L)).toBeUndefined();
    expect(tempRangeOf(room, { tempRange: { hold: 3 } } as never)).toBeUndefined();
    expect(tempRangeOf(room, {} as never)).toBeUndefined();
    expect(tempRangeOf(null as never, null as never)).toBeUndefined();
  });
});
