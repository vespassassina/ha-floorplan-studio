/** Floor textures a room may use instead of a flat colour. Each is a small SVG tile that repeats in plan units (cm).
 * `w`/`h` are the tile's own natural size — the size `tile`'s coordinates are drawn in, before any scale (S4.19). */
export interface Texture { id: string; name: string; tile: string; preview: string; w: number; h: number }

/** Boards 20 cm wide, 80 cm long, joints staggered by half a board, a faint grain line in each. */
const wood = (id: string, name: string, base: string, line: string): Texture => ({
  id, name, preview: base, w: 80, h: 40,
  tile: `<rect width="80" height="40" fill="${base}"/><g stroke="${line}" fill="none"><path d="M0 .5H80M0 20.5H80" stroke-width="1.5"/><path d="M.5 0V20M40.5 20V40" stroke-width="1.5"/><path d="M8 7H34M46 12H72M14 27H30M52 33H76" stroke-width=".6" opacity=".5"/></g>`,
});
/** Square tiles 50 cm wide with a 3 cm grout line. */
const stone = (id: string, name: string, base: string, grout: string): Texture => ({
  id, name, preview: base, w: 50, h: 50,
  tile: `<rect width="50" height="50" fill="${grout}"/><rect x="1.5" y="1.5" width="47" height="47" fill="${base}"/>`,
});
/** 40x40 cm cell, planks laid in a zig-zag V, the classic herringbone weave. */
const herringbone = (id: string, name: string, base: string, line: string): Texture => ({
  id, name, preview: base, w: 40, h: 40,
  tile: `<rect width="40" height="40" fill="${base}"/><g stroke="${line}" fill="none"><path d="M0 0L20 20L40 0M0 20L20 40L40 20" stroke-width="1"/><path d="M0 10L20 30M20 10L40 30M-20 10L0 30M40 10L60 30" stroke-width=".6" opacity=".5"/></g>`,
});
/** 40x40 cm cell, four quadrants of short parallel planks turned 90° from their neighbours, a basket weave. */
const parquet = (id: string, name: string, base: string, line: string): Texture => ({
  id, name, preview: base, w: 40, h: 40,
  tile: `<rect width="40" height="40" fill="${base}"/><g stroke="${line}" fill="none"><path d="M0 .5H40M0 20.5H40M.5 0V40M20.5 0V40" stroke-width="1.5"/><path d="M0 7H20M0 14H20M27 20V40M34 20V40" stroke-width=".6" opacity=".5"/><path d="M27 0V20M34 0V20M0 27H20M0 34H20" stroke-width=".6" opacity=".5" transform="translate(20,0)"/><path d="M0 27H20M0 34H20" stroke-width=".6" opacity=".5" transform="translate(0,0)"/></g>`,
});
/** Two-tone 50 cm squares, the classic checkerboard. */
const checker = (id: string, name: string, a: string, b: string): Texture => ({
  id, name, preview: a, w: 50, h: 50,
  tile: `<rect width="50" height="50" fill="${a}"/><rect x="0" y="0" width="25" height="25" fill="${b}"/><rect x="25" y="25" width="25" height="25" fill="${b}"/>`,
});

export const TEXTURES: Texture[] = [
  wood("wood-light", "Light wood", "#d8bd94", "#a98d63"),
  wood("wood-warm", "Warm wood", "#b98b5c", "#8a6238"),
  wood("wood-dark", "Dark wood", "#5b4130", "#3a2a1f"),
  herringbone("wood-herringbone", "Herringbone wood", "#c9a672", "#9c7a4d"),
  parquet("wood-parquet", "Parquet wood", "#b1875a", "#87613b"),
  stone("stone-white", "White stone tiles", "#f1f1ee", "#c4c4bf"),
  stone("stone-grey", "Grey stone tiles", "#9a9da0", "#6f7275"),
  stone("stone-bluegrey", "Dark blue-grey stone tiles", "#3f4a5a", "#29313d"),
  stone("stone-black", "Black stone tiles", "#2a2b2d", "#484a4d"),
  stone("stone-terracotta", "Terracotta tiles", "#c1592f", "#8f3f1d"),
  checker("checker-classic", "Checkerboard", "#eeece5", "#2a2b2d"),
];

export const TEXTURE_IDS: string[] = TEXTURES.map((t) => t.id);

/** A texture's own rotation, wrapped into `[0, 360)`. Anything that is not a finite number is 0 — a hostile or malformed
 * value never throws and never reaches an SVG attribute unescaped. */
export function normTextureRot(rot: unknown): number {
  if (typeof rot !== "number" || !Number.isFinite(rot)) return 0;
  const w = Math.trunc(rot) % 360;
  return w < 0 ? w + 360 : w;
}

/** A texture's own scale (S4.19), a multiple of its natural size, clamped to [0.25, 2] (25%–200%). Anything that is
 * not a finite number is 1 — a hostile or malformed value never throws and never reaches an SVG attribute unescaped. */
export function normTextureScale(scale: unknown): number {
  if (typeof scale !== "number" || !Number.isFinite(scale)) return 1;
  return Math.min(2, Math.max(0.25, scale));
}

/** The pattern id a room or stair should reference for this texture, rotation and scale: the plain, unrotated,
 * unscaled id when both are their defaults (unchanged from before this feature, so nothing already pinned to it
 * breaks), else a distinct id carrying whichever of `-r<rot>`/`-s<percent>` applies. */
export function texturePatternId(textureId: string, rot: number, scale = 1): string {
  const parts = [rot !== 0 ? `r${rot}` : "", scale !== 1 ? `s${Math.round(scale * 100)}` : ""].filter(Boolean);
  return parts.length ? `fp-tex-${textureId}-${parts.join("-")}` : `fp-tex-${textureId}`;
}

/** The `<pattern>` elements for the given (texture id, rotation, scale) triples (unknown texture ids skipped). Fixed
 * ids: two cards on a page declare the same pattern twice, identically, and only the combinations actually in use are
 * declared. A non-default scale grows the tile to `w*scale`/`h*scale` and maps the tile's own content back onto it
 * with a `viewBox`, so the pattern (not its content's coordinate system) is what changes size. */
export function texturePatterns(uses: Iterable<{ id: string; rot?: number; scale?: number }>): string {
  const want = new Map<string, { t: Texture; rot: number; scale: number }>();
  for (const u of uses) {
    const t = TEXTURES.find((x) => x.id === u.id);
    if (!t) continue;
    const rot = normTextureRot(u.rot);
    const scale = normTextureScale(u.scale);
    want.set(texturePatternId(t.id, rot, scale), { t, rot, scale });
  }
  return [...want.entries()]
    .map(([patId, { t, rot, scale }]) => {
      const w = t.w * scale, h = t.h * scale;
      const viewBox = scale !== 1 ? ` viewBox="0 0 ${t.w} ${t.h}"` : "";
      const transform = rot === 0 ? "" : ` patternTransform="rotate(${rot})"`;
      return `<pattern id="${patId}" width="${w}" height="${h}" patternUnits="userSpaceOnUse"${viewBox}${transform}>${t.tile}</pattern>`;
    }).join("");
}
