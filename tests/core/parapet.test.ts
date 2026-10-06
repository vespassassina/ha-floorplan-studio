import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { buildScene, type Solid } from "../../src/core/scene";
import { wallHeight, edgeHeight, WALL_KIND_HEIGHT } from "../../src/core/heights";
import { WALL_KINDS, validate, type Floor, type Layout } from "../../src/core/schema";
import { renderFloor, FLOORPLAN_CSS, WALL_WIDTH_EXTERNAL } from "../../src/core/render";
import { WALL_LABELS } from "../../src/editor/panels";

// The parapet (2026-10-06): a balcony's half wall. 120 cm tall, as thick as an external wall (20 cm).
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const ys = (s: Solid) => (s.shape as { base: number[][] }).base.map((p) => p[1]);
const top = (s: Solid) => (s.shape as { z1: number }).z1;

describe("parapet wall kind", () => {
  it("is a wall kind, with a label, and a layout with one validates", () => {
    expect(WALL_KINDS).toContain("parapet");
    expect(WALL_LABELS.parapet).toMatch(/balcony/i);
    const l = structuredClone(demo) as unknown as Layout;
    l.floors.ground.walls.push({ id: "p1", a: [0, 0], b: [100, 0], kind: "parapet" });
    l.floors.ground.owk = l.floors.ground.owk!.map((_, i) => (i === 0 ? "parapet" : "external"));
    expect(validate(l).ok).toBe(true);
  });

  it("is 120 cm tall, whatever the storey; a wall's own height still wins", () => {
    const f = floor({ height: 300 });
    expect(WALL_KIND_HEIGHT.parapet).toBe(120);
    expect(wallHeight(f, { kind: "parapet" } as never)).toBe(120);
    expect(wallHeight(f, { kind: "parapet", height: 90 } as never)).toBe(90);
    expect(edgeHeight(floor({ owk: ["parapet", "wall", "wall", "wall"] }), null, 0)).toBe(120);
  });

  it("is 20 cm thick in 3D, like an external wall, and 120 high", () => {
    const f = floor({ owk: ["external", "external", "external", "external"], walls: [{ id: "p", a: [100, 200], b: [300, 200], kind: "parapet" }] });
    const s = buildScene(f).solids.find((s) => s.ref.poly === "w" && s.ref.index === 0)!;
    expect([Math.min(...ys(s)), Math.max(...ys(s))]).toEqual([190, 210]);
    expect(top(s)).toBe(120);
  });

  it("is drawn 20 cm wide on the plan, in its own class", () => {
    const f = floor({ walls: [{ id: "p", a: [100, 200], b: [300, 200], kind: "parapet" }] });
    expect(renderFloor(f, {} as never)).toMatch(/<line class="e parapet" data-w="0"/);
    expect(FLOORPLAN_CSS).toMatch(new RegExp(`\\.e\\.parapet\\{[^}]*stroke-width:${WALL_WIDTH_EXTERNAL}`));
  });
});
