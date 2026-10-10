import { describe, expect, it } from "vitest";
import demo from "../../demo/layout.json";
import { buildScene, type Solid } from "../../src/core/scene";
import type { Floor, Layout } from "../../src/core/schema";
import { BAND_PATCH, BAND_WALL, contactShadows, groundBox } from "../../src/card/three/shade";

// S28.8: the pure part of the 3D contact shadows. Positions are three's frame (x, z up as y, plan y as z); alpha is per vertex.
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const ground = (demo as unknown as Layout).floors.ground;
const piece = (o: Record<string, unknown> = {}) => ({ id: "f", symbol: "table", x: 300, y: 200, rot: 0, w: 100, h: 50, ...o }) as never;
const verts = (s: ReturnType<typeof contactShadows>) => Array.from({ length: s.alpha.length }, (_, i) => ({ x: s.position[i * 3], z: s.position[i * 3 + 2], y: s.position[i * 3 + 1], a: s.alpha[i] }));

describe("contactShadows", () => {
  it("counts a wall's bands and the patches on the demo", () => {
    const sc = buildScene(ground), s = contactShadows(sc.solids);
    const walls = sc.solids.filter((x) => x.kind === "wall" && x.shape.type === "prism").length;
    const pieces = ground.furniture.filter((m) => m.symbol !== "patio-wood" && m.symbol !== "patio-concrete").length + ground.unlinked.length;
    expect(walls).toBeGreaterThan(5);
    expect(s.walls).toBe(walls);
    expect(s.patches).toBeGreaterThanOrEqual(pieces); // plus the device bodies on the floor (the radiator)
    expect(s.patches).toBeLessThanOrEqual(pieces + ground.devices.length);
    expect(s.position.length).toBe(s.alpha.length * 3);
    expect(s.alpha.length % 3).toBe(0);
  });
  it("every vertex has an alpha in 0..1 and the outer ones have 0, a band's width away from the footprint", () => {
    const sc = buildScene(floor({ furniture: [piece()] })), s = contactShadows(sc.solids.filter((x) => x.kind === "furniture"));
    expect(s.patches).toBe(1);
    const v = verts(s);
    expect(v.length).toBeGreaterThan(0);
    // the footprint is x 250..350, y 175..225 (three z = plan y)
    const dist = (p: { x: number; z: number }) => Math.hypot(Math.max(250 - p.x, 0, p.x - 350), Math.max(175 - p.z, 0, p.z - 225));
    for (const p of v) {
      expect(p.a).toBeGreaterThanOrEqual(0);
      expect(p.a).toBeLessThanOrEqual(1);
      if (p.a === 0) expect(dist(p)).toBeCloseTo(BAND_PATCH, 4);
      else expect(dist(p)).toBeCloseTo(0, 4);
    }
    expect(v.some((p) => p.a === 0)).toBe(true);
    expect(v.some((p) => p.a === 1)).toBe(true);
  });
  it("a wall gets the wall band; a flat slab, a raised piece and a point get none; junk is skipped", () => {
    const sc = buildScene(floor({ walls: [{ id: "w", a: [100, 100], b: [300, 100], kind: "wall" } as never], furniture: [piece({ symbol: "patio-wood" }), piece({ id: "up", x: 50, y: 50, z: 120 })] as never }));
    const s = contactShadows(sc.solids);
    const w = sc.solids.filter((x) => x.kind === "wall" && x.ref.poly === "w");
    expect(w.length).toBeGreaterThan(0);
    const mine = contactShadows(w);
    const v = verts(mine);
    expect(Math.max(...v.map((p) => Math.abs(p.z - 100)))).toBeCloseTo(5 + BAND_WALL, 4); // 10 thick: 5 each side, then the band
    expect(s.patches).toBe(0);
    const junk = [null, 7, { kind: "wall", shape: { type: "prism", base: [[0, 0], [NaN, 1], [1, 5]], z0: 0, z1: 1 }, ref: {}, paint: {} }, { kind: "furniture", shape: { type: "point", at: [1, 1], z: 1 } }, { kind: "wall", shape: { type: "prism", base: [], z0: 0, z1: 1 } }] as unknown as Solid[];
    expect(() => contactShadows(junk)).not.toThrow();
    expect(contactShadows(junk).alpha.length).toBe(0);
    expect(contactShadows(null as never).alpha.length).toBe(0);
  });
  it("a tree gets a soft patch under its crown, centre alpha above 0, rim 0, and no band round the trunk", () => {
    const sc = buildScene(floor({ furniture: [piece({ symbol: "tree", x: 300, y: 250, w: 120, h: 80 })] }));
    const s = contactShadows(sc.solids.filter((x) => x.kind !== "wall")), v = verts(s);
    expect(s.patches).toBe(1);
    expect(Math.max(...v.map((p) => p.a))).toBeGreaterThan(0.5);
    for (const p of v.filter((q) => q.a === 0)) { const dx = (p.x - 304) / 60, dz = (p.z - 256) / 40; expect(Math.hypot(dx, dz)).toBeCloseTo(1, 3); } // offset (+4, +6), radii w/2 and h/2
  });
  it("sits a hair above the floor it stands on, a nested room's included", () => {
    const f = floor({ rooms: [{ id: "a", name: "A", kind: "room", pts: [[0, 0], [600, 0], [600, 500], [0, 500]] }, { id: "b", name: "B", kind: "room", pts: [[200, 100], [450, 100], [450, 350], [200, 350]] }] as never, furniture: [piece({ x: 300, y: 200 }), piece({ id: "out", x: 100, y: 450, w: 40, h: 40 })] });
    const sc = buildScene(f), tops = sc.solids.filter((x) => x.kind === "room").map((x) => (x.shape as { z1: number }).z1);
    const v = verts(contactShadows(sc.solids.filter((x) => x.kind !== "wall")));
    const on = v.filter((p) => p.x > 240 && p.x < 360).map((p) => p.y), off = v.filter((p) => p.x < 150).map((p) => p.y);
    expect(Math.max(...tops)).toBeGreaterThan(Math.min(...tops)); // the nest is real
    for (const y of on) { expect(y).toBeGreaterThan(Math.max(...tops)); expect(y).toBeLessThan(Math.max(...tops) + 1); }
    for (const y of off) { expect(y).toBeGreaterThan(Math.min(...tops)); expect(y).toBeLessThan(Math.min(...tops) + 1); }
  });
  it("5000 pieces of furniture in under 100 ms", () => {
    const sc = buildScene(floor({ furniture: Array.from({ length: 5000 }, (_, i) => piece({ id: `f${i}`, x: (i % 100) * 8, y: Math.floor(i / 100) * 12, rot: i % 360, w: 15, h: 15 })) }));
    const t0 = performance.now(), s = contactShadows(sc.solids);
    expect(s.patches).toBe(5000);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe("groundBox", () => {
  it("1.5 times the box, centred on it", () => {
    expect(groundBox({ min: [0, 0, -25], max: [600, 500, 250] })).toEqual({ x0: -150, y0: -125, x1: 750, y1: 625 });
  });
  it("gives null for numbers no plane can have", () => {
    expect(groundBox({ min: [0, 0, 0], max: [0, 0, 0] })).toBeNull();
    expect(groundBox({ min: [NaN, 0, 0], max: [1, 1, 1] })).toBeNull();
    expect(groundBox(null as never)).toBeNull();
  });
});
