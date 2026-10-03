import { describe, it, expect } from "vitest";
import { renderFloor } from "../../src/core/render";
import type { Floor } from "../../src/core/schema";

// Diego, 2026-10-03, on 0.12.21: the stairs going down "are overlapping weirdly" - dark stripes over walls and the
// floor. A well is a hole in the floor: its ground, walls and treads lie below everything that stands on the floor, so
// they are drawn before every wall, whatever the depth sort says. Only the rim (it stands 6 cm up) sorts with the rest.
const floor = (): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"],
  rooms: [{ id: "r", name: "R", kind: "room", pts: [[0, 0], [600, 0], [600, 500], [0, 500]], wk: ["wall", "wall", "wall", "wall"] }] as never,
  walls: [{ id: "w1", a: [50, 50], b: [550, 50], kind: "wall" }, { id: "w2", a: [50, 450], b: [550, 450], kind: "wall" }, { id: "w3", a: [60, 100], b: [60, 400], kind: "wall" }] as never,
  stairs: [{ id: "s", name: "S", pts: [[100, 100], [200, 100], [200, 300], [100, 300]], shape: "straight", steps: 5, rot: 0, direction: "down" }] as never,
  doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [],
});
const last = (html: string, s: string) => html.lastIndexOf(s);

describe("a stairwell lies under every wall, whatever the turn", () => {
  for (const deg of [0, 45, 90, 180, 270]) {
    it(`turned ${deg}: every well piece but the rim is drawn before the first wall`, () => {
      const html = renderFloor(floor(), { scale: 1, view: "2.5d", rotate: deg ? { deg, pivot: [300, 250] } : undefined });
      const wall = html.indexOf('<polygon class="ws');
      expect(wall).toBeGreaterThan(0);
      for (const cls of ["well-floor", "well-wall", "well-tread", "well-riser", "well-edge"]) {
        if (cls !== "well-riser") expect(html, cls).toContain(cls); // turned away, the risers face off and are not drawn
        expect(last(html, `class="${cls}"`), cls).toBeLessThan(wall);
      }
      expect(html.indexOf("<clipPath")).toBeLessThan(wall);
    });
  }
  it("the hole's border is drawn over the treads, so no tread edge pokes over it", () => {
    const html = renderFloor(floor(), { scale: 1, view: "2.5d" });
    expect(html.indexOf('class="well-edge"')).toBeGreaterThan(last(html, 'class="well-tread"'));
  });
});
