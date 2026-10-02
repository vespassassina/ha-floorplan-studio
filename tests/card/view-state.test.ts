import { describe, expect, it } from "vitest";
import { easeInOut, normaliseRotation, parseStoredView, shortestDelta, viewAround } from "../../src/card/view-state";
import { MAX_ZOOM, MIN_ZOOM } from "../../src/card/viewport";

const isView = (v: unknown) => v === "2d" || v === "2.5d";
const themes = ["blueprint", "light", "ha"];
const parse = (raw: unknown) => parseStoredView(raw, isView, themes);

describe("normaliseRotation: config and storage are untrusted", () => {
  it.each([
    [0, 0], [45, 45], [90, 90], [315, 315], [360, 0], [405, 45], [-45, 315], [-90, 270], [-360, 0],
    [20, 0], [23, 45], [67.5, 90], [22.5, 45], [337, 315], [350, 0], [44.9, 45], [720, 0],
    ["90", 0], [null, 0], [undefined, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0], [{}, 0], [[45], 0], [true, 0],
  ])("%j -> %j", (input, out) => {
    expect(normaliseRotation(input)).toBe(out);
  });

  it("always returns a multiple of 45 in 0..315", () => {
    for (let d = -1000; d <= 1000; d += 7) {
      const r = normaliseRotation(d);
      expect(r % 45).toBe(0);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(360);
    }
  });
});

describe("shortestDelta: always the short way round", () => {
  it.each([
    [0, 45, 45], [315, 0, 45], [0, 315, -45], [0, 90, 90], [90, 0, -90], [45, 315, -90], [315, 45, 90],
    [0, 0, 0], [0, 135, 135], [0, 225, -135], [360, 45, 45], [405, 0, -45], [0, 180, 180],
  ])("%j to %j is %j", (from, to, d) => {
    expect(shortestDelta(from, to)).toBe(d);
  });
});

describe("easeInOut", () => {
  it("is 0 at the start, 1 at the end, symmetric, slow at the ends", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
    expect(easeInOut(-3)).toBe(0);
    expect(easeInOut(7)).toBe(1);
  });
});

describe("parseStoredView: untrusted storage, field by field", () => {
  it("reads a full good entry", () => {
    const raw = JSON.stringify({ v: 1, zoom: 2.5, focus: [120, -40], rotation: 90, view: "2.5d", tilt: 0.3, theme: "light", labels: false });
    expect(parse(raw)).toEqual({ zoom: 2.5, focus: [120, -40], rotation: 90, view: "2.5d", tilt: 0.3, theme: "light", labels: false });
  });

  it("an empty entry, no entry and junk are nothing, and never throw", () => {
    for (const raw of [null, undefined, "", "{", "null", "5", '"x"', "[]", "[1,2]", 7, true, {}, []]) expect(parse(raw), String(raw)).toEqual({});
  });

  it("drops each bad field and keeps the good ones", () => {
    const raw = { zoom: "big", focus: [1, 2], rotation: NaN, view: "3d?", tilt: "x", theme: "neon", labels: "yes" };
    expect(parse(raw)).toEqual({});
    expect(parse({ ...raw, rotation: 45, theme: "ha" })).toEqual({ rotation: 45, theme: "ha" });
  });

  it("a view the card does not offer is dropped, one it offers is kept as the string it was", () => {
    expect(parse({ view: "2d" })).toEqual({ view: "2d" });
    expect(parse({ view: "3d" })).toEqual({});
    expect(parse({ view: 2 })).toEqual({});
  });

  it("a theme must be one of the given list; a __proto__ key does not matter", () => {
    expect(parse({ theme: "blueprint" })).toEqual({ theme: "blueprint" });
    expect(parse({ theme: "__proto__" })).toEqual({});
    expect(parse(JSON.parse('{"__proto__":{"theme":"light"},"constructor":1}'))).toEqual({});
  });

  it("clamps zoom to the card's range", () => {
    expect(parse({ zoom: 1000, focus: [0, 0] }).zoom).toBe(MAX_ZOOM);
    expect(parse({ zoom: 0.0001, focus: [0, 0] }).zoom).toBe(MIN_ZOOM);
    expect(parse({ zoom: -2, focus: [0, 0] }).zoom).toBe(MIN_ZOOM);
  });

  it("zoom and focus come as a pair: one without the other is dropped", () => {
    expect(parse({ zoom: 2 })).toEqual({});
    expect(parse({ focus: [1, 2] })).toEqual({});
    expect(parse({ zoom: 2, focus: [1] })).toEqual({});
    expect(parse({ zoom: 2, focus: [1, "2"] })).toEqual({});
    expect(parse({ zoom: 2, focus: [1, Infinity] })).toEqual({});
    expect(parse({ zoom: 2, focus: [1, 2, 3] })).toEqual({});
  });

  it("a focus far outside any plan is pulled to a finite bound", () => {
    const f = parse({ zoom: 2, focus: [1e300, -1e300] }).focus!;
    expect(Math.abs(f[0])).toBeLessThanOrEqual(1e6);
    expect(Math.abs(f[1])).toBeLessThanOrEqual(1e6);
  });

  it("rotation is rounded to a step of 45 and wrapped", () => {
    expect(parse({ rotation: 100 }).rotation).toBe(90);
    expect(parse({ rotation: -45 }).rotation).toBe(315);
    expect(parse({ rotation: 720 }).rotation).toBe(0);
  });

  it("tilt is clamped to 0..1", () => {
    expect(parse({ tilt: 5 }).tilt).toBe(1);
    expect(parse({ tilt: -5 }).tilt).toBe(0);
  });
});

describe("viewAround", () => {
  const fit = { x: -60, y: -60, w: 1000, h: 500 };
  it("is fit's own aspect, fit.w / zoom wide, centred on the point", () => {
    const v = viewAround([100, 50], 2, fit);
    expect(v).toEqual({ x: -150, y: -75, w: 500, h: 250 });
  });
});
