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

describe("Orbit reframe: another floor, the same way of looking (S12.6)", () => {
  const small = { min: [0, 0, -300] as [number, number, number], max: [200, 100, 250] as [number, number, number] };
  it("keeps azimuth and polar, frames the new bounds, and what reset returns to is the new frame", () => {
    const o = make(1.5, 20);
    o.rotate(-100, 40);
    o.zoom(0.5);
    o.pan(30, 30, 800);
    const [az, polar] = [o.azimuth, o.polar];
    const fresh = new Orbit(small, 1.5, 40, 20);
    o.reframe(small);
    expect(o.azimuth).toBe(az);
    expect(o.polar).toBe(polar);
    expect(o.distance).toBeCloseTo(fresh.distance, 6);
    expect(o.target).toEqual(fresh.target);
    expect(o.framing).toBeCloseTo(fresh.framing, 6);
    o.rotate(50, 50);
    o.reset();
    expect(o.distance).toBeCloseTo(fresh.distance, 6); // back to the new floor's frame, with the first azimuth
    expect(o.target).toEqual(fresh.target);
  });
  it("keeps the panel inset, and junk bounds change nothing", () => {
    const o = make();
    o.setInset(0.2, 0.1);
    const fresh = new Orbit(small, 1.5, 40, 0);
    fresh.setInset(0.2, 0.1);
    o.reframe(small);
    expect(o.distance).toBeCloseTo(fresh.distance, 6);
    const d = o.distance, t = [...o.target];
    o.reframe({ min: [NaN, 0, 0], max: [1, 1, Infinity] } as never);
    o.reframe(null as never);
    expect(o.distance).toBe(d);
    expect(o.target).toEqual(t);
  });
});

describe("Orbit with numbers too large for a camera", () => {
  it("says it has no finite position when the bounds overflow the framing distance", () => {
    const huge = { min: [-1.7e308, 0, 0] as [number, number, number], max: [1.7e308, 800, 250] as [number, number, number] };
    expect(new Orbit(huge, 1.5, 40, 0).finite).toBe(false);
    expect(make().finite).toBe(true);
  });
});

describe("Orbit state and restore: the camera a floor is left with (S14.4)", () => {
  /** A camera the user has moved on all four axes, with asymmetric numbers. */
  const moved = () => { const o = make(); o.rotate(-130, 40); o.zoom(0.6); o.pan(90, -30, 600); return o; };

  it("state is the camera as numbers that survive another size of view: the distance as a multiple of the framing one", () => {
    const o = moved(), s = o.state();
    expect(s.az).toBeCloseTo(o.azimuth, 10);
    expect(s.polar).toBeCloseTo(o.polar, 10);
    expect(s.zoom).toBeCloseTo(o.distance / o.framing, 10);
    expect(s.dx).toBeCloseTo(o.target[0] - 500, 6); // the centre of the 1000 x 800 house
    expect(s.dz).toBeCloseTo(o.target[2] - 400, 6);
  });

  it("restore puts a fresh camera exactly where the old one stood", () => {
    const a = moved(), s = a.state(), b = make();
    b.restore(s);
    expect(b.azimuth).toBeCloseTo(a.azimuth, 10);
    expect(b.polar).toBeCloseTo(a.polar, 10);
    expect(b.distance).toBeCloseTo(a.distance, 6);
    expect(b.target[0]).toBeCloseTo(a.target[0], 6);
    expect(b.target[2]).toBeCloseTo(a.target[2], 6);
    expect(b.target[1]).toBeCloseTo(a.target[1], 6); // pan never lifts the target
  });

  it("restore on another floor keeps the way of looking and the offset, in that floor's own frame", () => {
    const small = { min: [0, 0, 0] as [number, number, number], max: [400, 300, 250] as [number, number, number] };
    const b = new Orbit(small, 1.5, 40, 0);
    b.restore({ az: 0.7, polar: 0.9, zoom: 0.5, dx: 20, dz: -10 });
    expect(b.distance).toBeCloseTo(b.framing * 0.5, 6);
    expect(b.target[0]).toBeCloseTo(220, 6);
    expect(b.target[2]).toBeCloseTo(140, 6);
  });

  it("restore after the view changed size lands at the same multiple of the framing distance", () => {
    const o = make(1.5);
    o.restore({ az: 0, polar: 0.8, zoom: 0.5, dx: 0, dz: 0 });
    o.setAspect(0.6);
    expect(o.state().zoom).toBeCloseTo(o.distance / o.framing, 10); // read against the new framing
    const p = make(0.6);
    p.restore(o.state());
    expect(p.distance).toBeCloseTo(o.distance, 6);
  });

  it("restore bounds what it is given: polar, distance and the offset stay inside what the camera allows; junk changes nothing", () => {
    const o = make();
    o.restore({ az: 0, polar: 99, zoom: 99, dx: 1e9, dz: -1e9 });
    expect(o.polar).toBe(MAX_POLAR);
    expect(o.distance).toBeCloseTo(o.framing * 4, 6);
    expect(o.target[0]).toBeCloseTo(1000 + 500 + 100, 6); // the same limit a pan has: half the house and 100 cm past its edge
    expect(o.target[2]).toBeCloseTo(0 - 400 - 100, 6);
    const before = o.state();
    for (const junk of [null, undefined, 7, "x", { az: NaN, polar: 1, zoom: 1, dx: 0, dz: 0 }, { az: 1 }] as never[]) o.restore(junk);
    expect(o.state()).toEqual(before);
  });

  it("reset still goes to the first view after a restore", () => {
    const o = make();
    const first = o.state();
    o.restore({ az: 2, polar: 1, zoom: 0.3, dx: 100, dz: 100 });
    o.reset();
    expect(o.state()).toEqual(first);
  });
});
