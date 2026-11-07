import { describe, it, expect } from "vitest";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import { buildScene, type Solid } from "../../src/core/scene";
import { FURNITURE_HEIGHTS, furnitureHeight } from "../../src/core/heights";
import { boxOf } from "../../src/core/polygon";
import type { Floor, Pt } from "../../src/core/schema";

// B54.2, spec item 21 and criterion 4: a worktop draws from its `pts` in 2D, 2.5D and 3D, to 90 cm; `color` overrides.
// Asymmetric points on purpose (finding 4): a box drawn from x, y, w and h would pass a symmetric ring.
const R = OBLIQUE.rise, K = OBLIQUE.skew;
const n = (v: number) => String(Math.round(v * 100) / 100);
const ring = (k: number): Pt[] => Array.from({ length: k }, (_, i) => [300 + 120 * Math.cos((2 * Math.PI * i) / k) + i, 250 + 50 * Math.sin((2 * Math.PI * i) / k)] as Pt);
const L: Pt[] = [[100, 100], [400, 100], [400, 160], [160, 160], [160, 330], [100, 330]];
const worktop = (pts: Pt[], extra: Record<string, unknown> = {}) => ({ id: "wt", symbol: "worktop", ...boxOf(pts), rot: 0, pts, ...extra });
const floor = (m: unknown): Floor => ({ title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["none", "none", "none", "none"], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [m], unlinked: [] }) as unknown as Floor;
const flat = (m: unknown) => renderFloor(floor(m), { scale: 1 });
const deep = (m: unknown) => renderFloor(floor(m), { scale: 1, view: "2.5d" });
const prismOf = (s: Solid) => { if (s.shape.type !== "prism") throw new Error("not a prism"); return s.shape; };

/** The symbol's path, mapped back to plan cm through the group's own transform: translate(x y) rotate(r) scale(w/100 h/100) translate(-50 -50). */
function planPoints(html: string): Pt[] {
  const g = /<g data-f="0"[^>]*transform="translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\) scale\(([-\d.]+) ([-\d.]+)\) translate\(-50 -50\)"[^>]*>(.*?)<\/g>/.exec(html);
  expect(g, "the worktop's group").not.toBeNull();
  const [, tx, ty, rot, sx, sy, body] = g!;
  expect(+rot).toBe(0);
  const d = /<path d="([^"]+)"/.exec(body)![1];
  return [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [(+m[1] - 50) * +sx + +tx, (+m[2] - 50) * +sy + +ty] as Pt);
}
// The group's scale is written to 0.01 (`num`), so a 300 cm piece can be 0.3 cm off in the plan. Under 0.5 cm is the same place at any zoom.
const close = (a: Pt[], b: Pt[]) => { expect(a).toHaveLength(b.length); a.forEach((p, i) => { expect(Math.abs(p[0] - b[i][0]), `x${i}`).toBeLessThan(0.5); expect(Math.abs(p[1] - b[i][1]), `y${i}`).toBeLessThan(0.5); }); };

describe("worktop in 2D", () => {
  it("draws its points, for 3, 6 and 64 of them and an L", () => {
    for (const pts of [ring(3), ring(6), ring(64), L]) close(planPoints(flat(worktop(pts))), pts);
  });
  it("follows pts even when a hand-edited file leaves rot on it", () => {
    close(planPoints(flat(worktop(L, { rot: 0 }))), L);
    const html = flat(worktop(L, { rot: 40 }));
    expect(html).toContain("rotate(0)");
    close(planPoints(html), L);
  });
  it("is filled like a piece of furniture, and its colour overrides", () => {
    expect(flat(worktop(L))).toMatch(/<g data-f="0" class="furn"[^>]*>.*class="ff"/);
    const painted = flat(worktop(L, { color: "#c03030" }));
    expect(painted).toContain("fpaint");
    expect(painted).toContain("#c03030");
  });
  it("without usable points still draws, as its box, and never throws", () => {
    for (const bad of [undefined, 5, [], [[0, 0]], [[0, 0], [1, NaN], [2, 2]], "x"]) {
      const html = flat({ ...worktop(L), pts: bad });
      expect(html).toContain('data-f="0"');
      expect(() => deep({ ...worktop(L), pts: bad })).not.toThrow();
    }
  });
});

describe("worktop in 2.5D", () => {
  it("is a prism of its points to 90 cm: the lid is the points lifted, one lid", () => {
    const html = deep(worktop(L));
    const lift = (p: Pt) => `${n(p[0] + 90 * K * R)},${n(p[1] - 90 * R)}`;
    const lids = [...html.matchAll(/<polygon class="bt" points="([^"]*)"\/>/g)].map((m) => m[1]);
    expect(lids).toEqual([L.map(lift).join(" ")]);
    expect(html).toContain('class="bs');
  });
  it("lifts a 3, a 6 and a 64 point worktop to the same 90", () => {
    for (const pts of [ring(3), ring(6), ring(64)]) {
      const lids = [...deep(worktop(pts)).matchAll(/<polygon class="bt" points="([^"]*)"\/>/g)].map((m) => m[1]);
      expect(lids, String(pts.length)).toHaveLength(1);
      expect(lids[0].split(" ")).toHaveLength(pts.length);
      expect(lids[0].split(" ")[0]).toBe(`${n(pts[0][0] + 90 * K * R)},${n(pts[0][1] - 90 * R)}`);
    }
  });
  it("its own height wins", () => {
    const lids = [...deep(worktop(L, { height: 40 })).matchAll(/<polygon class="bt" points="([^"]*)"\/>/g)].map((m) => m[1]);
    expect(lids[0].split(" ")[0]).toBe(`${n(L[0][0] + 40 * K * R)},${n(L[0][1] - 40 * R)}`);
  });
});

describe("worktop in 3D", () => {
  it("is one prism over its points, floor to 90", () => {
    for (const pts of [ring(3), ring(6), ring(64), L]) {
      const sol = buildScene(floor(worktop(pts))).solids.filter((s) => s.kind === "furniture");
      expect(sol, String(pts.length)).toHaveLength(1);
      const p = prismOf(sol[0]);
      expect(p.base).toEqual(pts);
      expect([p.z0, p.z1]).toEqual([0, 90]);
      expect(sol[0].tag).toBe("worktop");
    }
  });
  it("its colour paints the prism", () => {
    const sol = buildScene(floor(worktop(L, { color: "#c03030" }))).solids.filter((s) => s.kind === "furniture");
    expect(sol[0].paint.color).toBe("#c03030");
  });
  it("without usable points it is its bounding box, and nothing throws", () => {
    const sol = buildScene(floor({ ...worktop(L), pts: 5 })).solids.filter((s) => s.kind === "furniture");
    expect(sol).toHaveLength(1);
    expect(prismOf(sol[0]).base).toHaveLength(4);
  });
});

describe("worktop height", () => {
  it("is 90 by default", () => {
    expect(FURNITURE_HEIGHTS.worktop).toBe(90);
    expect(furnitureHeight(worktop(L) as never)).toBe(90);
  });
});
