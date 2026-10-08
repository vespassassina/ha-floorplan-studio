import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Layout } from "../../src/core/schema";
import { migrate } from "../../src/core";
import { NAME_MIN_PX, renderFloor } from "../../src/core/render";

// S23.2 (V1): `px`, screen px per plan unit, puts a floor under names (11 px) and device discs (28 px) in renderFloor
// itself, so the editor and the card draw from one path (finding 8). The card's measured run is card-label-floor.spec.ts.

const demo = migrate(JSON.parse(readFileSync("demo/layout.json", "utf8"))) as Layout;
const f = demo.floors.ground;
const names = (html: string) => [...html.matchAll(/<text [^>]*data-rl="\d+"[^>]*font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
const discK = (html: string) => [...html.matchAll(/<g data-x="\d+"[^>]* transform="translate\([-\d.]+ [-\d.]+\) scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));

describe("S23.2: a floor in screen space", () => {
  it("is 11 px", () => expect(NAME_MIN_PX).toBe(11));

  it("without px, or with a px that is not a positive finite number, nothing changes", () => {
    const plain = renderFloor(f, { scale: 1 });
    for (const px of [undefined, 0, -1, NaN, Infinity, "0.2" as unknown as number]) expect(renderFloor(f, { scale: 1, px }), String(px)).toBe(plain);
  });

  it("a big enough px changes nothing: the floor only lifts what would fall under it", () => {
    expect(renderFloor(f, { scale: 1, px: 3 })).toBe(renderFloor(f, { scale: 1 }));
  });

  for (const px of [0.3, 0.2, 0.12]) {
    it(`at ${px} px per unit no room name is under 11 px and no disc under 28`, () => {
      const html = renderFloor(f, { scale: 1, px });
      const ns = names(html), ks = discK(html);
      expect(ns.length).toBeGreaterThan(3);
      expect(ks.length).toBeGreaterThan(3);
      for (const s of ns) expect(s * px).toBeGreaterThanOrEqual(11 - 0.01);
      for (const k of ks) expect(32 * k * px).toBeGreaterThanOrEqual(28 - 0.01);
      // Without the floor the same plan is under it: the test is not passing on the plan's own sizes.
      expect(Math.min(...names(renderFloor(f, { scale: 1 }))) * px).toBeLessThan(11);
    });
  }
});
