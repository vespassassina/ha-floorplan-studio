import { describe, expect, it } from "vitest";
import { declutter, type Box } from "../../src/card/three/declutter";

// S28.11: which label boxes stay when some overlap. Pure: a box is { x, y, w, h, priority, area?, index? }; the answer is one
// boolean per box, in the order given.
const b = (x: number, y: number, w: number, h: number, priority: number, extra: Partial<Box> = {}): Box => ({ x, y, w, h, priority, ...extra });
const hit = (p: Box, q: Box) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

describe("declutter", () => {
  it("keeps the higher priority of two overlapping boxes, whatever their order", () => {
    expect(declutter([b(0, 0, 10, 10, 1), b(5, 5, 10, 10, 2)])).toEqual([false, true]);
    expect(declutter([b(5, 5, 10, 10, 2), b(0, 0, 10, 10, 1)])).toEqual([true, false]);
  });
  it("keeps both when they only touch or do not meet", () => {
    expect(declutter([b(0, 0, 10, 10, 1), b(10, 0, 10, 10, 1), b(0, 50, 10, 10, 1)])).toEqual([true, true, true]);
  });
  it("on equal priority keeps the larger room, then the lower index", () => {
    expect(declutter([b(0, 0, 10, 10, 1, { area: 5 }), b(5, 5, 10, 10, 1, { area: 9 })])).toEqual([false, true]);
    expect(declutter([b(0, 0, 10, 10, 1, { area: 5, index: 7 }), b(5, 5, 10, 10, 1, { area: 5, index: 3 })])).toEqual([false, true]);
    expect(declutter([b(0, 0, 10, 10, 1), b(5, 5, 10, 10, 1)])).toEqual([true, false]); // no area, no index: the earlier box
  });
  it("a chain of three: the middle one wins and takes both ends, or an end that is clear stays", () => {
    // A overlaps B, B overlaps C, A does not meet C.
    const A = b(0, 0, 10, 10, 1), B = b(8, 0, 10, 10, 3), C = b(16, 0, 10, 10, 2);
    expect(declutter([A, B, C])).toEqual([false, true, false]);
    const A2 = b(0, 0, 10, 10, 3), B2 = b(8, 0, 10, 10, 2), C2 = b(16, 0, 10, 10, 1);
    expect(declutter([A2, B2, C2])).toEqual([true, false, true]); // B lost to A, so C is free
  });
  it("no box shown overlaps another, over a random field", () => {
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const boxes = Array.from({ length: 400 }, () => b(rnd() * 800, rnd() * 600, 10 + rnd() * 80, 8 + rnd() * 30, Math.floor(rnd() * 5)));
    const keep = declutter(boxes), shown = boxes.filter((_, i) => keep[i]);
    expect(shown.length).toBeGreaterThan(20);
    expect(shown.length).toBeLessThan(boxes.length);
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) expect(hit(shown[i], shown[j])).toBe(false);
  });
  it("1000 boxes in under 5 ms", () => {
    const boxes = Array.from({ length: 1000 }, (_, i) => b((i * 37) % 900, (i * 91) % 700, 40, 14, i % 4));
    declutter(boxes); // warm
    const t = performance.now();
    declutter(boxes);
    expect(performance.now() - t).toBeLessThan(5);
  });
  it("skips a box with a NaN or infinite number, and one huge box does not stall", () => {
    const out = declutter([b(NaN, 0, 10, 10, 9), b(0, 0, Infinity, 10, 9), b(0, 0, 10, 10, 1), b(-1e12, -1e12, 2e12, 2e12, 5)]);
    expect(out[0]).toBe(false);
    expect(out[1]).toBe(false);
    expect(out[3]).toBe(true);
    expect(out[2]).toBe(false); // the huge box covers it and has the priority
  });
  it("never throws on junk", () => {
    expect(declutter([])).toEqual([]);
    expect(() => declutter([null, undefined, 5, "x", {}] as never)).not.toThrow();
    expect(declutter(null as never)).toEqual([]);
  });
});
