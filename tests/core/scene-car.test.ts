import { describe, expect, it } from "vitest";
import { buildScene, type Solid } from "../../src/core/scene";
import { carParts, carSpec, ROOF_INSET } from "../../src/core/car";
import { furnitureHeight } from "../../src/core/heights";
import { CAR_MODELS, type CarModel, type Floor } from "../../src/core/schema";
import { Picker, type Ray } from "../../src/card/three/pick";

// S35.5, spec C4 (the 3D half): a car piece is built from the model's table, not from one prism. Every part carries the piece's
// index and entity, so a tap on any part is a tap on the car. Frame: plan x, y in cm, z up; the nose is +x at rot 0.
const floor = (furniture: unknown[]): Floor => ({
  title: "T", outline: [[0, 0], [900, 0], [900, 700], [0, 700]], owk: ["external", "external", "external", "external"],
  rooms: [{ id: "a", name: "A", area: "", kind: "room", pts: [[0, 0], [900, 0], [900, 700], [0, 700]], wk: ["wall", "wall", "wall", "wall"] }] as never,
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture, unlinked: [],
}) as unknown as Floor;
const car = (model: CarModel | unknown, extra: Record<string, unknown> = {}) => {
  const s = carSpec(model);
  return { id: "car1", symbol: "car", x: 450, y: 350, rot: 0, w: s.w, h: s.h, entity: "device_tracker.car", model, ...extra };
};
const partsOf = (f: Floor) => buildScene(f).solids.filter((s) => s.kind === "furniture");
const tagged = (parts: Solid[], tag: string) => parts.filter((s) => s.tag === tag);
const centre = (p: number[][]) => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
const loftOf = (s: Solid) => { if (s.shape.type !== "loft") throw new Error(`${s.id} is not a loft`); return s.shape; };
const prismOf = (s: Solid) => { if (s.shape.type !== "prism") throw new Error(`${s.id} is not a prism`); return s.shape; };

describe("scene: a car piece, every model", () => {
  for (const model of CAR_MODELS) {
    it(`${model}: body, a greenhouse loft, a roof, four wheels; every part is the car's`, () => {
      const f = floor([car(model)]), parts = partsOf(f), s = carSpec(model), H = furnitureHeight(f.furniture[0] as never);
      expect(H).toBe(s.height);
      expect(tagged(parts, "car-body")).toHaveLength(1);
      expect(tagged(parts, "car-glass")).toHaveLength(1);
      expect(tagged(parts, "car-roof")).toHaveLength(1);
      expect(tagged(parts, "car-tyre")).toHaveLength(4);
      for (const p of parts) {
        expect(p.ref.index, p.id).toBe(0);
        expect(p.ref.entity, p.id).toBe("device_tracker.car");
        expect(p.kind).toBe("furniture");
      }
      const body = prismOf(tagged(parts, "car-body")[0]), glass = loftOf(tagged(parts, "car-glass")[0]), roof = prismOf(tagged(parts, "car-roof")[0]);
      // The body stands 18 cm off the ground up to the belt; the loft starts at the belt and ends 4 cm under the top; the roof is the last 4 cm.
      expect(body.z0).toBe(18);
      expect(body.z1).toBeCloseTo(s.belt * H, 6);
      expect(glass.z0).toBeCloseTo(body.z1, 6);
      expect(glass.z1).toBeCloseTo(H - 4, 6);
      expect(roof.z0).toBeCloseTo(H - 4, 6);
      expect(roof.z1).toBeCloseTo(H, 6);
      // Both rings convex, the same number of points; the top ring is narrower (the windscreen and the rear glass slope).
      expect(glass.base).toHaveLength(glass.top.length);
      const width = (r: number[][]) => Math.max(...r.map((q) => q[1])) - Math.min(...r.map((q) => q[1]));
      expect(width(glass.top)).toBeLessThan(width(glass.base));
      expect(width(glass.base)).toBeCloseTo(s.cabin * s.h, 4);
      // The body is the footprint, 8 chamfered corners.
      expect(body.base).toHaveLength(8);
      expect(Math.max(...body.base.map((q) => q[0])) - Math.min(...body.base.map((q) => q[0]))).toBeCloseTo(s.w, 4);
      for (const w of tagged(parts, "car-tyre")) expect(prismOf(w).z1 - prismOf(w).z0).toBe(Math.min(64, s.belt * H));
      expect(ROOF_INSET).toBe(0.08);
    });
  }

  it("only the electric car has no grille", () => {
    for (const model of CAR_MODELS) expect(tagged(partsOf(floor([car(model)])), "car-grille"), model).toHaveLength(model === "electric" ? 0 : 1);
  });

  it("the body and roof wear the piece's colour (when it is #rrggbb); the glass, tyres and trim never do", () => {
    const parts = partsOf(floor([car("suv", { color: "#c03030" })]));
    for (const t of ["car-body", "car-roof"]) expect(tagged(parts, t)[0].paint).toEqual({ role: "car-body", color: "#c03030" });
    expect(tagged(parts, "car-glass")[0].paint).toEqual({ role: "car-glass" });
    expect(tagged(parts, "car-tyre")[0].paint).toEqual({ role: "car-tyre" });
    for (const junk of ["red", "#12345", 5, null, "url(javascript:1)"]) expect(tagged(partsOf(floor([car("suv", { color: junk })])), "car-body")[0].paint.color, String(junk)).toBeUndefined();
  });

  it("at rot 90 the nose points down the plan (+y); at rot 0 to the right (+x), and the car turns about its own centre", () => {
    for (const [rot, axis] of [[0, 0], [90, 1]] as const) {
      const parts = partsOf(floor([car("sedan", { rot })])), nose = centre(prismOf(tagged(parts, "car-grille")[0]).base), body = centre(prismOf(tagged(parts, "car-body")[0]).base);
      expect(nose[axis] - 450 * (1 - axis) - 350 * axis).toBeGreaterThan(200); // about half the length ahead of the centre
      expect(Math.abs(nose[1 - axis] - (axis === 0 ? 350 : 450))).toBeLessThan(1e-6);
      expect(Math.abs(body[0] - 450) + Math.abs(body[1] - 350)).toBeLessThan(15); // the chamfers shift the mean a little, not the centre
    }
  });

  it("the wheels sit at the parts table's axles, a hair inside the body side so they do not fight it", () => {
    const parts = partsOf(floor([car("sedan")])), unit = carParts("sedan").wheels, s = carSpec("sedan");
    const tyres = tagged(parts, "car-tyre").map((t) => prismOf(t).base);
    expect(tyres.map(centre).map((c) => Math.round(c[0] - 450)).sort()).toEqual(unit.map((w) => Math.round(centre(w)[0] * s.w)).sort());
    for (const b of tyres) expect(Math.max(...b.map((q) => Math.abs(q[1] - 350)))).toBeLessThan(s.h / 2);
  });
});

describe("scene: a car piece, the edges", () => {
  it("with no entity the parts carry none; with only attached entities the first is the main one", () => {
    expect(partsOf(floor([car("sedan", { entity: undefined })])).every((p) => p.ref.entity === undefined)).toBe(true);
    expect(partsOf(floor([car("sedan", { entity: undefined, attached: ["sensor.x", "device_tracker.y"] })])).every((p) => p.ref.entity === "sensor.x")).toBe(true);
  });
  it("an unknown or junk model is a sedan; junk pieces never throw and leave the rest", () => {
    for (const model of ["Sedan", "__proto__", 5, null, {}, undefined]) {
      const parts = partsOf(floor([car(model)]));
      expect(tagged(parts, "car-glass"), String(model)).toHaveLength(1);
    }
    const bad = [car("sedan", { w: NaN }), car("sedan", { x: Infinity }), car("sedan", { h: 0 }), car("sedan", { rot: "a" }), car("sedan", { height: -5 }), null, 5];
    expect(() => buildScene(floor([...bad, car("van")]))).not.toThrow();
    expect(tagged(partsOf(floor([...bad, car("van")])), "car-glass").length).toBeGreaterThanOrEqual(1);
  });
  it("the scene bounds hold the whole car, roof included", () => {
    const sc = buildScene(floor([car("offroad")]));
    expect(sc.bounds.max[2]).toBeGreaterThanOrEqual(195);
  });
  it("a non-car piece is prisms of its own symbol: one for a toilet, its blocks for a table (B53.5)", () => {
    const one = partsOf(floor([{ id: "t", symbol: "toilet", x: 100, y: 100, rot: 0, w: 100, h: 60 }]));
    expect(one).toHaveLength(1);
    expect(one[0].shape.type).toBe("prism");
    const table = partsOf(floor([{ id: "t", symbol: "table", x: 100, y: 100, rot: 0, w: 100, h: 60 }]));
    expect(table).toHaveLength(5);
    expect(table.every((p) => p.shape.type === "prism" && p.tag === "table" && p.ref.index === 0)).toBe(true);
  });
});

describe("pick: the parts of a linked car are the car", () => {
  const down = (x: number, y: number): Ray => ({ o: [x, y, 1000], d: [0, 0, -1] });
  const zOf = (s: Solid): [number, number] | null => (s.shape.type === "point" ? null : [s.shape.z0, s.shape.z1]);
  it("a ray down onto the body, the glass and a wheel is the piece; beside the car it is the room", () => {
    const f = floor([car("sedan")]), p = new Picker(buildScene(f).solids), s = carSpec("sedan");
    const expectPiece = (x: number, y: number) => expect(p.pick(down(x, y), zOf), `${x},${y}`).toEqual({ type: "piece", index: 0 });
    expectPiece(450 + s.w * 0.4, 350);            // the bonnet
    expectPiece(450 - s.w * 0.5 + s.w * 0.45, 350); // the roof / glass
    expectPiece(450 - s.w * 0.5 + s.w * 0.18, 350 + s.h * 0.45); // above a wheel (the body hides it from above: still the car)
    expect(p.pick(down(450, 350 + s.h), zOf)).toEqual({ type: "room", index: 0 });
  });
  it("a ray from the side hits the sloped glass of the loft", () => {
    const p = new Picker(buildScene(floor([car("sedan")])).solids), s = carSpec("sedan");
    // a horizontal ray along +y at the cabin's height, from inside the room, at the middle of the roof; a prism of the glass base would miss
    // the slope near the top, so aim at 4 cm under the roof, where only the narrower top of the loft is there
    const ray: Ray = { o: [450 - s.w * 0.5 + s.w * 0.45, 150, s.height - 6], d: [0, 1, 0] };
    expect(p.pick(ray, zOf)).toEqual({ type: "piece", index: 0 });
  });
});
