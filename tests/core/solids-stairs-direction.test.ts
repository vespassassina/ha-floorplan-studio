import { describe, it, expect } from "vitest";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import { STAIR_DIRECTIONS, type Floor, type StairDirection } from "../../src/core/schema";

const R = OBLIQUE.rise, K = OBLIQUE.skew;
const n = (v: number) => String(Math.round(v * 100) / 100);
/** Where plan (x, y) at height h is drawn on an unturned plan. */
const P = (x: number, y: number, h: number) => `${n(x + h * K * R)},${n(y - h * R)}`;
const ring = (xy: [number, number][], h: number) => xy.map(([x, y]) => P(x, y, h)).join(" ");
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["none", "none", "none", "none"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
/** A flight along y, 100 x 200 cm, five steps of 40 cm; it rises toward -y (the top of the plan), so its low end is the south. */
const flight = (o: Record<string, unknown>) => floor({ stairs: [{ id: "s", name: "S", pts: [[100, 100], [200, 100], [200, 300], [100, 300]], shape: "straight", steps: 5, rot: 0, ...o }] as never });
const deep = (f: Floor, around?: { above: boolean; below: boolean }) => renderFloor(f, { scale: 1, view: "2.5d", around });
const polys = (html: string, cls: string) => [...html.matchAll(new RegExp(`<polygon class="${cls}"(?: opacity="[^"]*")? points="([^"]*)"/>`, "g"))].map((m) => m[1]);
const tops = (html: string) => polys(html, "bt");
const TOP = { above: true, below: false }, BELOW = { above: false, below: true };

/** What the well and the rim are made of; the numbers are written out here, not read from the code (they are cm). */
const WELL_DEPTH = 60, RIM_DOWN = 6, RIM_BOTH = 10;

describe("2.5D: a stair that goes up is what it was", () => {
  it("is byte for byte the output with no neighbours given", () => {
    const f = flight({});
    expect(deep(f, TOP)).toBe(deep(f));
    expect(deep(f, { above: true, below: true })).toBe(deep(f));
    expect(tops(deep(f)).length).toBe(5);
  });
});

describe("2.5D: a stair that goes down is a stairwell, not a tower", () => {
  const html = deep(flight({}), BELOW);

  it("draws no block: nothing rises, and no polygon reaches the storey height", () => {
    expect(tops(html)).toEqual([]);
    expect(html).not.toContain(P(100, 100, 250));
    expect(html).not.toContain(P(200, 300, 50));
  });
  it("sinks one tread per step, the lowest at the full depth and the one at the floor edge a step down", () => {
    const t = polys(html, "well-tread");
    expect(t).toHaveLength(5);
    for (let k = 0; k < 5; k++) {
      const y1 = 300 - k * 40, z = -WELL_DEPTH + (k * WELL_DEPTH) / 5;
      expect(t, `step ${k}`).toContain(ring([[100, y1 - 40], [200, y1 - 40], [200, y1], [100, y1]], z));
    }
  });
  it("shows the risers that face the viewer, between one tread and the next", () => {
    const r = polys(html, "well-riser");
    expect(r).toHaveLength(4); // the lowest step has none: nothing lies below it
    // step 2's low edge is y 220, from the tread at -36 down to the one at -48
    expect(r).toContain([P(200, 220, -48), P(100, 220, -48), P(100, 220, -36), P(200, 220, -36)].join(" "));
  });
  it("turned away, the same flight shows its treads and no risers", () => {
    const away = deep(flight({ rot: 180 }), BELOW);
    expect(polys(away, "well-tread")).toHaveLength(5);
    expect(polys(away, "well-riser")).toEqual([]);
  });
  it("draws the inner walls the viewer sees across the opening, down to the full depth", () => {
    const w = polys(html, "well-wall");
    expect(w).toHaveLength(2); // the north and the east edge face away from the camera
    expect(w).toContain([P(200, 100, 0), P(200, 300, 0), P(200, 300, -WELL_DEPTH), P(200, 100, -WELL_DEPTH)].join(" "));
    expect(w).toContain([P(100, 100, 0), P(200, 100, 0), P(200, 100, -WELL_DEPTH), P(100, 100, -WELL_DEPTH)].join(" "));
  });
  it("draws a short rim along the near edges, the south and the west", () => {
    const r = polys(html, "well-rim");
    expect(r).toHaveLength(2);
    expect(r).toContain([P(200, 300, 0), P(100, 300, 0), P(100, 300, RIM_DOWN), P(200, 300, RIM_DOWN)].join(" "));
    expect(r).toContain([P(100, 300, 0), P(100, 100, 0), P(100, 100, RIM_DOWN), P(100, 300, RIM_DOWN)].join(" "));
  });
  it("keeps the flat stairs group under it, for the click and for the shading", () => {
    expect(html).toContain('data-s="0"');
    expect(html).toContain("stair-shade");
  });
  it("an explicit down wins on a floor with a floor above, and a round stair is a well too", () => {
    expect(polys(deep(flight({ direction: "down" }), TOP), "well-tread")).toHaveLength(5);
    const round = deep(flight({ direction: "down", shape: "round", dia: 160, inner: 40, pts: [[120, 70], [280, 70], [280, 230], [120, 230]] }), TOP);
    expect(polys(round, "well-tread")).toHaveLength(8);
    expect(tops(round)).toEqual([]);
  });
});

describe("2.5D: a stair that goes both ways rises and keeps a low rim", () => {
  const html = deep(flight({ direction: "both" }), { above: true, below: true });
  it("rises exactly as an up stair does", () => {
    const up = tops(deep(flight({}), TOP));
    expect(tops(html).filter((q) => up.includes(q))).toEqual(up);
    expect(tops(html)).toContain(ring([[100, 100], [200, 100], [200, 140], [100, 140]], 250));
  });
  it("adds a rim round the foot, a few cm out and RIM_BOTH high", () => {
    const lids = tops(html).filter((q) => !tops(deep(flight({}), TOP)).includes(q));
    expect(lids).toHaveLength(4); // one segment per side
    // the south side: the foot's edge (200,300)-(100,300) out to 6 cm beyond it, mitred at the corners
    expect(lids).toContain(ring([[200, 300], [100, 300], [94, 306], [206, 306]], RIM_BOTH));
    expect(lids).toContain(ring([[100, 100], [200, 100], [206, 94], [94, 94]], RIM_BOTH));
  });
});

describe("the direction union is a list of decisions (finding 17)", () => {
  it("each member draws differently in 2.5D", () => {
    const out = STAIR_DIRECTIONS.map((d: StairDirection) => deep(flight({ direction: d }), TOP));
    expect(new Set(out).size).toBe(STAIR_DIRECTIONS.length);
  });
  it("an untrusted staircase with a direction does not throw, whatever it says", () => {
    for (const d of ["down", "both", "sideways", 5, null]) expect(() => deep(flight({ direction: d, pts: [[NaN, 1], [2, 2]] }), BELOW)).not.toThrow();
    for (const d of ["down", "both"]) expect(() => deep(flight({ direction: d, rot: NaN }), BELOW)).not.toThrow();
  });
});
