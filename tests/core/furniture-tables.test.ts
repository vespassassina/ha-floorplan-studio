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
/** B53.10: the thirteen pieces after them (Diego, 2026-11-06), written out. The rug is flat in 2.5D (under everything), the rest are boxes. */
const MORE: Record<string, { w: number; h: number; height: number }> = {
  wardrobe: { w: 120, h: 60, height: 210 }, dresser: { w: 100, h: 50, height: 85 }, nightstand: { w: 45, h: 40, height: 55 },
  desk: { w: 140, h: 70, height: 75 }, armchair: { w: 85, h: 85, height: 85 }, counter: { w: 240, h: 60, height: 90 },
  stove: { w: 60, h: 60, height: 90 }, fridge: { w: 70, h: 65, height: 185 }, dishwasher: { w: 60, h: 60, height: 85 },
  washer: { w: 60, h: 60, height: 85 }, dryer: { w: 60, h: 60, height: 85 }, rug: { w: 200, h: 140, height: 1 }, plant: { w: 40, h: 40, height: 90 },
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

  it("B53.10: has the thirteen new pieces with their sizes, heights and 2.5D mode", () => {
    for (const [s, want] of Object.entries(MORE)) {
      expect(FURNITURE_SYMBOLS, s).toContain(s);
      expect(FURNITURE[s as keyof typeof FURNITURE], s).toMatchObject({ w: want.w, h: want.h });
      expect(FURNITURE_SOLID[s as keyof typeof FURNITURE_SOLID], s).toBe(s === "rug" ? "flat" : "box");
      expect(furnitureHeight({ id: "f", symbol: s, x: 0, y: 0, rot: 0, w: want.w, h: want.h } as never), s).toBe(want.height);
      expect(FURNITURE_LABELS[s as keyof typeof FURNITURE_LABELS], s).toBeTruthy();
    }
    const all = [...Object.keys(NEW), ...Object.keys(MORE)].map((s) => FURNITURE[s as keyof typeof FURNITURE].svg);
    expect(new Set(all).size, "every icon is its own").toBe(all.length);
  });

  it("B53.10: validate accepts a piece of each", () => {
    const l = structuredClone(demo) as any;
    l.floors.ground.furniture = Object.entries(MORE).map(([symbol, d], i) => ({ id: `g${i}`, symbol, x: 300, y: 300, rot: 0, w: d.w, h: d.h }));
    const r = validate(l);
    expect(r.ok, JSON.stringify((r as { errors?: unknown }).errors)).toBe(true);
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

  // Spec item 18: a back run along the top, 45 % of the height deep, full width; a chaise on the left, 35 % of the width,
  // full height; the bottom right empty. The symbol is stretched to w x h as a whole, so the fractions hold in the 0-100 box.
  it("draws sofa-l as an L: back run and chaise filled, the bottom right empty", () => {
    const tag = /<path[^>]*class="ff"[^>]*>/.exec(FURNITURE["sofa-l"].svg)?.[0] ?? "";
    const body = /\sd="([^"]+)"/.exec(tag);
    expect(body, "a filled path").not.toBeNull();
    const pts = [...body![1].matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map((m) => [+m[1], +m[2]]);
    const inside = (x: number, y: number) => {
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    expect(inside(80, 80), "bottom right").toBe(false);
    expect(inside(60, 60), "just under the back run, right of the chaise").toBe(false);
    expect(inside(80, 20), "back run, right").toBe(true);
    expect(inside(50, 40), "back run, depth 45").toBe(true);
    expect(inside(20, 80), "chaise").toBe(true);
    expect(inside(30, 90), "chaise, width 35").toBe(true);
    expect(inside(40, 80), "just right of the chaise").toBe(false);
  });
});

describe("B53.10: the plant's class", () => {
  it("only a plant wears furn-plant, in 2D and 2.5D", async () => {
    const { renderFloor } = await import("../../src/core/render");
    const f = (symbol: string) => ({ title: "T", outline: [[0, 0], [900, 0], [900, 700], [0, 700]], owk: ["wall", "wall", "wall", "wall"], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], unlinked: [], furniture: [{ id: "p", symbol, x: 300, y: 300, rot: 0, w: 60, h: 60 }] }) as never;
    for (const view of ["2d", "2.5d"] as const) {
      expect(renderFloor(f("plant"), { scale: 1, view }), view).toContain("furn furn-plant");
      expect(renderFloor(f("table"), { scale: 1, view }), view).not.toContain("furn-plant");
    }
  });
});

describe("B53.10: a rug lies under what stands on it, in 2.5D", () => {
  it("draws the rug before a sofa that is nearer the viewer than the rug's corner", async () => {
    const { renderFloor } = await import("../../src/core/render");
    const p = (id: string, symbol: string, x: number, y: number, w: number, h: number) => ({ id, symbol, x, y, rot: 0, w, h });
    // the sofa is listed first and stands on the south half of the rug, so a nearest-corner sort alone would put it under the rug
    const f = { title: "T", outline: [[0, 0], [900, 0], [900, 700], [0, 700]], owk: ["wall", "wall", "wall", "wall"], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], unlinked: [], furniture: [p("s", "sofa", 300, 330, 160, 80), p("r", "rug", 300, 300, 200, 140)] } as never;
    const html = renderFloor(f, { scale: 1, view: "2.5d" });
    expect(html.indexOf('data-f="1"'), "rug").toBeGreaterThan(-1);
    expect(html.indexOf('data-f="1"'), "rug before sofa").toBeLessThan(html.indexOf('data-f="0"'));
  });
});
