import type { DeviceType } from "./schema";

/** A theme built from four roles instead of ~50 independent hexes (Diego, 2026-09-22): `base` is one hue, shaded from
 * background to linework for every structural surface (ground, walls, garden, doors, windows...); `fg` is the text/icon/detail
 * colour, `fgAlpha` its opacity for an icon's background disc; `line` colours the measurement grid and its numbers only, kept
 * apart from `fg` on purpose so it can read as a distinct "technical" layer; `accent` is the one saturated colour for anything
 * "live" - on-state devices, the on-room ring, warnings, the primary action button. `dark` picks which end of the base ramp is
 * the background: true puts the darkest shade at the back (paper is `base`, lines are `fg`), false puts the lightest there.
 * `devices` overrides `accent` for specific device types, for a theme that wants its on-state colours to stay distinct instead
 * of collapsing to one; a type left out uses `accent`. */
export interface ThemeRoles {
  base: string;
  fg: string;
  fgAlpha: number;
  line: string;
  accent: string;
  dark: boolean;
  devices?: Partial<Record<DeviceType, string>>;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const [r, g, b] = m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) : [0, 0, 0];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const S = clamp(s, 0, 100) / 100, L = clamp(l, 0, 100) / 100;
  if (S === 0) { const v = Math.round(L * 255); return `#${[v, v, v].map((x) => x.toString(16).padStart(2, "0")).join("")}`; }
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
  const H = ((h % 360) + 360) % 360 / 360;
  const f = (t0: number) => {
    let t = t0; if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const [r, g, b] = [f(H + 1 / 3), f(H), f(H - 1 / 3)].map((v) => Math.round(v * 255));
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** One structural surface's position on the base ramp: 0 is the background, 1 is the strongest linework (an external wall). */
const RAMP: [string, number][] = [
  ["bg", 0], ["room", 0.08], ["garden", 0.14], ["water", 0.16], ["terrace", 0.18], ["pavement", 0.20], ["fill", 0.22],
  ["fillLine", 0.30], ["idle", 0.42], ["sealed", 0.42], ["tread", 0.55], ["wallEdge", 0.55], ["wallFence", 0.55],
  ["wall", 0.78], ["wallExternal", 0.92],
];

/** A shade of `base` at ramp position `t` (0 background, 1 strongest line): lightness runs dark-to-light or light-to-dark
 * depending on `dark`, saturation eases up slightly for the strongest shades so linework doesn't wash out. */
function shade(base: string, dark: boolean, t: number): string {
  const [h, s0] = hexToHsl(base);
  const l = dark ? lerp(9, 78, t) : lerp(95, 14, t);
  const s = clamp(s0 * lerp(0.75, 1.15, t), 8, 85);
  return hslToHex(h, s, l);
}

const ON_DEVICES: DeviceType[] = ["light", "motion", "contact", "heater", "climate", "ac", "tv", "media", "cover", "plug", "computer"];

/** Builds a full `--fp-*` token string from four roles, so a new theme is four colours and a lightness direction, not ~50
 * independent hexes to keep in step by hand. */
export function rolesToTokens(roles: ThemeRoles): string {
  const shades = Object.fromEntries(RAMP.map(([k, t]) => [k, shade(roles.base, roles.dark, t)])) as Record<string, string>;
  const devFor = (t: DeviceType) => roles.devices?.[t] ?? roles.accent;
  const acCool = roles.devices?.ac ?? roles.accent, acHeat = roles.devices?.ac ?? roles.accent;
  return [
    `--fp-ink:${roles.fg}`, `--fp-bg:${shades.bg}`, `--fp-room:${shades.room}`, `--fp-room-empty:#d6d6d2`,
    `--fp-garden:${shades.garden}`, `--fp-terrace:${shades.terrace}`, `--fp-pavement:${shades.pavement}`,
    `--fp-wall:${shades.wall}`, `--fp-idle:${shades.idle}`,
    `--fp-on:${roles.accent}`, `--fp-open:${roles.accent}`, `--fp-motion:${devFor("motion")}`, `--fp-heater:${devFor("heater")}`,
    `--fp-door:${roles.fg}`, `--fp-glass:${roles.fg}`, `--fp-window:${roles.fg}`, `--fp-sealed:${shades.sealed}`,
    `--fp-water:${shades.water}`, `--fp-fill:${shades.fill}`, `--fp-fill-line:${shades.fillLine}`,
    `--fp-tread:${shades.tread}`,
    `--fp-dev-light:${devFor("light")}`, `--fp-dev-motion:${devFor("motion")}`, `--fp-dev-contact:${devFor("contact")}`,
    `--fp-dev-heater:${devFor("heater")}`, `--fp-dev-climate:${devFor("climate")}`, `--fp-dev-ac-cool:${acCool}`,
    `--fp-dev-ac-heat:${acHeat}`, `--fp-dev-tv:${devFor("tv")}`, `--fp-dev-media:${devFor("media")}`,
    `--fp-dev-cover:${devFor("cover")}`, `--fp-dev-plug:${devFor("plug")}`, `--fp-dev-computer:${devFor("computer")}`,
    `--fp-dev-camera:${shades.idle}`, `--fp-dev-garden:${shades.idle}`,
    `--fp-halo:${roles.fg}`, `--fp-alpha:.25`, `--fp-disc:${roles.fg}`, `--fp-disc-alpha:${roles.fgAlpha}`,
    `--fp-outline:${shades.bg}`, `--fp-text:${roles.fg}`,
    // warn/danger/primary and their on-dark/on-light text stay the same fixed pair in every theme, generated or not
    // (matching midnight and light before them): they are UI chrome, not "device on" state, and each already clears
    // 4.5:1 against its own fixed text colour - collapsing them into the accent broke that pairing (Opus review, 2026-09-22).
    `--fp-warn:#f28c28`, `--fp-danger:#b02a2a`, `--fp-primary:#1f6699`,
    `--fp-wall-external:${shades.wallExternal}`, `--fp-wall-fence:${shades.wallFence}`,
    `--fp-wall-edge:${shades.wallEdge}`, `--fp-measure:${roles.line}`, `--fp-glow:${roles.accent}`, `--fp-aura:${roles.accent}`,
    `--fp-active:${roles.accent}`,
    `--fp-on-dark:#fff`, `--fp-on-light:#2b2a27`,
  ].join(";");
}

// Unused named export kept for the ac-devices loop's intent to read clearly at the call site; ON_DEVICES documents which
// types have an .on rule at all (camera and outdoor/garden are static icon tints, not accent-gated - see rolesToTokens).
export { ON_DEVICES };
