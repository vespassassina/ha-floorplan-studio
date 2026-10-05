import { describe, expect, it } from "vitest";
import { prismTriangles, type Triangles } from "../../src/card/three/mesh";

// The pure part of the 3D view: a prism of the scene module (plan x, y, z up, cm) becomes triangles in three.js'
// frame (x right, y up, z toward the viewer, so plan y is three z). No WebGL here; the real pixels are in
// tests/card/card-3d.spec.ts. What matters in this file: every face looks outward (an inside-out face is invisible
// under back-face culling) and a hostile polygon makes no triangles instead of an error.

const fresh = (): Triangles => ({ position: [], normal: [] });
const tris = (t: Triangles) => t.position.length / 9;
const vertex = (t: Triangles, i: number) => [t.position[i * 3], t.position[i * 3 + 1], t.position[i * 3 + 2]];

/** Winding normal of triangle k, the way a GPU decides which side is the front. */
function winding(t: Triangles, k: number): number[] {
  const [a, b, c] = [vertex(t, k * 3), vertex(t, k * 3 + 1), vertex(t, k * 3 + 2)];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
const dot = (p: number[], q: number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

describe("prismTriangles", () => {
  const box = [[0, 0], [100, 0], [100, 40], [0, 40]] as [number, number][];

  it("a box is 12 triangles, and plan (x, y, z) lands at three (x, z, y)", () => {
    const t = fresh();
    expect(prismTriangles(box, 10, 250, t)).toBe(true);
    expect(tris(t)).toBe(12);
    const ys = new Set<number>(), zs = new Set<number>();
    for (let i = 0; i < t.position.length; i += 3) { ys.add(t.position[i + 1]); zs.add(t.position[i + 2]); }
    expect([...ys].sort((p, q) => p - q)).toEqual([10, 250]); // height is three's y
    expect([...zs].sort((p, q) => p - q)).toEqual([0, 40]); // plan y is three's z
  });

  it.each([
    ["clockwise", box],
    ["counter-clockwise", [...box].reverse()],
  ] as const)("every face of a %s base looks outward (winding agrees with the stored normal, and the normal points away from the centre)", (_n, base) => {
    const t = fresh();
    prismTriangles(base as never, 0, 100, t);
    const centre = [50, 50, 20];
    for (let k = 0; k < tris(t); k++) {
      const n = [t.normal[k * 9], t.normal[k * 9 + 1], t.normal[k * 9 + 2]], w = winding(t, k), v = vertex(t, k * 3);
      expect(dot(w, n)).toBeGreaterThan(0); // front face is the normal's side
      expect(dot(n, [v[0] - centre[0], v[1] - centre[1], v[2] - centre[2]])).toBeGreaterThan(0); // and that side is outside
    }
  });

  it("a concave L is triangulated over its own area only: top cap area equals the L's", () => {
    const L: [number, number][] = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]];
    const t = fresh();
    prismTriangles(L, 0, 10, t);
    let top = 0;
    for (let k = 0; k < tris(t); k++) if (t.normal[k * 9 + 1] > 0.5) { const w = winding(t, k); top += Math.hypot(w[0], w[1], w[2]) / 2; }
    expect(top).toBeCloseTo(100 * 40 + 40 * 60, 5); // 6400, not the 10000 of the bounding box
  });

  it("the sides carry horizontal normals and the caps vertical ones", () => {
    const t = fresh();
    prismTriangles(box, 0, 100, t);
    const up = [...Array(tris(t)).keys()].filter((k) => t.normal[k * 9 + 1] === 1).length;
    const down = [...Array(tris(t)).keys()].filter((k) => t.normal[k * 9 + 1] === -1).length;
    expect([up, down]).toEqual([2, 2]);
  });

  it.each([
    ["two points", [[0, 0], [1, 1]]],
    ["all on a line", [[0, 0], [5, 5], [10, 10]]],
    ["a repeated point", [[3, 3], [3, 3], [3, 3]]],
    ["NaN", [[0, 0], [NaN, 0], [1, 1]]],
    ["a hole in the type", [[0, 0], null, [1, 1]]],
    ["beyond what a float can hold", [[0, 0], [1e300, 0], [0, 1e300]]],
    ["not an array", 5],
  ])("hostile base (%s) makes no triangles and does not throw", (_n, base) => {
    const t = fresh();
    expect(() => prismTriangles(base as never, 0, 10, t)).not.toThrow();
    expect(prismTriangles(base as never, 0, 10, t)).toBe(false);
    expect(tris(t)).toBe(0);
  });

  it("a flat or inverted height makes nothing; a closing point equal to the first is ignored", () => {
    const t = fresh();
    expect(prismTriangles(box, 5, 5, t)).toBe(false);
    expect(prismTriangles(box, 9, 5, t)).toBe(false);
    expect(prismTriangles([...box, box[0]], 0, 10, t)).toBe(true);
    expect(tris(t)).toBe(12);
  });

  it("a self-crossing bow-tie does not throw and stays finite", () => {
    const t = fresh();
    expect(() => prismTriangles([[0, 0], [10, 10], [10, 0], [0, 10]], 0, 10, t)).not.toThrow();
    expect(t.position.every(Number.isFinite)).toBe(true);
  });
});
