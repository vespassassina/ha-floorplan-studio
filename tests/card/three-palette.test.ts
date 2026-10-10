import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildScene } from "../../src/core/scene";
import { DEVICE_TYPES, FURNITURE_SYMBOLS, ROOM_KINDS, WALL_KINDS } from "../../src/core/schema";
import { dimRgb, isKnownRole, parsePaintDim, roleStyle } from "../../src/card/three/palette";

// Finding 17: an enumeration is a list of decisions. A paint role the scene module can emit and the palette does not
// name would fall through to a default and look exactly like a colour chosen on purpose.

describe("palette roles", () => {
  const roles = [
    "slab", "panel", "door-leaf", "stair", "unlinked", "ring", "tree-crown",
    "open-door", "door-band", "door-cover", "body-heating", "screen-on", "driver-off", "driver-on", "motion", "motion-radar", "lamp", "backdrop", // S12.5: what the live state paints
    ...ROOM_KINDS.filter((k) => k !== "zone" && k !== "structure").map((k) => `room-${k}`),
    ...WALL_KINDS.map((k) => `wall-${k}`),
    ...["door", "glass", "window", "slit", "fullwindow", "sealed", "opening"].map((k) => `glass-${k}`),
    ...FURNITURE_SYMBOLS.map((s) => `furniture-${s}`),
    ...DEVICE_TYPES.map((t) => `device-${t}`),
  ];
  it.each(roles)("%s is named", (role) => {
    expect(isKnownRole(role)).toBe(true);
    const s = roleStyle(role);
    expect(s.css).toMatch(/--fp-/); // from a theme token, never a literal colour (finding 9)
    expect(s.opacity).toBeGreaterThan(0);
    expect(s.opacity).toBeLessThanOrEqual(1);
  });

  it("every role the scene module emits for the demo is named", () => {
    const demo = JSON.parse(fs.readFileSync("demo/layout.json", "utf8"));
    for (const floor of Object.values<any>(demo.floors)) for (const s of buildScene(floor).solids) expect(isKnownRole(s.paint.role), s.paint.role).toBe(true);
  });

  it("an unknown role, even a hostile one, gets the fallback, not an error", () => {
    expect(isKnownRole("__proto__")).toBe(false);
    expect(isKnownRole("constructor")).toBe(false);
    expect(roleStyle("__proto__").css).toMatch(/--fp-/);
    expect(roleStyle("room-\"><script>").css).toMatch(/--fp-/);
  });

  it("glass is see-through, solids are not", () => {
    expect(roleStyle("glass-window").opacity).toBeLessThan(1);
    expect(roleStyle("wall-wall").opacity).toBe(1);
  });
});

describe("S28.9 paint dim", () => {
  it("reads the two shapes the themes emit, and nothing else", () => {
    expect(parsePaintDim("brightness(.62) saturate(.85)")).toEqual({ brightness: 0.62, saturate: 0.85 });
    expect(parsePaintDim("  brightness(0.5)   saturate(1) ")).toEqual({ brightness: 0.5, saturate: 1 });
    for (const bad of ["none", "", "blur(4px)", "url(http://x/y.svg#f)", "brightness(NaN) saturate(1)", "brightness(-1) saturate(1)", "brightness(.5) saturate(1) url(x)"])
      expect(parsePaintDim(bad), bad).toBeNull();
  });
  it("brightness scales and saturate desaturates toward the luma, as the CSS filter does", () => {
    expect(dimRgb([200, 100, 50], { brightness: 1, saturate: 1 })).toEqual([200, 100, 50]);
    const d = dimRgb([200, 100, 50], { brightness: 0.5, saturate: 1 });
    expect(d.map(Math.round)).toEqual([100, 50, 25]);
    const g = dimRgb([200, 100, 50], { brightness: 1, saturate: 0 });
    expect(Math.round(g[0])).toBe(Math.round(g[1]));
    expect(Math.round(g[1])).toBe(Math.round(g[2]));
  });
});

describe("S28.9 wall share", () => {
  it.each(["wall-wall", "wall-boundary", "wall-external", "wall-parapet"])("%s follows --fp-wall-side-share, as the 2.5D side faces do", (role) => {
    expect(roleStyle(role).css).toContain("--fp-wall-side-share");
  });
});
