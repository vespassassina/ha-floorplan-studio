import { describe, it, expect } from "vitest";
import { hexToHs, hsToHex } from "../../src/editor/scene-colour";

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
