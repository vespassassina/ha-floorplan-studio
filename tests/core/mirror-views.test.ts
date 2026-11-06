import { describe, expect, it } from "vitest";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import { buildScene } from "../../src/core/scene";
import { furnitureBlocks, lidOf, CHAISE_SHARE } from "../../src/core/furniture-blocks";
import { furnitureHeight } from "../../src/core/heights";
import type { Floor, Furniture } from "../../src/core/schema";

// B53.2, criterion 3: `mirror` flips the L sofa about the piece's vertical axis in 2D, 2.5D and 3D alike. One asymmetric piece
// (240 x 160 at 300, 250), the chaise is the block that reaches the front edge and is 35 % of the width.
const W = 240, D = 160, CX = 300, CY = 250;
const sofa = (extra: Record<string, unknown> = {}) => ({ id: "s", symbol: "sofa-l", x: CX, y: CY, rot: 0, w: W, h: D, ...extra }) as unknown as Furniture;
const floor = (m: Furniture): Floor => ({
  title: "T", outline: [[0, 0], [700, 0], [700, 500], [0, 500]], owk: ["none", "none", "none", "none"],
  rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [m], unlinked: [],
}) as unknown as Floor;
const R = OBLIQUE.rise, K = OBLIQUE.skew;
const n = (v: number) => String(Math.round(v * 100) / 100);
const P = (x: number, y: number, h: number) => `${n(x + h * K * R)},${n(y - h * R)}`;
/** The chaise block of the piece, in plan coordinates (left edge, right edge, back y, front y, top z). */
function chaise(m: Furniture) {
  const H = furnitureHeight(m), b = furnitureBlocks(m).find((x) => x.y1 === D && Math.abs(x.x1 - x.x0 - W * CHAISE_SHARE) < 1e-9 && x.z1 < H)!;
  return { b, x0: CX - W / 2 + b.x0, x1: CX - W / 2 + b.x1, y0: CY - D / 2 + b.y0, y1: CY - D / 2 + b.y1 };
}

describe("mirror: the chaise changes side in 2D, 2.5D and 3D", () => {
  for (const mirror of [false, true]) {
    const m = sofa(mirror ? { mirror: true } : {});
    const label = mirror ? "mirrored" : "default";
    const c = chaise(m);

    it(`${label}: the block sits ${mirror ? "right" : "left"} in the piece's frame`, () => {
      expect(c.b.x0 < W / 2, label).toBe(!mirror);
      expect(c.b.x1 - c.b.x0).toBeCloseTo(W * CHAISE_SHARE, 9);
    });
    it(`${label}: 2D flips the symbol's x scale`, () => {
      const html = renderFloor(floor(m), { scale: 1 });
      expect(html).toContain(`scale(${mirror ? "-" : ""}${n(W / 100)} ${n(D / 100)})`);
      expect(html).not.toContain(`scale(${mirror ? "" : "-"}${n(W / 100)} ${n(D / 100)})`);
    });
    it(`${label}: 2.5D draws the chaise's top over the ${mirror ? "right" : "left"} third`, () => {
      const html = renderFloor(floor(m), { scale: 1, view: "2.5d" });
      const tops = [...html.matchAll(/<polygon class="bt" points="([^"]*)"\/>/g)].map((x) => x[1].split(" "));
      const z = c.b.z1, want = [P(c.x0, c.y0, z), P(c.x1, c.y0, z), P(c.x1, c.y1, z), P(c.x0, c.y1, z)];
      expect(tops.some((t) => want.every((p) => t.includes(p))), `${label} ${want.join(" ")}`).toBe(true);
      // and no top at the other side
      const other = mirror ? CX - W / 2 : CX + W / 2 - W * CHAISE_SHARE, w2 = [P(other, c.y0, z), P(other + W * CHAISE_SHARE, c.y0, z)];
      expect(tops.some((t) => w2.every((p) => t.includes(p))), `${label} other side`).toBe(false);
    });
    it(`${label}: 3D builds the chaise prism over the ${mirror ? "right" : "left"} third`, () => {
      expect(c.x0).toBeCloseTo(mirror ? 336 : 180, 9); // written out: 300 - 120 + 156, or 300 - 120
      const sol = buildScene(floor(m)).solids.filter((s) => s.kind === "furniture" && s.shape.type === "prism");
      const hit = sol.filter((s) => {
        const base = (s.shape as { base: number[][] }).base, xs = base.map((p) => p[0]), ys = base.map((p) => p[1]);
        return Math.abs(Math.min(...xs) - c.x0) < 1e-6 && Math.abs(Math.max(...xs) - c.x1) < 1e-6 && Math.abs(Math.max(...ys) - c.y1) < 1e-6;
      });
      expect(hit, label).toHaveLength(1);
    });
  }
  it("a turned piece mirrors about its own axis, not the plan's", () => {
    // At rot 90 the piece's own x runs along the plan's y, so the mirrored chaise is the default one reflected about y = CY,
    // with the same x span. A flip about the plan's x axis would keep the ys and move the xs.
    const bounds = (m: Furniture) => {
      const c = chaise(m), sol = buildScene(floor(m)).solids.filter((s) => s.kind === "furniture" && s.shape.type === "prism");
      const zTop = c.b.z1;
      return sol.map((s) => (s.shape as { base: number[][]; z1: number })).filter((sh) => Math.abs(sh.z1 - zTop) < 1e-6)
        .map((sh) => { const xs = sh.base.map((p) => p[0]), ys = sh.base.map((p) => p[1]); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; })
        .filter((b) => Math.abs(b[3] - b[2] - W * CHAISE_SHARE) < 1e-6);
    };
    const a = bounds(sofa({ rot: 90 })), b = bounds(sofa({ rot: 90, mirror: true }));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(b[0][0]).toBeCloseTo(a[0][0], 6);
    expect(b[0][1]).toBeCloseTo(a[0][1], 6);
    expect(b[0][2]).toBeCloseTo(2 * CY - a[0][3], 6);
    expect(b[0][3]).toBeCloseTo(2 * CY - a[0][2], 6);
    expect(Math.abs(b[0][2] - a[0][2])).toBeGreaterThan(1); // the chaise did move
  });
  it("the plan symbol of an L sofa lies on its seat, not floating at the back's height", () => {
    const m = sofa();
    expect(lidOf(m, furnitureBlocks(m))).toBeCloseTo(furnitureHeight(m) * 0.45, 9);
  });
  it("mirror on any other symbol changes nothing", () => {
    const base = { id: "s", symbol: "sofa", x: CX, y: CY, rot: 0, w: W, h: D };
    expect(renderFloor(floor({ ...base, mirror: true } as never), { scale: 1 })).toBe(renderFloor(floor(base as never), { scale: 1 }));
  });
});
