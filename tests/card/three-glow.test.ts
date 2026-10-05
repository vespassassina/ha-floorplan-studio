import { describe, it, expect } from "vitest";
import { glowAt, GLOW_REACH, facing, glowGrid, outwardSign } from "../../src/card/three/light";

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
    expect(facing([495, 400], [495, 0], s, living, lamp)).toEqual([-1, 0]);
    expect(facing([505, 0], [505, 400], s, living, lamp)).toBeNull();
    // the north wall's south face, and the outside of the same wall
    const n = outwardSign(north);
    expect(facing([500, 5], [0, 5], n, living, lamp)).toEqual([0, 1]);
    expect(facing([0, -5], [500, -5], n, living, lamp)).toBeNull();
  });
  it("is the same whichever way the ring is wound", () => {
    const rev = [...shared].reverse(), s = outwardSign(rev);
    expect(s).toBe(-outwardSign(shared));
    expect(facing([495, 0], [495, 400], s, living, lamp)).toEqual([-1, 0]);
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
