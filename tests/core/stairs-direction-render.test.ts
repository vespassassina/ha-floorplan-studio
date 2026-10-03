import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { STAIR_DIRECTIONS, type Layout, type StairDirection } from "../../src/core/schema";
import { renderFloor, FLOORPLAN_CSS } from "../../src/core/render";
import { stairDirection } from "../../src/core/stairs";

const L = demo as unknown as Layout;
const ground = L.floors.ground; // one flight, 80 x 160 at x 700..780, y 420..580: it runs along y, 4 steps of 40 cm
const base = { scale: 0.5 };
const ABOVE = { above: true, below: false }, BELOW = { above: false, below: true }, BOTH_SIDES = { above: true, below: true };

/** The stair's group, from a floor with `t` merged into its stair and the neighbours `around`. */
const group = (t: object, around?: { above: boolean; below: boolean }, extra: object = {}) => {
  const f = structuredClone(ground);
  Object.assign(f.stairs[0], t);
  return renderFloor(f, { ...base, around, ...extra }).match(/<g data-s="0"[^>]*>[\s\S]*?<\/g>/)![0];
};
const marks = (g: string) => ({ arrows: [...g.matchAll(/<path class="stair-dir" d="([^"]+)"\/>/g)].map((m) => m[1]), shades: [...g.matchAll(/<(?:rect|path) class="stair-shade"([^>]*)\/>/g)].map((m) => m[1]) });

describe("2D: a stair that goes up is drawn as it always was", () => {
  it("is byte for byte the output with no neighbours given, and carries no mark", () => {
    const f = structuredClone(ground);
    const plain = renderFloor(f, base);
    expect(renderFloor(f, { ...base, around: ABOVE })).toBe(plain);
    expect(renderFloor(f, { ...base, around: BOTH_SIDES })).toBe(plain);
    expect(plain).not.toContain("stair-dir");
    expect(plain).not.toContain("stair-shade");
    f.stairs[0].direction = "up";
    expect(renderFloor(f, { ...base, around: BELOW })).toBe(plain); // explicit up on a top floor
  });
});

describe("2D: a stair that goes down", () => {
  it("shades the steps darker toward the low end and puts one arrow on the axis, its head at the low end", () => {
    const m = marks(group({}, BELOW));
    // the flight climbs toward -y, so the low end is y 580; the arrow runs from 15 % in at the high end to 15 % in at the low end
    expect(m.arrows).toEqual(["M740 444L740 556M732.8 544L740 556L747.2 544"]);
    expect(m.shades.map((s) => [s.match(/ y="([\d.]+)"/)![1], s.match(/opacity="([\d.]+)"/)![1]])).toEqual([["420", "0.25"], ["460", "0.5"], ["500", "0.75"], ["540", "1"]]);
    expect(m.shades[0]).toMatch(/x="700"[^>]*width="80"[^>]*height="40"/);
  });
  it("an explicit down wins on a floor with a floor above", () => {
    expect(marks(group({ direction: "down" }, ABOVE)).arrows).toHaveLength(1);
  });
  it("a flight that runs along x climbs toward +x, so its arrow points at the left end", () => {
    const m = marks(group({ pts: [[0, 0], [200, 0], [200, 50], [0, 50]] }, BELOW));
    expect(m.arrows).toEqual(["M170 25L30 25M42 17.8L30 25L42 32.2"]);
  });
  it("the marks sit inside the rotated group, so they turn with the flight", () => {
    const g = group({ rot: 30 }, BELOW);
    expect(g).toContain('transform="rotate(30 740 500)"');
    expect(marks(g).arrows).toHaveLength(1);
  });
  it("a round stair is shaded as one shape and gets an arc with its head at the start of the climb", () => {
    const pts = Array.from({ length: 24 }, (_, i) => [Math.round(500 + 100 * Math.cos((i * Math.PI) / 12)), Math.round(400 + 100 * Math.sin((i * Math.PI) / 12))]);
    const g = group({ shape: "round", dia: 200, inner: 60, pts }, BELOW);
    const m = marks(g);
    expect(m.shades).toHaveLength(1);
    expect(m.arrows).toHaveLength(1);
    const nums = m.arrows[0].match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(m.arrows[0]).toMatch(/^M[^A]+A65 65 0 0 0 /); // mid radius of the ring, anticlockwise on the screen toward the low end
    // the arc starts at 330 degrees (the high end) and ends at 210 degrees (the low end, the tip)
    expect(nums[0]).toBeCloseTo(500 + 65 * Math.cos((330 * Math.PI) / 180), 1);
    expect(nums[1]).toBeCloseTo(400 + 65 * Math.sin((330 * Math.PI) / 180), 1);
    expect(nums[7]).toBeCloseTo(500 + 65 * Math.cos((210 * Math.PI) / 180), 1);
    expect(nums[8]).toBeCloseTo(400 + 65 * Math.sin((210 * Math.PI) / 180), 1);
  });
});

describe("2D: a stair that goes both ways", () => {
  it("has a head at each end of the axis and no shading", () => {
    const m = marks(group({ direction: "both" }, BOTH_SIDES));
    expect(m.arrows).toEqual(["M740 444L740 556M732.8 544L740 556L747.2 544M747.2 456L740 444L732.8 456"]);
    expect(m.shades).toEqual([]);
  });
});

describe("the direction union is a list of decisions (finding 17)", () => {
  it("each member draws differently, and 'up' draws nothing extra", () => {
    const out = Object.fromEntries(STAIR_DIRECTIONS.map((d) => [d, group({ direction: d }, ABOVE)])) as Record<StairDirection, string>;
    expect(new Set(Object.values(out)).size).toBe(STAIR_DIRECTIONS.length);
    expect(out.up).not.toContain("stair-");
    for (const d of ["down", "both"] as const) expect(out[d], d).toContain("stair-dir");
  });
  it("the card's wiring: stairDirection and the draw agree on the top floor of the demo", () => {
    const top = Object.keys(L.floors).length - 1;
    const t = structuredClone(ground.stairs[0]);
    expect(stairDirection(L, top, t)).toBe("down");
    expect(stairDirection(L, 0, t)).toBe("up");
  });
});

describe("the stylesheet gives the marks their own rules, with --fp-* colours only", () => {
  it("has .stair-dir and .stair-shade that take no clicks", () => {
    expect(FLOORPLAN_CSS).toMatch(/\.stair-dir\{[^}]*stroke:var\(--fp-[a-z-]+\)[^}]*pointer-events:none/);
    expect(FLOORPLAN_CSS).toMatch(/\.stair-shade\{[^}]*fill:var\(--fp-night\)[^}]*pointer-events:none/);
  });
});
