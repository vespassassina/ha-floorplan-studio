// The 2.5D solids: walls, furniture, appliances and stairs drawn as extruded shapes. Pure string builders; `renderFloor`
// decides when to call them and in what order (one draw path, CLAUDE.md finding 8). Nothing here knows the OBLIQUE
// numbers: they arrive in a `Proj`, so this file never imports render.ts.
import { floorHeight, furnitureHeight, unlinkedHeight, wallHeight, edgeHeight, deviceZ } from "./heights";
import type { Floor } from "./schema";

/** A device mount at or above this height gets a stem up from its icon (a ceiling light yes, a plug no). */
export const STEM_MIN_Z = 100;

/**
 * The tallest thing the 2.5D view draws on a floor, in cm, before any cutaway: `viewBoxFor` widens its box by this
 * (times rise and skew) so nothing is clipped. Heights come from the resolvers in heights.ts, never from here.
 */
export function tallestDrawn(f: Floor): number {
  let top = 0;
  const up = (h: number) => { if (Number.isFinite(h) && h > top) top = h; };
  (f.outline ?? []).forEach((_, i) => up(edgeHeight(f, null, i)));
  for (const r of f.rooms ?? []) if (r.kind !== "zone") (r.pts ?? []).forEach((_, i) => up(edgeHeight(f, r, i)));
  for (const w of f.walls ?? []) up(wallHeight(f, w));
  for (const m of f.furniture ?? []) up(furnitureHeight(m));
  for (const u of f.unlinked ?? []) up(unlinkedHeight(u));
  if ((f.stairs ?? []).length) up(floorHeight(f));
  for (const d of f.devices ?? []) if (d.type !== "person" && !("a" in d)) { const z = deviceZ(d); if (z >= STEM_MIN_Z) up(z); }
  return top;
}
