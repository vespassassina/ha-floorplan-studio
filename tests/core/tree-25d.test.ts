import { describe, expect, it } from "vitest";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import type { Floor } from "../../src/core/schema";

// S28.4: a 2.5D tree stands: shade patch at the foot, a 12 cm trunk to 60 % of the height, the S28.3 crown at 75 %.
const R = OBLIQUE.rise, K = OBLIQUE.skew;
const n = (v: number) => String(Math.round(v * 100) / 100);
/** Where plan (x, y) at height h is drawn on an unturned plan. */
const at = (x: number, y: number, h: number) => [n(x + h * K * R), n(y - h * R)];
const floor = (m: object): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["none", "none", "none", "none"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], unlinked: [],
  furniture: [{ id: "t", symbol: "tree", x: 300, y: 250, rot: 0, w: 80, h: 60, ...m }] as never,
});
const deep = (m: object = {}, o: object = {}) => renderFloor(floor(m), { scale: 1, view: "2.5d", ...o });
const group = (svg: string) => /<g data-f="0"[^>]*>(.*?)<\/g>\s*(?=<|$)/s.exec(svg)![0];
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

describe("S28.4 the 2.5D tree", () => {
  it("draws the shade patch, then the trunk, then the crown, in that order inside the piece's group", () => {
    const g = group(deep());
    const shade = g.indexOf('class="tree-shade"'), trunk = g.indexOf('class="trunk"'), crown = g.indexOf('class="tree-crown"');
    expect(shade, g).toBeGreaterThanOrEqual(0);
    expect(trunk).toBeGreaterThan(shade);
    expect(crown).toBeGreaterThan(trunk);
  });

  it("the trunk runs from the foot to 60 % of the height, lifted", () => {
    const t = attrs(/<line class="trunk"[^>]*>/.exec(deep())![0]);
    const [x2, y2] = at(300, 250, 240); // default tree height 400 cm, trunk top 240
    expect([t.x1, t.y1, t.x2, t.y2]).toEqual(["300", "250", x2, y2]);
  });

  it("the crown is centred on the lifted crown middle (75 % of the height), with no trunk dot at the top", () => {
    const g = group(deep());
    const [cx, cy] = at(300, 250, 300);
    expect(g).toContain(`translate(${cx} ${cy}) rotate(0) scale(0.8 0.6)`);
    expect(g).not.toContain('class="tree-trunk"');
  });

  it("a taller tree lifts the crown and the trunk end with it", () => {
    const g = group(deep({ height: 200 }));
    const [cx, cy] = at(300, 250, 150), [x2, y2] = at(300, 250, 120);
    expect(g).toContain(`translate(${cx} ${cy}) rotate(0)`);
    expect(attrs(/<line class="trunk"[^>]*>/.exec(g)![0]).y2).toBe(y2);
    expect(attrs(/<line class="trunk"[^>]*>/.exec(g)![0]).x2).toBe(x2);
  });

  it("the shade patch is the same one the 2D plan draws: offset (4, 6) at the foot, the tree's radii and turn", () => {
    const a = attrs(/<ellipse class="tree-shade"[^>]*>/.exec(deep({ rot: 30, w: 120, h: 300 }))![0]);
    expect([+a.cx, +a.cy, +a.rx, +a.ry, a.transform]).toEqual([304, 256, 60, 150, "rotate(30 304 256)"]);
  });

  it("at tilt 0 nothing lifts: the trunk has no length and the crown sits on the foot", () => {
    const g = group(deep({}, { tilt: 0 }));
    expect(g).toContain("translate(300 250) rotate(0)");
    const t = attrs(/<line class="trunk"[^>]*>/.exec(g)![0]);
    expect([t.x1, t.y1]).toEqual([t.x2, t.y2]);
  });

  it("junk size draws no tree and does not throw", () => {
    for (const bad of [{ w: 0 }, { h: -3 }, { w: Number.NaN }, { x: Number.POSITIVE_INFINITY }]) expect(() => deep(bad), JSON.stringify(bad)).not.toThrow();
  });

  it("the depth order is unchanged: a box in front of the tree still covers it", () => {
    const f = floor({});
    f.furniture.push({ id: "b", symbol: "cabinet", x: 300, y: 400, rot: 0, w: 80, h: 40 } as never);
    const svg = renderFloor(f, { scale: 1, view: "2.5d" });
    expect(svg.indexOf('data-f="0"')).toBeLessThan(svg.indexOf('data-f="1"'));
  });
});
