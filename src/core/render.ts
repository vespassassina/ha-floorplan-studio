import { DEVICE_ICONS, FURNITURE } from "./icons";
import { dist, edgeKindsNear, stairSteps } from "./geometry";
import { stairMarks } from "./stair-marks";
import { resolveStairDirection, type FloorsAround } from "./stairs";
import { DEVICE_TYPES, drawsEffect, fxScale, isSiren, MAX_TRACE_BYTES, MOTION_TYPES, TRACE_SRC } from "./schema";
import { TEXTURE_IDS, texturePatterns, texturePatternId, normTextureRot, normTextureScale } from "./textures";
import { rolesToTokens } from "./theme-roles";
import { esc, num, pts, tag } from "./fmt";
import { coverActive } from "./cover";
import { doorStateOf } from "./door-state";
import { plugThreshold, wattsOf } from "./power";
import { meanReading } from "./readings";
import { DEVICE_SOLID, STEM_MIN_Z, furnitureMode, deviceSolid, furnitureSolid, stairSolids, tallestDrawn, unlinkedSolid, wallSolids, wallsModeOf, type Proj, type Solid, type WallsMode } from "./solids";
import { deviceZ, edgeHeight, floorHeight, wallHeight } from "./heights";
import type { Device, DeviceType, EdgeKind, Floor, Layout, Pt, RoomKind, Stairs } from "./schema";

export interface StateOverlay { [entityId: string]: { state: string; attributes: Record<string, unknown>; last_changed: string } }
export interface RenderOpts {
  /** S11.3: the room the card has picked (its left panel shows it); drawn with an outline, class `picked`. The editor draws its own selection in an overlay and never passes this. */
  selectedRoom?: number;
  scale: number; selection?: { t: string; i: number } | null; showNames?: boolean; filter?: DeviceType[];
  state?: StateOverlay; now?: number; fade?: number; roomGlow?: boolean; editor?: boolean;
  /** Turns the whole drawing by `deg` (clockwise) about `pivot`; names, values and icons are turned back so they stay upright. */
  rotate?: { deg: number; pivot: Pt };
  /** `layout.colors`: a colour per device type, set as `--fp-dev-<type>` on a group round the drawing. */
  colors?: Layout["colors"];
  /** Names this plan's theme, regardless of its host's; omitted inherits the host's, and with no host theme at all the plan is blueprint. Nothing else in core reads it. */
  theme?: Theme;
  /** With `theme: "ha"`: true when Home Assistant itself is in dark mode, so the tokens HA's CSS variables do not cover (device colours, glow, the on-room stroke) are the dark ones. */
  dark?: boolean;
  /** S4.5: entity ids to draw faded (class `dim`) — every device not in the Group menu's chosen group. */
  dimmed?: ReadonlySet<string>;
  /** S7.11: draw the floor's trace image under everything. Only the editor passes it; the card never does. */
  trace?: boolean;
  /** S7.6: after sunset. Every room gets a `room-night` overlay, `lit` when a light inside it is on; the root carries class `night`. */
  night?: boolean;
  /** "2d" (default, also when omitted) is the flat plan, byte for byte as ever; "2.5d" adds depth (see OBLIQUE). */
  view?: PlanView;
  /** `false` draws no text at all: room, zone, extra and device names, sensor values and the leader lines. Icons, tap targets and state stay. Default `true`; absent output is byte for byte as before. */
  labels?: boolean;
  /** 0..1, how steeply the 2.5D view looks down: 0 is top-down (no lift), 1 is side-on. Only read with `view: "2.5d"`; see `obliqueFor`. Default `DEFAULT_TILT`, today's look. */
  tilt?: number;
  /** 2.5D wall heights: "full" every wall at its model height, "cut" (default, also for junk) the doll's house cutaway, "low" every wall at the cutaway height. See `WALLS_MODES`. 2D ignores it. */
  walls?: WallsMode;
  /** A plug is active from this many watts (default 2, `PLUG_ACTIVE_WATTS`). Junk is the default; see power.ts. */
  plugWatts?: number;
  /** Plug entity -> power sensor entity, found at runtime by the card for plugs with no `power` of their own. An explicit `power` wins. */
  powerLinks?: Record<string, string>;
  /** Whether the house has a floor over this one and under it, for the direction a stair with no `direction` of its own takes (stairs.ts). Omitted, the neighbours are unknown and such a stair reads up, as ever. */
  around?: FloorsAround;
}
/** How the plan is drawn. "3d" will be a different renderer (docs/DECISIONS.md), so it is not a member yet. */
export type PlanView = "2d" | "2.5d";
/**
 * The 2.5D projection, the one place to tune it. A vertical oblique: the floor stays true to the plan and a point at
 * plan (x, y) and height h cm is drawn at (x + h*skew*rise, y - h*rise). `rise` is how far up one cm of height goes on
 * screen, `skew` how far right per cm of that rise. `cutaway` is the height in cm a wall that would hide a room's
 * interior is drawn at, like a doll's house with the front taken off (see `solids.ts`).
 */
export const OBLIQUE = { rise: 0.55, skew: 0.3, cutaway: 90 };
/** The tilt at which `obliqueFor` gives exactly `OBLIQUE`. */
export const DEFAULT_TILT = 0.5;
/** A tilt from untrusted input: finite numbers clamp to 0..1, anything else is the default. */
export const clampTilt = (t: unknown): number => (typeof t === "number" && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : DEFAULT_TILT);
/** Rise at tilt 1: steep side-on. Rise is linear in tilt, so the default (0.5) lands on OBLIQUE.rise, 0.55. */
const MAX_RISE = 1.1;
/** What a cutaway front wall may hide on screen (OBLIQUE.cutaway * OBLIQUE.rise). Held constant so interiors stay as
 * visible at a steep tilt as at the default; the cm height falls as the lift grows. */
const HIDDEN_BY_FRONT_WALL = 49.5;
/** The tilt slider mapped to the projection: one function, so the card, the editor, `viewBoxFor` and the solids agree.
 * Skew stays put (it fixes which side faces show, not how tall they are). At tilt 0 there is no lift, so no front wall
 * hides anything and the cutaway is capped at 200 cm to stay finite. */
export function obliqueFor(tilt: unknown): { rise: number; skew: number; cutaway: number } {
  const rise = clampTilt(tilt) * MAX_RISE;
  if (rise === OBLIQUE.rise) return { ...OBLIQUE };
  return { rise, skew: OBLIQUE.skew, cutaway: Math.min(200, Math.round(HIDDEN_BY_FRONT_WALL / Math.max(rise, 1e-9))) };
}
/** blueprint is the default and the look of the project; midnight is the project's first dark theme (2026-09-21), kept under
 * its own name once blueprint moved on to a new palette; light is the same plan on paper; slate and terminal are the other two
 * role-generated presets; solarized is the bespoke Solarized palette; ha takes its neutrals straight from Home Assistant's own
 * CSS variables; coffee, a-team, space, cyberpunk, carpenter-brut and beach-house (2026-09-28, Diego's picks) are six more
 * role-generated presets, the same `rolesToTokens` four-colour system as blueprint/slate/terminal. */
export const THEMES = ["blueprint", "midnight", "light", "slate", "terminal", "solarized", "ha", "coffee", "a-team", "space", "cyberpunk", "carpenter-brut", "beach-house"] as const;
export type Theme = (typeof THEMES)[number];

/** The `fill` attribute for a room or staircase that carries its own paint: a texture wins over a colour. Both are checked against a fixed list or a strict pattern, because the value goes into an attribute. */
const paintAttr = (r: { color?: string; texture?: string; textureRot?: number; textureScale?: number }) =>
  typeof r.texture === "string" && TEXTURE_IDS.includes(r.texture) ? ` fill="url(#${texturePatternId(r.texture, normTextureRot(r.textureRot), normTextureScale(r.textureScale))})"` : typeof r.color === "string" && COLOR.test(r.color) ? ` fill="${r.color}"` : "";

/** The colour each device type has when `layout.colors` says nothing: the `--fp-dev-*` defaults below; types with none of their own use the idle grey. */
export const DEVICE_COLOURS: Record<DeviceType, string> = {
  heater: "#e8801a", light: "#e0a800", switch: "#8b8578", plug: "#2c7fb8", temp: "#8b8578", humidity: "#8b8578", motion: "#d64545",
  contact: "#d64545", camera: "#4a4a48", climate: "#e8801a", ac: "#2c7fb8", tv: "#2c7fb8", computer: "#2c7fb8", media: "#2c7fb8",
  cover: "#f28c28", battery: "#8b8578", inverter: "#8b8578", server: "#8b8578", access_point: "#8b8578",
  lock: "#d64545", vibration: "#d64545", other: "#8b8578",
  boiler: "#8b8578", car: "#8b8578", ups: "#8b8578", printer: "#8b8578", speaker: "#2c7fb8",
  person: "#1b9e77", radar: "#6a3fbf", vacuum: "#2f8f8f",
};

// S1.53: the light and dark (now blueprint) token sets, each written once and interpolated wherever CSS needs it, so a new
// token can never be added to one selector and forgotten in another. The "ha" theme is built from the same two.
const LIGHT_TOKENS = `--fp-ink:#2b2a27;--fp-bg:#f4f0e6;--fp-room:#e9e3d3;--fp-room-empty:#d6d6d2;--fp-garden:#9db98a;--fp-terrace:#cdb094;--fp-pavement:#c9c6bf;--fp-wall:#2b2a27;--fp-idle:#8b8578;
--fp-on:#e0a800;--fp-open:#f28c28;--fp-motion:#d64545;--fp-heater:#e8801a;--fp-door:#a5601c;--fp-glass:#1b9e77;--fp-window:#2c7fb8;--fp-sealed:#9a8f80;--fp-water:#a9cfe3;--fp-fill:#c4c0b8;--fp-fill-line:#9a958b;
--fp-tread:#8b8578;--fp-dev-light:#e0a800;--fp-dev-motion:#d64545;--fp-dev-contact:#d64545;--fp-dev-heater:#e8801a;--fp-dev-climate:#e8801a;--fp-dev-ac-cool:#2c7fb8;--fp-dev-ac-heat:#e8801a;--fp-dev-tv:#2c7fb8;--fp-dev-media:#2c7fb8;--fp-dev-cover:#f28c28;--fp-dev-plug:#2c7fb8;--fp-dev-computer:#2c7fb8;--fp-dev-camera:#4a4a48;--fp-dev-garden:#3f8f4f;--fp-dev-person:#1b9e77;--fp-dev-radar:#6a3fbf;--fp-dev-vacuum:#2f8f8f;--fp-dev-speaker:#2c7fb8;--fp-halo:#8b8578;--fp-alpha:.25;--fp-disc:#fff;--fp-disc-alpha:.5;--fp-outline:#fff;--fp-text:#3a3a3a;--fp-warn:#f28c28;--fp-danger:#b02a2a;--fp-primary:#1f6699;--fp-furniture:#79766e;--fp-wall-external:#1a1917;--fp-wall-fence:#7a5c3a;--fp-wall-edge:#a29e94;--fp-measure:#3a3a3a;--fp-glow:#f5e2a0;--fp-aura:#f0c419;--fp-active:#8a5117;--fp-night:rgba(4,10,30,.45);
--fp-on-dark:#fff;--fp-on-light:#2b2a27;--fp-open-door:var(--fp-dev-contact)`;
/* Midnight (Diego's call, 2026-09-21, ex-"blueprint"): a deep navy ground, blue linework for walls, cool-white text, from the
   reference screenshot he supplied. It replaced HA's night-blue; light is unchanged. Every accent that carries meaning (device colours, the warn/danger/primary
   buttons) keeps the same hex as light: each already clears 4.5:1 against its fixed on-dark/on-light text token, so
   none needed lightening. Only the neutrals (ink, bg, room, wall, disc, halo, tread, outline, measure,
   wall-external/-fence) change, because those are the tokens a dark background actually breaks. Renamed to "midnight" on
   2026-09-22 when "blueprint" moved on to the role-generated palette below (Diego's brief: four roles - a blue base, a white
   foreground, a terminal-green line colour and a saturated orange accent). */
const MIDNIGHT_TOKENS = `--fp-ink:#d8e2f2;--fp-bg:#0d1522;--fp-room:#14213a;--fp-room-empty:#d6d6d2;--fp-garden:#9db98a;--fp-terrace:#cdb094;--fp-pavement:#c9c6bf;--fp-wall:#8fb4f0;--fp-idle:#8b8578;
--fp-on:#e0a800;--fp-open:#f28c28;--fp-motion:#d64545;--fp-heater:#e8801a;--fp-door:#a5601c;--fp-glass:#1b9e77;--fp-window:#2c7fb8;--fp-sealed:#9a8f80;--fp-water:#a9cfe3;--fp-fill:#c4c0b8;--fp-fill-line:#9a958b;
--fp-tread:#6f93c9;--fp-dev-light:#e0a800;--fp-dev-motion:#d64545;--fp-dev-contact:#d64545;--fp-dev-heater:#e8801a;--fp-dev-climate:#e8801a;--fp-dev-ac-cool:#2c7fb8;--fp-dev-ac-heat:#e8801a;--fp-dev-tv:#2c7fb8;--fp-dev-media:#2c7fb8;--fp-dev-cover:#f28c28;--fp-dev-plug:#2c7fb8;--fp-dev-computer:#2c7fb8;--fp-dev-camera:#8a8a86;--fp-dev-garden:#3f8f4f;--fp-dev-person:#1b9e77;--fp-dev-radar:#8f6fd6;--fp-dev-vacuum:#35b0b0;--fp-dev-speaker:#2c7fb8;--fp-halo:#6f8fbf;--fp-alpha:.25;--fp-disc:#14213a;--fp-disc-alpha:.5;--fp-outline:#0d1522;--fp-text:#d8e2f2;--fp-warn:#f28c28;--fp-danger:#b02a2a;--fp-primary:#1f6699;--fp-furniture:#79766e;--fp-wall-external:#b4cdf7;--fp-wall-fence:#a67c52;--fp-wall-edge:#a29e94;--fp-measure:#8fb4f0;--fp-glow:#4a3f22;--fp-aura:#f0c419;--fp-active:#e0a800;--fp-night:rgba(4,10,30,.45);
--fp-on-dark:#fff;--fp-on-light:#2b2a27;--fp-open-door:var(--fp-dev-contact)`;

// The three role-generated themes (2026-09-22, Diego's brief): each is one base hue shaded into every structural token, one
// foreground colour for text/icons/detail, one line colour for the measurement grid, and one accent for anything "on" or
// "live". Device colours default to the accent (Diego: "collapse to one accent"); a theme can override specific types via
// `devices` when it wants them to stay distinct instead (see ThemeRoles in theme-roles.ts) - none of these three do.
const BLUEPRINT_TOKENS = rolesToTokens({ base: "#1c3f73", fg: "#eef3fb", fgAlpha: .5, line: "#35d47a", accent: "#ff8a1f", dark: true });
const SLATE_TOKENS = rolesToTokens({ base: "#9a9a96", fg: "#2b2a27", fgAlpha: .5, line: "#2f7a4a", accent: "#cc5500", dark: false });
const TERMINAL_TOKENS = rolesToTokens({ base: "#0c1512", fg: "#35d47a", fgAlpha: .5, line: "#35d47a", accent: "#ffb000", dark: true });

// Five more role-generated presets (2026-09-28, Diego's picks), the same four-colour system as the three above.
// coffee's own base already carries a warm brown across bg/walls, so the default grey `roomEmpty` sits fine against
// it; a-team/space/cyberpunk/carpenter-brut are dark and far more saturated, and the same fixed light grey read as a
// hole punched in the plan (Diego, 2026-09-28) - each gets its own dark roomEmpty instead, a shade of its own base.
const COFFEE_TOKENS = rolesToTokens({ base: "#2b1d14", fg: "#f3e5d0", fgAlpha: .5, line: "#a9713c", accent: "#f2a134", dark: true });
const A_TEAM_TOKENS = rolesToTokens({ base: "#141414", fg: "#e8e8e8", fgAlpha: .5, line: "#cc1f1f", accent: "#d4af37", dark: true, roomEmpty: "#242424" });
const SPACE_TOKENS = rolesToTokens({ base: "#050814", fg: "#eaf2ff", fgAlpha: .5, line: "#4fd8ff", accent: "#b14aff", dark: true, roomEmpty: "#141b33" });
const CYBERPUNK_TOKENS = rolesToTokens({ base: "#0b0014", fg: "#00e5ff", fgAlpha: .5, line: "#ff2bd6", accent: "#f9f002", dark: true, roomEmpty: "#22093a" });
const CARPENTER_BRUT_TOKENS = rolesToTokens({ base: "#170406", fg: "#ffd9e8", fgAlpha: .5, line: "#8f1022", accent: "#ff2f6e", dark: true, roomEmpty: "#2b0a10" });

// beach-house (2026-09-28, Diego's pick): a light theme, sand for the base (bg through walls), sea teal for the
// measurement line, palm-green as the one accent for anything "on". fg is a driftwood-dark brown-grey, enough
// contrast on sand without going as stark as pure black ink.
const BEACH_HOUSE_TOKENS = rolesToTokens({ base: "#e3cd9c", fg: "#3a3226", fgAlpha: .5, line: "#1a7a8a", accent: "#2f9e44", dark: false });

/* Solarized (bespoke, not role-generated - Diego's call, 2026-09-22: real Solarized fidelity matters more here than reuse).
   The dark variant, base03 background, base1 body text; each device type keeps its own Solarized hue rather than collapsing
   to one accent, demonstrating the per-type override the theme format supports. S9.3: --fp-dev-tv was #6c71c4 (Solarized
   violet), which read as blue-ish but was not blue; it is now #268bd2, Solarized's own blue (the same hex as --fp-window
   and --fp-dev-ac-cool here) — TV is the one exception to "each type keeps its own hue" too. */
const SOLARIZED_TOKENS = `--fp-ink:#93a1a1;--fp-bg:#002b36;--fp-room:#073642;--fp-room-empty:#d6d6d2;--fp-garden:#586e75;--fp-terrace:#657b83;--fp-pavement:#586e75;--fp-wall:#93a1a1;--fp-idle:#586e75;
--fp-on:#b58900;--fp-open:#cb4b16;--fp-motion:#dc322f;--fp-heater:#cb4b16;--fp-door:#cb4b16;--fp-glass:#2aa198;--fp-window:#268bd2;--fp-sealed:#586e75;--fp-water:#268bd2;--fp-fill:#073642;--fp-fill-line:#586e75;
--fp-tread:#93a1a1;--fp-dev-light:#b58900;--fp-dev-motion:#dc322f;--fp-dev-contact:#dc322f;--fp-dev-heater:#cb4b16;--fp-dev-climate:#cb4b16;--fp-dev-ac-cool:#268bd2;--fp-dev-ac-heat:#cb4b16;--fp-dev-tv:#268bd2;--fp-dev-media:#d33682;--fp-dev-cover:#cb4b16;--fp-dev-plug:#268bd2;--fp-dev-computer:#268bd2;--fp-dev-camera:#586e75;--fp-dev-garden:#859900;--fp-dev-person:#2aa198;--fp-dev-radar:#6c71c4;--fp-dev-vacuum:#859900;--fp-dev-speaker:#268bd2;--fp-halo:#93a1a1;--fp-alpha:.25;--fp-disc:#073642;--fp-disc-alpha:.5;--fp-outline:#002b36;--fp-text:#93a1a1;--fp-warn:#b58900;--fp-danger:#dc322f;--fp-primary:#268bd2;--fp-furniture:#79766e;--fp-wall-external:#fdf6e3;--fp-wall-fence:#cb4b16;--fp-wall-edge:#586e75;--fp-measure:#859900;--fp-glow:#657b83;--fp-aura:#b58900;--fp-active:#b58900;--fp-night:rgba(4,10,30,.45);
--fp-on-dark:#fdf6e3;--fp-on-light:#002b36;--fp-open-door:var(--fp-dev-contact)`;
/* "ha": the neutrals come from Home Assistant's own variables, so the plan is the colour of the user's dashboard whatever theme they run. The
   fallback of each is the hex the plain theme would have had, so outside Home Assistant (no variable defined) it degrades to that theme, not to
   nothing. Not mapped, on purpose: primary, danger, warn. HA's error and warning colours fail 4.5:1 against the fixed white or dark text on our
   buttons in some themes, and the device colours carry meaning that must not move with a theme. */
const haTokens = (base: string, fb: Record<string, string>) => `${base};
--fp-ink:var(--primary-text-color,${fb.ink});--fp-text:var(--primary-text-color,${fb.text});--fp-bg:var(--card-background-color,${fb.bg});--fp-room:var(--secondary-background-color,${fb.room});--fp-wall:var(--primary-text-color,${fb.wall});--fp-wall-external:var(--primary-text-color,${fb.wallExternal});--fp-outline:var(--card-background-color,${fb.outline});--fp-disc:var(--card-background-color,${fb.disc});--fp-measure:var(--secondary-text-color,${fb.measure})`;
const HA_LIGHT = haTokens(LIGHT_TOKENS, { ink: "#2b2a27", text: "#3a3a3a", bg: "#f4f0e6", room: "#e9e3d3", wall: "#2b2a27", wallExternal: "#1a1917", outline: "#fff", disc: "#fff", measure: "#3a3a3a" });
const HA_DARK = haTokens(MIDNIGHT_TOKENS, { ink: "#d8e2f2", text: "#d8e2f2", bg: "#0d1522", room: "#14213a", wall: "#8fb4f0", wallExternal: "#b4cdf7", outline: "#0d1522", disc: "#14213a", measure: "#8fb4f0" });


/**
 * S8.9 (Diego, 2026-09-26): internal walls thicker than before, external walls thicker still, in plan cm. Named
 * once so the stylesheet below, a door or window's own stroke (`wallWidthAt`) and the unit test that pins every
 * `WallKind`'s thickness can never drift apart. Fence, edge, the dashed no-wall ("boundary") and "none" edges are
 * unaffected — only a plain wall and an external wall changed.
 */
export const WALL_WIDTH = 10;
export const WALL_WIDTH_EXTERNAL = 20;
/** Each wall's white halo (`.eh`) stays this many cm wider than the wall it outlines, both kinds, same as before. */
const WALL_HALO_EXTRA = 2;

/** Default colours. Hosts (card, editor) override the --fp-* variables. Kept out of the markup on purpose. */
/** A room's motion border pulses this many times, each this many seconds, when its sensor trips. */
export const MOTION_PULSES = 3, MOTION_PULSE_S = 1.4;

export const FLOORPLAN_CSS = `
:host,.fp{${BLUEPRINT_TOKENS}}
/* Blueprint is the default: with no data-theme anywhere the plan is blueprint, whatever the OS or Home Assistant is doing (Diego's call, 2026-09-21;
   this replaces the old Auto, which followed prefers-color-scheme). A theme is named by data-theme, on the host (:host([data-theme])) or on one
   plan's own root (renderFloor's theme option, a <g data-theme>). Each rule has three selectors: the host itself, the .fp svg inside it (which the
   base rule above sets directly, so it would not inherit the host's tokens otherwise), and a nested element. Same specificity within a theme; the
   ha+dark rule is one attribute more, so it wins over plain ha. */
:host([data-theme="blueprint"]),:host([data-theme="blueprint"]) .fp,[data-theme="blueprint"]{${BLUEPRINT_TOKENS}}
:host([data-theme="midnight"]),:host([data-theme="midnight"]) .fp,[data-theme="midnight"]{${MIDNIGHT_TOKENS}}
:host([data-theme="light"]),:host([data-theme="light"]) .fp,[data-theme="light"]{${LIGHT_TOKENS}}
:host([data-theme="slate"]),:host([data-theme="slate"]) .fp,[data-theme="slate"]{${SLATE_TOKENS}}
:host([data-theme="terminal"]),:host([data-theme="terminal"]) .fp,[data-theme="terminal"]{${TERMINAL_TOKENS}}
:host([data-theme="solarized"]),:host([data-theme="solarized"]) .fp,[data-theme="solarized"]{${SOLARIZED_TOKENS}}
:host([data-theme="ha"]),:host([data-theme="ha"]) .fp,[data-theme="ha"]{${HA_LIGHT}}
:host([data-theme="ha"][data-mode="dark"]),:host([data-theme="ha"][data-mode="dark"]) .fp,[data-theme="ha"][data-mode="dark"]{${HA_DARK}}
:host([data-theme="coffee"]),:host([data-theme="coffee"]) .fp,[data-theme="coffee"]{${COFFEE_TOKENS}}
:host([data-theme="a-team"]),:host([data-theme="a-team"]) .fp,[data-theme="a-team"]{${A_TEAM_TOKENS}}
:host([data-theme="space"]),:host([data-theme="space"]) .fp,[data-theme="space"]{${SPACE_TOKENS}}
:host([data-theme="cyberpunk"]),:host([data-theme="cyberpunk"]) .fp,[data-theme="cyberpunk"]{${CYBERPUNK_TOKENS}}
:host([data-theme="carpenter-brut"]),:host([data-theme="carpenter-brut"]) .fp,[data-theme="carpenter-brut"]{${CARPENTER_BRUT_TOKENS}}
:host([data-theme="beach-house"]),:host([data-theme="beach-house"]) .fp,[data-theme="beach-house"]{${BEACH_HOUSE_TOKENS}}
/* 2.5D shades, derived from the theme's own wall colour so every theme has them with no per-theme edit. A custom property
   that reads var() is resolved on the element that declares it, so each plan, host and nested theme group derives its own. */
:host,.fp,[data-theme]{--fp-wall-top:var(--fp-wall);--fp-wall-side:color-mix(in srgb,var(--fp-wall) 55%,var(--fp-bg));--fp-box-top:color-mix(in srgb,var(--fp-furniture) 35%,var(--fp-bg));--fp-box-side:color-mix(in srgb,var(--fp-furniture) 60%,var(--fp-bg));--fp-box-side-w:color-mix(in srgb,var(--fp-furniture) 75%,var(--fp-bg))}
/* A room with its own colour carries a fill attribute; the :not([fill]) rules let it show. The fill room keeps its hatch.
   Each kind also names its own fill as --fp-room-fill, so a later rule can tint the room without ever having to know,
   or replace, the colour underneath (Opus review: the glow and on rules below used to read straight from --fp-glow,
   which outranks every rule here on specificity and so blanked out the kind colour entirely — a glowing water room
   went plain yellow, not a tinted blue). */
/* --fp-room-empty (Diego's call, 2026-09-21): a plain "room" or "structure" with no colour or texture of its own reads as
   not-yet-painted, the same light gray in every theme — blueprint, light, and ha (HA's --secondary-background-color no
   longer reaches this one fill; every other --fp-* token still follows HA as before). Garden, terrace, pavement, water
   and zone keep their own kind colour: only the plain, unpainted room is "undefined". */
.room:not([fill]){--fp-room-fill:var(--fp-room-empty);fill:var(--fp-room-fill)} .room-garden:not([fill]){--fp-room-fill:var(--fp-garden);fill:var(--fp-room-fill)} .room-terrace:not([fill]){--fp-room-fill:var(--fp-terrace);fill:var(--fp-room-fill)} .room-pavement:not([fill]){--fp-room-fill:var(--fp-pavement);fill:var(--fp-room-fill)}
.room.room-fill{--fp-room-fill:var(--fp-fill);fill:url(#fp-hatch)} .room-zone:not([fill]){--fp-room-fill:transparent;fill:none} .room-water:not([fill]){--fp-room-fill:var(--fp-water);fill:var(--fp-room-fill)}
/* S2.6: room_glow. Three classes (.room.glow:not([fill])) outrank every rule above (two classes each), so which
   wins is settled by specificity, not source order (CLAUDE.md finding 10: a [fill] attribute beat a class once
   before). A room with its own colour (own[fill] attribute) is the user's choice and keeps it, glowing or not.
   The fill mixes into --fp-room-fill (the kind's own colour) instead of overwriting it, so a glowing water room
   stays blue, just brighter. 25%, the same fraction as --fp-alpha elsewhere, keeps the kind colour recognisable
   (a lit water room reads pale teal, not pale yellow); 50% washed it out almost to the glow colour alone. */
.room.glow:not([fill]){fill:color-mix(in srgb,var(--fp-glow) 25%,var(--fp-room-fill))}
/* S7.6: night. The overlay is its own polygon over the room, so it darkens a room's own colour or texture too, and never
   competes with the room's fill rules above. Unlit by default (one class), dark under .night (two), clear again when
   a light in the room is on (three): specificity decides, not source order. Never a pick target (finding 18). */
.room-night{fill:none;pointer-events:none} .night .room-night{fill:var(--fp-night)} .night .room-night.lit{fill:none}
/* S1.37: a room with an entity (never one with an area) gets an outline when that entity is on, open or playing.
   This used to be the same fill tint as room_glow above, but a fill has to compete with a colour that already
   carries meaning: --fp-glow is a pale warm yellow, --fp-water is a pale cool blue at nearly the same lightness,
   so mixing them desaturated instead of brightened — an ON pond read as a duller, greyer blue than an OFF one,
   confidently wrong rather than obviously wrong (Opus review, rendered and looked at). A stroke never fights the
   fill, reads on every kind including zone (fill:none, so a fill tint there was a silent no-op), and reuses
   --fp-active, the same token furniture already wears when on, so "on" is one colour across the whole plan.
   No :not([fill]) guard: a stroke doesn't touch fill, so a room's own colour is untouched either way. */
.room.on{stroke:var(--fp-active);stroke-width:3;vector-effect:non-scaling-stroke}
/* The ring pass below carries a pointer-events="none" attribute, and the editor overrides rooms with
   .room{pointer-events:all} — a presentation attribute loses to any author rule, so the attribute alone would
   make the ring a click target with no data-r the day the editor renders live state. Two classes beat one. */
.room.ring{pointer-events:none}
/* A room with a triggered motion sensor in it: one thin line inside its walls, in the sensor's own colour (a radar in
   the radar colour), for as long as the sensor is on. renderFloor masks the wide stroke down to the line; the editor's
   .room{pointer-events:all} does not touch it, being a different class, and a class rule beats the attribute (finding 18). */
.motion-perimeter{fill:none;stroke:var(--fp-dev-motion);stroke-linejoin:round;pointer-events:none;opacity:var(--fp-fade,1)} .motion-perimeter.radar{stroke:var(--fp-dev-radar)}
/* S11.1: a room's own motion sensor trips: the same border pulses ${MOTION_PULSES} times, then holds steady while the sensor is on, and fades with
   --fp-fade once it is off. Never an endless blink. A redraw restarts a CSS animation, so renderFloor puts the trip's age in
   --fp-pulse-age (and the class only while the pulses last) and the negative delay starts it that far in: a redraw in the
   middle of the pulses carries on, it does not replay them. Reduced motion: no pulse, the steady edge only. */
.motion-perimeter.motion-pulse{animation:fp-motion-pulse ${MOTION_PULSE_S}s ease-in-out ${MOTION_PULSES};animation-delay:calc(var(--fp-pulse-age,0s) * -1)}
@keyframes fp-motion-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.motion-perimeter.motion-pulse{animation:none}}
/* .sel is one class (0,1,0); .room.on is two (0,2,0) and would always outrank it on specificity, so a selected
   room that is also on would stop showing its ink selection outline. This three-class override (0,3,0) wins
   regardless of source order and keeps selection on top (Opus review). */
.room.on.sel{stroke:var(--fp-ink)}
/* S11.3: the room picked in the card: the motion perimeter's inset band, dashed, in the ink colour. Dashes run along the wide band's
   path, so the mask leaves a dashed line. A class rule, not an attribute, for pointer-events (finding 18). */
.room-picked{fill:none;stroke:var(--fp-ink);stroke-linejoin:round;stroke-dasharray:20 12;pointer-events:none}
/* S2.9: furniture with an entity turns present, not paler, when it is on. --fp-glow is a fill tint built to sit
   close to a room's own colour, so reusing it as a stroke colour here made a sofa nearly vanish against the room
   under it in either theme (Opus review). --fp-active is its own token, amber like --fp-on, chosen per theme for
   at least 3:1 contrast against both --fp-room and --fp-bg (measured: light 5.0:1 / 5.6:1, dark 6.8:1 / 8.0:1). */
.furn.on{color:var(--fp-active)}
/* S8.9: internal corners and T-joins at the new 10-20 cm thickness are kept gap-free by the round linecap already
   here (each segment's rounded end overlaps its neighbour's whatever the angle between them); only the numbers
   changed. External walls keep the square cap they always had (a mitred, not rounded, look for the house perimeter). */
.e{stroke:var(--fp-wall);stroke-width:${WALL_WIDTH};stroke-linecap:round} .e.nw{stroke-dasharray:8 6;stroke-width:1.5}
/* 2.5D: the top of a wall. Same stroke as the flat wall, from its own token, and before the .external and .fence rules
   below so an equal-specificity kind rule still wins. */
.e.top{stroke:var(--fp-wall-top)}
.e.external{stroke:var(--fp-wall-external);stroke-width:${WALL_WIDTH_EXTERNAL};stroke-linecap:square} .e.fence{stroke:var(--fp-wall-fence);stroke-width:1.5;stroke-dasharray:10 4 2 4;stroke-linecap:butt} .e.edge{stroke:var(--fp-wall-edge);stroke-width:1.5}
.eh{stroke:var(--fp-outline);stroke-width:${WALL_WIDTH + WALL_HALO_EXTRA};stroke-linecap:round;pointer-events:none} .eh.nw{stroke-dasharray:8 6;stroke-width:3.5} .eh.external{stroke-width:${WALL_WIDTH_EXTERNAL + WALL_HALO_EXTRA};stroke-linecap:square} .eh.fence{stroke-dasharray:10 4 2 4;stroke-width:3.5;stroke-linecap:butt} .eh.edge{stroke-width:3.5}
/* 2.5D solids take no clicks: a tap or a pick goes through to the floor-level shape under them, as in 2D. Furniture is the
   exception: its group is data-f, so a tap on the block reaches it as it reaches the flat symbol. */
.ws,.glass,.eh.top,.e.top,.obj,.stem,.stem-top,.trunk,.wfoot,.wl,.door-leaf,.opn{pointer-events:none}
.bs,.bt{stroke:var(--fp-furniture);stroke-width:1;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.bt{fill:var(--fp-box-top)} .bs{fill:var(--fp-box-side)} .bs.w{fill:var(--fp-box-side-w)}
.trunk{stroke:var(--fp-furniture);stroke-width:8;stroke-linecap:round}
.dsolid .bs,.dsolid .bt{stroke:color-mix(in srgb,var(--fp-body) 60%,var(--fp-on-light))}
.dsolid .bt{fill:color-mix(in srgb,var(--fp-body) 70%,var(--fp-on-dark))} .dsolid .bs{fill:var(--fp-body)} .dsolid .bs.w{fill:color-mix(in srgb,var(--fp-body) 80%,var(--fp-on-light))}
.dsolid.radiator{--fp-body:color-mix(in srgb,var(--fp-idle) 55%,var(--fp-bg))} .dsolid.radiator.on{--fp-body:color-mix(in srgb,var(--fp-heater) 75%,var(--fp-bg))}
.dsolid.speaker,.dsolid.tv{--fp-body:color-mix(in srgb,var(--fp-on-light) 62%,var(--fp-furniture))}
.drv{fill:color-mix(in srgb,var(--fp-on-light) 55%,var(--fp-bg));stroke:var(--fp-on-dark);stroke-opacity:.45;stroke-width:1;vector-effect:non-scaling-stroke}
.dsolid.speaker.on .drv{fill:var(--fp-dev-speaker)} .dsolid.speaker.media.on .drv{fill:var(--fp-dev-media)}
.tv-screen{fill:color-mix(in srgb,var(--fp-on-light) 92%,var(--fp-bg));stroke:none} .dsolid.tv.on .tv-screen{fill:color-mix(in srgb,var(--fp-dev-tv) 80%,var(--fp-on-dark))}
.stem{stroke:var(--fp-idle);stroke-width:1;stroke-opacity:.7;vector-effect:non-scaling-stroke} .stem-top{fill:var(--fp-idle);fill-opacity:.7}
.ws{fill:var(--fp-wall-side);stroke:var(--fp-wall-top);stroke-width:1;stroke-linejoin:round;vector-effect:non-scaling-stroke}
/* A wall face is lit like a solid: a fixed light from the upper left. Faces turned to it are lighter, faces turned away
   darker, both by mixing the plain side with the theme's own light and dark text colours, so every theme and dark mode
   keep their hue. The foot is a darker band where the wall meets the floor; the highlight is a thin line on the near edge of the cap. */
.ws.lit{fill:color-mix(in srgb,var(--fp-wall-side) 80%,var(--fp-on-dark))} .ws.dim{fill:color-mix(in srgb,var(--fp-wall-side) 78%,var(--fp-on-light))}
.wfoot{fill:var(--fp-on-light);fill-opacity:.16;stroke:none} .wl{stroke:var(--fp-on-dark);stroke-opacity:.55;stroke-width:1;stroke-linecap:round;vector-effect:non-scaling-stroke}
.ws.fence{fill:var(--fp-wall-fence);fill-opacity:.4;stroke:var(--fp-wall-fence)} .ws.sealed{fill:var(--fp-sealed);stroke:var(--fp-sealed)}
.glass{fill:var(--fp-window);fill-opacity:.35;stroke:var(--fp-window);stroke-width:1;vector-effect:non-scaling-stroke} .glass.g-glass{fill:var(--fp-glass);stroke:var(--fp-glass)}
/* An opening that is open (a contact sensor on, a lock left unlocked) is red on the wall face as it is in 2D, an alarm the
   same; an open cover keeps its own orange. Unavailable and unknown are none of these. A closed door is a painted leaf. */
.door-leaf{fill:var(--fp-door);fill-opacity:.85;stroke:var(--fp-on-light);stroke-opacity:.6;stroke-width:1;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.opn{fill:var(--fp-open-door);fill-opacity:.3;stroke:var(--fp-open-door);stroke-width:2;stroke-linejoin:round;vector-effect:non-scaling-stroke} .opn.cover-open{fill:var(--fp-open-door);stroke:var(--fp-open-door)} .opn.band{fill-opacity:1}
.glass.open,.glass.alarm,.ws.sealed.open,.ws.sealed.alarm{fill:var(--fp-open-door);stroke:var(--fp-open-door)} .glass.open,.glass.alarm{fill-opacity:.55} .glass.cover-open,.ws.sealed.cover-open{fill:var(--fp-open-door);stroke:var(--fp-open-door)}
.e.none{stroke:var(--fp-idle);stroke-width:1;stroke-dasharray:2 5;opacity:.6} .e.se{stroke-width:1.5} .tread{stroke:var(--fp-tread);stroke-width:1.5;fill:none}
/* A stair that goes down or both ways (stairs.ts): an arrow on its axis, and going down the steps darkened toward the low end.
   Both take no click (finding 18): the flight underneath is the target. --fp-night is the one dark veil every theme has. */
.stair-dir{fill:none;stroke:var(--fp-wall);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;pointer-events:none} .stair-shade{fill:var(--fp-night);pointer-events:none}
/* The same stairs in 2.5D, going down: a well in the floor. Walls and treads take .stair-shade as a veil, darker with depth. */
.well-wall,.well-floor{fill:var(--fp-wall-side)} .well-tread{fill:var(--fp-box-top)} .well-riser{fill:var(--fp-box-side)}
.well-edge{fill:none;stroke:var(--fp-wall-top);stroke-width:1;stroke-linejoin:round;vector-effect:non-scaling-stroke;pointer-events:none}
.well-rim{fill:var(--fp-box-side);stroke:var(--fp-wall-top);stroke-width:1;stroke-linejoin:round;vector-effect:non-scaling-stroke}
/* S8.11 (Diego's field report: "openings must be transparent and make the wall under them transparent too"): an
   opening no longer paints a band over the wall — renderFloor cuts a real hole in the wall layer with an SVG
   mask, so whatever is under it (a room's own fill, its texture, the background) shows through. This line still
   exists in the markup, at the same place in the DOM it always was, because the editor's own hit order relies on
   it: its .opening rule (pointer-events:stroke, editor-app.ts's stylesheet) and hitOf()'s closest("line.opening")
   both need a real, hit-testable shape at the gap. It just paints nothing any more. */
.opening{stroke:transparent;pointer-events:none}
/* S4.13 (Opus review): was pointer-events:none, so a click on "tech area" or any other structure line always fell
   through to the room under it - the line rendered but took no clicks of its own, ever, on any floor. "all" matches
   .room{pointer-events:all} just above: a fill:none shape still needs the flag or its interior (a rect's, here) and
   its zero-area line never receive a hit at all. */
.extra{fill:none;stroke:var(--fp-idle);stroke-dasharray:6 4;stroke-width:1.2;vector-effect:non-scaling-stroke;pointer-events:all}
.door{stroke:var(--fp-door)} .door-glass{stroke:var(--fp-glass)} .door-window{stroke:var(--fp-window)} .door-sealed{stroke:var(--fp-sealed);stroke-dasharray:10 6}
/* S10.3: a triggered vibration sensor gives the door the same red as an open contact, but solid - dashed keeps
   meaning "open" alone. This rule comes before .door.open in source order and sets no dasharray of its own, so a
   door that is both open and vibrating still ends up dashed: .open's dasharray, asserted after this one, wins on
   that property (both selectors are two classes each, equal specificity), while the shared stroke colour agrees
   either way. */
.door.alarm{stroke:var(--fp-open-door)}
/* S9.1: an open contact door or window (or one left unlocked, S4.24/2026-09-28) is dashed, in --fp-open-door
   (default --fp-dev-contact; the card's open_color option overrides it — a class rule, not a presentation
   attribute, per finding 18). A cover door's own open state (.cover-open) is unrelated to contact and keeps its
   plain orange, undashed; it comes after .open in source order and both selectors are two classes each, so on a
   door that somehow carries both, .cover-open wins on every property it sets, including the dasharray it
   explicitly clears back to none. render.ts never sets .cover-open on a window or glass door at all — there
   cover is curtains, not a security state (Diego, 2026-09-28). */
.door.open{stroke:var(--fp-open-door);stroke-dasharray:10 6} .door.cover-open{stroke:var(--fp-open-door);stroke-dasharray:none}
/* S14.5: a tripped open doorway is a solid band in the alert colour, whatever tripped it (open, vibrating, cover open), at full strength even
   while selected. Three classes, so it outranks .door.open's dash and the selected-faint rule below without depending on source order. */
.door.door-open.band{stroke:var(--fp-open-door);stroke-dasharray:none;stroke-opacity:1}
/* S8.9 finding 3: a door's own stroke is now as thin as the internal wall it sits on, so this invisible twin
   (drawn first, same data-d, at the old fixed 22 cm) keeps the click target exactly as wide as it always was. */
.door-hit{stroke:transparent;pointer-events:stroke;cursor:move}
.dev.unbound path{stroke:var(--fp-warn);stroke-width:1.5;stroke-dasharray:3 2} .dev path{fill:var(--fp-idle)} .dev.on path{fill:var(--fp-dev-fill,var(--fp-dev));opacity:var(--fp-dev-opacity,1)}
.dev-camera path{fill:var(--fp-dev-camera)} .dev.dev-camera path.cone{fill:var(--fp-dev-camera);fill-opacity:var(--fp-alpha);pointer-events:none} .dev.outdoor path{fill:var(--fp-dev-garden)}
/* S2.9: --fp-dev names the active colour per type; switch and humidity fall back to idle grey (on and off look the same). */
.dev.on{--fp-dev:var(--fp-idle)} .dev-light.on{--fp-dev:var(--fp-dev-light)} .dev-motion.on{--fp-dev:var(--fp-dev-motion)} .dev-contact.on{--fp-dev:var(--fp-dev-contact)} .dev-heater.on{--fp-dev:var(--fp-dev-heater)} .dev-climate.on{--fp-dev:var(--fp-dev-climate)} .dev.siren.on{--fp-dev:var(--fp-danger)} .dev-ac.cool.on{--fp-dev:var(--fp-dev-ac-cool)} .dev-ac.heat.on{--fp-dev:var(--fp-dev-ac-heat)} .dev-tv.on{--fp-dev:var(--fp-dev-tv)} .dev-plug.on{--fp-dev:var(--fp-dev-plug)} .dev-computer.on{--fp-dev:var(--fp-dev-computer)} .dev-media.on{--fp-dev:var(--fp-dev-media)} .dev-switch.on{--fp-dev:var(--fp-idle)} .dev-humidity.on{--fp-dev:var(--fp-idle)} .dev-lock.on{--fp-dev:var(--fp-dev-contact)} .dev-vibration.on{--fp-dev:var(--fp-dev-contact)} .dev-person.on{--fp-dev:var(--fp-dev-person)} .dev-radar.on{--fp-dev:var(--fp-dev-radar)} .dev-vacuum.on{--fp-dev:var(--fp-dev-vacuum)} .dev-speaker.on{--fp-dev:var(--fp-dev-speaker)} .dev-cover.on{--fp-dev:var(--fp-dev-cover)}
/* S7.10: an error vacuum wears --fp-danger on its icon, two classes ahead of the plain idle-grey .dev path rule above. */
.dev.danger path{fill:var(--fp-danger)}
/* S4.25: an unlinked item has no on/off state of its own, so it never carries .on — it stays at the plain .dev
   path idle-grey rule above unless the instance has its own --fp-dev-fill colour override, which this rule
   (three classes, out-specifies the two-class .dev path default) lets through. */
.dev.unl path{fill:var(--fp-dev-fill,var(--fp-idle))}
.dev .halo{fill:var(--fp-disc);fill-opacity:var(--fp-disc-alpha);stroke:var(--fp-halo);stroke-width:1;vector-effect:non-scaling-stroke}
.dev.on .halo{fill:var(--fp-dev);fill-opacity:var(--fp-alpha)}
.aura{fill:var(--fp-aura);fill-opacity:var(--fp-alpha);pointer-events:none}
/* S8.13: a triggered motion or contact sensor. Its disc is filled harder than any other on disc and ringed in its own
   colour, and a ring pulses out from under it. An open contact door gets a wide pulsing line under its own. */
.dev-motion.on .halo,.dev-contact.on .halo{fill-opacity:.6;stroke:var(--fp-dev);stroke-width:2}
.ping{fill:none;stroke:var(--fp-dev);stroke-width:3;vector-effect:non-scaling-stroke;pointer-events:none;transform-box:fill-box;transform-origin:center;animation:fp-ping 1.6s ease-out infinite}
@keyframes fp-ping{from{transform:scale(1);opacity:.9}to{transform:scale(calc(1 + 1.2*var(--fp-fx,1)));opacity:0}}
.door-alert{stroke:var(--fp-open-door);stroke-opacity:.45;stroke-linecap:butt;pointer-events:none;animation:fp-door 1.6s ease-in-out infinite alternate}
@keyframes fp-door{from{stroke-opacity:.2}to{stroke-opacity:.6}}
/* S9.4: a playing speaker or media device sends out two arcs from under its disc, the same pattern as the ping above
   (a shape in the group, transform-box:fill-box so it scales from its own centre, held still under reduced motion) —
   staggered by animation-delay instead of drawn one on top of the other, so they read as a sound radiating outward.
   Opus review finding 8: the wave used to be two <path> semicircles, each scaling about its own bbox centre — a
   semicircle's bbox sits off the disc's own centre, so the two arcs visibly grew from different points, not the
   halo's. It is a <circle> now, like .ping: a circle's bbox is always the square centred on (cx,cy), so scaling it
   about "center" is automatically concentric with the halo, whatever arc stroke-dasharray leaves visible — and,
   like .ping, it needs no tag-qualified specificity repeat any more (CLAUDE.md finding 10's own guard from S9.4,
   dropped below): the ".dev.on path{fill:...}" rule above only ever matches a <path>, never a <circle>. */
.wave{fill:none;stroke:var(--fp-dev);stroke-width:2;vector-effect:non-scaling-stroke;pointer-events:none;transform-box:fill-box;transform-origin:center;animation:fp-wave 1.6s ease-out infinite}
.wave.w2{animation-delay:.8s}
@keyframes fp-wave{from{transform:scale(1);opacity:.8}to{transform:scale(calc(1 + 1.4*var(--fp-fx,1)));opacity:0}}
/* S14.3 (spec item 6): a siren's rings are the speaker's again, twice the radius at the end (4.8 against 2.4), a thicker line, a faster beat. */
.siren-ring{fill:none;stroke:var(--fp-dev);stroke-width:3.5;vector-effect:non-scaling-stroke;pointer-events:none;transform-box:fill-box;transform-origin:center;animation:fp-siren 1s ease-out infinite}
.siren-ring.w2{animation-delay:.5s}
@keyframes fp-siren{from{transform:scale(1);opacity:1}to{transform:scale(calc(1 + 3.8*var(--fp-fx,1)));opacity:0}}
@media (prefers-reduced-motion:reduce){.ping,.door-alert,.wave,.siren-ring{animation:none}.ping,.wave{transform:scale(calc(1 + .5*var(--fp-fx,1)));opacity:.6}.siren-ring{transform:scale(calc(1 + 2*var(--fp-fx,1)));opacity:.8}}
.dev.unavailable{opacity:.45}
.dev.dim{opacity:.3}
/* S7.8: a person glides to the room its room sensor names. The position is an inline CSS transform, not an attribute, so
   this rule can animate it; the card replays the old position before the new one (a FLIP), because each render builds new
   nodes. Away is a person at 35 %, with the away mark in the group; unavailable stays .45 like every device. */
.dev-person{transition:transform .6s ease} .dev-person.away{opacity:.35} .dev-person .away-mark{fill:var(--fp-idle);stroke:var(--fp-outline);stroke-width:1;vector-effect:non-scaling-stroke}
@media (prefers-reduced-motion:reduce){.dev-person{transition:none}}
/* S7.9: a radar target dot, one per tracked person, in the radar's own colour, taking no clicks. */
.target{fill:var(--fp-dev-radar);stroke:var(--fp-outline);stroke-width:1;vector-effect:non-scaling-stroke;pointer-events:none}
/* S7.10: a cleaning vacuum's icon spins slowly; docked, paused, returning and error do not (the .spin class is only
   ever added while state is "cleaning" — see vacuumSpinClass). transform-box/-origin keep the spin about the
   glyph's own centre instead of the SVG viewport's corner, the default CSS transform origin on an SVG shape. */
.dev-vacuum.spin path{transform-box:fill-box;transform-origin:center;animation:fp-spin 4s linear infinite}
@keyframes fp-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dev-vacuum.spin path{animation:none}}
.dev-motion{--fp-fade:0} .dev.dev-motion path{fill:color-mix(in srgb,var(--fp-motion) calc(var(--fp-fade) * 100%),var(--fp-idle))}
.heater{stroke:var(--fp-idle)} .heater.on{stroke:var(--fp-heater)} .val,.lbl{fill:var(--fp-text);paint-order:stroke;stroke:var(--fp-outline);stroke-width:3;stroke-linejoin:round} .lbl.zone{opacity:.5} .lbl-leader{stroke:var(--fp-text);opacity:.5;pointer-events:none}
.mg{stroke:var(--fp-measure);stroke-width:.5;vector-effect:non-scaling-stroke} .mg.m{stroke-width:1}
.sel{stroke:var(--fp-ink)} .door-open.sel:not(.open):not(.alarm):not(.cover-open){stroke-opacity:.35} .h{fill:var(--fp-bg);stroke:var(--fp-ink);stroke-width:1.5}`;

const COLOR = /^#[0-9a-fA-F]{6}$/;
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
/** x, y, w, h. */
/** Fixed regardless of a door's own visible stroke (S8.9): the box a door blocks room/zone names from (S7.15) and
 *  its invisible click target below, so a thinner internal door stays exactly as easy to hit and as good an
 *  obstacle as it always was. The label placer widens the door's line by half of it. */
const DOOR_HIT_WIDTH = 22;
/**
 * S8.9 part 2: a door or window's own stroke takes the thickness of the wall segment it lies on. Reuses the same
 * `nearestEdge` lookup the editor already snaps a door to when it is placed or dragged (editor-app.ts's `HOST`,
 * `{ walls: true }`), so rendering and snapping can never disagree about which wall a door is on. A door's
 * midpoint sits right on the wall line once snapped, so `DOOR_WALL_TOL` covers rounding plus real coincident edges
 * (two rooms sharing a wall, or a room wall drawn over the outline) — never a real search radius beyond that. Off
 * every wall, or on a zone/boundary edge, a door is a plain internal one.
 *
 * Opus review, defect 4: several edges can coincide at a door (an outline edge under a room edge, two rooms sharing
 * one edge with different kinds each), and every one of them is drawn — so the widest kind among all of them is
 * what actually shows, not whichever `nearestEdge` kept on a tie. `edgeKindsNear` collects every non-zone room
 * edge, outline edge and free wall within `DOOR_WALL_TOL` of the door's midpoint that runs parallel to it; "external"
 * wins if present anywhere in that set (the only two door widths are "external" and everything else).
 */
const DOOR_WALL_TOL = 10; // cm
export function wallWidthAt(f: Floor, a: Pt, b: Pt): number {
  const len = dist(a, b) || 1;
  const dir: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const kinds = edgeKindsNear(f, mid(a, b), dir, DOOR_WALL_TOL);
  return kinds.includes("external") ? WALL_WIDTH_EXTERNAL : WALL_WIDTH;
}
/** cm wide a door's floor line is drawn in 2.5D (see the doors loop in renderFloor). */
const DOOR_THRESHOLD_25D = 4;
/** The thickness of a slit window's line, as a share of the wall it sits in. */
const SLIT_BAND = 0.4;
/** A selected door or window is always 8 cm wider than its own thickness, whichever wall it sits on. */
const DOOR_SELECT_EXTRA = 8;
/** An opening's stroke must fully erase the (possibly thicker) wall under it: the wall's own thickness, plus enough
 *  margin so no sliver of it shows at the edges (S8.9 part 3) — and, since S8.11, strictly more than the wall's own
 *  halo margin (`WALL_HALO_EXTRA`), for internal walls same as external. Opus review (2026-09-26): this used to be
 *  a flat 2cm, exactly equal to WALL_HALO_EXTRA, so the cut's own edge landed exactly on the halo's edge — two
 *  independently antialiased edges on the same line do not reliably cancel, leaving a faint blended line along the
 *  hole (`renderFloor` test "S8.11 fix (halo seam...)" in card.spec.ts). One more cm of margin than the halo's own
 *  puts the cut's edge a clean centimetre past the halo's, with room to spare. */
const OPENING_EXTRA = WALL_HALO_EXTRA + 2;
/** A short, deterministic tag for a string (FNV-1a, 32-bit, base36). Not security-sensitive: only used to keep a
 *  generated id short while still varying with its content. Exported (S9.5): the active-devices list panel keys
 *  its localStorage entry off a hash of the card's own config, the same idea as the mask and pattern ids below. */
export { tag }; // lives in fmt.ts now, so solids.ts can mint a clip id without importing this file
type Box = [number, number, number, number];
const meets = (a: Box, b: Box) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/** `p` turned clockwise by `deg` degrees about `pivot` (y points down, so this is the direction SVG's rotate() turns). */
export function rotateAbout(p: Pt, deg: number, pivot: Pt): Pt {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), dx = p[0] - pivot[0], dy = p[1] - pivot[1];
  return [pivot[0] + dx * c - dy * s, pivot[1] + dx * s + dy * c];
}

/** The one point every floor turns about: the centre of the box round all outlines together. With no outline anywhere, the origin. */
export function planPivot(l: Layout): Pt {
  const all = Object.values(l.floors).flatMap((f) => f.outline);
  if (!all.length) return [0, 0];
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** cm a camera's cone reaches from its own centre (read by the cone radius below and by `viewBoxFor`). */
export const DEVICE_REACH = 100;
/** cm a lit lamp's aura reaches from its own centre. S8.13: 1.5x the camera's, at Diego's request (2026-09-26). */
export const LIGHT_REACH = 150;
/** cm an open door's alert line is wider than the door's own line (S8.13). */
export const DOOR_ALERT_EXTRA = 16;

/** The box that fits every structural point on the floor plus `pad`, in what the screen shows: turned by `rotate`
 * when there is one. Bounds on `structuralPoints` (outline, rooms, stairs, walls, furniture, unlinked), not just
 * the outline (Diego field report, 0.12.14: a garden shed drawn outside the house outline was clipped by the
 * card's default view with no way to zoom out to it), so anything drawn on the plan — a garden, a shed, a
 * structure outside the walls — is always in the default view. Devices are not in that unconditional set: only a
 * lit lamp or a camera widens the box, by its own reach, and only when it is near the rest of the plan already
 * (S5.7, S8.13) — a device dragged or imported far outside the house must not balloon the view the way a real
 * garden structure should, so it stays off view exactly as before this fix. In "2.5d" the tallest drawn height widens the box
 * up and to the right too (heights count: a wall drawn 250 cm up must not be clipped). */
export function viewBoxFor(f: Floor, pad = 60, rotate?: { deg: number; pivot: Pt }, view: PlanView = "2d", tilt?: number): { x: number; y: number; w: number; h: number } {
  const content = structuralPoints(f);
  if (!content.length) return { x: -pad, y: -pad, w: 1000 + 2 * pad, h: 1000 + 2 * pad };
  const turn = (p: Pt) => (rotate && rotate.deg % 360 ? rotateAbout(p, rotate.deg, rotate.pivot) : p);
  const boxes = content.map((p) => [turn(p), pad] as const);
  // Only a lamp or camera on or near the plan counts: one far outside it (a stray drag, a layout in mm) stays off
  // view, as before, instead of shrinking the house to a speck. Its centre is the one the aura is drawn at.
  const cx = content.map((p) => p[0]), cy = content.map((p) => p[1]);
  const near = (c: Pt, r: number) => c[0] >= Math.min(...cx) - r && c[0] <= Math.max(...cx) + r && c[1] >= Math.min(...cy) - r && c[1] <= Math.max(...cy) + r;
  for (const d of f.devices) {
    const r = d.type === "light" ? LIGHT_REACH * fxScale(d) : d.type === "camera" ? DEVICE_REACH : 0;
    const c = "a" in d ? mid(d.a, d.b) : ([d.x, d.y] as Pt);
    if (r && c.every(Number.isFinite) && near(c, r)) boxes.push([turn(c), r]);
  }
  // 2.5D: heights draw up and to the right on the screen, whatever the plan's own turn, so the box grows in the screen frame.
  const ob = obliqueFor(tilt), tall = view === "2.5d" ? tallestDrawn(f) * ob.rise : 0;
  const x0 = Math.min(...boxes.map(([p, r]) => p[0] - r)), y0 = Math.min(...boxes.map(([p, r]) => p[1] - r)) - tall;
  const x1 = Math.max(...boxes.map(([p, r]) => p[0] + r)) + tall * ob.skew, y1 = Math.max(...boxes.map(([p, r]) => p[1] + r));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Every drawn structural point on the floor: outline, rooms, stairs, walls, doors, openings, extras, furniture
 * (its centre) and unlinked sensors. Devices are deliberately excluded — `viewBoxFor` bounds on their reach, not
 * their raw position (see its own comment); `contentPoints` below is the wider set that does include them. */
function structuralPoints(f: Floor): Pt[] {
  const out: Pt[] = [];
  const add = (p: unknown) => { if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push([p[0], p[1]]); };
  for (const p of f.outline ?? []) add(p);
  for (const r of f.rooms ?? []) for (const p of r.pts ?? []) add(p);
  for (const t of f.stairs ?? []) for (const p of t.pts ?? []) add(p);
  for (const k of ["walls", "doors", "openings", "extras"] as const) for (const o of f[k] ?? []) { add(o.a); add(o.b); }
  for (const m of f.furniture ?? []) add([m.x, m.y]);
  for (const u of f.unlinked ?? []) add([u.x, u.y]);
  return out;
}

/** Every point that makes up the floor: `structuralPoints` plus devices (a heater's two ends, else the centre).
 * Only finite points; the editor's Re-center fits them all. */
export function contentPoints(f: Floor): Pt[] {
  const out = structuralPoints(f);
  const add = (p: unknown) => { if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push([p[0], p[1]]); };
  for (const d of f.devices ?? []) { if ("a" in d) { add(d.a); add(d.b); } else add([d.x, d.y]); }
  return out;
}

/** Class of a room edge or free wall: wall is plain, boundary is dotted, the rest carry their kind. */
const edgeClass = (kind: unknown) => `e${kind === "boundary" ? " nw" : kind === "wall" || kind === undefined ? "" : ` ${esc(String(kind))}`}`;
const at = (p: Pt) => `${num(p[0])} ${num(p[1])}`;
type Cls = "on" | "off" | "unavailable" | "danger";

const dead = (s: string) => s === "unavailable" || s === "unknown";

/** A bound light is one lamp: on if either entity is on, unavailable only if every known state is dead. */
function boundClassOf(d: Device, o: RenderOpts): Cls {
  const seen = [o.state?.[d.entity], d.bound ? o.state?.[d.bound] : undefined].filter((s) => s !== undefined);
  if (seen.some((s) => s.state === "on")) return "on";
  if (seen.length && seen.every((s) => dead(s.state))) return "unavailable";
  return "off";
}

/** A light that is on takes its icon fill from `attributes.rgb_color` when present; unset otherwise, so `.dev.on path`'s `var(--fp-dev-fill,var(--fp-on))` falls through to the flat colour. Untrusted `state`: a malformed value is silently ignored, not thrown on. */
export function lightFill(s: StateOverlay[string] | undefined): string | null {
  const rgb = s?.attributes.rgb_color;
  if (Array.isArray(rgb) && rgb.length === 3 && rgb.every((n) => typeof n === "number" && Number.isFinite(n))) return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  return null;
}

/** `attributes.brightness / 255`, floored at 0.35 so a dimmed lamp's icon never goes near-invisible; unset (full opacity through the cascade) with no `brightness` attribute. */
export function lightOpacity(s: StateOverlay[string] | undefined): number | null {
  const b = s?.attributes.brightness;
  if (typeof b !== "number" || !Number.isFinite(b)) return null;
  return Math.max(0.35, Math.min(1, b / 255));
}

/** Whether a point lies inside a polygon; also used by the editor to find the room a device stands in. */
export function inside(p: Pt, poly: Pt[]): boolean {
  let in_ = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) in_ = !in_;
  return in_;
}

/** Which kinds of room can own a point: hold a lamp's light, take a sensor, show a readout. A zone is an overlay, a structure
 *  a building drawn on the plan, a fill a hatched patch; none of them is a room a person stands in. Every kind is a decision (finding 17). */
export const ROOM_OWNS: Record<RoomKind, boolean> = { room: true, garden: true, pavement: true, terrace: true, water: true, fill: false, structure: false, zone: false };

/** The index of the smallest room that may own point `p` (`ROOM_OWNS`), or -1; equal areas go to the highest index. The one rule behind a lamp's aura clip, the
 *  editor's Attach, a room's readout and Sensors section, and the card's room summary, so they cannot disagree about
 *  which room a thing is in. Layout is untrusted: a room with no usable ring is skipped, never a throw. */
export function roomAt(f: Floor, p: Pt): number {
  if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return -1;
  let best = -1, bestArea = Infinity;
  (Array.isArray(f.rooms) ? f.rooms : []).forEach((r, j) => {
    const g = r?.pts;
    if (!r || !ROOM_OWNS[r.kind] || !Array.isArray(g) || g.length < 3 || !g.every((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])) || !inside(p, g)) return;
    const a = Math.abs(g.reduce((n, q, k) => n + q[0] * g[(k + 1) % g.length][1] - g[(k + 1) % g.length][0] * q[1], 0)) / 2;
    if (a <= bestArea) { best = j; bestArea = a; } // a tie goes to the later room: it is drawn on top, the one a tap reaches
  });
  return best;
}

/** S2.10: what an air conditioner is doing, read from the entity at render time and never stored. `off`, `unavailable` and `unknown` win over everything; otherwise `hvac_action` decides, and `state` stands in when the attribute is missing. */
export function acMode(d: Device, o: RenderOpts): "cool" | "heat" | null {
  const s = o.state?.[d.entity];
  if (!s || s.state === "off" || s.state === "unavailable" || s.state === "unknown") return null;
  const a = s.attributes?.hvac_action;
  const v = typeof a === "string" ? a : s.state === "cool" ? "cooling" : s.state === "heat" ? "heating" : "";
  return v === "cooling" ? "cool" : v === "heating" ? "heat" : null;
}

/** The sensor that measures plug `d`: its own `power`, else the one the card linked at runtime. Own `power` wins. */
function powerEntity(d: Device, o: RenderOpts): string | undefined {
  if (typeof d.power === "string" && d.power) return d.power;
  const linked = o.powerLinks?.[d.entity];
  return typeof linked === "string" && linked ? linked : undefined;
}

/** The watts a plug is drawing right now, or null when no sensor is known or it cannot be read (see `wattsOf`). */
function plugWatts(d: Device, o: RenderOpts): number | null {
  const e = powerEntity(d, o);
  return e ? wattsOf(o.state?.[e]) : null;
}

/**
 * The one rule for a plug (Diego, 2026-10): active only while it draws `plugWatts` or more, not merely switched on.
 * Switch off: off. Switch on and a readable sensor: watts >= threshold. Switch on and no sensor, or one that is
 * unavailable, unknown or in another unit: on, as before. We cannot know, and a flaky sensor must not hide a plug.
 */
function plugOn(d: Device, o: RenderOpts, sw: StateOverlay[string]): boolean {
  if (sw.state !== "on" && sw.state !== "open") return false;
  const w = plugWatts(d, o);
  return w === null || w >= plugThreshold(o.plugWatts);
}

/** Exported (S9.5): the active-devices list panel reuses this same function so the list and the plan can never
 *  disagree about which devices are "on" (CLAUDE.md finding 17). */
export function classOf(d: Device, o: RenderOpts): Cls {
  if (d.type === "light" && d.bound) return boundClassOf(d, o);
  const s = o.state?.[d.entity];
  if (!s) return "off";
  if (s.state === "unavailable" || s.state === "unknown") return "unavailable";
  if (d.type === "ac") return acMode(d, o) ? "on" : "off";
  if (d.type === "plug") return plugOn(d, o, s) ? "on" : "off";
  if (d.type === "climate" || d.type === "heater") return s.attributes.hvac_action === "heating" ? "on" : "off";
  // S9.4: a speaker is a media_player like any other — playing is the only "on", same as media.
  if (d.type === "media" || d.type === "speaker") return s.state === "playing" ? "on" : "off";
  // Opus review finding 1: a TV is a media_player too, but Cast/Android TV/webOS report "playing", "paused" and
  // "idle" while genuinely on, not only the plain "on" a demo switch would use. Anything other than off/standby
  // (unavailable/unknown are already handled above) counts.
  if (d.type === "tv") return s.state === "off" || s.state === "standby" ? "off" : "on";
  if (d.type === "person") return s.state === "home" ? "on" : "off";
  // S7.10: docked/idle/paused read idle grey like an off device; cleaning and returning are both active (the
  // spin class, from vacuumSpinClass below, is what tells them apart); error is its own danger class, not on/off.
  if (d.type === "vacuum") {
    if (s.state === "error") return "danger";
    if (s.state === "cleaning" || s.state === "returning") return "on";
    return "off";
  }
  // Diego, 2026-10-03: a cover is active only while a garage door, a gate or a door stands open; a curtain, blind or
  // shutter draws idle in every state. `coverActive` reads the entity's device_class and decides (cover.ts).
  if (d.type === "cover") return coverActive(s) ? "on" : "off";
  return s.state === "on" || s.state === "open" ? "on" : "off";
}

/** S7.10: the extra class a vacuum wears while actually cleaning — a slow spin on its icon, dropped the moment it
 *  starts returning (still active, just not moving in place) or its state is anything else. */
function vacuumSpinClass(d: Device, o: RenderOpts): string {
  return d.type === "vacuum" && o.state?.[d.entity]?.state === "cleaning" ? " spin" : "";
}

/** S7.8: the extra class a person wears. `home` when home; `away` for any other live state (not_home, a zone's name);
 *  nothing with no state or a dead one, which reads like every other device. */
function personClass(d: Device, o: RenderOpts, cls: Cls): string {
  if (d.type !== "person" || !o.state?.[d.entity] || cls === "unavailable") return "";
  return cls === "on" ? " home" : " away";
}

/** Room-sensor states that say nothing about a room: the placed spot is kept. */
const NO_ROOM = new Set(["", "unknown", "unavailable", "not_home"]);

/**
 * S7.8: the room a person's room sensor names, as an index into `rooms`, or -1. The sensor's state is tried first, then
 * its `area_id` and `area` attributes; each is matched, ignoring case, against every room's `area` before any room's
 * `name`. Untrusted state: anything that is not text is skipped, never thrown on.
 */
export function personRoom(d: Device, rooms: Floor["rooms"], o: RenderOpts): number {
  if (d.type !== "person" || typeof d.room !== "string") return -1;
  const s = o.state?.[d.room];
  if (!s) return -1;
  const said = [s.state, s.attributes?.area_id, s.attributes?.area].filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()).filter((v) => !NO_ROOM.has(v));
  const usable = (r: Floor["rooms"][number]) => Array.isArray(r.pts) && r.pts.length >= 3;
  for (const v of said) {
    let i = rooms.findIndex((r) => usable(r) && typeof r.area === "string" && r.area.toLowerCase() === v);
    if (i < 0) i = rooms.findIndex((r) => usable(r) && typeof r.name === "string" && r.name.toLowerCase() === v);
    if (i >= 0) return i;
  }
  return -1;
}

/** S1.37: a room or a piece of furniture with an entity carries "on" when that entity is on, open or playing. */
const ON_STATES = new Set(["on", "open", "playing"]);
function entityOn(o: RenderOpts, entity: string | undefined, plugs?: ReadonlyMap<string, Device>): boolean {
  if (!entity) return false;
  const s = o.state?.[entity];
  if (!s) return false;
  // A room or piece of furniture that shows a plug's switch follows the plug's own rule, not the bare switch state.
  const plug = plugs?.get(entity);
  if (plug) return classOf(plug, o) === "on";
  if (entity.startsWith("cover.")) return coverActive(s); // a curtain behind a room does not light it either
  return ON_STATES.has(s.state);
}

/**
 * One stairs object: the polygon (or, round, an even-odd path with the well cut out), its treads and its edges, turned
 * together by `rot` about the centre of the polygon's box. Only an unturned straight flight has edge lines a click can
 * pick (`data-e`): the stored corners are those of the unturned polygon, so for any other stairs they are not where the
 * lines are drawn. The whole group is `data-s`.
 */
function stairsGroup(t: Stairs, i: number, around?: FloorsAround): string {
  const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rot = typeof t.rot === "number" && Number.isFinite(t.rot) ? t.rot : 0;
  const steps = stairSteps(t);
  const round = t.shape === "round" && typeof t.dia === "number" && t.dia > 0;
  const inner = round && typeof t.inner === "number" && t.inner > 0 ? t.inner / 2 : 0;
  const g: string[] = [];
  const dir = resolveStairDirection(t, around), treads: string[] = [];
  let outline = "";
  if (round) {
    const R = t.dia! / 2;
    const hole = inner ? ` M${num(cx + inner)} ${num(cy)}A${num(inner)} ${num(inner)} 0 1 0 ${num(cx - inner)} ${num(cy)}A${num(inner)} ${num(inner)} 0 1 0 ${num(cx + inner)} ${num(cy)}Z` : "";
    outline = `d="M${t.pts.map((p) => `${num(p[0])} ${num(p[1])}`).join("L")}Z${hole}"`;
    g.push(`<path class="stairs room"${paintAttr(t)} fill-rule="evenodd" ${outline}/>`);
    for (let n = 1; n < steps; n++) {
      const a = (n * 2 * Math.PI) / steps;
      treads.push(`<line class="tread" x1="${num(cx + inner * Math.cos(a))}" y1="${num(cy + inner * Math.sin(a))}" x2="${num(cx + R * Math.cos(a))}" y2="${num(cy + R * Math.sin(a))}"/>`);
    }
  } else {
    g.push(`<polygon class="stairs room"${paintAttr(t)} points="${pts(t.pts)}"/>`);
    // Treads run across the short side of the box, one every (long side / steps).
    const along = x1 - x0 > y1 - y0;
    for (let n = 1; n < steps; n++) {
      if (along) { const x = x0 + ((x1 - x0) * n) / steps; treads.push(`<line class="tread" x1="${num(x)}" y1="${num(y0)}" x2="${num(x)}" y2="${num(y1)}"/>`); }
      else { const y = y0 + ((y1 - y0) * n) / steps; treads.push(`<line class="tread" x1="${num(x0)}" y1="${num(y)}" x2="${num(x1)}" y2="${num(y)}"/>`); }
    }
  }
  const marks = stairMarks({ x0, x1, y0, y1, steps, round: round ? { R: t.dia! / 2, r: inner } : undefined }, dir, outline);
  g.push(marks.shade, ...treads, marks.arrow);
  t.pts.forEach((a, j) => {
    const b = t.pts[(j + 1) % t.pts.length], e = !round && !rot ? ` data-e="s${i}:${j}"` : "";
    g.push(`<line class="e se"${e} x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"/>`);
  });
  return `<g data-s="${i}" transform="rotate(${num(rot)} ${num(cx)} ${num(cy)})">${g.join("")}</g>`;
}

/** cm of floor between the outer edge of the widest wall (halo included) of a room and its motion line. */
const MOTION_GAP = 2;
/** cm wide the motion line is drawn. */
const MOTION_LINE = 2.5;

/** cm a motion sensor may sit outside a room's outline and still count for it: half the thickest wall plus its halo, so one screwed into the wall line is the room's. */
const MOTION_WALL_REACH = WALL_WIDTH_EXTERNAL / 2 + WALL_HALO_EXTRA;

/** cm from `p` to the nearest edge of the ring. */
function ringGap(p: Pt, ring: Pt[]): number {
  let best = Infinity;
  ring.forEach((a, j) => {
    const b = ring[(j + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  });
  return best;
}

/** 0..1 from `fade` seconds (default 300) since `lastChanged`; 1 at that moment, 0 once they have passed. Unreadable time: just changed. */
function fadeSince(lastChanged: string, fade: number, now: number): number {
  const t = Date.parse(lastChanged), age = Number.isNaN(t) ? 0 : now - t;
  return Math.max(0, Math.min(1, 1 - age / (fade * 1000)));
}

/** 0..1, how red a motion icon still is: 1 at the moment of motion, 0 once `fade` seconds (default 300) have passed since the sensor was last on. Fade 0 turns the fade off. */
function motionFade(d: Device, o: RenderOpts, now: number): number {
  const s = o.state?.[d.entity];
  if (!s || d.type !== "motion") return 0; // a radar's icon does not fade, so neither does its border
  const fade = o.fade ?? 300;
  return fade > 0 ? fadeSince(s.last_changed, fade, now) : classOf(d, o) === "on" ? 1 : 0;
}

/**
 * The room's motion perimeter: one solid line, `MOTION_LINE` wide, just inside the walls. It is the room's outline
 * stroked wide and masked to a band: white room shape (nothing outside the room shows, whatever the shape) minus a
 * black stroke twice the wall reach (nothing near the walls shows). What is left is the ring between the two, an exact
 * inset of the outline, round at a concave corner, so an L or a U needs no offset-polygon arithmetic. The mask id is
 * a hash of the geometry (like the opening mask) so two cards drawing one floor mint the same id. Colour and
 * pointer-events come from the class (findings 9, 18); `radar` takes the radar colour.
 */
function motionPerimeter(f: Floor, ring: Pt[], i: number, radar: boolean, strength: number, pulseAge: number | null = null, as?: { cls: string; data: string }): string {
  const reach = Math.max(...ring.map((a, j) => wallWidthAt(f, a, ring[(j + 1) % ring.length]))) + WALL_HALO_EXTRA;
  const hide = reach + 2 * MOTION_GAP, band = hide + 2 * MOTION_LINE;
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const x = Math.min(...xs) - band, y = Math.min(...ys) - band;
  const id = `fp-mp-${tag(`${pts(ring)}|${hide}${as ? `|${as.cls}` : ""}`)}`, points = pts(ring); // S11.3: the picked-room line is the same band under its own class and its own mask id
  const mask = `<mask id="${id}" maskUnits="userSpaceOnUse" x="${num(x)}" y="${num(y)}" width="${num(Math.max(...xs) + band - x)}" height="${num(Math.max(...ys) + band - y)}"><polygon points="${points}" fill="white"/><polygon points="${points}" fill="none" stroke="black" stroke-width="${num(hide)}" stroke-linejoin="round"/></mask>`;
  const style = [strength < 1 ? `--fp-fade:${num(strength)}` : "", pulseAge !== null ? `--fp-pulse-age:${num(pulseAge)}s` : ""].filter(Boolean).join(";");
  return `${mask}<polygon class="${as?.cls ?? "motion-perimeter"}${radar ? " radar" : ""}${pulseAge !== null ? " motion-pulse" : ""}" ${as?.data ?? "data-m"}="${i}" mask="url(#${id})" stroke-width="${num(band)}"${style ? ` style="${style}"` : ""} points="${points}"/>`;
}

/** The vertex mean, or when that falls outside the room (an L, a U) the middle of the widest stretch of the room along the mean's own row. */
export function polyCentre(p: Pt[]): Pt {
  const m: Pt = [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  if (!m.every(Number.isFinite) || inside(m, p)) return m;
  const xs: number[] = [];
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > m[1]) !== (p[j][1] > m[1])) xs.push(p[i][0] + ((m[1] - p[i][1]) * (p[j][0] - p[i][0])) / (p[j][1] - p[i][1]));
  xs.sort((a, b) => a - b);
  let best: Pt = m, w = 0;
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > w) { w = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, m[1]]; }
  return best;
}

// ---- What the plan decides from the live state, as functions. renderFloor reads them, and so does the card's 3D view
// (live.ts), so the two views cannot disagree about which room has motion, which sensor is attached or what an icon wears.

export type SensorList = "temps" | "humidity" | "motion";
/** The entity ids of a room's own sensor list. Layout is untrusted: a list that is not a list is empty, a non-text entry is dropped. */
export const roomList = (r: Floor["rooms"][number], k: SensorList): string[] => (Array.isArray(r[k]) ? (r[k] as unknown[]).filter((e): e is string => typeof e === "string") : []);
const ATTACH_LIST: Partial<Record<DeviceType, SensorList>> = { temp: "temps", humidity: "humidity", motion: "motion" };
/** S11.1: whether a device is a room's own sensor (in the room's temps, humidity or motion list). Such a sensor draws no icon (DECISIONS, S11.1). */
export function attachedTest(f: Floor): (d: Device) => boolean {
  const attached: Record<SensorList, Set<string>> = { temps: new Set(), humidity: new Set(), motion: new Set() };
  for (const r of f.rooms) for (const k of ["temps", "humidity", "motion"] as const) for (const e of roomList(r, k)) attached[k].add(e);
  return (d) => { const k = ATTACH_LIST[d.type]; return !!k && attached[k].has(d.entity); };
}
/** S11.1: the readout of a room's own sensors: the mean temperature and humidity, as the plan prints them under the room's name. "" when nothing is readable. */
export function roomReadout(r: Floor["rooms"][number], state: StateOverlay | undefined): string {
  return [meanReading(roomList(r, "temps"), state), meanReading(roomList(r, "humidity"), state)].filter(Boolean).join(" · ");
}
/** `layout.colors` as the custom properties the plan sets on a group (known types, strict colours only), so a device keeps its own colour. */
export function deviceColourVars(colors: RenderOpts["colors"]): string[] {
  return Object.entries(colors ?? {}).filter(([t, v]) => (DEVICE_TYPES as readonly string[]).includes(t) && typeof v === "string" && COLOR.test(v)).map(([t, v]) => `--fp-dev-${t}:${v}`);
}

export interface RoomMotion { radar: boolean; on: boolean; v: number }
/**
 * The rooms with motion: room index to how it reads (radar colour, a sensor is on, strength 0..1). `pulsing` holds the
 * rooms whose own sensor tripped less than `MOTION_PULSES` pulses ago, with the age in seconds. The rule behind the
 * plan's red border and the 3D view's: a sensor goes to a room by its FLOOR point, never the lifted icon: the smallest
 * room that holds it; one screwed into the wall line goes to the nearest room. The first sensor that is on in a room
 * names the colour, a fading one only lends strength. A room's own `motion` list joins the icon-made ring of the same room.
 */
export function motionRooms(f: Floor, o: RenderOpts, now: number): { triggered: Map<number, RoomMotion>; pulsing: Map<number, number> } {
  const isAttached = attachedTest(f), stateOf = (e: string) => (o.state && Object.prototype.hasOwnProperty.call(o.state, e) && typeof o.state[e]?.state === "string" ? o.state[e] : undefined);
  const listOf = roomList;
  const ring = (r: { pts?: unknown }): Pt[] | null => Array.isArray(r.pts) && r.pts.length >= 3 && r.pts.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) ? (r.pts as Pt[]) : null;
  const ringArea = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
  const rings = f.rooms.map(ring), areas = rings.map((p) => (p ? ringArea(p) : 0));
  const triggered = new Map<number, RoomMotion>();
  f.devices.forEach((d, i) => {
    if (!MOTION_TYPES.includes(d.type) || "a" in d || isAttached(d)) return; // an attached sensor lights its room through the room's own list, below
    const cls = classOf(d, o), on = cls === "on", v = on ? 1 : motionFade(d, o, now);
    if (v <= 0 || cls === "unavailable") return;
    const sel = o.selection?.t === "dev" && o.selection.i === i;
    if (o.filter && o.filter.length && !o.filter.includes(d.type) && !sel) return;
    const c: Pt = [d.x, d.y];
    if (!c.every(Number.isFinite)) return;
    let at = -1, best = Infinity;
    f.rooms.forEach((r, j) => {
      const p = rings[j];
      if (!p || r.kind === "zone" || r.kind === "structure" || (r.kind === "fill" && !r.name)) return;
      const gap = inside(c, p) ? 0 : ringGap(c, p);
      if (gap > MOTION_WALL_REACH) return;
      const rank = (gap === 0 ? 0 : 1e9) + areas[j] + gap; // inside beats near; then the smaller room
      if (rank < best) { best = rank; at = j; }
    });
    if (at < 0) return;
    const t = triggered.get(at), mine = { radar: d.type === "radar", on, v };
    if (!t || (on && !t.on)) triggered.set(at, mine);
    else if (on === t.on) t.v = Math.max(t.v, v);
  });
  // S11.1: a room's own `motion` list. On means 1 and pulses; off fades from last_changed like an icon does; unavailable
  // or unknown says nothing. It joins the icon-made ring of the same room, so a room never draws two.
  const pulsing = new Map<number, number>(); // room index to the age of its trip in seconds, only while the pulses last
  f.rooms.forEach((r, j) => {
    const p = rings[j];
    if (!p || !ROOM_OWNS[r.kind]) return;
    let on = false, v = 0, tripped = -Infinity;
    for (const e of listOf(r, "motion")) {
      const s = stateOf(e);
      if (!s) continue;
      if (s.state === "on") { on = true; tripped = Math.max(tripped, Date.parse(s.last_changed)); }
      else if (s.state !== "unavailable" && s.state !== "unknown" && (o.fade ?? 300) > 0) v = Math.max(v, fadeSince(s.last_changed, o.fade ?? 300, now));
    }
    if (!on && v <= 0) return;
    // The age is of the newest sensor that is on. An unreadable time pulses nothing: it could not be told from a fresh trip on every redraw.
    const age = Math.max(0, (now - tripped) / 1000);
    if (on && age < MOTION_PULSES * MOTION_PULSE_S) pulsing.set(j, Math.round(age * 100) / 100);
    const t = triggered.get(j);
    if (!t) triggered.set(j, { radar: false, on, v: on ? 1 : v });
    else if (on && !t.on) triggered.set(j, { radar: false, on: true, v: 1 });
    else if (on === t.on) t.v = Math.max(t.v, on ? 1 : v);
  });
  return { triggered, pulsing };
}

export interface DeviceMarkup {
  /** `on`, `off`, `unavailable` or `danger`, then what the type adds (`outdoor`, `home`/`away`, `spin`): the classes of the icon group after `dev dev-<type>`. */
  cls: string;
  base: Cls;
  /** Custom properties the icon's rules read: motion fade, a lit lamp's own colour and brightness. */
  style: string[];
  /** The inner markup of the icon: rings, halo, glyph, the away mark. */
  icon: string;
  s: StateOverlay[string] | undefined;
}
/** What a device icon wears, from the live state: the one place the plan (renderFloor) and the 3D overlay read it. `floorAt` is the device's floor point. */
export function deviceMarkup(f: Floor, d: Device, o: RenderOpts, now: number, floorAt: Pt): DeviceMarkup {
    // Value sensors in a garden room are outdoor sensors. Motion and contact keep their own state colours.
    const outdoor = (d.type === "temp" || d.type === "humidity") && f.rooms.some((r) => r.kind === "garden" && inside(floorAt, r.pts));
    const base = classOf(d, o), person = d.type === "person";
    const cls = base + (outdoor ? " outdoor" : "") + personClass(d, o, base) + vacuumSpinClass(d, o) + (isSiren(d) && base === "on" ? " siren" : "");
    const s = o.state?.[d.entity];
    const style: string[] = [];
    if (d.type === "motion" && s) {
      style.push(`--fp-fade:${num(motionFade(d, o, now))}`);
    }
    // S2.2: a lit lamp's own colour and brightness, read from its own state (not the bound switch's) and set as
    // custom properties the stylesheet consumes (`.dev.on path`), not literal fill/opacity attributes — so a
    // future rule (S2.9's aura) can read the same `--fp-dev-fill` instead of a second, possibly different, source.
    if (d.type === "light" && cls === "on" && s) {
      const fill = lightFill(s);
      if (fill) style.push(`--fp-dev-fill:${fill}`);
      const opacity = lightOpacity(s);
      if (opacity !== null) style.push(`--fp-dev-opacity:${num(opacity)}`);
    }
    // S14.3: the effect size, a fraction the rings and waves read (`--fp-fx`, default 1 in the stylesheet). Written only when it
    // changes something, so a layout that never sets it is drawn byte for byte as before.
    if (drawsEffect(d) && fxScale(d) !== 1) style.push(`--fp-fx:${num(fxScale(d))}`);
    // S7.8: an away person carries a small grey dot on the disc's edge, so away reads without relying on the fade alone.
    const mark = person && cls.endsWith(" away") ? `<circle class="away-mark" cx="23" cy="1" r="4.5"/>` : "";
    // S8.13: a triggered motion or contact sensor sends out a ring from under its disc, so it reads at a glance.
    const ping = (d.type === "motion" || d.type === "contact") && base === "on" ? `<circle class="ping" cx="12" cy="12" r="16"/>` : "";
    // S9.4: a speaker or media device playing sends out two arcs, staggered — exactly "playing", not the generic
    // .on class (a media_player can be "on" without playing, and that reads active but silent, not radiating).
    // r=16, the halo's own radius (like .ping): a smaller arc sat entirely inside the halo's fill and never showed
    // even at rest under reduced motion (Opus review, S9.4 shots) — the two together read as one ring, split so
    // each can carry its own animation-delay and pulse out a beat apart.
    // Opus review finding 8: two <circle> elements, not <path> semicircles — a circle's bounding box is always the
    // square centred on (cx,cy), so transform-box:fill-box scales it about the halo's own centre, whatever it did
    // for two independent semicircle paths (each one's bbox sits off to one side). pathLength="100" makes
    // stroke-dasharray's numbers mean "percent of the circumference" regardless of r; "50 50" is half drawn, half
    // gap, and the second arc's dashoffset of 50 puts its visible half opposite the first's, so the two read as
    // two arcs on either side of the ring rather than one drawn twice in the same place.
    const wave = (d.type === "speaker" || d.type === "media") && s?.state === "playing"
      ? `<circle class="wave" cx="12" cy="12" r="16" pathLength="100" stroke-dasharray="50 50" stroke-dashoffset="0"/>` +
        `<circle class="wave w2" cx="12" cy="12" r="16" pathLength="100" stroke-dasharray="50 50" stroke-dashoffset="50"/>`
      : "";
    // S14.3 (spec item 6): a siren that is on sends out two rings, twice the radius of a speaker's and a harder pulse; same circle trick as the waves.
    const siren = isSiren(d) && base === "on"
      ? `<circle class="siren-ring" cx="12" cy="12" r="16" pathLength="100" stroke-dasharray="50 50" stroke-dashoffset="0"/>` +
        `<circle class="siren-ring w2" cx="12" cy="12" r="16" pathLength="100" stroke-dasharray="50 50" stroke-dashoffset="50"/>`
      : "";
    const icon = `${ping}${wave}${siren}<circle class="halo" cx="12" cy="12" r="16"/><path d="${DEVICE_ICONS[d.type] ?? DEVICE_ICONS.other}"/>${mark}`;
  return { cls, base, style, icon, s };
}

export function renderFloor(f: Floor, o: RenderOpts): string {
  const k = 1 / (o.scale || 1);
  const turn = o.rotate && o.rotate.deg % 360 ? o.rotate : null, planDeg = turn ? turn.deg : 0;
  /** Attribute that keeps a text upright in a turned plan: turns it back about its own anchor. */
  const up = (x: number, y: number) => (turn ? ` transform="rotate(${num(-planDeg)} ${num(x)} ${num(y)})"` : "");
  const out: string[] = [];
  const now = o.now ?? Date.now();
  // S11.1: sensors that belong to a room. Layout and state are untrusted: a list that is not a list is empty, a state is
  // read only if it is the overlay's own, and a reading counts only if it is a plain finite number.
  const listOf = roomList, isAttached = attachedTest(f);
  /** An attached sensor draws no icon; the editor keeps it, so it can still be selected and moved (DECISIONS, S11.1). */
  const iconHidden = (d: Device) => !o.editor && isAttached(d);
  // 2.5D: the projection in the frame of the plan group. The screen-up lift is turned back by the plan's own turn, so
  // a rotated plan still lifts toward the top of the screen.
  const x25 = o.view === "2.5d";
  const scr = (p: Pt): Pt => (turn ? rotateAbout(p, turn.deg, turn.pivot) : p);
  const ob = obliqueFor(o.tilt);
  const lean = rotateAbout([ob.rise * ob.skew, -ob.rise], -planDeg, [0, 0]);
  const px: Proj = { lift: (p, h) => [p[0] + h * lean[0], p[1] + h * lean[1]], scr, rise: ob.rise, skew: ob.skew, cutaway: ob.cutaway };
  /** Where a device's icon, and everything it carries, is drawn. 2.5D lifts a high mount (a ceiling light, a camera) to
   * where the real thing hangs; a person, a heater bar, a low device and all of 2D stay at `c`. The pin and stem stay
   * at `c`, on the floor. */
  const iconAt = (d: Device, c: Pt): Pt => {
    if (!x25 || d.type === "person" || "a" in d) return c;
    const z = deviceZ(d);
    // A speaker's default is the top of its cabinet, 30 cm: below the stem threshold, but still lifted onto the box it stands on.
    return z >= STEM_MIN_Z || (DEVICE_SOLID[d.type] === "speaker" && z > 0) ? px.lift(c, z) : c;
  };
  const showText = o.labels !== false; // false skips every <text> and leader below; placement still runs, so nothing else moves
  const solids: Solid[] = [];
  // S7.11: the scan to trace over, first so everything draws on top of it. Checked again here: the layout is untrusted.
  const tr = f.trace;
  if (o.trace && tr?.on === true && typeof tr.src === "string" && tr.src.length <= MAX_TRACE_BYTES && TRACE_SRC.test(tr.src) && [tr.x, tr.y, tr.w, tr.rot, tr.alpha].every(Number.isFinite) && tr.w > 0)
    out.push(`<image class="trace" href="${tr.src}" x="${num(tr.x)}" y="${num(tr.y)}" width="${num(tr.w)}" opacity="${num(Math.min(1, Math.max(0, tr.alpha)))}" transform="rotate(${num(tr.rot)} ${num(tr.x)} ${num(tr.y)})"/>`);

  // One fixed id: two cards on a page declare the same pattern twice, and both are identical (see DECISIONS).
  const textured = [...f.rooms, ...(f.stairs ?? [])]
    .filter((r): r is typeof r & { texture: string } => typeof r.texture === "string" && TEXTURE_IDS.includes(r.texture))
    .map((r) => ({ id: r.texture, rot: normTextureRot(r.textureRot), scale: normTextureScale(r.textureScale) }));
  const hatch = f.rooms.some((r) => r.kind === "fill") ? '<pattern id="fp-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="var(--fp-fill)"/><line x1="0" y1="0" x2="0" y2="12" stroke="var(--fp-fill-line)" stroke-width="2"/></pattern>' : "";
  // S8.11: an opening cuts a real hole in the wall layer below (halo and stroke, every kind including external),
  // instead of painting a band over it, so a room's own fill or texture shows through. `openingWidths[i]` is the
  // same wallWidthAt(...) + OPENING_EXTRA the opening's own erase-line always used (S8.9 part 3): the widest wall or
  // halo the opening crosses, so no sliver survives at its sides, its ends, or where it meets a corner. The mask id
  // is a hash of the openings' own geometry (never anything from a name, so nothing here needs escaping), the same
  // convention texturePatternId already uses: two cards drawing the same floor mint the identical id and safely
  // share one `<mask>`, exactly like two cards sharing one `<pattern>`; two floors whose openings actually differ
  // mint different ids and never collide. This also keeps renderFloor a pure function of its floor and options,
  // which the rest of this file's tests rely on (byte-identical output for equal input, called any number of times).
  const openingWidths = f.openings.map((op) => wallWidthAt(f, op.a, op.b) + OPENING_EXTRA);
  // Mask colours are the SVG keywords "white"/"black" (luminance, not literal hex), matching the codebase's
  // no-literal-hex-colours convention (a `renderFloor` test enforces it).
  // Diego's field review (2026-09-26, 4x crops): a round cap erodes a full disc of radius half-width around each
  // end, in every direction, not only along the wall — the opening's ends read as concave arcs instead of a square
  // cut, and the erosion reaches past the opening's own span. "butt" cuts exactly at `a` and `b`, wider across only.
  // An open doorway (kind "open") is cut like an opening: it is a door that draws nothing, so the wall must not show through it.
  const doorways = f.doors.filter((d) => d.kind === "open");
  const openingLines = [...f.openings, ...doorways].map((op) => `<line x1="${num(op.a[0])}" y1="${num(op.a[1])}" x2="${num(op.b[0])}" y2="${num(op.b[1])}" stroke="black" stroke-width="${wallWidthAt(f, op.a, op.b) + OPENING_EXTRA}" stroke-linecap="butt"/>`);
  const maskId = openingLines.length ? `fp-open-mask-${tag(openingLines.join(""))}` : "";
  // Opus review (2026-09-26): `<mask>` itself carries no x/y/width/height, so its region defaults to -10%/120% of
  // the *viewport*, measured from the coordinate system's own 0,0 — never from the viewBox's own x/y. A floor that
  // is viewed away from the origin (zoomed in on the card or the editor, or simply drawn somewhere else in plan
  // space) then has this whole masked wall group erased outright wherever it falls outside that accidental
  // rectangle: real walls vanish, not just the opening. The inner rect already covered a huge span for the same
  // reason the mask needs one; the region attributes below are what was actually missing.
  const openingMask = maskId
    ? `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000"><rect x="-100000" y="-100000" width="200000" height="200000" fill="white"/>${openingLines.join("")}</mask>`
    : "";
  if (hatch || textured.length || openingMask) out.push(`<defs>${hatch}${texturePatterns(textured)}${openingMask}</defs>`);
  // S2.6: room_glow. A room glows when any light "in" it (point-in-polygon of the device's x,y; a light never has
  // a/b, only a heater does, but the same "a" in d guard the rest of the file uses is kept here too) is on. Untrusted
  // layout/state: a non-finite coordinate or a light outside every room's polygon is simply not counted, never thrown.
  // S7.6: the same set decides which rooms stay bright at night.
  const plugs = new Map(f.devices.filter((d) => d.type === "plug" && d.entity).map((d) => [d.entity, d]));
  const glowRooms = new Set<number>();
  if (o.roomGlow || o.night)
    for (const d of f.devices) {
      if (d.type !== "light" || classOf(d, o) !== "on") continue;
      const c = "a" in d ? mid(d.a, d.b) : ([d.x, d.y] as Pt);
      if (!c.every(Number.isFinite)) continue;
      f.rooms.forEach((r, i) => { if (inside(c, r.pts)) glowRooms.add(i); });
    }
  // Zones are painted after every other room so they sit on top whatever the array order (the editor picks the top polygon).
  // A room drawn inside a bigger one paints after it, whatever the array order, so a garden house never sits under its garden.
  const ring = (r: { pts?: unknown }): Pt[] | null => Array.isArray(r.pts) && r.pts.length >= 3 && r.pts.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) ? (r.pts as Pt[]) : null;
  const ringArea = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
  const rings = f.rooms.map(ring), areas = rings.map((p) => (p ? ringArea(p) : 0));
  const depth = rings.map((p, i) => (p ? rings.reduce((n, q, j) => n + +(j !== i && !!q && areas[j] > areas[i] && p.every((v) => inside(v, q))), 0) : 0));
  [...f.rooms.keys()].sort((a, b) => +(f.rooms[a].kind === "zone") - +(f.rooms[b].kind === "zone") || depth[a] - depth[b]).forEach((i) => {
    const r = f.rooms[i];
    if (r.kind === "fill" && !r.name) return;
    const own = paintAttr(r);
    const glow = o.roomGlow && glowRooms.has(i) ? " glow" : "";
    const on = !r.area && entityOn(o, r.entity, plugs) ? " on" : "";
    out.push(`<polygon data-r="${i}" class="room room-${esc(String(r.kind))}${r.kind === "water" ? " water" : ""}${glow}${on}"${own} points="${pts(r.pts)}"/>`);
  });

  f.stairs.forEach((t, i) => out.push(stairsGroup(t, i, o.around)));

  // S7.6: the night overlay, over every room fill and staircase, under walls, names and devices, so lines and icons stay
  // crisp. Zones and structures sit on a room and share its overlay; a fill with no name is not drawn, so it gets none.
  // No data-r: the overlay is never a pick target (class room-night carries pointer-events:none, CLAUDE.md finding 18).
  if (o.night)
    f.rooms.forEach((r, i) => {
      if (r.kind === "zone" || r.kind === "structure" || (r.kind === "fill" && !r.name)) return;
      out.push(`<polygon data-night="${i}" class="room-night${glowRooms.has(i) ? " lit" : ""}" points="${pts(r.pts)}"/>`);
    });

  // S2.8: every lit lamp's aura, drawn as one flat pass before any device group. S8.13: and before walls, doors,
  // furniture and names, now that it reaches 150 cm and would tint them (an open door's red line most of all). One pass, not interleaved with the
  // devices loop below, so two overlapping auras never sit between one lamp's icon and the next lamp's icon; the
  // icons themselves (drawn after every aura) stay on top and legible. The colour is the lamp's own rgb_color, read
  // the same way as the device group's --fp-dev-fill (S2.2): from the light entity's own state, never the bound switch's.
  f.devices.forEach((d, i) => {
    const sel = o.selection?.t === "dev" && o.selection.i === i;
    if (d.type !== "light") return;
    if (o.filter && o.filter.length && !o.filter.includes(d.type) && !sel) return;
    if (classOf(d, o) !== "on") return;
    const floorAt = "a" in d ? mid(d.a, d.b) : ([d.x, d.y] as Pt);
    if (!floorAt.every(Number.isFinite)) return;
    const c = iconAt(d, floorAt); // the aura hangs with the lamp, not on the floor under it
    const fill = lightFill(o.state?.[d.entity]);
    const style = fill ? ` style="--fp-aura:${fill}"` : "";
    const reach = num(LIGHT_REACH * fxScale(d)); // S14.3: the lamp's own effect size; 150 at the default
    // The light stays in the room it hangs in: clipped to the smallest real room holding the lamp (`roomAt`: a zone, a structure
    // and a fill are not rooms; a lamp in no room, a garden lamp say, keeps the free circle). The clip is the floor polygon.
    const holder = roomAt(f, floorAt), own = holder < 0 ? null : ring(f.rooms[holder]);
    if (own) {
      // The aura hangs with the lamp (`c`), so its clip takes the same lift off the floor.
      const lift = c[0] !== floorAt[0] || c[1] !== floorAt[1] ? ` transform="translate(${at([c[0] - floorAt[0], c[1] - floorAt[1]])})"` : "";
      const cid = `fp-aura-${tag(`${pts(own)}${lift}`)}`;
      out.push(`<clipPath id="${cid}"${lift}><polygon points="${pts(own)}"/></clipPath>`);
      out.push(`<circle class="aura" cx="${num(c[0])}" cy="${num(c[1])}" r="${reach}" clip-path="url(#${cid})"${style}/>`);
      return;
    }
    out.push(`<circle class="aura" cx="${num(c[0])}" cy="${num(c[1])}" r="${reach}"${style}/>`);
  });

  const polys: { id: string; pts: Pt[]; wk?: EdgeKind[]; zone?: boolean }[] = [{ id: "o", pts: f.outline, wk: f.owk }, ...f.rooms.map((r, i) => ({ id: `r${i}`, pts: r.pts, wk: r.wk, zone: r.kind === "zone" }))];
  // Every edge has a white twin drawn first (the line version of the text outline), so a dark line stays visible on a dark floor.
  const edgeLines: { cls: string; attr: string; a: Pt; b: Pt }[] = [], guides: typeof edgeLines = [];
  for (const P of polys)
    P.pts.forEach((a, i) => {
      // The outline defaults external (the house perimeter, S1.52); a room with no wk yet is never valid, so "wall" is only a defensive fallback.
      const b = P.pts[(i + 1) % P.pts.length], kind = P.zone ? "boundary" : P.wk ? P.wk[i] : P.id === "o" ? "external" : "wall";
      if (kind === "none") { if (o.editor) guides.push({ cls: "e none", attr: ` data-e="${P.id}:${i}"`, a, b }); return; } // not drawn: the editor keeps a faint guide so it can be picked again
      if (x25 && !P.zone && edgeHeight(f, P.id === "o" ? null : f.rooms[Number(P.id.slice(1))], i) > 0) return; // a wall with height is drawn as a solid below
      edgeLines.push({ cls: edgeClass(kind), attr: ` data-e="${P.id}:${i}"`, a, b });
    });
  f.walls.forEach((w, i) => { if (!(x25 && wallHeight(f, w) > 0)) edgeLines.push({ cls: edgeClass(w.kind), attr: ` data-w="${i}"`, a: w.a, b: w.b }); });
  const seg = (a: Pt, b: Pt) => `x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"`;
  // S8.11: every halo and stroke line, of every kind (including external and the free-wall/outline lines above),
  // is what an opening's mask cuts a hole through — collected here instead of pushed straight to `out` so the whole
  // lot can be wrapped in one `<g mask>` when there is a hole to cut, and left alone (no group, no defs, identical
  // output to before) when there is not.
  const wallLines: string[] = [];
  for (const l of edgeLines) wallLines.push(`<line class="eh${l.cls.slice(1)}" ${seg(l.a, l.b)}/>`);
  for (const l of [...guides, ...edgeLines]) wallLines.push(`<line class="${l.cls}"${l.attr} ${seg(l.a, l.b)}/>`);
  if (maskId) out.push(`<g mask="url(#${maskId})">${wallLines.join("")}</g>`);
  else out.push(...wallLines);

  // S8.11 review (Opus, 2026-09-26): the seam patch this comment used to sit above is gone. Widening the opening's own
  // cut past the wall halo's edge (OPENING_EXTRA, above) closed the antialiasing gap it was built to hide — checked at
  // 4x in light, blueprint and ha-dark, on an outline-wall opening and on an opening between two differently-coloured
  // rooms (a test layout, not the demo), no line survives. See the S8.11 DECISIONS follow-up.

  // S2.9 round 3: a room's own boundary is almost always also a wall, and a wall's white halo (3.5-5px) is drawn
  // right on top of the room polygon and fully covers a same-width stroke on it — the .room.on rule above proves
  // correct in a computed-style pair, but on screen the "on" ring all but vanished behind the wall it traces
  // (Opus review: rendered and looked at). A second, undecorated pass draws the ring again after every wall line,
  // on top of them, so it actually reads. fill="none" makes the :not([fill]) room rules leave it alone; it takes
  // no clicks of its own, the polygon underneath still does.
  [...f.rooms.keys()].forEach((i) => {
    const r = f.rooms[i];
    if (r.kind === "fill" && !r.name) return;
    if (r.area || !entityOn(o, r.entity, plugs)) return;
    out.push(`<polygon class="room on ring" fill="none" pointer-events="none" points="${pts(r.pts)}"/>`);
  });
  // S11.3: the room the card has picked, a dashed line just inside its walls (the motion perimeter's band, under its own class),
  // drawn after the wall lines: a stroke on the room's own polygon sits under the wall halo and is not seen (finding 16).
  // No data-r: it is never a pick target.
  const pickedAt = typeof o.selectedRoom === "number" ? o.selectedRoom : -1, pickedRing = pickedAt >= 0 && f.rooms[pickedAt] ? ring(f.rooms[pickedAt]) : null;
  if (pickedRing) out.push(motionPerimeter(f, pickedRing, pickedAt, false, 1, null, { cls: "room-picked", data: "data-picked" }));

  // A room with a triggered motion sensor (or radar) in it gets one thin line just inside its walls, for as long as the
  // sensor is on, and while a motion icon is still red from its fade (red icon and no border read as a bug, Diego
  // 0.12.23; the border fades with the icon). The sensor goes to a room by its FLOOR point, never the lifted icon: the
  // smallest room that holds it (a house in a garden lights the house); one screwed into the wall line goes to the
  // nearest room. The first sensor that is on in a room names the colour, a fading one only lends strength. Same pass
  // as the ring above, after the wall lines, so the 2.5D solids below still cover it.
  const { triggered, pulsing } = motionRooms(f, o, now);
  for (const i of [...triggered.keys()].sort((a, b) => a - b)) { const t = triggered.get(i)!; out.push(motionPerimeter(f, rings[i]!, i, t.radar, t.on ? 1 : t.v, pulsing.get(i) ?? null)); }

  // 2.5D: the solids, back to front, over the floor-level things above (fills, flat edges, rings) and under everything
  // below (names, icons, door lines), so a tap target is never hidden behind a wall. Stable sort: equal depth keeps array order.
  if (x25) {
    solids.push(...wallSolids(f, px, wallsModeOf(o.walls), o.state));
    f.furniture.forEach((m, i) => {
      const mode = furnitureMode(m), sym = FURNITURE[m.symbol];
      const s = mode !== "flat" && sym ? furnitureSolid(m, i, mode, entityOn(o, m.entity, plugs), sym.svg, px) : null;
      if (s) solids.push(s);
    });
    for (const u of f.unlinked ?? []) { const s = unlinkedSolid(u, px); if (s) solids.push(s); }
    f.devices.forEach((d, i) => {
      if (o.filter && o.filter.length && !o.filter.includes(d.type) && !(o.selection?.t === "dev" && o.selection.i === i)) return;
      const s = deviceSolid(f, d, classOf(d, o), px);
      if (s) solids.push(s);
    });
    for (const t of f.stairs) solids.push(...stairSolids(t, floorHeight(f), px, resolveStairDirection(t, o.around)));
    // What lies below the floor (a stairwell) goes first: nothing standing on the floor is ever drawn under it.
    out.push(...solids.filter((s) => s.under).sort((a, b) => a.key - b.key).map((s) => s.svg));
    out.push(...solids.filter((s) => !s.under).sort((a, b) => a.key - b.key).map((s) => s.svg));
  }

  // S7.1: no text overprints another text or a device icon. Every text is placed against one list of boxes, in the screen
  // frame (text is drawn upright, so on screen every box is axis-aligned; a turned plan is turned into that frame first).
  // A text box is len x 0.6 x size wide and size tall, its baseline 0.75 of the size below its top (text-anchor middle).
  // The icons go in first, so nothing may hide one; then room names (what a person reads), room labels, zone labels,
  // extras' names, and last the sensor values, in the device loop below. A text takes the first free candidate; with
  // none free it keeps its first one regardless, so nothing is ever dropped (a name longer than its room, say).
  const placed: Box[] = [];
  const toScreen = (p: Pt): Pt => (turn ? rotateAbout(p, turn.deg, turn.pivot) : p);
  const cs = Math.cos((planDeg * Math.PI) / 180), sn = Math.sin((planDeg * Math.PI) / 180);
  /** The plan point that shows `dx` right of and `dy` below `a` on the screen: the screen vector turned back into the plan. */
  const screenOff = (a: Pt, dx: number, dy: number): Pt => (planDeg ? [a[0] + dx * cs + dy * sn, a[1] - dx * sn + dy * cs] : [a[0] + dx, a[1] + dy]);
  const textBox = (a: Pt, size: number, len: number): Box => { const [x, y] = toScreen(a), w = len * 0.6 * size; return [x - w / 2, y - 0.75 * size, w, size]; };
  const place = (cands: Pt[], size: number, text: unknown): Pt => {
    const len = String(text).length, at = cands.find((c) => !placed.some((q) => meets(textBox(c, size, len), q))) ?? cands[0];
    placed.push(textBox(at, size, len));
    return at;
  };
  const inPoly = inside, centroid = polyCentre;
  /** Centroid, 32k below, 32k above, 64k below, 64k above: 32k clears a 16k disc and a 12k name either way.
   * The ones inside the room come first: a name goes to the next room only when no spot in its own is free.
   * `avoid` are smaller rooms drawn inside this one (a pond in a garden): a name on one hides under its fill. */
  const rows = (a: Pt, poly?: Pt[], avoid: Pt[][] = []): Pt[] => {
    const all = [0, 32, -32, 64, -64].map((dy) => screenOff(a, 0, dy * k));
    if (!poly) return all;
    const ok = (c: Pt, i: number) => (i === 0 || inPoly(c, poly)) && !avoid.some((q) => inPoly(c, q));
    const ins = all.filter(ok);
    return [...ins, ...all.filter((c, i) => !ok(c, i))];
  };
  const disc = (c: Pt, r: number) => { const [x, y] = toScreen(c); placed.push([x - r, y - r, 2 * r, 2 * r]); };
  // S7.8: a person whose room sensor names a room stands at that room's centroid, the same point its name is tried at
  // first. Several in one room stand on a ring round it, in device order, far enough apart that their 16k discs never
  // touch: the chord between neighbours is 2R sin(pi/n) >= 34k. The icon is placed here, before any text, so the room's
  // name moves off it like off any other icon.
  const personAt = new Map<number, Pt>();
  const byRoom = new Map<number, number[]>();
  f.devices.forEach((d, i) => {
    const sel = o.selection?.t === "dev" && o.selection.i === i;
    if (o.filter && o.filter.length && !o.filter.includes(d.type) && !sel) return;
    const r = personRoom(d, f.rooms, o);
    if (r >= 0) byRoom.set(r, [...(byRoom.get(r) ?? []), i]);
  });
  // Demo and real plans put a light at a room's centroid, so the ring's centre moves off any other icon it would cover:
  // the centroid, then 40k below, above, right and left of it, the first where no person lands on another icon's disc.
  const others: Pt[] = [];
  f.devices.forEach((d, i) => {
    if ([...byRoom.values()].some((who) => who.includes(i)) || iconHidden(d)) return;
    const c = "a" in d ? mid(d.a, d.b) : ([d.x, d.y] as Pt);
    if (c.every(Number.isFinite)) others.push(iconAt(d, c));
  });
  for (const [r, who] of byRoom) {
    const c0 = centroid(f.rooms[r].pts), n = who.length;
    if (!c0.every(Number.isFinite)) continue;
    const R = n > 1 ? Math.max(20 * k, (17 * k) / Math.sin(Math.PI / n)) : 0;
    const ring = (c: Pt) => who.map((_, j): Pt => { const a = (2 * Math.PI * j) / n - Math.PI / 2; return [c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]; });
    const free = (ps: Pt[]) => ps.every((p) => others.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= 32 * k));
    const spots = [c0, screenOff(c0, 0, 40 * k), screenOff(c0, 0, -40 * k), screenOff(c0, 40 * k, 0), screenOff(c0, -40 * k, 0)].map(ring);
    (spots.find(free) ?? spots[0]).forEach((p, j) => personAt.set(who[j], p));
  }
  const centreOf = (d: Device, i: number): Pt => personAt.get(i) ?? ("a" in d ? mid(d.a, d.b) : ([d.x, d.y] as Pt));
  f.devices.forEach((d, i) => {
    const sel = o.selection?.t === "dev" && o.selection.i === i;
    if (o.filter && o.filter.length && !o.filter.includes(d.type) && !sel) return;
    if (iconHidden(d)) return;
    const c = centreOf(d, i);
    if (c.every(Number.isFinite)) disc(iconAt(d, c), 16 * k);
  });
  for (const u of f.unlinked ?? []) {
    const scale = typeof u.scale === "number" && Number.isFinite(u.scale) && u.scale > 0 ? u.scale : 1;
    if (Number.isFinite(u.x) && Number.isFinite(u.y)) disc([u.x, u.y], 16 * k * scale);
  }
  // S7.15: doors are obstacles too, so a name never runs across one (the demo's "Garden pond" sat on the garage
  // door). A door's box is its line, in the screen frame, widened by half its 22-unit stroke on every side.
  for (const d of f.doors) {
    const [ax, ay] = toScreen(d.a), [bx, by] = toScreen(d.b), h = DOOR_HIT_WIDTH / 2;
    if ([ax, ay, bx, by].every(Number.isFinite)) placed.push([Math.min(ax, bx) - h, Math.min(ay, by) - h, Math.abs(bx - ax) + 2 * h, Math.abs(by - ay) + 2 * h]);
  }
  const named = (r: Floor["rooms"][number]) => !!r.name && r.kind !== "fill";
  const area = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
  /** The width of the room along the screen row through `a`, on the stretch that holds `a`; 0 when the row misses the room. */
  const chordAt = (poly: Pt[], a: Pt): number => {
    const sp = poly.map(toScreen), [ax, ay] = toScreen(a), xs: number[] = [];
    for (let i = 0, j = sp.length - 1; i < sp.length; j = i++) if ((sp[i][1] > ay) !== (sp[j][1] > ay)) xs.push(sp[i][0] + ((ay - sp[i][1]) * (sp[j][0] - sp[i][0])) / (sp[j][1] - sp[i][1]));
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) if (ax >= xs[i] && ax <= xs[i + 1]) return xs[i + 1] - xs[i];
    return 0;
  };
  const GAP = 4; // plan units (times k) between a room and a name put outside it
  /** Where a room's name goes and at what size. Too wide for the room at its anchor row: shrink to `floor` (centred);
   * still too wide: just outside the room, above or below, on a leader line back to the anchor. Never dropped. */
  type Label = { at: Pt; size: number; from?: Pt };
  const placeName = (r: Floor["rooms"][number], base: number, floor: number): Label => {
    const mine = area(r.pts), inner = f.rooms.filter((q) => q !== r && named(q) && q.kind !== "zone" && area(q.pts) < mine).map((q) => q.pts);
    const anchor = centroid(r.pts), len = String(r.name).length, room = chordAt(r.pts, anchor);
    const size = Math.max(floor, Math.min(base, room / (len * 0.6)));
    if (!anchor.every(Number.isFinite) || len * 0.6 * size <= room) return { at: place(rows(anchor, r.pts, inner), size, r.name), size };
    const ys = r.pts.map((p) => toScreen(p)[1]), ay = toScreen(anchor)[1];
    const above = screenOff(anchor, 0, Math.min(...ys) - GAP * k - 0.25 * size - ay), below = screenOff(anchor, 0, Math.max(...ys) + GAP * k + 0.75 * size - ay);
    // The leader is one more thing that must not run across another text: its own thin box counts too.
    const leaderBox = (c: Pt): Box => { const [x, y] = toScreen(anchor), cy = toScreen(c)[1]; return [x - k / 2, Math.min(y, cy), k, Math.abs(cy - y)]; };
    const free = (c: Pt) => !placed.some((q) => meets(textBox(c, size, len), q));
    const at = [below, above].find((c) => free(c) && !placed.some((q) => meets(leaderBox(c), q))) ?? [below, above].find(free) ?? below;
    placed.push(textBox(at, size, len));
    return { at, size, from: anchor };
  };
  const nameAt: Label[] = [], zoneAt: Label[] = [];
  f.rooms.forEach((r, i) => { if (named(r) && r.kind !== "zone") nameAt[i] = placeName(r, 11 * k, 7 * k); });
  f.rooms.forEach((r, i) => { if (named(r) && r.kind === "zone") zoneAt[i] = placeName(r, 8 * k, 6 * k); });

  // Openings erase the wall under them; extras are dashed outlines with a name. Both sit under devices and names.
  // S8.9 part 3: the opening's own stroke must cover whichever wall it is on, now that walls no longer share one width.
  f.openings.forEach((op, i) => out.push(`<line class="opening" x1="${num(op.a[0])}" y1="${num(op.a[1])}" x2="${num(op.b[0])}" y2="${num(op.b[1])}" stroke-width="${openingWidths[i]}"/>`));
  f.extras.forEach((x, i) => {
    const mx = Math.min(x.a[0], x.b[0]), my = Math.min(x.a[1], x.b[1]), w = Math.abs(x.a[0] - x.b[0]), h = Math.abs(x.a[1] - x.b[1]);
    out.push(w && h
      ? `<rect class="extra" data-ex="${i}" x="${num(mx)}" y="${num(my)}" width="${num(w)}" height="${num(h)}"/>`
      : `<line class="extra" data-ex="${i}" x1="${num(x.a[0])}" y1="${num(x.a[1])}" x2="${num(x.b[0])}" y2="${num(x.b[1])}"/>`);
    const [tx, ty] = place(rows([mx + w / 2, my + h / 2]), 11 * k, x.name);
    if (showText) out.push(`<text class="lbl" x="${num(tx)}" y="${num(ty)}"${up(tx, ty)} text-anchor="middle" font-size="${num(11 * k)}">${esc(x.name)}</text>`);
  });

  f.furniture.forEach((m, i) => {
    const sym = FURNITURE[m.symbol];
    if (!sym || (x25 && furnitureMode(m) !== "flat")) return; // 2.5D draws a block above; a flat piece (a patio) stays as in 2D
    const on = entityOn(o, m.entity, plugs) ? " on" : "";
    out.push(`<g data-f="${i}" class="furn${on}" transform="translate(${num(m.x)} ${num(m.y)}) rotate(${num(m.rot)}) scale(${num(m.w / 100)} ${num(m.h / 100)}) translate(-50 -50)" color="var(--fp-furniture)">${sym.svg}</g>`);
  });

  f.doors.forEach((d, i) => {
    // S4.24: several contact sensors may be attached; the door reads open if any one does, and the same for an
    // attached smart lock left unlocked (Diego, 2026-09-28: an unlocked door or window is the same security
    // state as an open one, so it gets the same alert).
    // (doorStateOf, door-state.ts, also drives the 2.5D wall face.) Diego, 2026-09-28: on a window or glass door,
    // `cover` is curtains/blinds - open curtains are not a security state and never colour the opening.
    // S10.3: a triggered vibration sensor gives the door the same red and the same pulsing alert line as an open
    // contact, but solid, not dashed - dashed keeps meaning "open" alone. Both at once: dashed (open wins the
    // dash, class order below puts .open after .alarm so its dasharray is the one asserted last), red, one line.
    const { open, alarm: vibrating, cover: coverOpen } = doorStateOf(d, o.state);
    const sel = o.selection?.t === "door" && o.selection.i === i, doorway = d.kind === "open";
    // S14.5: a tripped doorway is a solid alert band (`band`: no dash, no pulse), not an open door's look.
    const tripped = doorway && (open || vibrating || coverOpen);
    const cls = ["door", `door-${esc(String(d.kind))}`, d.kind === "slit" ? "door-window" : "", vibrating ? "alarm" : "", open ? "open" : "", coverOpen ? "cover-open" : "", tripped ? "band" : ""].filter(Boolean).join(" ");
    // 2.5D: the wall is already cut open above, so the floor line is only a threshold, thin enough to see through the gap.
    // It keeps every class (open, alarm, cover-open) and its alert line, so a door's state still shows.
    // A slit window is the window mark drawn as a thin band (SLIT_BAND of the wall), so it reads as a slit at a glance.
    const w = x25 ? DOOR_THRESHOLD_25D : d.kind === "slit" ? wallWidthAt(f, d.a, d.b) * SLIT_BAND : wallWidthAt(f, d.a, d.b);
    const seg = `x1="${num(d.a[0])}" y1="${num(d.a[1])}" x2="${num(d.b[0])}" y2="${num(d.b[1])}"`;
    // S8.9 part 2 + finding 3: the visible line is now as thin as the internal wall it sits on (10 cm, or 20 on an
    // external wall), so a plain transparent line first, at the old fixed 22 cm, keeps the door as easy to click as
    // it always was. It shares data-d with the visible line, so hitOf() (editor-app.ts) finds the same door either way.
    // S8.13: an open contact door gets a wide pulsing line under its own, so it reads from across the room.
    // S10.3: a vibrating door gets the same line - open or vibrating (or both) is still only ever one alert line.
    if ((open || vibrating) && !doorway) out.push(`<line class="door-alert" ${seg} stroke-width="${w + DOOR_ALERT_EXTRA}"/>`);
    out.push(`<line data-d="${i}" class="door-hit${doorway ? " door-hit-open" : ""}" ${seg} stroke-width="${DOOR_HIT_WIDTH}"/>`);
    // A doorway draws nothing of its own: only its state (open, vibrating, cover open) or the editor's selection shows a line.
    if (doorway && !sel && !open && !vibrating && !coverOpen) return;
    out.push(`<line data-d="${i}" class="${cls}${sel ? " sel" : ""}" ${seg} stroke-width="${sel ? w + DOOR_SELECT_EXTRA : w}"><title>${esc(d.name ?? "")}</title></line>`);
  });

  f.rooms.forEach((r, i) => {
    if (!showText || !r.name || r.kind === "fill") return;
    const zone = r.kind === "zone", { at: [x, y], size, from } = (zone ? zoneAt : nameAt)[i];
    // The leader runs from the room's anchor to the edge of the text box nearest it, and is drawn under the text.
    if (from) {
      const down = toScreen([x, y])[1] > toScreen(from)[1], [ex, ey] = screenOff([x, y], 0, down ? -0.75 * size - 0.5 * k : 0.25 * size + 0.5 * k);
      out.push(`<line class="lbl-leader" stroke-width="${num(k)}" x1="${num(from[0])}" y1="${num(from[1])}" x2="${num(ex)}" y2="${num(ey)}"/>`);
    }
    out.push(zone
      ? `<text class="lbl zone" x="${num(x)}" y="${num(y)}" data-rl="${i}"${up(x, y)} text-anchor="middle" font-size="${num(size)}">${esc(r.name)}</text>`
      : `<text class="lbl" x="${num(x)}" y="${num(y)}" data-rl="${i}"${up(x, y)} text-anchor="middle" font-size="${num(size)}" font-weight="600" opacity=".5">${esc(r.name)}</text>`);
  });

  // S11.1: the readout of a room's own sensors, a small line under its name (or at its anchor when it has none). Placed like
  // every other text, so it moves off a name or an icon; nothing readable draws nothing, never "NaN".
  f.rooms.forEach((r, i) => {
    if (!showText || !ROOM_OWNS[r.kind]) return;
    const text = [meanReading(listOf(r, "temps"), o.state), meanReading(listOf(r, "humidity"), o.state)].filter(Boolean).join(" · ");
    if (!text) return;
    const lab = nameAt[i], base = lab?.at ?? centroid(r.pts), size = lab?.size ?? 0, vs = 10 * k;
    if (!base.every(Number.isFinite)) return;
    const [vx, vy] = place([screenOff(base, 0, 0.25 * size + k + 0.75 * vs), screenOff(base, 0, -0.75 * size - k - 0.25 * vs)], vs, text);
    out.push(`<text class="val" data-rv="${i}" x="${num(vx)}" y="${num(vy)}"${up(vx, vy)} text-anchor="middle" font-size="${num(vs)}">${esc(text)}</text>`);
  });

  f.devices.forEach((d, i) => {
    const sel = o.selection?.t === "dev" && o.selection.i === i;
    if (o.filter && o.filter.length && !o.filter.includes(d.type) && !sel) return;
    if (iconHidden(d)) return;
    const floorAt = centreOf(d, i);
    if (!floorAt.every(Number.isFinite)) return;
    // `c` is where the icon and all it carries are drawn; `floorAt` only the pin, the stem, the room test and a radar's targets.
    const c = iconAt(d, floorAt);
    const person = d.type === "person";
    const { cls, style: styleParts, icon, s } = deviceMarkup(f, d, o, now, floorAt);
    // S7.8: a person's position is a CSS transform, so .dev-person's transition can glide it to a new room. A person
    // has no facing, so `rot` is not applied.
    const origin = at([c[0] - 12 * k, c[1] - 12 * k]).replace(" ", "px,") + "px";
    if (person) styleParts.push(`transform:translate(${origin}) scale(${num(k)})`);
    const style = styleParts.length ? ` style="${styleParts.join(";")}"` : "";
    const label = d.name ?? d.id;
    const bound = d.type === "light" && d.bound ? d.bound : "";
    const bname = bound ? o.state?.[bound]?.attributes.friendly_name : undefined;
    const w = d.type === "plug" ? plugWatts(d, o) : null;
    const title = `${esc(d.type)}: ${esc(label)}${w === null ? "" : `, ${num(Math.round(w * 10) / 10)} W`}${bound ? ` + ${esc(typeof bname === "string" && bname ? bname : bound)}` : ""}`;
    // The group turns by `rot` about the icon's centre; the icon turns back so the glyph stays upright (only what else is drawn in the group turns).
    const rot = !person && typeof d.rot === "number" && Number.isFinite(d.rot) && d.rot !== 0 ? d.rot : 0;
    // A turned plan turns the group again from outside; the icon takes that back too, the cone (in the group's frame) does not.
    const back = (rot + planDeg) % 360 ? rot + planDeg : 0;
    // Camera: a 120 degree, 100 cm cone about "up" (-90 degrees), in plan units (the group is scaled by k). It comes first, so the icon covers its tip.
    let cone = "";
    if (d.type === "camera") {
      const R = DEVICE_REACH / k, p = (deg: number) => at([12 + R * Math.cos((deg * Math.PI) / 180), 12 + R * Math.sin((deg * Math.PI) / 180)]);
      cone = `<path class="cone" d="M12 12L${p(-150)}A${num(R)} ${num(R)} 0 0 1 ${p(-30)}Z"/>`;
    }
    // 2.5D: a device mounted high (a ceiling light, a camera, a thermostat) is drawn where the real thing hangs (`c`,
    // lifted), with its aura, cone, rings and text. A small pin stays on the floor under it and a thin stem joins the
    // two. The tap target is the lifted icon. A person walks about and a heater bar lies on the floor: neither lifts.
    if (c !== floorAt) out.push(`<line class="stem" x1="${num(floorAt[0])}" y1="${num(floorAt[1])}" x2="${num(c[0])}" y2="${num(c[1])}"/><circle class="stem-top" cx="${num(floorAt[0])}" cy="${num(floorAt[1])}" r="${num(3 * k)}"/>`);
    // The bar draws first so the icon group (fix/heater-bar-under-icon), with its white disc and halo, always paints on top of it.
    // S2.5: the bar carries the same on/off/unavailable class as the icon, so it goes orange only while heating (classOf already reads hvac_action).
    if ("a" in d) out.push(`<line data-xbar="${i}" class="heater ${cls}${sel ? " sel" : ""}" x1="${num(d.a[0])}" y1="${num(d.a[1])}" x2="${num(d.b[0])}" y2="${num(d.b[1])}" stroke-width="${sel ? 12 : 8}"/>`);
    const dim = o.dimmed?.has(d.entity) ? " dim" : "";
    out.push(`<g data-x="${i}" class="dev dev-${esc(String(d.type))}${d.type === "ac" ? ` ${acMode(d, o) ?? ""}`.trimEnd() : ""}${bound ? " bound" : ""}${o.editor && d.entity === "" ? " unbound" : ""} ${cls}${sel ? " sel" : ""}${dim}"${style}${person ? "" : ` transform="translate(${at([c[0] - 12 * k, c[1] - 12 * k])}) scale(${num(k)})${rot ? ` rotate(${num(rot)} 12 12)` : ""}"`}><title>${title}</title>${cone}${back ? `<g transform="rotate(${num(-back)} 12 12)">${icon}</g>` : icon}</g>`);
    // S7.9: a radar's targets. Each pair's x (mm, right of the sensor) and y (mm, ahead of it) is turned by the
    // sensor's own `rot` the same way a plan point turns (SVG's own clockwise convention: rot 0 keeps "ahead" up),
    // converted to centimetres, then added to the sensor's own position — the world point a target dot is drawn
    // at, unless that point falls outside the floor's own outline, in which case it is skipped, not clamped.
    // Untrusted state: a non-numeric or missing reading draws nothing for that one pair; nothing caps how many.
    // Opus review 2026-09-25: Number("") and Number(" ") are 0, and an LD2450 reports 0/0 for an empty slot, so a
    // blank reading is not a number here and a pair at exactly 0/0 is "no target", never a dot on the sensor itself.
    if (d.type === "radar" && Array.isArray(d.targets)) {
      const rad = (rot * Math.PI) / 180;
      const mm = (e: string) => { const s = String(o.state?.[e]?.state ?? "").trim(); return s === "" ? NaN : Number(s) / 10; }; // mm to cm
      for (const t of d.targets) {
        const xl = mm(t.x), yl = mm(t.y);
        if (!Number.isFinite(xl) || !Number.isFinite(yl) || (xl === 0 && yl === 0)) continue;
        const p: Pt = [floorAt[0] + xl * Math.cos(rad) + yl * Math.sin(rad), floorAt[1] + xl * Math.sin(rad) - yl * Math.cos(rad)];
        if (!inside(p, f.outline)) continue;
        out.push(`<circle class="target" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(6 * k)}"/>`);
      }
    }
    if ((d.type === "temp" || d.type === "humidity") && s) {
      // Anything that is not a finite number reads as "–". `unknown` and `unavailable` are only the two HA spells for it;
      // an integration can report an empty string, a comma decimal or a word, and printing "not-a-number °C" is worse than saying nothing.
      const bad = !/^-?\d+(\.\d+)?$/.test(s.state.trim()) || !Number.isFinite(Number(s.state));
      const unit = typeof s.attributes.unit_of_measurement === "string" ? ` ${s.attributes.unit_of_measurement}` : "";
      const text = bad ? "–" : s.state + unit, vs = 11 * k, gap = 16 * k + 2 * k; // 2k clear of the 16k disc
      // S7.1: below the icon, then above, then to the right (the box centred on the icon's centre line).
      const [vx, vy] = place([screenOff(c, 0, gap + 0.75 * vs), screenOff(c, 0, -gap - 0.25 * vs), screenOff(c, gap + (text.length * 0.6 * vs) / 2, 0.25 * vs)], vs, text);
      if (showText) out.push(`<text class="val" x="${num(vx)}" y="${num(vy)}"${up(vx, vy)} text-anchor="middle" font-size="${num(vs)}">${esc(text)}</text>`);
    }
    if (showText && (o.showNames || sel)) out.push(`<text class="lbl" x="${num(c[0])}" y="${num(c[1] - 16 * k)}"${up(c[0], c[1] - 16 * k)} text-anchor="middle" font-size="${num(9 * k)}">${esc(label)}</text>`);
  });

  // S4.25: an unlinked appliance. Flat idle-grey icon (no on/off state), an optional per-instance colour override,
  // and its own scale/rot — otherwise the same group shape as a device icon, so selection (.sel) and hit-testing
  // (data-u, mirroring data-x) need no new CSS or overlay code (finding 8, one draw path).
  (f.unlinked ?? []).forEach((u, i) => {
    if (!Number.isFinite(u.x) || !Number.isFinite(u.y)) return;
    const sel = o.selection?.t === "unl" && o.selection.i === i;
    const scale = typeof u.scale === "number" && Number.isFinite(u.scale) && u.scale > 0 ? u.scale : 1;
    const rot = typeof u.rot === "number" && Number.isFinite(u.rot) && u.rot !== 0 ? u.rot : 0;
    const uk = k * scale;
    const style = u.color && COLOR.test(u.color) ? ` style="--fp-dev-fill:${u.color}"` : "";
    const label = u.name ?? u.id;
    const icon = `<circle class="halo" cx="12" cy="12" r="16"/><path d="${DEVICE_ICONS[u.type] ?? DEVICE_ICONS.other}"/>`;
    // Unlike a device icon (which stays upright so a live state reads at a glance), an unlinked appliance is a
    // placed object like furniture: `rot` turns the glyph itself, and it turns again with the plan when the
    // plan is rotated (no counter-rotation) — found by looking at the render (npm run shots), not by the unit
    // test alone: a copy of the device's "icon stays upright" logic left `rot` with no visible effect at all.
    out.push(`<g data-u="${i}" class="dev unl${sel ? " sel" : ""}"${style} transform="translate(${at([u.x - 12 * uk, u.y - 12 * uk])}) scale(${num(uk)})${rot ? ` rotate(${num(rot)} 12 12)` : ""}"><title>${esc(String(u.type))}: ${esc(label)}</title>${icon}</g>`);
    if (showText && (o.showNames || sel)) out.push(`<text class="lbl" x="${num(u.x)}" y="${num(u.y - 16 * k)}"${up(u.x, u.y - 16 * k)} text-anchor="middle" font-size="${num(9 * k)}">${esc(label)}</text>`);
  });

  if (o.editor)
    for (const P of polys) P.pts.forEach((p, j) => out.push(`<circle class="h" data-h="${P.id}:${j}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`));
  const body = out.join("\n");
  const turned = turn ? `<g class="plan-turn" transform="rotate(${num(turn.deg)} ${num(turn.pivot[0])} ${num(turn.pivot[1])})">${body}</g>` : body;
  // Custom properties inherit, so one style on a group reaches every device. Only known types and strict #rrggbb go in: the value ends up in an attribute.
  const vars = deviceColourVars(o.colors);
  const coloured = vars.length ? `<g class="dev-colours" style="${vars.join(";")}">${turned}</g>` : turned;
  // A plan-level theme, so one plan can differ from its host. No o.theme writes nothing and inherits the host's. o.theme is checked against THEMES:
  // it lands in an attribute, and a caller's stray string must not.
  const night = o.night ? ' class="night"' : "";
  if (!o.theme || !(THEMES as readonly string[]).includes(o.theme)) return night ? `<g${night}>${coloured}</g>` : coloured;
  return `<g data-theme="${o.theme}"${o.theme === "ha" && o.dark ? ' data-mode="dark"' : ""}${night}>${coloured}</g>`;
}
