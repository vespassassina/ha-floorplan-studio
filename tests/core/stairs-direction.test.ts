import { describe, it, expect } from "vitest";
import { STAIR_DIRECTIONS, validate } from "../../src/core/schema";
import { floorsAround, resolveStairDirection, stairDirection, STAIR_DIRECTION_LABELS } from "../../src/core/stairs";
import { migrate } from "../../src/core/migrate";
import demo from "../../demo/layout.json";

const floor = (o: any = {}) => ({ title: "F", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o }) as any;
const stair = (o: any = {}) => ({ id: "s1", name: "Stairs", pts: [[0, 0], [80, 0], [80, 160], [0, 160]], shape: "straight", steps: 4, rot: 0, ...o });
const house = (n: number) => ({ version: 2, north: 0, floors: Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, floor({ stairs: [stair()] })])) }) as any;

describe("stairDirection: the default rule (a floor above means up; else a floor below means down; else up)", () => {
  // [floors in the house, floor index, expected]
  const table: [number, number, string][] = [
    [1, 0, "up"],
    [2, 0, "up"], [2, 1, "down"],
    [3, 0, "up"], [3, 1, "up"], [3, 2, "down"],
  ];
  it.each(table)("%i floors, floor %i -> %s", (n, i, want) => {
    expect(stairDirection(house(n), i, stair())).toBe(want);
  });
  it("an explicit direction wins on any floor", () => {
    for (const d of STAIR_DIRECTIONS) for (const [n, i] of [[1, 0], [2, 0], [2, 1], [3, 1]]) expect(stairDirection(house(n), i, stair({ direction: d })), `${d} ${n} ${i}`).toBe(d);
  });
  it("junk in the layout or the stair falls back to the default and never throws", () => {
    const junk: unknown[] = [NaN, 5, null, {}, [], true, "sideways", "UP", "", "__proto__"];
    for (const j of junk) expect(stairDirection(house(2), 1, stair({ direction: j })), String(j)).toBe("down");
    for (const l of [null, undefined, 5, "x", {}, { floors: 5 }, { floors: null }, { floors: [] }] as any[]) expect(stairDirection(l, 0, stair()), String(l)).toBe("up");
    for (const i of [-1, 9, NaN, 1.5, "1" as any]) expect(stairDirection(house(3), i, stair()), String(i)).toBe("up");
    expect(stairDirection(house(2), 1, null as any)).toBe("down");
  });
  it("floorsAround counts the neighbours by key order", () => {
    expect(floorsAround(house(3), 1)).toEqual({ above: true, below: true });
    expect(floorsAround(house(3), 0)).toEqual({ above: true, below: false });
    expect(floorsAround(house(3), 2)).toEqual({ above: false, below: true });
  });
  it("resolveStairDirection with no neighbours known reads up (the flat plan as it always was)", () => {
    expect(resolveStairDirection(stair())).toBe("up");
    expect(resolveStairDirection(stair(), { above: false, below: true })).toBe("down");
    expect(resolveStairDirection(stair(), { above: true, below: true })).toBe("up");
  });
});

/** The demo with its ground-floor stair set to `direction`: a layout `validate` accepts apart from that field. */
const demoWith = (direction: unknown) => { const l = structuredClone(demo) as any; l.floors.ground.stairs[0].direction = direction; return l; };

describe("the direction union is a list of decisions (finding 17)", () => {
  it("every member has a label and validates; a non-member does not", () => {
    expect([...STAIR_DIRECTIONS]).toEqual(["up", "down", "both"]);
    expect(Object.keys(STAIR_DIRECTION_LABELS).sort()).toEqual([...STAIR_DIRECTIONS].sort());
    for (const d of STAIR_DIRECTIONS) expect(validate(demoWith(d)).ok, d).toBe(true);
    for (const bad of ["sideways", 5, null, {}, ["up"], true]) {
      const r = validate(demoWith(bad));
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.errors.join("\n")).toMatch(/direction must be one of up, down, both/);
    }
  });
  it("migrate does not choke on a junk direction; validate then names it", () => {
    for (const bad of ["sideways", 5, null, {}, []]) {
      const m = migrate(demoWith(bad)) as any;
      expect(m.floors.ground.stairs).toHaveLength(1);
      expect(validate(m).ok, String(bad)).toBe(false);
    }
  });
});
