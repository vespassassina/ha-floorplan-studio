import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildScene } from "../../src/core/scene";
import { DEVICE_TYPES, FURNITURE_SYMBOLS, ROOM_KINDS, WALL_KINDS } from "../../src/core/schema";
import { isKnownRole, roleStyle } from "../../src/card/three/palette";

// Finding 17: an enumeration is a list of decisions. A paint role the scene module can emit and the palette does not
// name would fall through to a default and look exactly like a colour chosen on purpose.

describe("palette roles", () => {
  const roles = [
    "slab", "panel", "door-leaf", "stair", "unlinked",
    ...ROOM_KINDS.filter((k) => k !== "zone" && k !== "structure").map((k) => `room-${k}`),
    ...WALL_KINDS.map((k) => `wall-${k}`),
    ...["door", "glass", "window", "sealed", "opening"].map((k) => `glass-${k}`),
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
