// S23.4 (V10): the ink a glyph wears on a solid disc. An on device is a disc in its own colour; the glyph on it must read
// at 4.5:1 (WCAG AA). Neither fixed theme ink reaches that on every accent (white on TV blue is 4.26:1, #2b2a27 on it 3.6:1),
// so the theme's own ink is used where it is enough and pure black or white otherwise: one of the two always clears 4.58:1.
// Computed once per theme when the stylesheet is built, and at render time for a colour only the state knows (a lamp's
// rgb_color, a plug's heat, a layout's own device colour). Pure, no DOM.

type Rgb = [number, number, number];

/** `#rgb`, `#rrggbb` or `rgb(r,g,b)` as 0..255 channels; null for anything else (a var(), a name, junk). */
function parse(c: string): Rgb | null {
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16)) as Rgb;
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as Rgb;
  m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(s);
  if (m) { const v = [m[1], m[2], m[3]].map(Number); return v.every((n) => n <= 255) ? (v as Rgb) : null; }
  return null;
}
const hex = (c: Rgb) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

/** The WCAG contrast ratio of two colours, 1..21; 1 when either cannot be read. */
export function contrast(a: string, b: string): number {
  const x = parse(a), y = parse(b);
  if (!x || !y) return 1;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** The glyph ink for a disc of colour `bg`: the theme's dark ink, else its light ink, if either reaches 4.5:1; else black or white, whichever is stronger. */
export function pickInk(bg: string, onLight: string, onDark: string): string {
  for (const ink of [onLight, onDark]) if (contrast(bg, ink) >= 4.5) return ink;
  return contrast(bg, "#000") >= contrast(bg, "#fff") ? "#000" : "#fff";
}
/** The ink for a colour only the state knows: black or white. An unreadable colour gets white, the old glyph colour on a dark disc. */
export const inkFor = (bg: string) => (parse(bg) ? pickInk(bg, "#000", "#fff") : "#fff");

/** CSS `color-mix(in srgb, a share, b)`, as hex. */
export function mixSrgb(a: string, b: string, share: number): string {
  const x = parse(a), y = parse(b);
  if (!x || !y) return a;
  return hex(x.map((v, i) => v * share + y[i] * (1 - share)) as Rgb);
}

// oklch, for the plug's heat ramp: the stylesheet mixes it in oklch, so its ink has to be picked from the same colour.
function toOklch(c: Rgb): Rgb {
  const [r, g, b] = c.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}
function fromOklch([L, C, H]: Rgb): Rgb {
  const A = C * Math.cos((H * Math.PI) / 180), B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const enc = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
  return [enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}
/** CSS `color-mix(in oklch, a share, b)` (shorter hue arc), as hex; exact at either end. */
function mixOklch(a: string, b: string, share: number): string {
  if (share >= 1) return a;
  if (share <= 0) return b;
  const x = toOklch(parse(a)!), y = toOklch(parse(b)!);
  let dh = x[2] - y[2];
  if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  return hex(fromOklch([x[0] * share + y[0] * (1 - share), x[1] * share + y[1] * (1 - share), y[2] + dh * share]));
}

/** The plug heat ramp's fixed colours (render.ts, `--fp-heat-*`). */
export const HEAT = { cool: "#2f86c9", mid: "#f0a020", hot: "#d63a2a" } as const;
/** The colour the stylesheet's `.dev-plug.on[style*="--fp-heat"]` rule gives heat `h` (0..1): cool to mid over the first half, mid to hot over the second. */
export function heatColour(h: number): string {
  const t = Math.min(1, Math.max(0, Number.isFinite(h) ? h : 0));
  return mixOklch(mixOklch(HEAT.cool, HEAT.mid, 1 - Math.min(t * 2, 1)), HEAT.hot, 1 - Math.max(t * 2 - 1, 0));
}

const pairs = (tokens: string) => new Map((tokens.match(/--fp-[a-z0-9-]+:[^;]+/g) ?? []).map((kv) => { const i = kv.indexOf(":"); return [kv.slice(0, i), kv.slice(i + 1).trim()] as [string, string]; }));

/**
 * What a theme adds on top of its tokens, as a CSS declaration list: an `-ink` for each device colour, idle and danger (the
 * colours a disc can be), and `--fp-glow-blend` (S23.8: screen on a dark theme, multiply on a light one). `idle`, when given,
 * replaces the theme's idle and every token that was the same colour as the old idle (S23.4, V11: blueprint's idle).
 * A token that is not a plain colour (Home Assistant's var()s) gets no ink; the stylesheet's fallback covers it.
 */
export function themeExtras(tokens: string, dark: boolean, idle?: string): string {
  const t = pairs(tokens), out: string[] = [];
  const oldIdle = t.get("--fp-idle");
  if (idle) for (const [k, v] of t) if (v === oldIdle) { t.set(k, idle); out.push(`${k}:${idle}`); }
  const onLight = t.get("--fp-on-light") ?? "#2b2a27", onDark = t.get("--fp-on-dark") ?? "#fff";
  for (const [k, v] of t) if ((k === "--fp-idle" || k === "--fp-danger" || k.startsWith("--fp-dev-")) && parse(v)) out.push(`${k}-ink:${pickInk(v, onLight, onDark)}`);
  out.push(`--fp-glow-blend:${dark ? "screen" : "multiply"}`);
  return out.join(";");
}
