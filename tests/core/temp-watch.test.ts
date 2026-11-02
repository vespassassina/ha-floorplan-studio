import { describe, expect, it } from "vitest";
import { TempWatch } from "../../src/core/temp-watch";
import { attention } from "../../src/core/attention";
import { renderFloor } from "../../src/core/render";

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
    expect(w.warn).toEqual({ g: { k: "hot" } });
  });
  it("coming back in clears at once and forgets the onset", () => {
    const w = new TempWatch(() => {}), L = layout(0);
    w.sync(L, { s: st("27.4") }, 0);
    expect(w.warn).toEqual({ g: { k: "hot" } });
    w.sync(L, { s: st("25.4") }, 10);
    expect(w.warn).toBeUndefined();
    expect(w.sync(L, { s: st("27.4") }, 20)).toBeNull(); // hold 0: warns on the first sample
    expect(w.warn).toEqual({ g: { k: "hot" } });
  });
  it("keeps the same object while nothing changed, a new one when a room's side changes", () => {
    const w = new TempWatch(() => {}), L = layout(0);
    w.sync(L, { s: st("27.4") }, 0);
    const a = w.warn;
    w.sync(L, { s: st("27.8") }, 5);
    expect(w.warn).toBe(a);
    w.sync(L, { s: st("15") }, 10);
    expect(w.warn).toEqual({ g: { k: "cold" } });
    expect(w.warn).not.toBe(a);
  });
  it("junk in: no layout, no states, no throw", () => {
    const w = new TempWatch(() => {});
    expect(() => w.sync(undefined, undefined, 0)).not.toThrow();
    expect(() => w.sync({ floors: 5 } as never, {}, 1)).not.toThrow();
    expect(w.warn).toBeUndefined();
  });

  // Opus review of Sprint 42, item 1: a room id is unique only within its floor, so the memory and the warning are per floor.
  const bare = { outline: [], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [] };
  const twoFloors = (a: string, b: string) => ({
    v: 2, tempRange: { min: 17, max: 26 }, version: 2, unit: "cm", north: 0, catalog: [],
    floors: {
      [a]: { ...bare, title: "A", rooms: [{ id: "r1", name: "Hot", kind: "room", area: "", pts: sq, wk: [], temps: ["sA"] }], devices: [] },
      [b]: { ...bare, title: "B", rooms: [{ id: "r1", name: "Calm", kind: "room", area: "", pts: sq, wk: [], temps: ["sB"] }], devices: [] },
    },
  }) as never;
  it("same room id on two floors: one hot, one in range -> one warning, one item, one wash, on the right floor", () => {
    const w = new TempWatch(() => {}), L = twoFloors("up", "down") as any, S = { sA: st("29"), sB: st("22") };
    L.tempRange.hold = 0;
    w.sync(L, S, 0);
    expect(w.warn).toEqual({ up: { r1: "hot" } });
    expect(w.warn!.down).toBeUndefined();
    const a = attention(L, S, undefined, w.warn);
    expect(a.items.map((i) => [i.kind, i.floor, i.name])).toEqual([["too-hot", "up", "Hot"]]);
    const wash = (k: string) => (renderFloor(L.floors[k], { scale: 1, state: S, tempWarn: w.warn![k] }).match(/class="temp-wash /g) ?? []).length;
    expect([wash("up"), wash("down")]).toEqual([1, 0]);
  });
  it("same room id on two floors keeps independent onsets: one held, one not", () => {
    const w = new TempWatch(() => {}), L = twoFloors("up", "down") as any;
    L.floors.down.rooms[0].tempRange = { max: 26 }; // own range, same hold (5 min from the house)
    w.sync(L, { sA: st("29"), sB: st("22") }, 0);
    w.sync(L, { sA: st("29"), sB: st("29") }, 4 * MIN); // down goes out 4 min after up did
    w.sync(L, { sA: st("29"), sB: st("29.1") }, 5 * MIN);
    expect(w.warn).toEqual({ up: { r1: "hot" } }); // up held 5 min; down only 1
    w.sync(L, { sA: st("29"), sB: st("29.2") }, 9 * MIN);
    expect(w.warn).toEqual({ up: { r1: "hot" }, down: { r1: "hot" } });
  });
  it("a floor named __proto__ or constructor does not leak or throw", () => {
    const w = new TempWatch(() => {}), L = twoFloors("x", "y") as any;
    L.floors = JSON.parse('{"__proto__":{"title":"P","rooms":[{"id":"r1","name":"P","kind":"room","area":"","pts":[[0,0],[4,0],[4,4],[0,4]],"wk":[],"temps":["sA"]}],"devices":[]},"constructor":{"title":"C","rooms":[],"devices":[]}}');
    L.tempRange = { min: 17, max: 26, hold: 0 };
    expect(() => w.sync(L, { sA: st("29") }, 0)).not.toThrow();
    expect(Object.keys(w.warn!)).toEqual(["__proto__"]);
    expect(Object.keys(w.warn!["__proto__"]!)).toEqual(["r1"]);
    expect(({} as any).r1).toBeUndefined();
  });
});
