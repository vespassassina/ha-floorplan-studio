import { describe, expect, it } from "vitest";
import { MAX_ZOOM, clamp, panBy, pinch, zoomAt, type View } from "../../src/card/viewport";

// An asymmetric plan box (not square, not at the origin), so a swapped x/y or w/h shows up.
const FIT: View = { x: -60, y: -40, w: 1200, h: 800 };

/** Where plan point (px, py) sits inside `v`, as a fraction of its width and height: the screen position. */
const frac = (v: View, px: number, py: number) => [(px - v.x) / v.w, (py - v.y) / v.h];

describe("viewport: zoomAt", () => {
  it("scales the view by 1/k and keeps the plan point under the pointer where it was", () => {
    const v = zoomAt(FIT, 2, 300, 100);
    expect(v.w).toBeCloseTo(600);
    expect(v.h).toBeCloseTo(400);
    const [a, b] = frac(FIT, 300, 100);
    const [c, d] = frac(v, 300, 100);
    expect(c).toBeCloseTo(a);
    expect(d).toBeCloseTo(b);
  });

  it("k < 1 zooms out about the same point", () => {
    const inV = zoomAt(FIT, 4, 900, 600);
    const outV = zoomAt(inV, 0.5, 900, 600);
    expect(outV.w).toBeCloseTo(600);
    expect(frac(outV, 900, 600)[0]).toBeCloseTo(frac(FIT, 900, 600)[0]);
  });

  it("returns the view unchanged for a k that is not a positive finite number", () => {
    for (const k of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) expect(zoomAt(FIT, k, 10, 10)).toEqual(FIT);
  });
});

describe("viewport: panBy", () => {
  it("moves the view's origin by (dx, dy) in plan units, size unchanged", () => {
    expect(panBy({ x: 10, y: 20, w: 300, h: 200 }, 7, -3)).toEqual({ x: 17, y: 17, w: 300, h: 200 });
  });
});

describe("viewport: clamp", () => {
  it("never zooms out past fit: a view wider than fit comes back as fit exactly", () => {
    expect(clamp(zoomAt(FIT, 0.5, 100, 100), FIT)).toEqual(FIT);
  });

  it("never zooms in past MAX_ZOOM (8x), keeping the view's centre", () => {
    expect(MAX_ZOOM).toBe(8);
    const deep = zoomAt(FIT, 20, 540, 360); // the centre of FIT
    const c = clamp(deep, FIT);
    expect(c.w).toBeCloseTo(FIT.w / 8);
    expect(c.h).toBeCloseTo(FIT.h / 8);
    expect(c.x + c.w / 2).toBeCloseTo(540);
    expect(c.y + c.h / 2).toBeCloseTo(360);
  });

  it("leaves a view between fit and 8x, inside the bounds, alone", () => {
    const v = zoomAt(FIT, 3, 200, 500);
    expect(clamp(v, FIT)).toEqual(v);
  });

  it("at fit zoom there is nothing to pan: the view stays fit", () => {
    expect(clamp(panBy(FIT, 5000, -5000), FIT)).toEqual(FIT);
  });

  it("a view a rounding error narrower than fit (in then out again) is fit, not a pannable 1.0000001x", () => {
    const back = zoomAt(zoomAt(FIT, 3, 17, 29), 1 / 3, 17, 29);
    expect(clamp(panBy(back, 400, 0), FIT)).toEqual(FIT);
  });

  it("zoomed in, a pan keeps at least one third of the view on the plan", () => {
    const z = zoomAt(FIT, 4, 540, 360);
    const c = clamp(panBy(z, -9000, 9000), FIT);
    const ox = Math.min(c.x + c.w, FIT.x + FIT.w) - Math.max(c.x, FIT.x);
    const oy = Math.min(c.y + c.h, FIT.y + FIT.h) - Math.max(c.y, FIT.y);
    expect(ox).toBeCloseTo(z.w / 3);
    expect(oy).toBeCloseTo(z.h / 3);
  });

  it("a pan that stays inside the bounds is not touched", () => {
    const z = zoomAt(FIT, 4, 540, 360);
    const p = panBy(z, 50, -30);
    expect(clamp(p, FIT)).toEqual(p);
  });

  it("returns fit for a view with non-finite numbers", () => {
    expect(clamp({ x: Number.NaN, y: 0, w: 10, h: 10 }, FIT)).toEqual(FIT);
    expect(clamp({ x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 10 }, FIT)).toEqual(FIT);
  });
});

describe("viewport: pinch", () => {
  it("two fingers moving apart to twice the distance zoom 2x", () => {
    const v = pinch(FIT, [100, 100], [300, 100], [0, 100], [400, 100]);
    expect(v.w).toBeCloseTo(FIT.w / 2);
    expect(v.h).toBeCloseTo(FIT.h / 2);
  });

  it("the plan point under the old midpoint ends up under the new midpoint", () => {
    const p1: [number, number] = [100, 100], p2: [number, number] = [300, 300];
    const q1: [number, number] = [150, 120], q2: [number, number] = [450, 420]; // 1.5x and moved
    const v = pinch(FIT, p1, p2, q1, q2);
    const pm: [number, number] = [200, 200], qm: [number, number] = [300, 270];
    // qm's screen position in the old view is where pm must be in the new one.
    const [a, b] = frac(FIT, qm[0], qm[1]);
    const [c, d] = frac(v, pm[0], pm[1]);
    expect(c).toBeCloseTo(a);
    expect(d).toBeCloseTo(b);
    expect(v.w).toBeCloseTo(FIT.w / 1.5);
  });

  it("fingers closing together zoom out", () => {
    const z = zoomAt(FIT, 4, 540, 360);
    const v = pinch(z, [400, 300], [600, 300], [450, 300], [550, 300]);
    expect(v.w).toBeCloseTo(z.w * 2);
  });

  it("two fingers on the same spot are not a pinch: the view is unchanged", () => {
    expect(pinch(FIT, [5, 5], [5, 5], [10, 10], [20, 20])).toEqual(FIT);
  });
});
