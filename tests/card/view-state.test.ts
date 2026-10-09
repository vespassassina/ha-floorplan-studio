import { describe, expect, it } from "vitest";
import { CAM_ZOOM_MAX, CAM_ZOOM_MIN, easeInOut, normaliseRotation, parseStoredView, shortestDelta, viewAround } from "../../src/card/view-state";
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

/** One floor's view, wrapped as the card stores it. */
const onFloor = (fv: unknown, key = "ground") => ({ floors: [[key, fv]] });
const floorOf = (raw: unknown, key = "ground") => parse(raw).floors?.find(([k]) => k === key)?.[1];

describe("parseStoredView: untrusted storage, field by field", () => {
  it("reads a full good entry, the view per floor", () => {
    const raw = JSON.stringify({ v: 1, floors: [["ground", { zoom: 2.5, focus: [120, -40], rotation: 90, cam: { az: 1, polar: 0.8, zoom: 0.5, dx: 10, dz: -20 } }]], view: "2.5d", tilt: 0.3, theme: "light", labels: false, floor: "ground" });
    expect(parse(raw)).toEqual({ floors: [["ground", { zoom: 2.5, focus: [120, -40], rotation: 90, cam: { az: 1, polar: 0.8, zoom: 0.5, dx: 10, dz: -20 } }]], view: "2.5d", tilt: 0.3, theme: "light", labels: false, floor: "ground" });
  });

  it("an empty entry, no entry and junk are nothing, and never throw", () => {
    for (const raw of [null, undefined, "", "{", "null", "5", '"x"', "[]", "[1,2]", 7, true, {}, []]) expect(parse(raw), String(raw)).toEqual({});
  });

  it("drops each bad field and keeps the good ones", () => {
    const raw = { tilt: "x", view: "3d?", theme: "neon", labels: "yes", floors: [["ground", { zoom: "big", focus: [1, 2], rotation: NaN, cam: 7 }]] };
    expect(parse(raw)).toEqual({});
    expect(parse({ ...raw, theme: "ha", floors: [["ground", { rotation: 45 }]] })).toEqual({ theme: "ha", floors: [["ground", { rotation: 45 }]] });
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
    expect(floorOf(onFloor({ zoom: 1000, focus: [0, 0] }))!.zoom).toBe(MAX_ZOOM);
    expect(floorOf(onFloor({ zoom: 0.0001, focus: [0, 0] }))!.zoom).toBe(MIN_ZOOM);
    expect(floorOf(onFloor({ zoom: -2, focus: [0, 0] }))!.zoom).toBe(MIN_ZOOM);
  });

  it("zoom and focus come as a pair: one without the other is dropped", () => {
    for (const fv of [{ zoom: 2 }, { focus: [1, 2] }, { zoom: 2, focus: [1] }, { zoom: 2, focus: [1, "2"] }, { zoom: 2, focus: [1, Infinity] }, { zoom: 2, focus: [1, 2, 3] }]) {
      expect(parse(onFloor(fv)), JSON.stringify(fv)).toEqual({});
    }
  });

  it("a focus far outside any plan is pulled to a finite bound", () => {
    const f = floorOf(onFloor({ zoom: 2, focus: [1e300, -1e300] }))!.focus!;
    expect(Math.abs(f[0])).toBeLessThanOrEqual(1e6);
    expect(Math.abs(f[1])).toBeLessThanOrEqual(1e6);
  });

  it("rotation is rounded to a step of 45 and wrapped", () => {
    expect(floorOf(onFloor({ rotation: 100 }))!.rotation).toBe(90);
    expect(floorOf(onFloor({ rotation: -45 }))!.rotation).toBe(315);
    expect(floorOf(onFloor({ rotation: 720 }))!.rotation).toBe(0);
  });

  it("tilt is clamped to 0..1", () => {
    expect(parse({ tilt: 5 }).tilt).toBe(1);
    expect(parse({ tilt: -5 }).tilt).toBe(0);
  });

  it("each floor stands alone: a bad one is dropped, the others stay", () => {
    const raw = { floors: [["ground", { rotation: 90 }], ["first", { zoom: "x" }], [7, { rotation: 45 }], ["", { rotation: 45 }], "junk", ["test", { rotation: 135 }]] };
    expect(parse(raw).floors).toEqual([["ground", { rotation: 90 }], ["test", { rotation: 135 }]]);
  });

  it("a floor named __proto__ is data, not a prototype", () => {
    const raw = JSON.parse('{"floors":[["__proto__",{"rotation":90}],["constructor",{"rotation":45}]]}');
    expect(parse(raw).floors).toEqual([["__proto__", { rotation: 90 }], ["constructor", { rotation: 45 }]]);
    expect(({} as Record<string, unknown>).rotation).toBeUndefined();
  });

  it("keeps at most 50 floors", () => {
    const floors = Array.from({ length: 80 }, (_, i) => [`f${i}`, { rotation: 90 }]);
    expect(parse({ floors }).floors).toHaveLength(50);
  });

  it("the 3D camera: every number must be finite, and each is bounded", () => {
    const good = { az: 1, polar: 0.8, zoom: 1, dx: 0, dz: 0 };
    for (const bad of [{ ...good, az: NaN }, { ...good, polar: "1" }, { ...good, zoom: Infinity }, { ...good, dx: null }, { az: 1 }, [], "x"]) {
      expect(parse(onFloor({ cam: bad })), JSON.stringify(bad)).toEqual({});
    }
    const c = floorOf(onFloor({ cam: { az: 1e300, polar: 0.8, zoom: 99, dx: -1e300, dz: 1e300 } }))!.cam!;
    expect(Math.abs(c.az)).toBeLessThanOrEqual(1e4);
    expect(c.zoom).toBe(CAM_ZOOM_MAX);
    expect(Math.abs(c.dx)).toBeLessThanOrEqual(1e6);
    expect(Math.abs(c.dz)).toBeLessThanOrEqual(1e6);
    expect(floorOf(onFloor({ cam: { ...good, zoom: 0 } }))!.cam!.zoom).toBe(CAM_ZOOM_MIN);
  });

  it("hidden layers (S24.8): known families only, once each, in layer order; junk is dropped alone", () => {
    expect(parse({ layers: ["furniture", "lights", "lights", "__proto__", 5, "nope"] }).layers).toEqual(["lights", "furniture"]);
    expect(parse({ layers: "lights", names: true })).toEqual({ names: true });
    expect(parse({ layers: [] })).toEqual({});
    expect(parse({ layers: [null, {}] })).toEqual({});
  });

  it("an entry from before per-floor memory moves its zoom, focus and turn to the floor it names", () => {
    expect(parse({ zoom: 2, focus: [1, 2], rotation: 90, floor: "first" })).toEqual({ floor: "first", floors: [["first", { zoom: 2, focus: [1, 2], rotation: 90 }]] });
    expect(parse({ zoom: 2, focus: [1, 2], rotation: 90 })).toEqual({}); // no floor named: whose view it was cannot be said
  });
});

describe("viewAround", () => {
  const fit = { x: -60, y: -60, w: 1000, h: 500 };
  it("is fit's own aspect, fit.w / zoom wide, centred on the point", () => {
    const v = viewAround([100, 50], 2, fit);
    expect(v).toEqual({ x: -150, y: -75, w: 500, h: 250 });
  });
});

describe("S25.8: the stored detail mode", () => {
  const ok = () => true;
  it("keeps one of the three names and drops anything else on its own", () => {
    for (const d of ["auto", "full", "minimal"]) expect(parseStoredView({ v: 1, detail: d }, ok, []).detail).toBe(d);
    for (const d of ["FULL", "", 3, null, {}, ["full"], "<b>"]) expect(parseStoredView({ v: 1, detail: d, labels: false }, ok, [])).toEqual({ labels: false });
  });
});
