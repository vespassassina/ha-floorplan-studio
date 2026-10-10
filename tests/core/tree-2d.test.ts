import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FLOORPLAN_CSS, renderFloor } from "../../src/core/render";
import { FURNITURE } from "../../src/core/icons";
import type { Floor, Layout } from "../../src/core/schema";

// S28.3: a 2D tree is a crown (an 8-lobed outline), a trunk dot and a soft shade patch; colours come from classes, never attributes.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const withTree = (extra: object = {}, many = false): Floor => {
  const f = structuredClone(demo.floors.ground!);
  f.furniture = [{ id: "t", symbol: "tree", x: 500, y: 400, rot: 30, w: 120, h: 300, ...extra } as never];
  if (many) f.furniture.push({ id: "u", symbol: "tree", x: 100, y: 100, rot: 0, w: 60, h: 60 } as never);
  return f;
};
const svgOf = (f: Floor) => renderFloor(f, { scale: 0.5 });
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

describe("S28.3 the 2D tree", () => {
  it("the symbol is a crown of 8 lobes and a trunk dot, with no colour attribute", () => {
    const sym = FURNITURE.tree.svg;
    const crown = /<path class="tree-crown"[^>]*d="([^"]+)"/.exec(sym);
    expect(crown, sym).not.toBeNull();
    expect(crown![1].match(/A/g)).toHaveLength(8);
    expect(sym).toMatch(/<circle class="tree-trunk"/);
    expect(sym).not.toMatch(/fill=|stroke=|class="ff"/);
  });

  it("draws the shade patch outside the scaled group, offset by exactly (4, 6) cm for a 120 x 300 tree at rot 30", () => {
    const svg = svgOf(withTree());
    const patch = /<ellipse class="tree-shade"[^>]*>/.exec(svg)?.[0];
    expect(patch, svg.slice(0, 200)).toBeDefined();
    const a = attrs(patch!);
    expect([+a.cx, +a.cy, +a.rx, +a.ry]).toEqual([504, 406, 60, 150]);
    expect(a.transform).toBe("rotate(30 504 406)");
    // under the crown: before the piece's group, which is the one that carries the scale
    expect(svg.indexOf(patch!)).toBeLessThan(svg.indexOf('data-f="0"'));
    expect(/<g data-f="0"[^>]*>/.exec(svg)![0]).toContain("scale(1.2 3)");
  });

  it("the patch offset is (4, 6) whatever w, h and rot are", () => {
    for (const [w, h, rot] of [[200, 200, 0], [50, 70, 20], [400, 90, 270], [10, 10, 359]]) {
      const a = attrs(/<ellipse class="tree-shade"[^>]*>/.exec(svgOf(withTree({ w, h, rot })))![0]);
      expect([+a.cx - 500, +a.cy - 400], `${w}x${h}@${rot}`).toEqual([4, 6]);
    }
  });

  it("one patch per tree, none for another symbol, none for junk", () => {
    expect(svgOf(withTree({}, true)).match(/class="tree-shade"/g)).toHaveLength(2);
    expect(svgOf(withTree({ symbol: "table" }))).not.toContain("tree-shade");
    for (const junk of [{ w: 0 }, { w: NaN }, { h: "x" }, { w: -4 }, { x: NaN }, { rot: NaN }])
      expect(() => svgOf(withTree(junk)), JSON.stringify(junk)).not.toThrow();
    expect(svgOf(withTree({ w: 0 }))).not.toContain("tree-shade");
  });

  it("escapes a payload in the entity, the id and the symbol", () => {
    const evil = '"><script>';
    const svg = svgOf(withTree({ entity: evil, id: evil, name: evil }));
    expect(svg).not.toContain("<script");
  });

  it("the stylesheet gives the classes their colours through tokens", () => {
    expect(FLOORPLAN_CSS).toMatch(/\.tree-crown\{[^}]*fill:var\(--fp-tree\)[^}]*fill-opacity:\.35/);
    expect(FLOORPLAN_CSS).toMatch(/\.tree-crown\{[^}]*stroke:var\(--fp-tree-edge\)/);
    expect(FLOORPLAN_CSS).toMatch(/\.tree-shade\{[^}]*fill:var\(--fp-shade\)[^}]*pointer-events:none/);
  });
});
