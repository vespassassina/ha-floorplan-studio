import { describe, it, expect } from "vitest";
import { edgeGap, inPoly, liftFor, MAX_POOLS, pickLights, roomLifts, roomOfPoint, type RoomShape } from "../../src/card/three/light";
import { insetBand, pulseAt } from "../../src/card/three/ring";
import { MOTION_PULSE_S } from "../../src/core/render";

const sq = (x: number, y: number, w: number, h: number) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const living: RoomShape = { index: 0, base: sq(0, 0, 500, 400), top: 1, area: 200000 }, kitchen: RoomShape = { index: 1, base: sq(500, 0, 300, 400), top: 1, area: 120000 };
const nested: RoomShape = { index: 2, base: sq(100, 100, 100, 100), top: 2, area: 10000 };

describe("roomOfPoint", () => {
  it("is the room that holds the point, the highest when one stands in another, and -1 outside", () => {
    expect(roomOfPoint([living, kitchen], 250, 200)).toBe(0);
    expect(roomOfPoint([living, kitchen], 700, 200)).toBe(1);
    expect(roomOfPoint([living, kitchen, nested], 150, 150)).toBe(2);
    expect(roomOfPoint([living, kitchen], 900, 200)).toBe(-1);
  });
  it("sends a point just outside every room to the nearest one, within reach, and no further", () => {
    expect(roomOfPoint([living, kitchen], -8, 200, 12)).toBe(0);
    expect(roomOfPoint([living, kitchen], -30, 200, 12)).toBe(-1);
    expect(roomOfPoint([living, kitchen], -8, 200)).toBe(-1);
  });
  it("never throws on junk", () => {
    expect(roomOfPoint([living], NaN, 5)).toBe(-1);
    expect(roomOfPoint([], 1, 1, 12)).toBe(-1);
  });
  it("measures a gap to an edge", () => {
    expect(edgeGap(sq(0, 0, 100, 100), 50, 130)).toBeCloseTo(30);
    expect(inPoly(sq(0, 0, 100, 100), 50, 50)).toBe(true);
  });
});

describe("the lamp budget and the lift", () => {
  const lamp = (x: number, room = 0) => ({ at: [x, 0] as [number, number], room, rgb: [1, 0.7, 0.3] as [number, number, number], level: 1 });
  it("keeps the nearest lamps to the centre, in a fixed order", () => {
    const lamps = Array.from({ length: 20 }, (_, i) => lamp(i * 10));
    const kept = pickLights(lamps, [0, 0]);
    expect(kept).toHaveLength(MAX_POOLS);
    expect(kept.map((l) => l.at[0])).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
    expect(pickLights(lamps, [200, 0], 3).map((l) => l.at[0])).toEqual([190, 180, 170]);
    expect(pickLights(lamps, [0, 0], 0)).toEqual([]);
  });
  it("lifts a lit room brighter and toward the lamp, never darker, and a dim lamp less", () => {
    const [r, g, b] = liftFor([1, 0.7, 0.3], 1);
    expect(r).toBeGreaterThan(g); expect(g).toBeGreaterThan(b); expect(b).toBeGreaterThan(1);
    expect(liftFor([1, 0.7, 0.3], 0.3)[0]).toBeLessThan(r);
    expect(liftFor([0, 0, 0], 1).every((c) => c > 1)).toBe(true);
    expect(liftFor([1, 1, 1], 0).every((c) => c === 1)).toBe(true);
  });
  it("lifts the rooms that hold a lit lamp and no other, and caps what two lamps in one room add", () => {
    const m = roomLifts([lamp(0, 0), lamp(5, 0), lamp(0, 3), lamp(0, -1)]);
    expect([...m.keys()].sort()).toEqual([0, 3]);
    expect(m.get(0)![0]).toBeCloseTo(m.get(3)![0], 6); // two lamps at full level are one lamp's full lift
    expect(roomLifts([])).toEqual(new Map());
  });
});

describe("insetBand", () => {
  const inside = (p: number[], poly: number[][]) => inPoly(poly, p[0], p[1]);
  it("is a band between inner and outer cm inside a rectangle: every corner is inside, none closer than inner or farther than outer", () => {
    const poly = sq(0, 0, 500, 400), t = insetBand(poly, 8, 16);
    expect(t.length).toBe(4 * 12);
    for (let i = 0; i < t.length; i += 2) {
      const p = [t[i], t[i + 1]], d = edgeGap(poly, p[0], p[1]);
      expect(inside(p, poly)).toBe(true);
      expect(d).toBeGreaterThan(8 - 1e-6); expect(d).toBeLessThan(16 + 1e-6);
    }
    // area of the band: the rectangle inset by 8 minus the rectangle inset by 16
    let a = 0;
    for (let i = 0; i < t.length; i += 6) a += Math.abs((t[i + 2] - t[i]) * (t[i + 5] - t[i + 1]) - (t[i + 4] - t[i]) * (t[i + 3] - t[i + 1])) / 2;
    expect(Math.abs(a - (484 * 384 - 468 * 368))).toBeLessThan(100); // the exact band
  });
  it("does not care which way the polygon is wound", () => {
    const poly = sq(0, 0, 200, 100), rev = [...poly].reverse();
    for (const p of [poly, rev]) { const t = insetBand(p, 5, 10); for (let i = 0; i < t.length; i += 2) expect(inPoly(poly, t[i], t[i + 1])).toBe(true); }
  });
  it("keeps an L shape's band inside it, at its reflex corner too", () => {
    const L = [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]];
    const t = insetBand(L, 6, 14);
    expect(t.length).toBe(6 * 12);
    for (let i = 0; i < t.length; i += 2) expect(inPoly(L, t[i], t[i + 1])).toBe(true);
  });
  it("gives nothing for a polygon that cannot hold a band, and never throws", () => {
    for (const bad of [[], [[0, 0], [1, 1]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [NaN, 0], [1, 1]], null, 5, [[0, 0], [10, 0], [10, 10]].map(() => "x")]) expect(insetBand(bad as never, 5, 10)).toEqual([]);
    expect(insetBand(sq(0, 0, 10, 10), 10, 5)).toEqual([]);
    expect(insetBand(sq(0, 0, 10, 10), -1, 5)).toEqual([]);
  });
});

describe("the pulse", () => {
  it("is full at the start of a pulse, 0.35 half way and full again at the end, as the plan's keyframes", () => {
    expect(pulseAt(0, MOTION_PULSE_S)).toBeCloseTo(1, 6);
    expect(pulseAt(MOTION_PULSE_S / 2, MOTION_PULSE_S)).toBeCloseTo(0.35, 6);
    expect(pulseAt(MOTION_PULSE_S, MOTION_PULSE_S)).toBeCloseTo(1, 6);
  });
});
