import { describe, expect, it } from "vitest";
import { FURNITURE_SYMBOLS } from "../../src/core/schema";
import { DARKEN_PCT, darkened } from "../../src/core/furniture-blocks";
import { isKnownRole, roleStyle } from "../../src/card/three/palette";

// B53.5: the 3D palette names a `-dark` role for every symbol, 20 % darker than the piece's own (the 3D chunk imports nothing from core, so the figure is written there again; this holds the two together).
describe("3D palette: dark blocks", () => {
  it("has a dark role for every symbol, DARKEN_PCT darker than the plain one", () => {
    for (const s of FURNITURE_SYMBOLS) {
      expect(isKnownRole(`furniture-${s}-dark`), s).toBe(true);
      expect(roleStyle(`furniture-${s}-dark`).css, s).toBe(darkened(roleStyle(`furniture-${s}`).css));
    }
    expect(DARKEN_PCT).toBe(20);
  });
});
