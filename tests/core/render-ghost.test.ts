import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FLOORPLAN_CSS, renderFloor } from "../../src/core/render";
import type { Floor, Layout } from "../../src/core/schema";

// S27.5: the floor below, drawn by renderFloor as faint lines under the current floor.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const ground = demo.floors.ground!;
const first = Object.values(demo.floors)[1]!;
const plain = renderFloor(first, { scale: 0.5 });
const ghosted = (ghost: unknown, extra: object = {}) => renderFloor(first, { scale: 0.5, ghost, ...extra } as never);
const ghostPart = (svg: string) => /<g class="ghost">[\s\S]*?<\/g>/.exec(svg)?.[0] ?? "";

describe("S27.5 ghost floor", () => {
  it("is absent without the option: the markup is what it was", () => {
    expect(plain).not.toContain("ghost");
    expect(renderFloor(first, { scale: 0.5, ghost: undefined })).toBe(plain);
  });

  it("draws one g.ghost, after every room fill and stair and before walls, doors, text and devices (review 27)", () => {
    const svg = ghosted({ floor: ground, shift: [0, 0] });
    const g = ghostPart(svg);
    expect(g).toContain("<path");
    const night = ghosted({ floor: ground, shift: [0, 0] }, { night: true });
    expect(night.lastIndexOf('data-night="')).toBeLessThan(night.indexOf('<g class="ghost">'));
    const at = svg.indexOf('<g class="ghost">');
    // Opaque room fills would hide a ghost drawn under them, exactly where Align needs it.
    for (const over of ['data-r="', 'class="stairs room"', 'data-night="']) expect(svg.lastIndexOf(over), over).toBeLessThan(at);
    for (const under of ['class="eh ', 'class="door ', "<text", "data-x="]) expect(svg.indexOf(under), under).toBeGreaterThan(at);
    expect(svg.match(/class="ghost"/g)).toHaveLength(1);
    for (const bad of ["<text", "<use", "<image", "data-x", "data-r", "data-e", "data-d", "<title", "<polygon"]) expect(g, bad).not.toContain(bad);
    // the rest of the plan is the plain plan, untouched
    expect(svg.replace(`${g}\n`, "")).toBe(plain);
  });

  it("draws the outline, every room, wall and stair of the floor below", () => {
    const f = { ...ground, outline: [[0, 0], [100, 0], [100, 100]], rooms: [{ name: "R", kind: "room", pts: [[1, 1], [2, 1], [2, 2]] }], walls: [{ id: "w", a: [3, 3], b: [4, 4], kind: "wall" }], stairs: [{ id: "s", name: "S", pts: [[5, 5], [6, 5], [6, 6]], shape: "straight", steps: 5, rot: 0 }] } as unknown as Floor;
    const g = ghostPart(ghosted({ floor: f, shift: [0, 0] }));
    for (const d of ["M0 0", "M1 1", "M3 3", "M5 5"]) expect(g, d).toContain(d);
  });

  it("moves every point by the shift", () => {
    const f = { ...ground, outline: [[10, 20], [110, 20], [110, 120]], rooms: [], walls: [], stairs: [] } as unknown as Floor;
    const g = ghostPart(ghosted({ floor: f, shift: [137, -61] }));
    expect(g).toContain("M147 -41");
    expect(g).not.toContain("M10 20");
  });

  it("never lets a name through, and draws no text for it", () => {
    const evil = '"><script>';
    const f = { ...ground, title: evil, rooms: [{ name: evil, kind: evil, pts: [[0, 0], [9, 0], [9, 9]], area: evil }], walls: [{ id: evil, a: [0, 0], b: [9, 9], kind: evil }], stairs: [{ id: evil, name: evil, pts: [[0, 0], [9, 0], [9, 9]], shape: evil }] } as unknown as Floor;
    const svg = ghosted({ floor: f, shift: [0, 0] });
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain(evil);
  });

  it("draws nothing for junk, and never throws", () => {
    const junk: unknown[] = [null, 5, "x", [], {}, { floor: null }, { floor: 5, shift: [0, 0] }, { floor: ground }, { floor: ground, shift: "ab" }, { floor: ground, shift: [NaN, 0] },
      { floor: ground, shift: [1] }, { floor: ground, shift: [0, Infinity] }, { floor: ground, shift: [1e308, 0] }, { floor: { outline: 5, rooms: 5, walls: 5, stairs: 5 }, shift: [0, 0] },
      { floor: { outline: [[NaN, 0], [1, 1]], rooms: [null, 4, { pts: "x" }, { pts: [[0, "a"]] }], walls: [null, { a: [0, 0] }, { a: [NaN, 0], b: [1, 1] }], stairs: [null, { pts: [[1]] }] }, shift: [0, 0] }];
    for (const j of junk) expect(() => ghosted(j), JSON.stringify(j)).not.toThrow();
    for (const j of junk) expect(ghostPart(ghosted(j)), JSON.stringify(j)).not.toContain("<path");
  });

  it("wraps with a theme or a rotation like any other part of the plan", () => {
    const lit = ghosted({ floor: ground, shift: [0, 0] }, { theme: "light" });
    expect(lit).toMatch(/^<g data-theme="light">/);
    expect(lit.indexOf('<g class="ghost">')).toBeGreaterThan(0);
    const turned = ghosted({ floor: ground, shift: [0, 0] }, { rotate: { deg: 90, pivot: [0, 0] } });
    expect(turned).toMatch(/^<g class="plan-turn"[^>]*>/);
    expect(turned.indexOf('<g class="ghost">')).toBeGreaterThan(0);
  });

  it("has a token in the generic defaults, and its rules are classes, not attributes", () => {
    expect(FLOORPLAN_CSS).toMatch(/--fp-ghost:color-mix\(in srgb,var\(--fp-wall\)[^;]*var\(--fp-bg\)\)/);
    expect(FLOORPLAN_CSS).toMatch(/\.ghost[^{]*\{[^}]*pointer-events:none/);
    expect(FLOORPLAN_CSS).toMatch(/\.ghost[^{]*\{[^}]*stroke:var\(--fp-ghost\)/);
    expect(ghostPart(ghosted({ floor: ground, shift: [0, 0] }))).not.toMatch(/pointer-events|stroke=/);
  });
});
