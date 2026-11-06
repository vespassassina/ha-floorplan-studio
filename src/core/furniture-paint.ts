// B53.4: paint on a piece of furniture. `color` (#rrggbb) or `texture` (a room texture) with `textureRot` and `textureScale`,
// as a room stores them. One pure module for 2D, 2.5D and 3D, so the three cannot disagree. A layout is untrusted (finding 1):
// every function here answers "no paint" to a value it does not understand and never throws.
import type { Furniture } from "./schema";
import { TEXTURES, TEXTURE_IDS, normTextureRot, normTextureScale, texturePatternId } from "./textures";

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Whether a symbol takes `color` and `texture`. A car has a colour of its own (the body paint, no texture) and a tree is a crown
 * and a trunk the theme colours; neither is a block to paint. One entry decides each symbol (finding 17: a test walks the list).
 */
export function furniturePaintable(symbol: unknown): boolean {
  // B53.12: a mirror is glass in the theme's mirror colour, so neither mirror takes paint. A shower does: its tray is painted, its glass is not.
  return symbol !== "car" && symbol !== "tree" && symbol !== "mirror" && symbol !== "mirror-stand";
}

/** The piece's paint as a strict value, or null: a texture (a known id) wins over a colour, like on a room. */
function paintOf(m: Furniture): { color: string } | { texture: string; rot: number; scale: number } | null {
  if (!m || typeof m !== "object" || !furniturePaintable(m.symbol)) return null;
  if (typeof m.texture === "string" && TEXTURE_IDS.includes(m.texture)) return { texture: m.texture, rot: normTextureRot(m.textureRot), scale: normTextureScale(m.textureScale) };
  if (typeof m.color === "string" && HEX.test(m.color)) return { color: m.color.toLowerCase() };
  return null;
}

/**
 * The one colour the 2.5D block and the 3D solid of a piece wear: its colour, or its texture's base colour (no grain in 3D),
 * `#rrggbb`. `undefined` for no paint, so the caller keeps the theme's furniture colour and the palette's role.
 */
export function furniturePaint(m: Furniture): string | undefined {
  const p = paintOf(m);
  if (!p) return undefined;
  return "color" in p ? p.color : TEXTURES.find((t) => t.id === p.texture)?.preview;
}

const finiteSize = (m: Furniture) => Number.isFinite(m.w) && Number.isFinite(m.h) && m.w > 0 && m.h > 0;

/** Id of the pattern a textured piece fills with. The piece's group is scaled by w/100 x h/100, so the pattern carries the size too. */
function patternIdOf(m: Furniture, p: { texture: string; rot: number; scale: number }): string {
  return `${texturePatternId(p.texture, p.rot, p.scale)}-f${Math.round(m.w * 10)}x${Math.round(m.h * 10)}`;
}

/**
 * The attributes of the piece's group: ` fpaint` for the class list (empty with no paint) and the ` style` with the custom
 * properties a class rule reads (`.furn.fpaint .ff` takes `--fp-furn-fill`; the 2.5D block takes `--fp-box-*`). Colours are
 * a custom property and a rule, never a `fill` attribute, which any author rule outranks (finding 18). Everything interpolated
 * here is a checked hex, a number or an id from the fixed list.
 */
export function furniturePaintLook(m: Furniture): { cls: string; style: string } {
  const p = paintOf(m);
  const base = furniturePaint(m);
  if (!p || !base || !finiteSize(m)) return { cls: "", style: "" };
  const fill = "color" in p ? base : `url(#${patternIdOf(m, p)})`;
  const shade = (n: number) => `color-mix(in srgb,${base} ${n}%,black)`;
  return { cls: " fpaint", style: ` style="--fp-furn-fill:${fill};--fp-box-top:${base};--fp-box-side:${shade(74)};--fp-box-side-w:${shade(88)}"` };
}

/** The `<pattern>` elements the textured pieces of a floor need (one per texture, turn, scale and size in use). */
export function furniturePatterns(pieces: readonly Furniture[]): string {
  const seen = new Map<string, string>();
  for (const m of pieces) {
    const p = paintOf(m);
    if (!p || !("texture" in p) || !finiteSize(m)) continue;
    const t = TEXTURES.find((x) => x.id === p.texture);
    if (!t) continue;
    const id = patternIdOf(m, p);
    if (seen.has(id)) continue;
    const w = t.w * p.scale, h = t.h * p.scale;
    const viewBox = p.scale !== 1 ? ` viewBox="0 0 ${t.w} ${t.h}"` : "";
    const fit = `scale(${+(100 / m.w).toFixed(4)} ${+(100 / m.h).toFixed(4)})`;
    seen.set(id, `<pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse"${viewBox} patternTransform="${fit}${p.rot ? ` rotate(${p.rot})` : ""}">${t.tile}</pattern>`);
  }
  return [...seen.values()].join("");
}
