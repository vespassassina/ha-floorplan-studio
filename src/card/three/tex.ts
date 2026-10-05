// Floor textures in the 3D view. A texture is the same SVG tile the 2D plan draws as a <pattern> (core/textures.ts), rasterised once to
// a canvas from an inline `data:` image (no network, CLAUDE.md finding 9) and laid on the top face of a room or a tread so that a board
// is the size, turn and scale it is on the plan. The UVs are worked out from plan cm, so one texture per (id, scale) serves every
// rotation. Nothing is imported from core at run time (the chunk shares no code with the card, see palette.ts): the card passes the tile.
import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type WebGLRenderer } from "three";
import type { TextureTile } from "../../core/textures";

export type { TextureTile };
/** Raster pixels per cm of tile, and the longest side a raster may have (a 200% tile of an 80 cm board stays under it). */
const PX_PER_CM = 4, PX_MAX = 512, PX_MIN = 32;

/** The texture coordinates of a plan point (cm). The pattern is turned by `rot` about the plan's origin as SVG's `rotate()` turns it, so a point of the plan is taken back into the pattern's own axes; v runs the other way because an uploaded canvas is flipped. */
export function uvOf(t: TextureTile, x: number, y: number): [number, number] {
  const a = (t.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const px = x * c + y * s, py = -x * s + y * c, u = px / (t.w * t.scale), v = -py / (t.h * t.scale);
  return [Number.isFinite(u) ? u : 0, Number.isFinite(v) ? v : 0];
}

/** The raster's size in pixels: `PX_PER_CM` over the scaled tile, kept between `PX_MIN` and `PX_MAX` on its longer side. */
export function pixelSize(t: TextureTile): [number, number] {
  const w = t.w * t.scale, h = t.h * t.scale, k = Math.max(PX_MIN / Math.max(w, h), Math.min(PX_PER_CM, PX_MAX / Math.max(w, h)));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** The tile as an inline SVG image URL, `w` x `h` px, its content in its own cm coordinates (the tile text is a fixed list, never user input). */
export const tileImage = (t: TextureTile, w: number, h: number): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${t.w} ${t.h}">${t.tile}</svg>`)}`;

export const textureKey = (t: TextureTile): string => `${t.id}|${t.scale}`;

/**
 * The rasters, by (id, scale). A raster is made once and kept for the life of the view (a canvas holds no graphics memory);
 * `texture` makes the graphics-side texture from it, which the caller disposes with its floor. `onReady` runs after a raster
 * finishes, so the view can lay the texture on the meshes that waited for it.
 */
export function createRasters(onReady: () => void, onError: (e: unknown) => void) {
  const done = new Map<string, HTMLCanvasElement>(), pending = new Set<string>();
  let gone = false;
  return {
    /** The texture for `t` if its raster is ready (anisotropy and mipmaps set), else null, and the raster is started. */
    texture(t: TextureTile, renderer: WebGLRenderer): CanvasTexture | null {
      const key = textureKey(t), cv = done.get(key);
      if (cv) {
        const tex = new CanvasTexture(cv);
        tex.wrapS = tex.wrapT = RepeatWrapping;
        tex.colorSpace = SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        return tex;
      }
      if (!pending.has(key)) {
        pending.add(key);
        const [w, h] = pixelSize(t), img = new Image(w, h);
        img.onload = () => {
          pending.delete(key);
          if (gone) return;
          try {
            const c = document.createElement("canvas");
            c.width = w; c.height = h;
            c.getContext("2d")!.drawImage(img, 0, 0, w, h);
            done.set(key, c);
            onReady();
          } catch (e) { onError(e); }
        };
        img.onerror = () => { pending.delete(key); if (!gone) onError(new Error(`the floor texture ${t.id} could not be drawn`)); };
        img.src = tileImage(t, w, h);
      }
      return null;
    },
    ready: (t: TextureTile) => done.has(textureKey(t)),
    dispose() { gone = true; done.clear(); },
  };
}
