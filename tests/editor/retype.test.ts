import { describe, expect, it } from "vitest";
import { retype } from "../../src/editor/panels";
import { FURNITURE_SYMBOLS, isLinkable, strictEntity, validate, type Furniture, type Layout } from "../../src/core/schema";
import { furniturePaintable } from "../../src/core/furniture-paint";

// Opus review of B53.10-B53.13 (finding 12): `EditorState.edit` does not validate, so the panel's symbol change must leave a piece
// that `validate` accepts, whichever symbol it came from and goes to. A tv may hold a loose entity (`media_player.Living-Room`)
// that a washer refuses. Every pair, each source carrying every key it may carry.
const layoutOf = (m: Furniture): Layout => ({ version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { ground: { title: "G", outline: [[0, 0], [900, 0], [900, 700], [0, 700]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], unlinked: [], furniture: [m] } } }) as unknown as Layout;
const LOOSE = "media_player.Living-Room";
/** A piece of `symbol` carrying everything that symbol may carry. */
function loaded(symbol: string): Furniture {
  const m: Record<string, unknown> = { id: "p", symbol, x: 300, y: 300, rot: 0, w: 60, h: 60 };
  m.entity = strictEntity(symbol) ? "sensor.a_b" : LOOSE;
  if (isLinkable(symbol)) m.attached = ["sensor.x"];
  if (symbol === "plant") m.minMoisture = 30;
  if (symbol === "car") { m.model = "suv"; m.color = "#aabbcc"; } else if (furniturePaintable(symbol)) { m.color = "#aabbcc"; m.texture = "wood-light"; m.textureRot = 10; m.textureScale = 1; }
  if (symbol === "sofa-l") m.mirror = true;
  if (symbol === "worktop") m.pts = [[270, 270], [330, 270], [330, 300], [300, 300], [300, 330], [270, 330]];
  return m as unknown as Furniture;
}

describe("changing a piece's symbol leaves a valid layout, for every pair", () => {
  it("the starting pieces are valid (so a failure below is the change's)", () => {
    for (const s of FURNITURE_SYMBOLS) { const r = validate(layoutOf(loaded(s))); expect(r.ok, `${s}: ${r.ok ? "" : r.errors.join("; ")}`).toBe(true); }
  });
  for (const from of FURNITURE_SYMBOLS) {
    it(`from ${from}`, () => {
      for (const to of FURNITURE_SYMBOLS) {
        const p = loaded(from);
        retype(p, from, to);
        const r = validate(layoutOf(p));
        expect(r.ok, `${from} -> ${to}: ${r.ok ? "" : r.errors.join("; ")}`).toBe(true);
      }
    });
  }
  it("a loose entity survives where the new symbol accepts it, and goes where it does not", () => {
    const tv = loaded("tv"); retype(tv, "tv", "speaker"); expect(tv.entity).toBe(LOOSE);
    const w = loaded("tv"); retype(w, "tv", "washer"); expect(w).not.toHaveProperty("entity");
    expect(w.attached, "attached is kept").toEqual(["sensor.x"]);
    const ok = loaded("washer"); retype(ok, "washer", "dryer"); expect(ok.entity).toBe("sensor.a_b");
  });
});

// Opus review of Sprint 54 (spec C20): turning a piece into a worktop makes its footprint the points, so x, y, w, h must be the points' bounding box.
// The first version kept the old w and h: a 200 x 60 table turned 90 degrees read as 200 wide while its points were 60 wide.
describe("retyping a turned piece to a worktop keeps the box equal to the points' box", () => {
  for (const [w, h, rot] of [[200, 60, 0], [200, 60, 90], [200, 60, 45], [200, 60, 180], [60, 200, 90]] as const) {
    it(`${w} x ${h} turned ${rot}`, () => {
      const p = { id: "p", symbol: "table", x: 300, y: 300, rot, w, h } as unknown as Furniture;
      retype(p, "table", "worktop");
      const xs = p.pts!.map((q) => q[0]), ys = p.pts!.map((q) => q[1]);
      const box = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      expect({ x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot }).toEqual({ ...box, rot: 0 });
      expect(validate(layoutOf(p)).ok).toBe(true);
    });
  }
});
