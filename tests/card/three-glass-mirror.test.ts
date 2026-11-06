import { describe, expect, it } from "vitest";
import { buildScene } from "../../src/core/scene";
import type { Floor } from "../../src/core/schema";
import { isKnownRole, roleStyle } from "../../src/card/three/palette";

// B53.12: a shower is a dark tray and glass walls, a mirror its own colour; in 3D that is three roles, and glass and mirror never take paint.
const floor = (furniture: unknown[]): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"],
  rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture, unlinked: [],
}) as unknown as Floor;
const piece = (symbol: string, extra: Record<string, unknown> = {}) => ({ id: `p-${symbol}`, symbol, x: 300, y: 250, rot: 0, w: 90, h: 90, ...extra });
const roles = (f: Floor) => buildScene(f).solids.filter((s) => s.kind === "furniture").map((s) => s.paint);

describe("3D: the shower box and the mirrors", () => {
  it("a shower has one tray in the piece's role (dark) and four glass walls; paint reaches only the tray", () => {
    const plain = roles(floor([piece("shower")]));
    expect(plain.map((p) => p.role).sort()).toEqual(["furniture-glass", "furniture-glass", "furniture-glass", "furniture-glass", "furniture-shower-dark"]);
    const painted = roles(floor([piece("shower", { color: "#c03030" })]));
    for (const p of painted) {
      if (p.role === "furniture-glass") expect(p.color, "glass keeps the theme").toBeUndefined();
      else expect(p.color).toBeDefined();
    }
    expect(painted.filter((p) => p.color).length).toBe(1);
  });
  it("a mirror, and every slab of a standing mirror, is the mirror role, even with a colour in the file", () => {
    for (const s of ["mirror", "mirror-stand"]) {
      const r = roles(floor([piece(s, { color: "#c03030", w: 80, h: 5 })]));
      expect(r.length, s).toBeGreaterThan(0);
      expect(r.filter((p) => p.role === "furniture-mirror").length, s).toBeGreaterThanOrEqual(1);
      for (const p of r) if (p.role === "furniture-mirror") expect(p.color, s).toBeUndefined();
    }
  });
  it("the palette names both: glass is see-through on the theme's glass, the mirror is the theme's mirror colour lifted to white", () => {
    for (const r of ["furniture-glass", "furniture-mirror"]) expect(isKnownRole(r), r).toBe(true);
    expect(roleStyle("furniture-glass")).toEqual({ css: "var(--fp-glass)", opacity: 0.2 });
    expect(roleStyle("furniture-mirror").css).toMatch(/--fp-mirror.*white/);
    expect(roleStyle("furniture-mirror").opacity).toBe(1);
  });
});
