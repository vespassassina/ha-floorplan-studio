import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { migrate } from "../../src/core/migrate";
import { ROOM_KINDS, validate, type Layout, type Room } from "../../src/core/schema";
import { ROOM_OWNS } from "../../src/core/render";
import { TEMP_BAND, TEMP_HOLD_DEFAULT, tempWarn, type TempWarnState } from "../../src/core/temp-range";

// S42.1 (spec docs/specs/temp-range.md, criteria 1 to 4). Plain `now` numbers, no fake clock.
const MIN = 60_000;
const NOW = 10_000_000;
const room = (extra: Record<string, unknown> = {}, kind = "room") => ({ id: "r1", name: "Kitchen", area: "", kind, pts: [], wk: [], ...extra }) as unknown as Room;
const house = (tempRange?: unknown) => ({ version: 2, unit: "cm", north: 0, floors: {}, catalog: [], ...(tempRange === undefined ? {} : { tempRange }) }) as unknown as Layout;
const IDLE: TempWarnState = { out: null, since: null };
const F2C = (f: number) => ((f - 32) * 5) / 9; // the caller converts; tempWarn only sees °C (spec 5)

describe("tempWarn: every combination (criterion 1, finding 12)", () => {
  type Range = { min?: number; max?: number } | undefined;
  const houses: [string, Range][] = [["no house range", undefined], ["house 17..26", { min: 17, max: 26 }]];
  // The room override replaces the house range whole (spec 9).
  const overrides: [string, Range | "absent"][] = [
    ["no override", "absent"], ["override {}", {}], ["override min 19", { min: 19 }], ["override max 24", { max: 24 }], ["override 19..24", { min: 19, max: 24 }],
  ];
  const readings = ["under", "on min", "inside", "on max", "over", "missing", "fahrenheit over"] as const;
  const prevs = ["idle", "hot", "cold"] as const;
  const holds = ["held", "fresh"] as const;

  let count = 0;
  for (const [hn, h] of houses) for (const [on, o] of overrides) for (const rd of readings) for (const pv of prevs) for (const hd of holds) {
    it(`${hn}, ${on}, reading ${rd}, previous ${pv}, ${hd}`, () => {
      count++;
      const eff: Range = o === "absent" ? h : o;
      const lo = eff?.min, hi = eff?.max;
      const value = (): number | null => {
        switch (rd) {
          case "under": return (lo ?? 0) - 1;
          case "on min": return lo ?? 0;
          case "inside": return ((lo ?? 20) + (hi ?? 20)) / 2 + (lo !== undefined && hi === undefined ? 3 : 0);
          case "on max": return hi ?? 0;
          case "over": return (hi ?? 0) + 1;
          case "fahrenheit over": return F2C((hi ?? 0) * 9 / 5 + 32 + 1.8); // 1 °C over, entered as °F
          default: return null;
        }
      };
      const reading = value();
      const prev: TempWarnState = pv === "idle" ? IDLE : { out: pv, since: hd === "held" ? NOW - 5 * MIN : NOW - 1 * MIN };
      const r = tempWarn(room(o === "absent" ? {} : { tempRange: o }), house(h), reading, prev, NOW);

      // The expected flag is written from the spec's rules, not from the code under test.
      let out: "hot" | "cold" | null = null;
      if (reading !== null) {
        if (hi !== undefined && reading > hi) out = "hot";
        else if (lo !== undefined && reading < lo) out = "cold";
        else if (pv === "hot" && hi !== undefined && reading > hi - TEMP_BAND) out = "hot";
        else if (pv === "cold" && lo !== undefined && reading < lo + TEMP_BAND) out = "cold";
      }
      const since = out === null ? null : out === pv ? prev.since : NOW;
      const warn = out !== null && NOW - (since as number) >= TEMP_HOLD_DEFAULT * MIN ? out : null;
      expect(r).toEqual({ out, since, warn });
    });
  }
  it("ran the whole grid", () => { expect(count).toBe(2 * 5 * 7 * 3 * 2); });
});

describe("tempWarn: the band (criterion 2), min 17 max 26", () => {
  const L = house({ min: 17, max: 26, hold: 0 });
  const at = (v: number, prev: TempWarnState) => tempWarn(room(), L, v, prev, NOW);
  it("the band is 0.5 and the hold default 5", () => { expect(TEMP_BAND).toBe(0.5); expect(TEMP_HOLD_DEFAULT).toBe(5); });
  it("26 is not over; 26.1 is", () => {
    expect(at(26, IDLE).out).toBeNull();
    expect(at(26.1, IDLE).out).toBe("hot");
  });
  it("once hot, 25.8 stays hot and 25.5 comes in", () => {
    const hot = { out: "hot", since: NOW - 1 } as const;
    expect(at(25.8, hot).out).toBe("hot");
    expect(at(25.6, hot).out).toBe("hot");
    expect(at(25.5, hot).out).toBeNull();
    expect(at(25.4, hot)).toEqual({ out: null, since: null, warn: null });
  });
  it("a reading at 25.8 that was never out stays in", () => { expect(at(25.8, IDLE).out).toBeNull(); });
  it("17 is not under; 16.9 is", () => {
    expect(at(17, IDLE).out).toBeNull();
    expect(at(16.9, IDLE).out).toBe("cold");
  });
  it("once cold, 17.2 stays cold, 17.5 comes in", () => {
    const cold = { out: "cold", since: NOW - 1 } as const;
    expect(at(17.2, cold).out).toBe("cold");
    expect(at(17.5, cold).out).toBeNull();
  });
  it("the hysteresis of one side does not hold the other: cold at 25.8 is in", () => {
    expect(at(25.8, { out: "cold", since: NOW - 1 }).out).toBeNull();
  });
  it("hot straight to cold is a new onset", () => {
    const r = tempWarn(room({ tempRange: { min: 30, max: 40 } }), house({ hold: 10 }), 29, { out: "hot", since: NOW - 9 * MIN }, NOW);
    expect(r).toEqual({ out: "cold", since: NOW, warn: null });
  });
});

describe("tempWarn: the hold (criterion 3), house 17..26", () => {
  const L = house({ min: 17, max: 26 }); // hold absent: 5 minutes
  const step = (v: number | null, prev: TempWarnState, now: number) => tempWarn(room(), L, v, prev, now);
  it("4 min 59 s does not warn, 5 min does", () => {
    const first = step(27, IDLE, NOW);
    expect(first).toEqual({ out: "hot", since: NOW, warn: null });
    expect(step(27, first, NOW + 5 * MIN - 1000).warn).toBeNull();
    expect(step(27, first, NOW + 5 * MIN).warn).toBe("hot");
    expect(step(27, first, NOW + 5 * MIN).since).toBe(NOW);
  });
  it("one sample back in resets the onset", () => {
    let s = step(27, IDLE, NOW);
    s = step(27, s, NOW + 4 * MIN);
    s = step(25, s, NOW + 4 * MIN + 1000);
    expect(s).toEqual({ out: null, since: null, warn: null });
    s = step(27, s, NOW + 5 * MIN);
    expect(s).toEqual({ out: "hot", since: NOW + 5 * MIN, warn: null });
    expect(step(27, s, NOW + 9 * MIN).warn).toBeNull();
    expect(step(27, s, NOW + 10 * MIN).warn).toBe("hot");
  });
  it("coming back in clears the warning at once", () => {
    const warned = { out: "hot", since: NOW - 30 * MIN } as const;
    expect(step(25.5, warned, NOW).warn).toBeNull();
  });
  it("a missing reading clears and resets", () => {
    expect(step(null, { out: "hot", since: NOW - 30 * MIN }, NOW)).toEqual({ out: null, since: null, warn: null });
  });
  it("hold 0 warns on the first sample", () => {
    expect(tempWarn(room(), house({ min: 17, max: 26, hold: 0 }), 27, IDLE, NOW)).toEqual({ out: "hot", since: NOW, warn: "hot" });
  });
  it("hold comes from the house even when the room overrides the range", () => {
    const l = house({ min: 17, max: 26, hold: 10 });
    const o = room({ tempRange: { max: 24 } });
    const first = tempWarn(o, l, 25, IDLE, NOW);
    expect(tempWarn(o, l, 25, first, NOW + 9 * MIN).warn).toBeNull();
    expect(tempWarn(o, l, 25, first, NOW + 10 * MIN).warn).toBe("hot");
  });
  it("a house with no range but a hold, and a room range, uses that hold", () => {
    expect(tempWarn(room({ tempRange: { max: 24 } }), house({ hold: 0 }), 25, IDLE, NOW).warn).toBe("hot");
  });
  it("a clock that went back restarts the onset instead of waiting", () => {
    expect(step(27, { out: "hot", since: NOW + 99 * MIN }, NOW)).toEqual({ out: "hot", since: NOW, warn: null });
  });
});

describe("tempWarn: kinds and junk (finding 17, finding 1)", () => {
  it("only a kind the heat map reads can warn; every RoomKind is listed", () => {
    for (const kind of ROOM_KINDS) {
      const r = tempWarn(room({}, kind), house({ max: 26, hold: 0 }), 40, IDLE, NOW);
      expect(r.warn, kind).toBe(ROOM_OWNS[kind] ? "hot" : null);
      if (!ROOM_OWNS[kind]) expect(r).toEqual({ out: null, since: null, warn: null });
    }
  });
  it("junk never throws and never warns", () => {
    const junk: unknown[] = [undefined, null, 5, "x", [], NaN, {}, { tempRange: 5 }, { tempRange: [] }, { tempRange: { min: "a", max: NaN } }];
    for (const j of junk) for (const l of junk) {
      for (const reading of [NaN, Infinity, "30" as unknown as number, 30])
        expect(() => tempWarn(j as Room, l as Layout, reading, IDLE, NOW)).not.toThrow();
    }
    expect(tempWarn(room({ tempRange: { max: "a" } }), house(), 30, IDLE, NOW).warn).toBeNull();
    expect(tempWarn(room(), house({ max: 26, hold: 0 }), NaN, IDLE, NOW).warn).toBeNull();
    expect(tempWarn(room(), house({ max: 26, hold: 0 }), 30, { out: "x", since: "y" } as unknown as TempWarnState, NOW)).toEqual({ out: "hot", since: NOW, warn: "hot" });
  });
});

describe("validate: tempRange (criterion 4)", () => {
  const withHouse = (t: unknown) => { const l = structuredClone(demo) as any; l.tempRange = t; return l; };
  const withRoom = (t: unknown) => { const l = structuredClone(demo) as any; l.floors.ground.rooms[0].tempRange = t; return l; };
  const errors = (l: unknown) => { const r = validate(l); return r.ok ? [] : r.errors; };
  const roomId = (demo as any).floors.ground.rooms[0].id as string;

  it("accepts good ranges and an empty room override", () => {
    for (const t of [{}, { min: 17 }, { max: 26 }, { min: 17, max: 26, hold: 5 }, { hold: 0 }, { hold: 120 }, { min: -50, max: 100 }, { min: 17, max: 18 }])
      expect(errors(withHouse(t)), JSON.stringify(t)).toEqual([]);
    for (const t of [{}, { min: 17 }, { max: 26 }, { min: 17, max: 26 }])
      expect(errors(withRoom(t)), JSON.stringify(t)).toEqual([]);
  });
  const bad: [string, unknown][] = [
    ["an array", []], ["a string", "17"], ["a number", 17], ["null", null], ["NaN min", { min: NaN }], ["Infinity max", { max: Infinity }],
    ["a text min", { min: "17" }], ["min below -50", { min: -50.1 }], ["max above 100", { max: 100.1 }], ["min above max", { min: 26, max: 17 }],
    ["a gap under 1", { min: 17, max: 17.9 }], ["equal min and max", { min: 20, max: 20 }], ["an unknown key", { min: 17, colour: "red" }],
    ["__proto__ as a key", JSON.parse('{"__proto__": {"min": 1}}')],
  ];
  for (const [what, t] of bad) it(`refuses ${what} on the house`, () => {
    const e = errors(withHouse(t));
    expect(e.length, what).toBeGreaterThan(0);
    expect(e.join("\n")).toMatch(/tempRange/);
  });
  for (const [what, t] of bad) it(`refuses ${what} on a room, naming the room`, () => {
    const e = errors(withRoom(t));
    expect(e.length, what).toBeGreaterThan(0);
    expect(e.join("\n")).toContain(roomId);
    expect(e.join("\n")).toMatch(/tempRange/);
  });
  for (const hold of [2.5, 500, -1, "5", NaN, 120.5]) it(`refuses hold ${String(hold)} on the house`, () => {
    expect(errors(withHouse({ hold })).join("\n")).toMatch(/tempRange.*hold/);
  });
  it("refuses hold on a room: it is a house setting", () => {
    expect(errors(withRoom({ hold: 5 })).join("\n")).toMatch(new RegExp(`${roomId}.*tempRange`));
  });
  it("never throws on a hostile prototype-carrying shape", () => {
    expect(() => validate(withRoom(Object.create({ min: 1 })))).not.toThrow();
  });
});

describe("migrate: tempRange (finding 1)", () => {
  const src = (h: unknown, rm: unknown) => { const l = structuredClone(demo) as any; if (h !== undefined) l.tempRange = h; if (rm !== undefined) l.floors.ground.rooms[0].tempRange = rm; return l; };
  it("keeps a good house range and a good room override", () => {
    const m = migrate(src({ min: 17, max: 26, hold: 5 }, { max: 24 }));
    expect(m.tempRange).toEqual({ min: 17, max: 26, hold: 5 });
    expect(m.floors.ground.rooms[0].tempRange).toEqual({ max: 24 });
    expect(validate(m).ok).toBe(true);
  });
  it("keeps {} on a room: it means never", () => {
    expect(migrate(src(undefined, {})).floors.ground.rooms[0].tempRange).toEqual({});
  });
  it("drops each shape it does not know, so the result validates", () => {
    for (const t of [[], "x", 5, null, { min: "a" }, { min: 30, max: 20 }, { hold: 2.5 }, { colour: 1 }, JSON.parse('{"__proto__": {"min": 1}}')]) {
      const m = migrate(src(t, t));
      expect(m.tempRange, JSON.stringify(t)).toBeUndefined();
      expect("tempRange" in m.floors.ground.rooms[0], JSON.stringify(t)).toBe(false);
      expect(validate(m).ok, JSON.stringify(t)).toBe(true);
    }
  });
  it("does not change the input", () => {
    const s = src({ min: 30, max: 20 }, []);
    const before = structuredClone(s);
    migrate(s);
    expect(s).toEqual(before);
  });
});
