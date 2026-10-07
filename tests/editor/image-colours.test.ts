import { describe, it, expect } from "vitest";
import { dominantColours } from "../../src/editor/image-colours";

// S17.6: pure, on pixel arrays (RGBA bytes, as canvas getImageData gives them).
const px = (parts: [number[], number][]) => {
  const out: number[] = [];
  for (const [rgba, n] of parts) for (let i = 0; i < n; i++) out.push(...rgba);
  return new Uint8ClampedArray(out);
};
const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], GREEN = [0, 255, 0, 255];

describe("dominantColours: a fixed-seed k-means over pixels", () => {
  it("finds the colours of a picture made of a few flat colours, the biggest first", () => {
    expect(dominantColours(px([[RED, 60], [BLUE, 30], [GREEN, 10]]), 3)).toEqual(["#ff0000", "#0000ff", "#00ff00"]);
  });
  it("is deterministic: the same pixels always give the same answer", () => {
    const data = px([[RED, 40], [BLUE, 40], [GREEN, 20], [[250, 240, 10, 255], 15], [[20, 20, 20, 255], 25]]);
    const a = dominantColours(data, 4);
    for (let i = 0; i < 5; i++) expect(dominantColours(data, 4)).toEqual(a);
  });
  it("groups near colours: a noisy red and a noisy blue come out as two colours near red and blue", () => {
    const parts: [number[], number][] = [];
    for (let i = 0; i < 20; i++) { parts.push([[240 + (i % 10), i % 7, i % 5, 255], 3]); parts.push([[i % 6, i % 4, 230 + (i % 20), 255], 3]); }
    const [a, b] = dominantColours(px(parts), 2).map((h) => parseInt(h.slice(1), 16));
    const rs = [a, b].map((n) => [n >> 16, n & 255]);
    expect(rs.some(([r, bl]) => r > 230 && bl < 20)).toBe(true);
    expect(rs.some(([r, bl]) => r < 20 && bl > 220)).toBe(true);
  });
  it("gives fewer colours than asked when the picture has fewer; skips transparent pixels; nothing for nothing", () => {
    expect(dominantColours(px([[RED, 10]]), 4)).toEqual(["#ff0000"]);
    expect(dominantColours(px([[RED, 10], [[0, 255, 0, 0], 500]]), 3)).toEqual(["#ff0000"]);
    expect(dominantColours(new Uint8ClampedArray(0), 3)).toEqual([]);
    expect(dominantColours(px([[RED, 5]]), 0)).toEqual([]);
  });
  it("never throws on junk: a length that is not a multiple of 4, NaN k, a huge k", () => {
    expect(() => dominantColours(new Uint8ClampedArray([1, 2, 3, 4, 5]), 2)).not.toThrow();
    expect(dominantColours(px([[RED, 5]]), NaN)).toEqual([]);
    expect(dominantColours(px([[RED, 5], [BLUE, 5]]), 1000).length).toBeLessThanOrEqual(6);
  });
});
