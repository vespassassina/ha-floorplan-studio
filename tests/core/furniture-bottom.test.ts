import { describe, it, expect } from "vitest";
import { FURNITURE_SYMBOLS, validate, furnitureBottom, furnitureTop, furnitureHeight, FURNITURE_Z, FURNITURE } from "../../src/core";
import { furnitureSolid } from "../../src/core/solids";

// Diego, 2026-10-07: a TV hangs 100 cm over the floor, a speaker stands at 100 cm, both editable. `z` is the bottom of
// the piece, `height` its own size, so the top is z + height. Pieces without z stay on the floor, as they were.

const px = { scr: (p: number[]) => p, lift: (p: number[], z: number) => [p[0], p[1] - z], skew: 0 } as any;
const piece = (o: object) => ({ id: "f1", symbol: "tv", x: 100, y: 100, rot: 0, w: 120, h: 10, ...o }) as any;

describe("furniture bottom", () => {
  it("defaults: tv and speaker 100 cm up, everything else on the floor", () => {
    expect(FURNITURE_Z).toEqual({ tv: 100, speaker: 100 });
    expect(furnitureBottom(piece({}))).toBe(100);
    expect(furnitureBottom(piece({ symbol: "speaker" }))).toBe(100);
    expect(furnitureBottom(piece({ symbol: "sofa" }))).toBe(0);
  });
  it("an own z wins, 0 puts a tv on the floor; junk falls back", () => {
    expect(furnitureBottom(piece({ z: 40 }))).toBe(40);
    expect(furnitureBottom(piece({ z: 0 }))).toBe(0);
    for (const j of ["x", NaN, -3, 5000, null]) expect(furnitureBottom(piece({ z: j })), String(j)).toBe(100);
  });
  it("top = bottom + height", () => {
    expect(furnitureTop(piece({ z: 30, height: 50 }))).toBe(80);
    expect(furnitureTop(piece({ symbol: "sofa" }))).toBe(furnitureHeight(piece({ symbol: "sofa" })));
  });
  it("every symbol has a drawing; speaker is one of them", () => {
    expect(FURNITURE_SYMBOLS).toContain("speaker");
    for (const s of FURNITURE_SYMBOLS) expect(FURNITURE[s], s).toBeTruthy();
  });
  it("validate accepts z 0..1000 and refuses junk", () => {
    const base = (z: unknown) => ({ version: 2, floors: { ground: { name: "G", outline: [], rooms: [], walls: [], doors: [], windows: [], devices: [], furniture: [piece({ z })], stairs: [], unlinked: [] } } });
    const errs = (z: unknown) => { const r = validate(base(z) as any); return r.ok ? [] : r.errors.filter((e) => /\bz\b/.test(e)); };
    expect(errs(100)).toEqual([]);
    expect(errs(0)).toEqual([]);
    for (const j of [-1, 1001, "a", NaN]) expect(errs(j).length, String(j)).toBe(1);
  });
  it("2.5D: a piece lifted off the floor draws its walls from z, not from 0", () => {
    const lo = furnitureSolid(piece({ z: 0, height: 50 }), 0, "box", false, "", px)!.svg;
    const hi = furnitureSolid(piece({ z: 100, height: 50 }), 0, "box", false, "", px)!.svg;
    expect(hi).not.toBe(lo);
    expect(hi).toContain("40,-55 160,-55"); // the lid: y 95 lifted 150
    expect(hi).toContain("160,5 40,5"); // the wall starts at y 105 lifted 100, not at the floor line
  });
});
