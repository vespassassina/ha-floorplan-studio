import { describe, expect, it } from "vitest";
import { migrate } from "../../src/core/migrate";
import { validate, type Layout } from "../../src/core/schema";

// Opus review of B53.10-B53.13: a mirror takes no paint (`furniturePaintable`), so a layout that carries any is refused by validate
// and cleaned by migrate, as for a tree. Before, validate stayed lenient and the renderer ignored it.
const layoutOf = (m: Record<string, unknown>) => ({ version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { ground: { title: "G", outline: [[0, 0], [500, 0], [500, 400], [0, 400]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], unlinked: [], furniture: [{ id: "m", x: 100, y: 100, rot: 0, w: 80, h: 5, ...m }] } } }) as unknown as Layout;

describe("a mirror takes no paint", () => {
  for (const symbol of ["mirror", "mirror-stand"]) {
    for (const k of [{ color: "#aabbcc" }, { texture: "wood-light" }, { texture: "wood-light", textureRot: 10 }, { texture: "wood-light", textureScale: 1 }]) {
      it(`${symbol} with ${Object.keys(k).join("+")}: validate refuses, migrate drops it`, () => {
        const r = validate(layoutOf({ symbol, ...k }));
        expect(r.ok, "refused").toBe(false);
        const m = migrate(layoutOf({ symbol, ...k }));
        const p = m.floors.ground.furniture[0] as unknown as Record<string, unknown>;
        for (const key of Object.keys(k)) expect(p, key).not.toHaveProperty(key);
        expect(validate(m).ok).toBe(true);
      });
    }
    it(`${symbol} with no paint is valid`, () => expect(validate(layoutOf({ symbol })).ok).toBe(true));
  }
  it("a shower and a sofa still take paint", () => {
    for (const symbol of ["shower", "sofa"]) expect(validate(layoutOf({ symbol, color: "#aabbcc", w: 90, h: 90 })).ok, symbol).toBe(true);
  });
});
