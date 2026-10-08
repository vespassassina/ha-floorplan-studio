import { describe, it, expect } from "vitest";
import { glowAt, GLOW_REACH, facing, glowGrid, outwardSign, type RoomShape } from "../../src/card/three/light";

// Pure maths of the wall glow (3D lamp light on the walls of its own room). Frame: the plan's, cm. No three.js here.
const sq = (x: number, y: number, w: number, h: number) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const living = sq(0, 0, 500, 400);

describe("glowAt: how much of the lamp's light reaches a point of a wall", () => {
  it("is brightest at the lamp, falls with the distance, and is nothing at the reach and beyond", () => {
    expect(GLOW_REACH).toBe(300);
    const near = glowAt(50, 50), mid = glowAt(150, 150), far = glowAt(280, 280);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(glowAt(300, 300)).toBe(0);
    expect(glowAt(900, 900)).toBe(0);
    expect(glowAt(0, 0)).toBeLessThanOrEqual(1);
  });
  it("is dimmer on a point seen at a grazing angle than head on, at the same distance (asymmetric: 200 away, 20 across vs 190 across)", () => {
    expect(glowAt(200, 190)).toBeGreaterThan(glowAt(200, 20));
  });
  it("never throws and never gives NaN on junk", () => {
    for (const v of [NaN, Infinity, -5, undefined as unknown as number]) { const g = glowAt(v, v); expect(Number.isFinite(g)).toBe(true); expect(g).toBeGreaterThanOrEqual(0); }
  });
});

describe("facing: the side of a wall face that looks into the lamp's room", () => {
  const lamp: [number, number] = [250, 200];
  // A wall slab is a ring; each edge of it is a face, and the ring's winding says which way is out (outwardSign).
  const shared = [[495, 0], [505, 0], [505, 400], [495, 400]], north = [[0, -5], [500, -5], [500, 5], [0, 5]];
  it("gives the inward normal of the room's own face, and nothing for the other side of the same wall", () => {
    // a wall centred on x=500, 10 cm thick: its west face (x=495) looks into the living room, its east face (x=505) into the kitchen
    const s = outwardSign(shared);
    expect(facing([495, 400], [495, 0], s, living, lamp)?.n).toEqual([-1, 0]);
    expect(facing([505, 0], [505, 400], s, living, lamp)).toBeNull();
    // the north wall's south face, and the outside of the same wall
    const n = outwardSign(north);
    expect(facing([500, 5], [0, 5], n, living, lamp)?.n).toEqual([0, 1]);
    expect(facing([0, -5], [500, -5], n, living, lamp)).toBeNull();
  });
  it("is the same whichever way the ring is wound", () => {
    const rev = [...shared].reverse(), s = outwardSign(rev);
    expect(s).toBe(-outwardSign(shared));
    expect(facing([495, 0], [495, 400], s, living, lamp)?.n).toEqual([-1, 0]);
  });
  it("gives nothing for a face the lamp is behind, and for a degenerate edge", () => {
    expect(facing([495, 400], [495, 0], 1, living, [600, 200])).toBeNull();
    expect(facing([10, 10], [10, 10], 1, living, lamp)).toBeNull();
    expect(facing([NaN, 0], [495, 400], 1, living, lamp)).toBeNull();
  });
  it("keeps a lamp 3 cm from the wall off the face that is inside the wall's own thickness (the true normal, not 'toward the lamp')", () => {
    expect(facing([505, 0], [505, 400], 1, living, [498, 200])).toBeNull();
    expect(facing([495, 400], [495, 0], 1, living, [498, 200])).toBeNull(); // the lamp is east of this face: behind it
  });
});

describe("facing: which stretch of a face is lit (the lamp's own room, not the whole face)", () => {
  const A: RoomShape = { index: 0, base: sq(0, 0, 500, 400), top: 250, area: 200000 };
  const C: RoomShape = { index: 1, base: sq(500, 0, 500, 400), top: 250, area: 200000 };
  // The outline's south edge, one 1000 cm face shared by both rooms, wound so that (dy, -dx) points out: the inner face looks north, up the plan (y down).
  const south = (lamp: [number, number], room: number, rooms = [A, C]) => facing([1000, 395], [0, 395], -1, rooms[room].base, lamp, rooms, room);
  const spanOf = (r: ReturnType<typeof facing>) => r?.spans.map(([u0, u1]) => [Math.round(u0), Math.round(u1)]);
  it("a lamp in C lights only C's stretch of the outline face: x 500..1000, nothing of A's 0..500", () => {
    const r = south([600, 200], 1);
    expect(r?.n).toEqual([0, -1]);
    // the face runs from x=1000 (u 0) to x=0 (u 1000), so C's stretch is u 0..500
    expect(spanOf(r)).toEqual([[0, 500]]);
  });
  it("a lamp in A lights its own stretch, x 0..500 (u 500..1000), and not C's", () => {
    expect(spanOf(south([250, 200], 0))).toEqual([[500, 1000]]);
  });
  it("the spans are the part of the face the old midpoint test got wrong: the old rule lit x 407..793 for a lamp at x=600, 93 cm of it inside A", () => {
    const r = south([600, 200], 1)!;
    for (const [u0, u1] of r.spans) { expect(1000 - u0).toBeGreaterThanOrEqual(500); expect(1000 - u1).toBeGreaterThanOrEqual(500); }
  });
  it("a face wholly in the lamp's room is one span, wholly in another room none", () => {
    expect(spanOf(facing([500, 5], [0, 5], 1, A.base, [250, 200], [A, C], 0))).toEqual([[0, 500]]);
    expect(facing([500, 5], [0, 5], 1, A.base, [250, 200], [A, C], 1)).toBeNull();
  });
  it("without the room check a face that faces the lamp but lies in another room is refused: the kitchen's own west face at x=520, the lamp in the living room", () => {
    // normal -x (toward the lamp at x=250), its front point (518, y) is in the kitchen, not the living room
    expect(facing([520, 0], [520, 400], -1, A.base, [250, 200])).toBeNull();
    expect(facing([520, 400], [520, 0], -1, A.base, [250, 200], [A, C], 0)).toBeNull();
  });
  it("a face of a room nested in the lamp's room is not lit through the inner room: it belongs to the room that holds its front", () => {
    const inner: RoomShape = { index: 2, base: sq(100, 100, 100, 100), top: 270, area: 10000 };
    const outer: RoomShape = { index: 0, base: sq(0, 0, 500, 400), top: 250, area: 200000 };
    // the inner room's west wall, its inner face at x=100 looking east into the inner room, the lamp in the outer room at (150, 50), east of it
    expect(facing([100, 200], [100, 100], -1, outer.base, [150, 50])?.n).toEqual([1, 0]); // the old rule: the inner room is inside the outer polygon
    expect(facing([100, 200], [100, 100], -1, outer.base, [150, 50], [outer, inner], 0)).toBeNull();
    // the outer face of the same wall (x=95, looking west into the outer room) is the outer room's
    expect(facing([100, 100], [100, 200], -1, outer.base, [50, 150], [outer, inner], 0)?.n).toEqual([-1, 0]);
    // and a lamp in the inner room lights the inner face
    expect(facing([100, 200], [100, 100], -1, inner.base, [150, 150], [outer, inner], 2)?.n).toEqual([1, 0]);
  });
  it("never throws on junk", () => {
    expect(facing([NaN, 0], [1, 1], 1, living, [1, 1], [A], 0)).toBeNull();
    expect(facing([0, 0], [0, 0], 1, living, [1, 1], [], -1)).toBeNull();
    expect(facing([0, 0], [10, 0], 1, [], [1, 5], undefined, 3)).toBeNull();
  });
});

describe("glowGrid with a span", () => {
  it("meshes only the span: no vertex outside it along the face", () => {
    const g = glowGrid([1000, 395], [0, 395], [0, -1], 0, 250, [600, 200], 230, GLOW_REACH, 0.8, [0, 500])!;
    expect(g).not.toBeNull();
    for (let i = 0; i < g.pos.length / 3; i++) expect(g.pos[i * 3]).toBeGreaterThanOrEqual(500 - 1e-6);
    expect(glowGrid([1000, 395], [0, 395], [0, -1], 0, 250, [600, 200], 230, GLOW_REACH, 0.8, [700, 1000])).toBeNull(); // the stretch is x <= 300, 300+ cm from the lamp at x=600: out of reach
  });
});

describe("glowGrid: the glow of one wall face", () => {
  const lamp: [number, number] = [250, 200];
  const grid = (a: [number, number], b: [number, number], n: [number, number], z0: number, z1: number, at = lamp, lampZ = 230) => glowGrid(a, b, n, z0, z1, at, lampZ, GLOW_REACH, 0.8);
  it("lights the part of the face within reach, brightest near the foot of the lamp, and lies a little off the face", () => {
    // the west face of the wall at x=495 faces a lamp 245 cm away: reach 300 leaves a patch of the face
    const g = grid([495, 0], [495, 400], [-1, 0], 0, 250)!;
    expect(g).not.toBeNull();
    const n = g.pos.length / 3;
    expect(g.k.length).toBe(n);
    let best = 0;
    for (let i = 0; i < n; i++) if (g.k[i] > g.k[best]) best = i;
    expect(Math.abs(g.pos[best * 3 + 2] - 200)).toBeLessThanOrEqual(30); // the brightest vertex is level with the lamp along the wall (three z is the plan's y)
    expect(g.pos[best * 3 + 1]).toBeGreaterThan(150); // and up near its height (three y is up)
    for (let i = 0; i < n; i++) expect(g.pos[i * 3]).toBeCloseTo(494.2, 5); // lifted off the face along its normal
    // far ends of the 400 cm face are out of reach: nothing is drawn at y = 0 or y = 400
    for (let i = 0; i < n; i++) { expect(g.pos[i * 3 + 2]).toBeGreaterThan(0); expect(g.pos[i * 3 + 2]).toBeLessThan(400); }
  });
  it("is clipped to the drawn height: a lowered wall (80 cm) gets no vertex above 80 and the glow is the lower part of the same field", () => {
    const tall = grid([495, 0], [495, 400], [-1, 0], 0, 250)!, low = grid([495, 0], [495, 400], [-1, 0], 0, 80)!;
    for (let i = 0; i < low.pos.length / 3; i++) expect(low.pos[i * 3 + 1]).toBeLessThanOrEqual(80);
    expect(Math.max(...low.k)).toBeLessThan(Math.max(...tall.k)); // the lamp is at 230: the low strip is far from its brightest spot
  });
  it("is null for a face out of reach, and for a lamp on the wrong side of it", () => {
    expect(grid([0, 5], [500, 5], [0, 1], 0, 250, [250, 390])).toBeNull(); // 385 cm from the north wall
    expect(grid([495, 0], [495, 400], [1, 0], 0, 250)).toBeNull(); // normal points away from the lamp
  });
  it("is bounded: a long face and a tall one stay under a fixed vertex count", () => {
    const g = grid([0, 5], [60000, 5], [0, 1], 0, 100000, [250, 5.5])!;
    expect(g.pos.length / 3).toBeLessThanOrEqual(13 * 7);
  });
  it("never throws on junk", () => {
    expect(grid([NaN, 0], [1, 1], [1, 0], 0, 1)).toBeNull();
    expect(grid([0, 0], [10, 0], [0, 1], 5, 5)).toBeNull();
  });
});

// S23.8 (V14): on a light theme the walls are pale, so an additive glow in the lamp's own colour at full strength washes them
// to white. There the glow is warm white (#ffd9a0) and its strength is capped at .35; a dark theme keeps the lamp's colour.
describe("glowTint: the colour a wall patch adds per unit of light", () => {
  it("a dark theme: the lamp's colour times the strength, uncapped", async () => {
    const { glowTint } = await import("../../src/card/three/glow");
    expect(glowTint([1, 0.5, 0.25], 0.8, false)).toEqual([0.8, 0.4, 0.2]);
  });
  it("a light theme: warm white, whatever the lamp's colour, and the strength capped at .35", async () => {
    const { glowTint, WARM_WHITE, LIGHT_GLOW_CAP } = await import("../../src/card/three/glow");
    expect(LIGHT_GLOW_CAP).toBe(0.35);
    expect(WARM_WHITE.map((v) => Math.round(v * 255))).toEqual([0xff, 0xd9, 0xa0]);
    const t = glowTint([0, 0, 1], 2.08, true); // the night boost: 0.5 x 3.5 x 0.8 x level 1 is far above the cap
    expect(t.map((v) => +v.toFixed(4))).toEqual(WARM_WHITE.map((v) => +(v * 0.35).toFixed(4)));
    const low = glowTint([0, 0, 1], 0.2, true); // under the cap: the strength itself
    expect(low.map((v) => +v.toFixed(4))).toEqual(WARM_WHITE.map((v) => +(v * 0.2).toFixed(4)));
  });
  it("never throws and never gives NaN on junk", async () => {
    const { glowTint } = await import("../../src/card/three/glow");
    for (const s of [NaN, -1, Infinity]) for (const light of [true, false]) for (const v of glowTint([NaN, 1, 1] as never, s, light)) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); }
  });
});
