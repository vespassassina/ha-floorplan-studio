import { describe, expect, it } from "vitest";
import { Orbit, MAX_POLAR, MIN_POLAR } from "../../src/card/three/orbit";

// The camera maths of the 3D view, with no WebGL: where the camera stands and what a drag, a wheel turn and a pan do.

const bounds = { min: [0, 0, 0] as [number, number, number], max: [1000, 800, 250] as [number, number, number] };
const make = (aspect = 1.5, deg = 0) => new Orbit(bounds, aspect, 40, deg);

describe("Orbit", () => {
  it("starts south of the house, 50 degrees above the horizon, looking at its centre", () => {
    const o = make(), p = o.position(), t = o.target;
    expect(t).toEqual([500, 125, 400]); // three's frame: plan (500, 400), half the height
    expect(p[0]).toBeCloseTo(500, 6); // straight south: no east-west offset
    expect(p[2]).toBeGreaterThan(t[2]); // south is +z
    const elev = Math.atan2(p[1] - t[1], Math.hypot(p[0] - t[0], p[2] - t[2]));
    expect((elev * 180) / Math.PI).toBeCloseTo(50, 6);
  });

  it("frames the whole house: the distance grows with the house and shrinks with a wider view", () => {
    const small = new Orbit({ min: [0, 0, 0], max: [100, 100, 100] }, 1.5, 40, 0).distance;
    expect(make().distance).toBeGreaterThan(small);
    expect(make(0.5).distance).toBeGreaterThan(make(2).distance); // a tall narrow view must back off to fit the width
  });

  it("a plan turned by +90 degrees starts with the camera east of the house (the plan reads turned clockwise)", () => {
    const o = make(1.5, 90), p = o.position();
    expect(p[0] - o.target[0]).toBeGreaterThan(o.distance * 0.5);
    expect(Math.abs(p[2] - o.target[2])).toBeLessThan(1e-6 * o.distance + 1e-3);
  });

  it("dragging sideways turns the azimuth and never changes the polar angle", () => {
    const o = make(), a = o.azimuth, p = o.polar;
    o.rotate(100, 0);
    expect(o.azimuth).not.toBeCloseTo(a, 3);
    expect(o.polar).toBeCloseTo(p, 9);
  });

  it("the polar angle is clamped: you cannot go under the floor, and you cannot flip over the top", () => {
    const o = make();
    o.rotate(0, 100000); // dragging down lifts the camera, as in every orbit control
    expect(o.polar).toBe(MIN_POLAR);
    o.rotate(0, -100000);
    expect(o.polar).toBe(MAX_POLAR);
    expect(MAX_POLAR).toBeLessThan(Math.PI / 2); // the camera stays above the floor plane
    expect(o.position()[1]).toBeGreaterThan(o.target[1]);
  });

  it("zoom is clamped on both sides, and a non-finite factor changes nothing", () => {
    const o = make(), d = o.distance;
    o.zoom(1e-9);
    const near = o.distance;
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(d);
    o.zoom(1e12);
    const far = o.distance;
    expect(far).toBeGreaterThan(d);
    o.zoom(NaN); o.zoom(Infinity);
    expect(o.distance).toBe(far);
    o.rotate(NaN, NaN);
    expect(Number.isFinite(o.azimuth) && Number.isFinite(o.polar)).toBe(true);
  });

  it("pan moves the target along the ground (never up), by a bigger step the further out the camera is", () => {
    const o = make(), t0 = [...o.target];
    o.pan(60, 0, 600);
    expect(o.target[1]).toBe(t0[1]);
    expect(Math.hypot(o.target[0] - t0[0], o.target[2] - t0[2])).toBeGreaterThan(0);
    const near = make(); near.zoom(0.2);
    const far = make(); far.zoom(3);
    near.pan(60, 0, 600); far.pan(60, 0, 600);
    expect(Math.abs(far.target[0] - 500) + Math.abs(far.target[2] - 400)).toBeGreaterThan(Math.abs(near.target[0] - 500) + Math.abs(near.target[2] - 400));
  });

  it("pan cannot carry the target away from the house", () => {
    const o = make();
    o.pan(1e9, 1e9, 600);
    expect(Math.abs(o.target[0] - 500)).toBeLessThan(5000);
    expect(Math.abs(o.target[2] - 400)).toBeLessThan(5000);
  });

  it("empty or hostile bounds still give a camera that looks at a finite point", () => {
    const o = new Orbit({ min: [0, 0, 0], max: [0, 0, 0] }, 1, 40, 0);
    expect(o.position().every(Number.isFinite)).toBe(true);
    const n = new Orbit({ min: [NaN, 0, 0], max: [Infinity, 0, 0] } as never, NaN, NaN, NaN);
    expect(n.position().every(Number.isFinite)).toBe(true);
  });

  it("reset puts the camera back where it started", () => {
    const o = make(1.5, 45), p = o.position();
    o.rotate(300, 80); o.zoom(2); o.pan(40, 40, 600);
    o.reset();
    expect(o.position().map((v) => Math.round(v * 1e6) / 1e6)).toEqual(p.map((v) => Math.round(v * 1e6) / 1e6));
  });

  it("MIN_POLAR and MAX_POLAR are in range", () => {
    expect(MIN_POLAR).toBeGreaterThan(0);
    expect(MIN_POLAR).toBeLessThan(MAX_POLAR);
  });
});

describe("Orbit inset: a panel covers part of the view (S12.4)", () => {
  it("frames the house in the free width: the camera backs off and the picture shifts toward the free side", () => {
    const o = make(1.5), before = o.distance;
    expect(o.shift).toBe(0);
    o.setInset(0, 0.4); // a panel over the right 40 percent
    expect(o.distance).toBeGreaterThan(before); // a narrower field must back off to fit the width
    expect(o.shift).toBeCloseTo(-0.2, 9); // the free area's centre is 0.2 of the width left of the view's centre
    o.setInset(0.4, 0);
    expect(o.shift).toBeCloseTo(0.2, 9);
  });

  it("clearing the inset returns the first framing; a camera the user moved keeps its distance", () => {
    const o = make(1.5), first = o.distance;
    o.setInset(0, 0.4);
    o.setInset(0, 0);
    expect(o.distance).toBeCloseTo(first, 9);
    expect(o.shift).toBe(0);
    o.zoom(0.5);
    const zoomed = o.distance;
    o.setInset(0, 0.4);
    const fresh = make(1.5);
    fresh.setInset(0, 0.4);
    expect(o.distance).toBeCloseTo(zoomed * (fresh.distance / first), 6); // the same step, so the zoom the user chose is kept in proportion
  });

  it("never covers the whole view, and junk changes nothing", () => {
    const o = make(1.5);
    o.setInset(0.9, 0.9);
    expect(o.shift).toBe(0); // equal sides: centred
    expect(Number.isFinite(o.distance)).toBe(true);
    const d = o.distance;
    o.setInset(NaN, -3);
    expect(o.distance).toBe(d);
  });
});
