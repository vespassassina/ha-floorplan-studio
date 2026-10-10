import { describe, expect, it } from "vitest";
import { TRUNK_SIDE, treeShape } from "../../src/core/tree";
import * as core from "../../src/core";
import { FRAME_PROUD, FRAME_WIDTH } from "../../src/core/solids";
import type { Furniture } from "../../src/core/schema";

// S28.1: one tree shape for every view. A trunk under a crown; the numbers come from the tree's w, h and height.
const tree = (extra: object = {}) => ({ id: "t", symbol: "tree", x: 100, y: 100, w: 200, h: 120, rot: 0, ...extra }) as unknown as Furniture;

describe("S28.1 treeShape", () => {
  it("the default tree (400 cm): trunk top at 60 %, crown from 50 % to 100 %, radii w/2 and h/2", () => {
    const s = treeShape(tree())!;
    expect(s).toEqual({ height: 400, trunkTop: 240, crownBottom: 200, crownTop: 400, crownMiddle: 300, rx: 100, ry: 60, trunk: TRUNK_SIDE });
    expect(TRUNK_SIDE).toBe(12);
  });
  it("asymmetric w and h keep their own radii (not swapped, not averaged)", () => {
    const s = treeShape(tree({ w: 90, h: 340 }))!;
    expect(s.rx).toBe(45);
    expect(s.ry).toBe(170);
  });
  it("a set height scales the heights, not the radii", () => {
    const s = treeShape(tree({ height: 1000 }))!;
    expect(s).toMatchObject({ height: 1000, trunkTop: 600, crownBottom: 500, crownTop: 1000, crownMiddle: 750, rx: 100, ry: 60 });
  });
  it("is exported from core", () => {
    expect(core.treeShape).toBe(treeShape);
  });
  it("junk gives null, never a throw", () => {
    const junk: unknown[] = [
      tree({ w: 0 }), tree({ h: 0 }), tree({ w: -5 }), tree({ w: NaN }), tree({ h: Infinity }), tree({ w: "200" }), tree({ h: null }),
      undefined, null, 5, "tree", [], {}, JSON.parse('{"symbol":"__proto__","w":10,"h":10}'),
    ];
    for (const j of junk) {
      let r: unknown;
      expect(() => { r = treeShape(j as never); }, String(j)).not.toThrow();
      if (r !== null) for (const v of Object.values(r as object)) expect(Number.isFinite(v), String(j)).toBe(true);
    }
    expect(treeShape(tree({ w: 0 }))).toBeNull();
    expect(treeShape(tree({ w: NaN }))).toBeNull();
    expect(treeShape(tree({ h: "120" }))).toBeNull();
    expect(treeShape(undefined as never)).toBeNull();
  });
  it("a string height is ignored (the symbol's default stands), not trusted", () => {
    expect(treeShape(tree({ height: "9999" }))!.height).toBe(400);
  });
  it("a __proto__ symbol still gives numbers or null", () => {
    const m = JSON.parse('{"symbol":"__proto__","x":0,"y":0,"w":50,"h":50,"rot":0}');
    const s = treeShape(m);
    if (s) for (const v of Object.values(s)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("S28.1 frame constants", () => {
  it("are 5 cm along the wall and 2 cm proud of each face", () => {
    expect(FRAME_WIDTH).toBe(5);
    expect(FRAME_PROUD).toBe(2);
  });
});
