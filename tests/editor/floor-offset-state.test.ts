import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import align from "../fixtures/align-house.json";
import type { Layout } from "../../src/core/schema";
import { validate } from "../../src/core";
import { EditorState } from "../../src/editor/state";

// S27.8. Three floors so that "lowest", "middle" and "top" are different floors.
const three = (): Layout => {
  const l = structuredClone(align) as unknown as Layout;
  const first = l.floors.first;
  l.floors.second = structuredClone(first);
  l.floors.second.title = "Second";
  return l;
};
const st = (locked: boolean) => { const s = new EditorState(three()); s.planLocked = locked; return s; };
const ok = (s: EditorState) => expect(validate(s.layout).ok).toBe(true);

describe("EditorState.setOffset (S27.8)", () => {
  const starts: [string, [number, number] | undefined][] = [["absent", undefined], ["zero", [0, 0]], ["set", [11, -7]]];
  for (const [name, start] of starts) for (const locked of [false, true]) for (const key of ["ground", "first", "second", "nope", "__proto__"]) {
    it(`${name} offset, lock ${locked}, floor ${key}`, () => {
      const s = st(locked);
      if (start && Object.keys(s.layout.floors).includes(key)) s.layout.floors[key].offset = [...start];
      const before = JSON.stringify(s.layout);
      const known = Object.keys(s.layout.floors).includes(key);
      // a change
      const r = s.setOffset(key, [137, -61]);
      if (!known) { expect(r).toBe(false); expect(JSON.stringify(s.layout)).toBe(before); expect(s.canUndo).toBe(false); return; }
      if (locked) {
        expect(r).toBe(false); expect(s.planBlocked).toBe(true);
        expect(JSON.stringify(s.layout)).toBe(before); expect(s.canUndo).toBe(false);
      } else {
        expect(r).toBe(true); expect(s.layout.floors[key].offset).toEqual([137, -61]);
        expect(s.canUndo).toBe(true);
        s.undo();
        expect(JSON.stringify(s.layout)).toBe(before); expect(s.canUndo).toBe(false);
        // [0,0] deletes the key
        const moved = start !== undefined && (start[0] !== 0 || start[1] !== 0);
        expect(s.setOffset(key, [0, 0])).toBe(moved); // a stored zero is already zero: no step
        if (moved) expect("offset" in s.layout.floors[key]).toBe(false);
      }
      ok(s);
    });
  }

  it("no change leaves no step and no blame on the lock", () => {
    for (const locked of [false, true]) {
      const s = st(locked); s.layout.floors.first.offset = [5, 6];
      expect(s.setOffset("first", [5, 6])).toBe(false);
      expect(s.canUndo).toBe(false); expect(s.planBlocked).toBe(false);
      expect(s.setOffset("ground", [0, 0])).toBe(false); // absent == zero
      expect(s.canUndo).toBe(false);
    }
  });

  it("junk and out-of-range values are refused, never thrown", () => {
    const s = st(false), before = JSON.stringify(s.layout);
    for (const v of [[NaN, 0], [Infinity, 0], [2e7, 0], [1], "1,2", null, undefined, [1, 2, 3], [1, "2"]]) expect(s.setOffset("first", v as never)).toBe(false);
    expect(JSON.stringify(s.layout)).toBe(before); expect(s.canUndo).toBe(false);
  });

  it("rounds to whole centimetres", () => {
    const s = st(false);
    expect(s.setOffset("first", [137.4, -61.6])).toBe(true);
    expect(s.layout.floors.first.offset).toEqual([137, -62]);
    expect(s.setOffset("first", [0.4, -0.4])).toBe(true);
    expect("offset" in s.layout.floors.first).toBe(false);
    ok(s);
  });
});

describe("EditorState.alignToBelow (S27.8)", () => {
  it("lays the first floor on the ground in one undo step", () => {
    const s = st(false); s.layout.floors.ground.offset = [10, 20];
    expect(s.alignToBelow("first")).toBe(true);
    const o = s.layout.floors.first.offset!;
    expect(Math.abs(o[0] - (10 - 137.4))).toBeLessThanOrEqual(2);
    expect(Math.abs(o[1] - (20 + 61.7))).toBeLessThanOrEqual(2);
    ok(s);
    s.undo(); expect(s.layout.floors.first.offset).toBeUndefined(); expect(s.canUndo).toBe(false);
  });
  it("is refused on the lowest floor, an unknown floor, and under Lock plan", () => {
    for (const k of ["ground", "nope"]) { const s = st(false); expect(s.alignToBelow(k)).toBe(false); expect(s.canUndo).toBe(false); }
    const s = st(true); expect(s.alignToBelow("first")).toBe(false); expect(s.planBlocked).toBe(true); expect(s.canUndo).toBe(false);
  });
  it("a second align changes nothing and leaves no second step", () => {
    const s = st(false); s.alignToBelow("first");
    expect(s.alignToBelow("first")).toBe(false); s.undo(); expect(s.canUndo).toBe(false);
  });
  it("identical floors (the demo) give no change", () => {
    const s = new EditorState(structuredClone(demo) as unknown as Layout);
    const k = Object.keys(s.layout.floors)[1];
    expect(s.alignToBelow(k)).toBe(false); expect(s.canUndo).toBe(false);
  });
});

describe("addFloor and the offset (S27.8)", () => {
  it("the new floor gets the lowest floor's offset; none when it has none", () => {
    const s = st(false); s.layout.floors.ground.offset = [30, -40];
    const k = s.addFloor("Attic"); expect(s.layout.floors[k].offset).toEqual([30, -40]); ok(s);
    s.layout.floors.ground.offset = undefined as never; delete s.layout.floors.ground.offset;
    const k2 = s.addFloor("Cellar"); expect("offset" in s.layout.floors[k2]).toBe(false);
  });
});
