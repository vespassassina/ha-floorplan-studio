import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FLOORPLAN_CSS, OBLIQUE, renderFloor } from "../../src/core/render";
import { collectWalls, deviceSolid, furnitureMode, unlinkedSolid, type Proj } from "../../src/core/solids";
import { furnitureBottom } from "../../src/core/heights";
import type { Floor, Layout } from "../../src/core/schema";

// S28.5: 2.5D contact shadows, baked. One g.shade after the room fills and stairs, before the ghost and the night veil: two stepped bands
// along both sides of every wall run (6 cm at full alpha, 6 cm more at half), and one patch under each standing box.
const R = OBLIQUE.rise, K = OBLIQUE.skew;
const px: Proj = { lift: (p, h) => [p[0] + h * K * R, p[1] - h * R], scr: (p) => p, rise: R, skew: K, cutaway: OBLIQUE.cutaway };
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const bare = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["none", "none", "none", "none"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const deep = (f: Floor, o: object = {}) => renderFloor(f, { scale: 1, view: "2.5d", ...o });
const shade = (svg: string) => /<g class="shade">(.*?)<\/g>/s.exec(svg)?.[1] ?? "";
const polys = (g: string, cls: string) => [...g.matchAll(new RegExp(`<polygon class="${cls}" points="([^"]*)"/>`, "g"))].map((m) => m[1]);

describe("S28.5 2.5D contact shadows", () => {
  it("one wall draws two bands on each side: 6 cm at full alpha then 6 cm at half, from the wall's face", () => {
    // wall kind: the face lies 5 cm from the line, so the bands start at 5 and 11 cm.
    const g = shade(deep(bare({ outline: [], walls: [{ a: [100, 100], b: [300, 100], kind: "wall" }] as never })));
    expect(polys(g, "s1")).toEqual(["100,105 300,105 300,111 100,111", "100,95 300,95 300,89 100,89"]);
    expect(polys(g, "s2")).toEqual(["100,111 300,111 300,117 100,117", "100,89 300,89 300,83 100,83"]);
  });

  it("an external wall's face is 10 cm out; a fence's is the line itself", () => {
    const ext = shade(deep(bare({ outline: [], walls: [{ a: [100, 100], b: [300, 100], kind: "external" }] as never })));
    expect(polys(ext, "s1")[0]).toBe("100,110 300,110 300,116 100,116");
    const fence = shade(deep(bare({ outline: [], walls: [{ a: [100, 100], b: [300, 100], kind: "fence" }] as never })));
    expect(polys(fence, "s1")[0]).toBe("100,100 300,100 300,106 100,106");
  });

  it("a band pair per wall run: four band quads for every wall collectWalls draws, over the demo", () => {
    for (const key of ["ground", "first", "test"]) {
      const f = demo.floors[key]!, n = collectWalls(f, px, "cut").length, g = shade(deep(f));
      expect(n, key).toBeGreaterThan(0);
      expect(polys(g, "s1").length + polys(g, "s2").length, key).toBe(n * 4);
    }
  });

  it("one patch under each furniture box, unlinked box and device body, over the demo", () => {
    for (const key of ["ground", "first"]) {
      const f = structuredClone(demo.floors[key]!);
      f.unlinked = [{ id: "u", type: "other", x: 400, y: 300, rot: 0, scale: 1 }] as never;
      const boxes = f.furniture.filter((m) => furnitureMode(m) === "box" && furnitureBottom(m) < 40).length;
      const unl = (f.unlinked ?? []).filter((u) => unlinkedSolid(u, px)).length;
      const dev = f.devices.filter((d) => deviceSolid(f, d, "", px)).length;
      expect(boxes + unl + dev, key).toBeGreaterThan(0);
      expect(polys(shade(deep(f)), "sp").length, key).toBe(boxes + unl + dev);
    }
  });

  it("the patch is the box's footprint grown by 6 cm on every side, in the order of its corners", () => {
    const f = bare({ furniture: [{ id: "c", symbol: "cabinet", x: 300, y: 250, rot: 0, w: 80, h: 60 }] as never });
    expect(polys(shade(deep(f)), "sp")).toEqual(["254,214 346,214 346,286 254,286"]);
  });

  it("a turned box has a turned patch: 80 x 60 at rot 90 about (300, 250) is 60 wide and 80 tall, grown to 72 x 92", () => {
    const f = bare({ furniture: [{ id: "c", symbol: "cabinet", x: 300, y: 250, rot: 90, w: 80, h: 60 }] as never });
    const [ring] = polys(shade(deep(f)), "sp");
    const p = ring.split(" ").map((q) => q.split(",").map(Number));
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([264, 336, 204, 296]);
  });

  it("no patch under a tree (it has its own), a flat patio, or a piece hung up on a wall", () => {
    const f = bare({ furniture: [
      { id: "t", symbol: "tree", x: 100, y: 100, rot: 0, w: 60, h: 60 }, { id: "p", symbol: "patio-wood", x: 300, y: 100, rot: 0, w: 80, h: 80 },
      { id: "w", symbol: "cabinet", x: 300, y: 300, rot: 0, w: 80, h: 40, z: 140 },
    ] as never });
    expect(shade(deep(f))).toBe("");
  });

  it("the group sits after the room fills and stairs and before the ghost, the night veil and the walls", () => {
    const f = structuredClone(demo.floors.ground!);
    const svg = deep(f, { night: true, ghost: { floor: demo.floors.first!, shift: [0, 0] } });
    const at = (s: string) => svg.indexOf(s);
    const lastFill = svg.lastIndexOf("<polygon data-r="), stairs = at('class="stairs'), g = at('<g class="shade">');
    expect(g).toBeGreaterThan(lastFill);
    if (stairs >= 0) expect(g).toBeGreaterThan(stairs);
    expect(g).toBeLessThan(at('<g class="ghost">'));
    expect(g).toBeLessThan(at("data-night="));
    expect(g).toBeLessThan(at('class="ws'));
    expect(svg.match(/<g class="shade">/g)).toHaveLength(1);
  });

  it("nothing at rise 0, and nothing in 2D: tilt 0 stays the 2D plan", () => {
    const f = structuredClone(demo.floors.ground!);
    expect(deep(f, { tilt: 0 })).not.toContain('class="shade"');
    expect(renderFloor(f, { scale: 1 })).not.toContain('class="shade"');
  });

  it("junk draws nothing and never throws", () => {
    const f = bare({
      walls: [{ a: [Number.NaN, 0], b: [10, 10], kind: "wall" }, { a: [0, 0], b: "x", kind: "wall" }, { a: [5, 5], b: [5, 5], kind: "wall" }] as never,
      furniture: [{ id: "a", symbol: "cabinet", x: Number.NaN, y: 1, rot: 0, w: 10, h: 10 }, { id: "b", symbol: "cabinet", x: 1, y: 1, rot: 0, w: 0, h: 10 }, { id: "c", symbol: "__proto__", x: 1, y: 1, rot: 0, w: 5, h: 5 }] as never,
      unlinked: [{ id: "u", type: "other", x: Number.POSITIVE_INFINITY, y: 0, rot: 0, scale: 1 }] as never,
    });
    let svg = "";
    expect(() => { svg = deep(f); }).not.toThrow();
    expect(shade(svg)).not.toContain("NaN"); // the 2D flat path of a junk piece is older than this and not under test here
    expect(polys(shade(svg), "sp")).toEqual([]);
  });

  it("the stylesheet gives the group its colour, the soft band half the alpha, and no pointer events", () => {
    expect(FLOORPLAN_CSS).toMatch(/\.shade\{[^}]*fill:var\(--fp-shade\)[^}]*pointer-events:none/);
    expect(FLOORPLAN_CSS).toMatch(/\.shade \.s2\{[^}]*fill-opacity:calc\(var\(--fp-shade-alpha\) \/ 2\)/);
  });

  it("5000 pieces of furniture draw in 2.5D in under 2 s, the scene budget's bound, with a patch under each", () => {
    const f = bare({ outline: [[0, 0], [8000, 0], [8000, 6000], [0, 6000]], furniture: Array.from({ length: 5000 }, (_, i) => ({ id: `f${i}`, symbol: "table", x: (i % 100) * 80 + 40, y: Math.floor(i / 100) * 100 + 50, rot: 0, w: 60, h: 60 })) as never });
    const t0 = performance.now(), svg = deep(f), ms = performance.now() - t0;
    expect(polys(shade(svg), "sp")).toHaveLength(5000);
    expect(ms, `${Math.round(ms)} ms`).toBeLessThan(2000);
  });
});
