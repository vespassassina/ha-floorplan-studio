import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { buildScene } from "../../src/core/scene";

// S12 review finding S5: "never hangs". A layout is untrusted input; the scene builder must stay inside a time budget on
// rooms with many points and on many rooms. The bounds are generous (a loaded CI box) and far below the seconds the
// quadratic code took (9 s for the nested case, measured by the reviewer on 2026-10-05).
const circle = (cx: number, cy: number, r: number, n: number) => Array.from({ length: n }, (_, k) => [Math.round((cx + r * Math.cos((k / n) * 2 * Math.PI)) * 10) / 10, Math.round((cy + r * Math.sin((k / n) * 2 * Math.PI)) * 10) / 10]);
const floorOf = (rooms: unknown[]) => ({ ...structuredClone(demo.floors.ground), rooms, doors: [], openings: [], devices: [], walls: [], furniture: [], stairs: [], unlinked: [] });

describe("scene builder time budget", () => {
  it("150 nested rooms of 400 points each build in under 2 s, with every fill at one height", () => {
    const rooms = Array.from({ length: 150 }, (_, i) => ({ id: `n${i}`, kind: "room", name: `n${i}`, pts: circle(445, 310, 20 + i * 2, 400), wk: Array(400).fill("none") }));
    const t = performance.now();
    const scene = buildScene(floorOf(rooms) as never);
    const ms = performance.now() - t;
    expect(ms, `took ${Math.round(ms)} ms`).toBeLessThan(2000);
    const fills = scene.solids.filter((s) => s.kind === "room");
    expect(fills.length).toBe(150);
    expect(new Set(fills.map((s) => (s.shape.type === "prism" ? s.shape.z0 : -1))).size).toBe(1); // over the nest budget: no nesting, as past 300 rooms
  });

  it("5000 rooms on a grid build in under 2 s", () => {
    const rooms = Array.from({ length: 5000 }, (_, i) => { const x = (i % 100) * 60, y = Math.floor(i / 100) * 60; return { id: `g${i}`, kind: "room", name: `g${i}`, pts: [[x, y], [x + 60, y], [x + 60, y + 60], [x, y + 60]], wk: ["wall", "wall", "wall", "wall"] }; });
    const t = performance.now();
    const scene = buildScene(floorOf(rooms) as never);
    const ms = performance.now() - t;
    expect(ms, `took ${Math.round(ms)} ms`).toBeLessThan(2000);
    expect(scene.solids.length).toBeGreaterThan(5000);
  });

  it("a small nested layout still nests: the budget is for the pathological case only", () => {
    const rooms = [
      { id: "big", kind: "room", name: "big", pts: [[0, 0], [400, 0], [400, 400], [0, 400]], wk: ["wall", "wall", "wall", "wall"] },
      { id: "in", kind: "room", name: "in", pts: [[100, 100], [200, 100], [200, 200], [100, 200]], wk: ["wall", "wall", "wall", "wall"] },
    ];
    const z0 = (id: string) => { const s = buildScene(floorOf(rooms) as never).solids.find((x) => x.id === id); return s && s.shape.type === "prism" ? s.shape.z0 : NaN; };
    expect(z0("room:1")).toBeGreaterThan(z0("room:0"));
  });
});
