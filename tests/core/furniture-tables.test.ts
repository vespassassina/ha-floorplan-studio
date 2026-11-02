import demo from "../../demo/layout.json";
import { describe, expect, it } from "vitest";
import { FURNITURE, FURNITURE_SYMBOLS, furnitureHeight, validate } from "../../src/core";
import { FURNITURE_SOLID } from "../../src/core/solids";
import { FURNITURE_HEIGHTS } from "../../src/core/heights";
import { isKnownRole } from "../../src/card/three/palette";
import { FURNITURE_LABELS } from "../../src/editor/toolbar";

/** B53.1: the four new pieces, written out (w x h cm, height cm). Finding 17: a list of decisions, not a default. */
const NEW: Record<string, { w: number; h: number; height: number }> = {
  "sofa-l": { w: 280, h: 180, height: 85 },
  "coffee-table": { w: 110, h: 60, height: 40 },
  bookcase: { w: 100, h: 35, height: 200 },
  buffet: { w: 180, h: 50, height: 85 },
};

describe("B53.1: every furniture symbol is decided in every table", () => {
  it("walks FURNITURE_SYMBOLS against each per-symbol table", () => {
    for (const s of FURNITURE_SYMBOLS) {
      expect(FURNITURE[s], `FURNITURE ${s}`).toBeDefined();
      expect(FURNITURE[s].svg, `svg ${s}`).toMatch(/^</);
      expect(FURNITURE_SOLID[s], `FURNITURE_SOLID ${s}`).toBeDefined();
      expect(FURNITURE_HEIGHTS[s], `FURNITURE_HEIGHTS ${s}`).toBeGreaterThan(0);
      expect(FURNITURE_LABELS[s], `FURNITURE_LABELS ${s}`).toBeTruthy();
      expect(isKnownRole(`furniture-${s}`), `palette role ${s}`).toBe(true);
    }
    for (const t of [FURNITURE, FURNITURE_SOLID, FURNITURE_HEIGHTS, FURNITURE_LABELS]) expect(Object.keys(t).sort()).toEqual([...FURNITURE_SYMBOLS].sort());
  });

  it("has the four new symbols with their sizes and heights, as plain boxes", () => {
    for (const [s, want] of Object.entries(NEW)) {
      expect(FURNITURE_SYMBOLS, s).toContain(s);
      expect(FURNITURE[s as keyof typeof FURNITURE], s).toMatchObject({ w: want.w, h: want.h });
      expect(FURNITURE_SOLID[s as keyof typeof FURNITURE_SOLID], s).toBe("box");
      expect(furnitureHeight({ id: "f", symbol: s, x: 0, y: 0, rot: 0, w: want.w, h: want.h } as never), s).toBe(want.height);
    }
  });

  it("draws the four new symbols differently from each other", () => {
    const svgs = Object.keys(NEW).map((s) => FURNITURE[s as keyof typeof FURNITURE].svg);
    expect(new Set(svgs).size).toBe(4);
  });

  it("validate accepts a piece of each new symbol and refuses an unknown one", () => {
    const l = structuredClone(demo) as any;
    l.floors.ground.furniture = Object.entries(NEW).map(([symbol, d], i) => ({ id: `f${i}`, symbol, x: 300, y: 300, rot: 0, w: d.w, h: d.h }));
    const r = validate(l);
    expect(r.ok, JSON.stringify((r as { errors?: unknown }).errors)).toBe(true);
    l.floors.ground.furniture[0].symbol = "sofa-xl";
    expect(validate(l).ok).toBe(false);
  });
});
