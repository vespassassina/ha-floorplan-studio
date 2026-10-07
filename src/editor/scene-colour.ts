// S17.3: hue/saturation <-> hex for the designer's colour box. Home Assistant's `hs_color` is [hue 0-360, saturation 0-100]; the
// box is a browser colour input (#rrggbb) at full value, brightness being its own field.

export function hsToHex(h: number, s: number): string {
  const fin = (n: number) => (Number.isFinite(n) ? n : 0);
  const sat = Math.min(100, Math.max(0, fin(s))) / 100, hue = ((fin(h) % 360) + 360) % 360 / 60;
  const f = (n: number) => { const k = (n + hue) % 6; return 1 - sat * Math.max(0, Math.min(k, 4 - k, 1)); };
  return "#" + [5, 3, 1].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("");
}

/** `null` for anything that is not #rrggbb. */
export function hexToHs(hex: string): [number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(((h * 60) + 360) % 360), Math.round(max ? (d / max) * 100 : 0)];
}

export const MAX_PALETTE = 6;
const luma = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };

/**
 * S17.5: a palette dealt over `count` lights. Colours that are not #rrggbb or that repeat are dropped, the brightest six are kept and
 * ordered brightest first (so the order the user picked them in does not change the result), then light j gets colour j mod n. Pure:
 * the same palette and count always give the same list.
 */
export function spreadColours(palette: string[], count: number): [number, number][] {
  if (!(count > 0)) return [];
  const seen = new Set<string>();
  const ok = palette.flatMap((c) => { const h = typeof c === "string" ? c.toLowerCase() : ""; if (!hexToHs(h) || seen.has(h)) return []; seen.add(h); return [h]; });
  ok.sort((a, b) => luma(b) - luma(a) || (a < b ? -1 : 1));
  const use = ok.slice(0, MAX_PALETTE).map((h) => hexToHs(h) as [number, number]);
  if (!use.length) return [];
  return Array.from({ length: Math.floor(count) }, (_, j) => [...use[j % use.length]] as [number, number]);
}
