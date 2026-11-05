// B53.9: the colour of walls. A layout default per kind (`Layout.wallColors`) and a colour per wall piece (`Room.wc`,
// `Floor.owc`, `Wall.color`). Everything arrives from a layout file, so nothing here trusts a shape or throws (CLAUDE.md
// finding 1), and only a strict #rrggbb ever reaches markup (finding 2).
import type { Floor, Pt } from "./schema";

/** The wall kinds whose theme token a layout may replace. `parapet` follows `external`; `edge` and `boundary` keep their own look. */
export const WALL_COLOUR_KEYS = ["wall", "external", "fence"] as const;
export type WallColourKey = (typeof WALL_COLOUR_KEYS)[number];

const HEX = /^#[0-9a-fA-F]{6}$/;
/** The colour as lower-case `#rrggbb`, or undefined for anything else. */
export const wallHex = (v: unknown): string | undefined => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : undefined);

/**
 * `Layout.wallColors` as the custom properties a group sets, so 2D, 2.5D and 3D all follow, in every theme. Custom properties
 * that read `var()` resolve where they are declared, so setting `--fp-wall` alone would leave the cap and the faces (derived
 * from it on the theme's own group) as they were: they are set here as well, from the same colour. Absent or not a strict
 * colour: nothing, and the theme's token stands.
 */
export function wallColourVars(wc: unknown): string[] {
  if (typeof wc !== "object" || wc === null || Array.isArray(wc)) return [];
  const get = (k: WallColourKey) => wallHex(Object.prototype.hasOwnProperty.call(wc, k) ? (wc as Record<string, unknown>)[k] : undefined);
  const out: string[] = [], wall = get("wall"), external = get("external"), fence = get("fence");
  if (wall) out.push(`--fp-wall:${wall}`, `--fp-wall-top:${wall}`, `--fp-wall-side:color-mix(in srgb,${wall} var(--fp-wall-side-share,55%),var(--fp-bg))`);
  if (external) out.push(`--fp-wall-external:${external}`);
  if (fence) out.push(`--fp-wall-fence:${fence}`);
  return out;
}

/** The key of an edge: its two ends rounded to whole centimetres, in either order. The rule of the 2.5D and 3D wall dedup. */
export const wallEdgeKey = (a: Pt, b: Pt): string => [a, b].map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).sort().join("|");

const pt = (p: unknown): p is Pt => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * The colour of every edge that has one, by `wallEdgeKey`. One rule for 2D, 2.5D and 3D: an edge drawn by two pieces (a
 * room's wall on the outline, two rooms side by side, a free wall laid over an edge) has one colour, the first set one in
 * this order: the outline, the rooms in array order, the free walls. A side that sets none takes the other's. Zones draw
 * no wall and are skipped. Anything that is not a strict colour counts as unset.
 */
export function wallColourMap(f: Floor): Map<string, string> {
  const out = new Map<string, string>();
  const ring = (pts: unknown, wc: unknown) => {
    if (!Array.isArray(pts) || !Array.isArray(wc)) return;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length], c = wallHex(wc[i]);
      if (c && pt(a) && pt(b)) { const k = wallEdgeKey(a, b); if (!out.has(k)) out.set(k, c); }
    });
  };
  const x = f as unknown as Record<string, unknown>;
  ring(x.outline, x.owc);
  if (Array.isArray(x.rooms)) for (const r of x.rooms) if (typeof r === "object" && r !== null && (r as { kind?: unknown }).kind !== "zone") ring((r as { pts?: unknown }).pts, (r as { wc?: unknown }).wc);
  if (Array.isArray(x.walls)) for (const w of x.walls) {
    const c = typeof w === "object" && w !== null ? wallHex((w as { color?: unknown }).color) : undefined;
    if (c && pt((w as { a?: unknown }).a) && pt((w as { b?: unknown }).b)) { const k = wallEdgeKey((w as { a: Pt }).a, (w as { b: Pt }).b); if (!out.has(k)) out.set(k, c); }
  }
  return out;
}
