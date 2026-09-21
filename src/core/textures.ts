/** Floor textures a room may use instead of a flat colour. Each is a small SVG tile that repeats in plan units (cm). */
export interface Texture { id: string; name: string; tile: string; preview: string }

/** Boards 20 cm wide, 80 cm long, joints staggered by half a board, a faint grain line in each. */
const wood = (id: string, name: string, base: string, line: string): Texture => ({
  id, name, preview: base,
  tile: `<rect width="80" height="40" fill="${base}"/><g stroke="${line}" fill="none"><path d="M0 .5H80M0 20.5H80" stroke-width="1.5"/><path d="M.5 0V20M40.5 20V40" stroke-width="1.5"/><path d="M8 7H34M46 12H72M14 27H30M52 33H76" stroke-width=".6" opacity=".5"/></g>`,
});
/** Square tiles 50 cm wide with a 3 cm grout line. */
const stone = (id: string, name: string, base: string, grout: string): Texture => ({
  id, name, preview: base,
  tile: `<rect width="50" height="50" fill="${grout}"/><rect x="1.5" y="1.5" width="47" height="47" fill="${base}"/>`,
});

export const TEXTURES: Texture[] = [
  wood("wood-light", "Light wood", "#d8bd94", "#a98d63"),
  wood("wood-warm", "Warm wood", "#b98b5c", "#8a6238"),
  wood("wood-dark", "Dark wood", "#5b4130", "#3a2a1f"),
  stone("stone-white", "White stone tiles", "#f1f1ee", "#c4c4bf"),
  stone("stone-grey", "Grey stone tiles", "#9a9da0", "#6f7275"),
  stone("stone-bluegrey", "Dark blue-grey stone tiles", "#3f4a5a", "#29313d"),
  stone("stone-black", "Black stone tiles", "#2a2b2d", "#484a4d"),
];

export const TEXTURE_IDS: string[] = TEXTURES.map((t) => t.id);

/** The `<pattern>` elements for the given texture ids (unknown ids skipped). Fixed ids: two cards on a page declare the same pattern twice, identically. */
export function texturePatterns(ids: Iterable<string>): string {
  const want = new Set(ids);
  return TEXTURES.filter((t) => want.has(t.id))
    .map((t) => {
      const [w, h] = t.id.startsWith("wood") ? [80, 40] : [50, 50];
      return `<pattern id="fp-tex-${t.id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse">${t.tile}</pattern>`;
    }).join("");
}
