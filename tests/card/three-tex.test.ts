import { describe, it, expect } from "vitest";
import { uvOf, tileImage, pixelSize } from "../../src/card/three/tex";
import { textureDeps } from "../../src/core/three-deps";
import { TEXTURES } from "../../src/core/textures";

// A floor texture in 3D must be the same size, turn and scale as the 2D plan's pattern (render.ts: a <pattern> in plan units, with
// patternTransform rotate(rot), width w*scale). The UVs are worked out from plan cm; these are the maths.
const wood = textureDeps.texture("wood-light", 0, 1)!; // 80 x 40 cm

describe("textureDeps.texture (card side, handed to the chunk)", () => {
  it("names the tile, its natural size and its preview colour, with rotation and scale normalised as the 2D plan does", () => {
    expect(wood.w).toBe(80); expect(wood.h).toBe(40); expect(wood.rot).toBe(0); expect(wood.scale).toBe(1);
    expect(wood.preview).toBe("#d8bd94");
    const t = textureDeps.texture("stone-grey", -90, 5)!;
    expect(t.rot).toBe(270); expect(t.scale).toBe(2); // wrapped, and clamped to 200%
  });
  it("is null for an id that is not a texture, whatever it is", () => {
    for (const id of ["__proto__", "nope", 5, null, undefined, "", "constructor", { a: 1 }]) expect(textureDeps.texture(id, 0, 1)).toBeNull();
  });
  it("takes junk rotation and scale as 0 and 1", () => {
    const t = textureDeps.texture("wood-dark", "90", NaN)!;
    expect(t.rot).toBe(0); expect(t.scale).toBe(1);
  });
  it("covers every texture", () => { for (const x of TEXTURES) expect(textureDeps.texture(x.id, 0, 1)?.preview).toBe(x.preview); });
});

describe("uvOf", () => {
  it("is plan cm over the tile's size: one board length east is one repeat in u; one board width south is half a repeat in v (80 x 40 tile)", () => {
    const o = uvOf(wood, 0, 0), e = uvOf(wood, 80, 0), s = uvOf(wood, 0, 40);
    expect(e[0] - o[0]).toBeCloseTo(1); expect(e[1] - o[1]).toBeCloseTo(0);
    expect(Math.abs(s[1] - o[1])).toBeCloseTo(1); expect(s[0] - o[0]).toBeCloseTo(0);
    const half = uvOf(wood, 20, 0);
    expect(half[0]).toBeCloseTo(0.25);
  });
  it("runs v against the plan's y: the image's top row is plan y 0 going south (the texture is flipped on upload)", () => {
    expect(uvOf(wood, 0, 20)[1]).toBeLessThan(uvOf(wood, 0, 0)[1]);
  });
  it("scales: at 200% the tile covers twice the cm", () => {
    const big = textureDeps.texture("wood-light", 0, 2)!;
    expect(uvOf(big, 80, 0)[0]).toBeCloseTo(0.5);
    expect(uvOf(big, 0, 20)[1]).toBeCloseTo(-0.25);
  });
  it("turns like the SVG's rotate(): rotate(90) turns the pattern's x axis onto the plan's +y (south)", () => {
    const r = textureDeps.texture("wood-light", 90, 1)!;
    const along = uvOf(r, 0, 80); // the pattern's x runs south: 80 cm south is one full board in u
    expect(along[0]).toBeCloseTo(1); expect(along[1]).toBeCloseTo(0);
    const across = uvOf(r, -40, 0); // the pattern's y runs west: 40 cm west is one board width in pattern y, which is -1 in v
    expect(across[0]).toBeCloseTo(0); expect(Math.abs(across[1])).toBeCloseTo(1);
  });
  it("is finite for any point", () => { for (const v of [NaN, Infinity, 1e300]) expect(uvOf(wood, v, v).every(Number.isFinite)).toBe(true); });
});

describe("tileImage and pixelSize", () => {
  it("is an inline data: SVG of the tile's own content, no network", () => {
    const img = tileImage(wood, 320, 160);
    expect(img.startsWith("data:image/svg+xml")).toBe(true);
    const svg = decodeURIComponent(img.slice(img.indexOf(",") + 1));
    expect(svg).toContain('viewBox="0 0 80 40"'); expect(svg).toContain('width="320"'); expect(svg).toContain('height="160"');
    expect(svg).toContain("#d8bd94");
    expect(svg.replace(/xmlns="[^"]*"/, "")).not.toMatch(/https?:|href|<script/);
  });
  it("sizes the raster by cm per pixel and caps a side at 512", () => {
    expect(pixelSize(wood)).toEqual([320, 160]);
    const big = textureDeps.texture("wood-light", 0, 2)!;
    const [w, h] = pixelSize(big);
    expect(w).toBeLessThanOrEqual(512); expect(h).toBeLessThanOrEqual(512); expect(w / h).toBeCloseTo(2);
    const small = textureDeps.texture("stone-white", 0, 0.25)!;
    expect(pixelSize(small)[0]).toBeGreaterThanOrEqual(32);
  });
});

describe("createRasters", () => {
  it("has no texture on the first ask (the flat colour stands in), starts the raster once, and says it is not ready", async () => {
    const { createRasters } = await import("../../src/card/three/tex");
    const r = createRasters(() => undefined, () => undefined), renderer = { capabilities: { getMaxAnisotropy: () => 4 } } as never;
    expect(r.texture(wood, renderer)).toBeNull();
    expect(r.texture(wood, renderer)).toBeNull();
    expect(r.ready(wood)).toBe(false);
    r.dispose();
  });
});
