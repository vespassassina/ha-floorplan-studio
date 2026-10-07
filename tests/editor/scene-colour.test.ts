import { describe, it, expect } from "vitest";
import { hexToHs, hsToHex, spreadColours } from "../../src/editor/scene-colour";

describe("scene colour: hue/saturation and hex", () => {
  it("knows the primaries and white", () => {
    expect(hsToHex(0, 100)).toBe("#ff0000");
    expect(hsToHex(120, 100)).toBe("#00ff00");
    expect(hsToHex(240, 100)).toBe("#0000ff");
    expect(hsToHex(200, 0)).toBe("#ffffff");
    expect(hexToHs("#00ff00")).toEqual([120, 100]);
    expect(hexToHs("#ffffff")).toEqual([0, 0]);
  });
  it("round-trips within a degree and a percent, and refuses junk", () => {
    for (const [h, s] of [[30, 80], [200, 55], [310, 20], [359, 100]]) {
      const back = hexToHs(hsToHex(h, s))!;
      expect(Math.abs(back[0] - h)).toBeLessThanOrEqual(2);
      expect(Math.abs(back[1] - s)).toBeLessThanOrEqual(2);
    }
    expect(hexToHs("red")).toBeNull();
    expect(hexToHs("#12")).toBeNull();
    expect(hsToHex(NaN as number, 50)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("spreadColours: a palette over n lights", () => {
  it("orders the palette brightest first and deals it out round the lights", () => {
    // luminance: yellow > red > blue
    const out = spreadColours(["#0000ff", "#ff0000", "#ffff00"], 5);
    expect(out).toEqual([[60, 100], [0, 100], [240, 100], [60, 100], [0, 100]]);
  });
  it("is deterministic: any order of the same colours gives the same lights, and a repeat gives the same answer", () => {
    const a = spreadColours(["#ff0000", "#00ff00", "#0000ff"], 4), b = spreadColours(["#0000ff", "#ff0000", "#00ff00"], 4);
    expect(a).toEqual(b);
    expect(spreadColours(["#ff0000", "#00ff00", "#0000ff"], 4)).toEqual(a);
  });
  it("drops junk and repeats; keeps at most 6; gives nothing for no lights or no usable colour", () => {
    expect(spreadColours(["red", "#ff0000", "#FF0000", 5 as never], 2)).toEqual([[0, 100], [0, 100]]);
    const seven = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff", "#ff8000"];
    expect(new Set(spreadColours(seven, 20).map((c) => c.join())).size).toBe(6);
    expect(spreadColours(["#ff0000"], 0)).toEqual([]);
    expect(spreadColours(["nope"], 3)).toEqual([]);
  });
});
