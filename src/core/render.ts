import { DEVICE_ICONS, FURNITURE } from "./icons";
import { stairSteps } from "./geometry";
import { DEVICE_TYPES } from "./schema";
import { TEXTURE_IDS, texturePatterns, texturePatternId, normTextureRot, normTextureScale } from "./textures";
import { rolesToTokens } from "./theme-roles";
import type { Device, DeviceType, EdgeKind, Floor, Layout, Pt, Stairs } from "./schema";

export interface StateOverlay { [entityId: string]: { state: string; attributes: Record<string, unknown>; last_changed: string } }
export interface RenderOpts {
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
  /** S7.6: after sunset. Every room gets a `room-night` overlay, `lit` when a light inside it is on; the root carries class `night`. */
  night?: boolean;
}
/** blueprint is the default and the look of the project; midnight is the project's first dark theme (2026-09-21), kept under
 * its own name once blueprint moved on to a new palette; light is the same plan on paper; slate and terminal are the other two
 * role-generated presets; solarized is the bespoke Solarized palette; ha takes its neutrals straight from Home Assistant's own
 * CSS variables. */
export const THEMES = ["blueprint", "midnight", "light", "slate", "terminal", "solarized", "ha"] as const;
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
  boiler: "#8b8578", car: "#8b8578", ups: "#8b8578", printer: "#8b8578", speaker: "#8b8578",
};

// S1.53: the light and dark (now blueprint) token sets, each written once and interpolated wherever CSS needs it, so a new
// token can never be added to one selector and forgotten in another. The "ha" theme is built from the same two.
const LIGHT_TOKENS = `--fp-ink:#2b2a27;--fp-bg:#f4f0e6;--fp-room:#e9e3d3;--fp-room-empty:#d6d6d2;--fp-garden:#9db98a;--fp-terrace:#cdb094;--fp-pavement:#c9c6bf;--fp-wall:#2b2a27;--fp-idle:#8b8578;
--fp-on:#e0a800;--fp-open:#f28c28;--fp-motion:#d64545;--fp-heater:#e8801a;--fp-door:#a5601c;--fp-glass:#1b9e77;--fp-window:#2c7fb8;--fp-sealed:#9a8f80;--fp-water:#a9cfe3;--fp-fill:#c4c0b8;--fp-fill-line:#9a958b;
--fp-tread:#8b8578;--fp-dev-light:#e0a800;--fp-dev-motion:#d64545;--fp-dev-contact:#d64545;--fp-dev-heater:#e8801a;--fp-dev-climate:#e8801a;--fp-dev-ac-cool:#2c7fb8;--fp-dev-ac-heat:#e8801a;--fp-dev-tv:#2c7fb8;--fp-dev-media:#2c7fb8;--fp-dev-cover:#f28c28;--fp-dev-plug:#2c7fb8;--fp-dev-computer:#2c7fb8;--fp-dev-camera:#4a4a48;--fp-dev-garden:#3f8f4f;--fp-halo:#8b8578;--fp-alpha:.25;--fp-disc:#fff;--fp-disc-alpha:.5;--fp-outline:#fff;--fp-text:#3a3a3a;--fp-warn:#f28c28;--fp-danger:#b02a2a;--fp-primary:#1f6699;--fp-furniture:#79766e;--fp-wall-external:#1a1917;--fp-wall-fence:#7a5c3a;--fp-wall-edge:#a29e94;--fp-measure:#3a3a3a;--fp-glow:#f5e2a0;--fp-aura:#f0c419;--fp-active:#8a5117;--fp-night:rgba(4,10,30,.45);
--fp-on-dark:#fff;--fp-on-light:#2b2a27`;
/* Midnight (Diego's call, 2026-09-21, ex-"blueprint"): a deep navy ground, blue linework for walls, cool-white text, from the
   reference screenshot he supplied. It replaced HA's night-blue; light is unchanged. Every accent that carries meaning (device colours, the warn/danger/primary
   buttons) keeps the same hex as light: each already clears 4.5:1 against its fixed on-dark/on-light text token, so
   none needed lightening. Only the neutrals (ink, bg, room, wall, disc, halo, tread, outline, measure,
   wall-external/-fence) change, because those are the tokens a dark background actually breaks. Renamed to "midnight" on
   2026-09-22 when "blueprint" moved on to the role-generated palette below (Diego's brief: four roles - a blue base, a white
   foreground, a terminal-green line colour and a saturated orange accent). */
const MIDNIGHT_TOKENS = `--fp-ink:#d8e2f2;--fp-bg:#0d1522;--fp-room:#14213a;--fp-room-empty:#d6d6d2;--fp-garden:#9db98a;--fp-terrace:#cdb094;--fp-pavement:#c9c6bf;--fp-wall:#8fb4f0;--fp-idle:#8b8578;
--fp-on:#e0a800;--fp-open:#f28c28;--fp-motion:#d64545;--fp-heater:#e8801a;--fp-door:#a5601c;--fp-glass:#1b9e77;--fp-window:#2c7fb8;--fp-sealed:#9a8f80;--fp-water:#a9cfe3;--fp-fill:#c4c0b8;--fp-fill-line:#9a958b;
--fp-tread:#6f93c9;--fp-dev-light:#e0a800;--fp-dev-motion:#d64545;--fp-dev-contact:#d64545;--fp-dev-heater:#e8801a;--fp-dev-climate:#e8801a;--fp-dev-ac-cool:#2c7fb8;--fp-dev-ac-heat:#e8801a;--fp-dev-tv:#2c7fb8;--fp-dev-media:#2c7fb8;--fp-dev-cover:#f28c28;--fp-dev-plug:#2c7fb8;--fp-dev-computer:#2c7fb8;--fp-dev-camera:#8a8a86;--fp-dev-garden:#3f8f4f;--fp-halo:#6f8fbf;--fp-alpha:.25;--fp-disc:#14213a;--fp-disc-alpha:.5;--fp-outline:#0d1522;--fp-text:#d8e2f2;--fp-warn:#f28c28;--fp-danger:#b02a2a;--fp-primary:#1f6699;--fp-furniture:#79766e;--fp-wall-external:#b4cdf7;--fp-wall-fence:#a67c52;--fp-wall-edge:#a29e94;--fp-measure:#8fb4f0;--fp-glow:#4a3f22;--fp-aura:#f0c419;--fp-active:#e0a800;--fp-night:rgba(4,10,30,.45);
--fp-on-dark:#fff;--fp-on-light:#2b2a27`;

// The three role-generated themes (2026-09-22, Diego's brief): each is one base hue shaded into every structural token, one
// foreground colour for text/icons/detail, one line colour for the measurement grid, and one accent for anything "on" or
// "live". Device colours default to the accent (Diego: "collapse to one accent"); a theme can override specific types via
// `devices` when it wants them to stay distinct instead (see ThemeRoles in theme-roles.ts) - none of these three do.
const BLUEPRINT_TOKENS = rolesToTokens({ base: "#1c3f73", fg: "#eef3fb", fgAlpha: .5, line: "#35d47a", accent: "#ff8a1f", dark: true });
const SLATE_TOKENS = rolesToTokens({ base: "#9a9a96", fg: "#2b2a27", fgAlpha: .5, line: "#2f7a4a", accent: "#cc5500", dark: false });
const TERMINAL_TOKENS = rolesToTokens({ base: "#0c1512", fg: "#35d47a", fgAlpha: .5, line: "#35d47a", accent: "#ffb000", dark: true });

/* Solarized (bespoke, not role-generated - Diego's call, 2026-09-22: real Solarized fidelity matters more here than reuse).
   The dark variant, base03 background, base1 body text; each device type keeps its own Solarized hue rather than collapsing
   to one accent, demonstrating the per-type override the theme format supports. */
const SOLARIZED_TOKENS = `--fp-ink:#93a1a1;--fp-bg:#002b36;--fp-room:#073642;--fp-room-empty:#d6d6d2;--fp-garden:#586e75;--fp-terrace:#657b83;--fp-pavement:#586e75;--fp-wall:#93a1a1;--fp-idle:#586e75;
--fp-on:#b58900;--fp-open:#cb4b16;--fp-motion:#dc322f;--fp-heater:#cb4b16;--fp-door:#cb4b16;--fp-glass:#2aa198;--fp-window:#268bd2;--fp-sealed:#586e75;--fp-water:#268bd2;--fp-fill:#073642;--fp-fill-line:#586e75;
--fp-tread:#93a1a1;--fp-dev-light:#b58900;--fp-dev-motion:#dc322f;--fp-dev-contact:#dc322f;--fp-dev-heater:#cb4b16;--fp-dev-climate:#cb4b16;--fp-dev-ac-cool:#268bd2;--fp-dev-ac-heat:#cb4b16;--fp-dev-tv:#6c71c4;--fp-dev-media:#d33682;--fp-dev-cover:#cb4b16;--fp-dev-plug:#268bd2;--fp-dev-computer:#268bd2;--fp-dev-camera:#586e75;--fp-dev-garden:#859900;--fp-halo:#93a1a1;--fp-alpha:.25;--fp-disc:#073642;--fp-disc-alpha:.5;--fp-outline:#002b36;--fp-text:#93a1a1;--fp-warn:#b58900;--fp-danger:#dc322f;--fp-primary:#268bd2;--fp-furniture:#79766e;--fp-wall-external:#fdf6e3;--fp-wall-fence:#cb4b16;--fp-wall-edge:#586e75;--fp-measure:#859900;--fp-glow:#657b83;--fp-aura:#b58900;--fp-active:#b58900;--fp-night:rgba(4,10,30,.45);
--fp-on-dark:#fdf6e3;--fp-on-light:#002b36`;
/* "ha": the neutrals come from Home Assistant's own variables, so the plan is the colour of the user's dashboard whatever theme they run. The
   fallback of each is the hex the plain theme would have had, so outside Home Assistant (no variable defined) it degrades to that theme, not to
   nothing. Not mapped, on purpose: primary, danger, warn. HA's error and warning colours fail 4.5:1 against the fixed white or dark text on our
   buttons in some themes, and the device colours carry meaning that must not move with a theme. */
const haTokens = (base: string, fb: Record<string, string>) => `${base};
--fp-ink:var(--primary-text-color,${fb.ink});--fp-text:var(--primary-text-color,${fb.text});--fp-bg:var(--card-background-color,${fb.bg});--fp-room:var(--secondary-background-color,${fb.room});--fp-wall:var(--primary-text-color,${fb.wall});--fp-wall-external:var(--primary-text-color,${fb.wallExternal});--fp-outline:var(--card-background-color,${fb.outline});--fp-disc:var(--card-background-color,${fb.disc});--fp-measure:var(--secondary-text-color,${fb.measure})`;
const HA_LIGHT = haTokens(LIGHT_TOKENS, { ink: "#2b2a27", text: "#3a3a3a", bg: "#f4f0e6", room: "#e9e3d3", wall: "#2b2a27", wallExternal: "#1a1917", outline: "#fff", disc: "#fff", measure: "#3a3a3a" });
const HA_DARK = haTokens(MIDNIGHT_TOKENS, { ink: "#d8e2f2", text: "#d8e2f2", bg: "#0d1522", room: "#14213a", wall: "#8fb4f0", wallExternal: "#b4cdf7", outline: "#0d1522", disc: "#14213a", measure: "#8fb4f0" });


/** Default colours. Hosts (card, editor) override the --fp-* variables. Kept out of the markup on purpose. */
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
/* .sel is one class (0,1,0); .room.on is two (0,2,0) and would always outrank it on specificity, so a selected
   room that is also on would stop showing its ink selection outline. This three-class override (0,3,0) wins
   regardless of source order and keeps selection on top (Opus review). */
.room.on.sel{stroke:var(--fp-ink)}
/* S2.9: furniture with an entity turns present, not paler, when it is on. --fp-glow is a fill tint built to sit
   close to a room's own colour, so reusing it as a stroke colour here made a sofa nearly vanish against the room
   under it in either theme (Opus review). --fp-active is its own token, amber like --fp-on, chosen per theme for
   at least 3:1 contrast against both --fp-room and --fp-bg (measured: light 5.0:1 / 5.6:1, dark 6.8:1 / 8.0:1). */
.furn.on{color:var(--fp-active)}
.e{stroke:var(--fp-wall);stroke-width:3;stroke-linecap:round} .e.nw{stroke-dasharray:8 6;stroke-width:1.5}
.e.external{stroke:var(--fp-wall-external);stroke-width:6;stroke-linecap:square} .e.fence{stroke:var(--fp-wall-fence);stroke-width:1.5;stroke-dasharray:10 4 2 4;stroke-linecap:butt} .e.edge{stroke:var(--fp-wall-edge);stroke-width:1.5}
.eh{stroke:var(--fp-outline);stroke-width:5;stroke-linecap:round;pointer-events:none} .eh.nw{stroke-dasharray:8 6;stroke-width:3.5} .eh.external{stroke-width:8;stroke-linecap:square} .eh.fence{stroke-dasharray:10 4 2 4;stroke-width:3.5;stroke-linecap:butt} .eh.edge{stroke-width:3.5}
.e.none{stroke:var(--fp-idle);stroke-width:1;stroke-dasharray:2 5;opacity:.6} .e.se{stroke-width:1.5} .tread{stroke:var(--fp-tread);stroke-width:1.5;fill:none}
/* An opening erases the wall under it by painting over it, so its stroke must match a plain room's own fill, not
   --fp-room: that token is UI chrome (toolbar buttons), shaded near the background in a dark theme, so an opening
   used to punch a visibly wrong-coloured hole instead of blending away (Opus review). */
.opening{stroke:var(--fp-room-empty);stroke-width:9;pointer-events:none}
/* S4.13 (Opus review): was pointer-events:none, so a click on "tech area" or any other structure line always fell
   through to the room under it - the line rendered but took no clicks of its own, ever, on any floor. "all" matches
   .room{pointer-events:all} just above: a fill:none shape still needs the flag or its interior (a rect's, here) and
   its zero-area line never receive a hit at all. */
.extra{fill:none;stroke:var(--fp-idle);stroke-dasharray:6 4;stroke-width:1.2;vector-effect:non-scaling-stroke;pointer-events:all}
.door{stroke:var(--fp-door)} .door-glass{stroke:var(--fp-glass)} .door-window{stroke:var(--fp-window)} .door-sealed{stroke:var(--fp-sealed);stroke-dasharray:10 6}
.door.open{stroke:var(--fp-dev-contact)} .door.cover-open{stroke:var(--fp-open)}
.dev.unbound path{stroke:var(--fp-warn);stroke-width:1.5;stroke-dasharray:3 2} .dev path{fill:var(--fp-idle)} .dev.on path{fill:var(--fp-dev-fill,var(--fp-dev));opacity:var(--fp-dev-opacity,1)}
.dev-camera path{fill:var(--fp-dev-camera)} .dev.dev-camera path.cone{fill:var(--fp-dev-camera);fill-opacity:var(--fp-alpha);pointer-events:none} .dev.outdoor path{fill:var(--fp-dev-garden)}
/* S2.9: --fp-dev names the active colour per type; switch and humidity fall back to idle grey (on and off look the same). */
.dev.on{--fp-dev:var(--fp-idle)} .dev-light.on{--fp-dev:var(--fp-dev-light)} .dev-motion.on{--fp-dev:var(--fp-dev-motion)} .dev-contact.on{--fp-dev:var(--fp-dev-contact)} .dev-heater.on{--fp-dev:var(--fp-dev-heater)} .dev-climate.on{--fp-dev:var(--fp-dev-climate)} .dev-ac.cool.on{--fp-dev:var(--fp-dev-ac-cool)} .dev-ac.heat.on{--fp-dev:var(--fp-dev-ac-heat)} .dev-tv.on{--fp-dev:var(--fp-dev-tv)} .dev-plug.on{--fp-dev:var(--fp-dev-plug)} .dev-computer.on{--fp-dev:var(--fp-dev-computer)} .dev-media.on{--fp-dev:var(--fp-dev-media)} .dev-cover.on{--fp-dev:var(--fp-dev-cover)} .dev-switch.on{--fp-dev:var(--fp-idle)} .dev-humidity.on{--fp-dev:var(--fp-idle)} .dev-lock.on{--fp-dev:var(--fp-dev-contact)} .dev-vibration.on{--fp-dev:var(--fp-dev-contact)}
/* S4.25: an unlinked item has no on/off state of its own, so it never carries .on — it stays at the plain .dev
   path idle-grey rule above unless the instance has its own --fp-dev-fill colour override, which this rule
   (three classes, out-specifies the two-class .dev path default) lets through. */
.dev.unl path{fill:var(--fp-dev-fill,var(--fp-idle))}
.dev .halo{fill:var(--fp-disc);fill-opacity:var(--fp-disc-alpha);stroke:var(--fp-halo);stroke-width:1;vector-effect:non-scaling-stroke}
.dev.on .halo{fill:var(--fp-dev);fill-opacity:var(--fp-alpha)}
.aura{fill:var(--fp-aura);fill-opacity:var(--fp-alpha);pointer-events:none}
.dev.unavailable{opacity:.45}
.dev.dim{opacity:.3}
.dev-motion{--fp-fade:0} .dev.dev-motion path{fill:color-mix(in srgb,var(--fp-motion) calc(var(--fp-fade) * 100%),var(--fp-idle))}
.heater{stroke:var(--fp-idle)} .heater.on{stroke:var(--fp-heater)} .val,.lbl{fill:var(--fp-text);paint-order:stroke;stroke:var(--fp-outline);stroke-width:3;stroke-linejoin:round} .lbl.zone{opacity:.75}
.mg{stroke:var(--fp-measure);stroke-width:.5;vector-effect:non-scaling-stroke} .mg.m{stroke-width:1}
.sel{stroke:var(--fp-ink)} .h{fill:var(--fp-bg);stroke:var(--fp-ink);stroke-width:1.5}`;

/** Text for markup. A name that is not text (a layout that skipped `validate`) is shown as text, never thrown on. */
const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const COLOR = /^#[0-9a-fA-F]{6}$/;
const num = (n: number) => String(Math.round(n * 100) / 100);
const pts = (p: Pt[]) => p.map((q) => `${num(q[0])},${num(q[1])}`).join(" ");
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
/** x, y, w, h. */
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

/** cm a lit lamp's aura or a camera's cone reaches from its own centre (also read by the aura circle and the cone radius below, S2.8 and Sprint 1, so the three cannot drift apart). */
export const DEVICE_REACH = 100;

/** The box that fits the outline, in what the screen shows: turned by `rotate` when there is one. Padded by the greater
 * of `pad` and DEVICE_REACH whenever the floor has a light or camera, so a wall-mounted one's aura or cone is never
 * clipped (S5.7) — a plan with neither keeps `pad` exactly. */
export function viewBoxFor(f: Floor, pad = 60, rotate?: { deg: number; pivot: Pt }): { x: number; y: number; w: number; h: number } {
  if (!f.outline.length) return { x: -pad, y: -pad, w: 1000 + 2 * pad, h: 1000 + 2 * pad };
  const reach = f.devices.some((d) => d.type === "light" || d.type === "camera") ? Math.max(pad, DEVICE_REACH) : pad;
  const shown = rotate && rotate.deg % 360 ? f.outline.map((p) => rotateAbout(p, rotate.deg, rotate.pivot)) : f.outline;
  const xs = shown.map((p) => p[0]), ys = shown.map((p) => p[1]);
  const x0 = Math.min(...xs) - reach, y0 = Math.min(...ys) - reach;
  return { x: x0, y: y0, w: Math.max(...xs) + reach - x0, h: Math.max(...ys) + reach - y0 };
}

/** Every point that makes up the floor: outline, rooms, stairs, walls, doors, openings, extras, furniture (its centre) and devices (a heater's two ends, else the centre). Only finite points; the editor's Re-center fits them all. */
export function contentPoints(f: Floor): Pt[] {
  const out: Pt[] = [];
  const add = (p: unknown) => { if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push([p[0], p[1]]); };
  for (const p of f.outline ?? []) add(p);
  for (const r of f.rooms ?? []) for (const p of r.pts ?? []) add(p);
  for (const t of f.stairs ?? []) for (const p of t.pts ?? []) add(p);
  for (const k of ["walls", "doors", "openings", "extras"] as const) for (const o of f[k] ?? []) { add(o.a); add(o.b); }
  for (const m of f.furniture ?? []) add([m.x, m.y]);
  for (const d of f.devices ?? []) { if ("a" in d) { add(d.a); add(d.b); } else add([d.x, d.y]); }
  for (const u of f.unlinked ?? []) add([u.x, u.y]);
  return out;
}

/** Class of a room edge or free wall: wall is plain, boundary is dotted, the rest carry their kind. */
const edgeClass = (kind: unknown) => `e${kind === "boundary" ? " nw" : kind === "wall" || kind === undefined ? "" : ` ${esc(String(kind))}`}`;
const at = (p: Pt) => `${num(p[0])} ${num(p[1])}`;
type Cls = "on" | "off" | "unavailable";

const dead = (s: string) => s === "unavailable" || s === "unknown";

/** A bound light is one lamp: on if either entity is on, unavailable only if every known state is dead. */
function boundClassOf(d: Device, o: RenderOpts): Cls {
  const seen = [o.state?.[d.entity], d.bound ? o.state?.[d.bound] : undefined].filter((s) => s !== undefined);
  if (seen.some((s) => s.state === "on")) return "on";
  if (seen.length && seen.every((s) => dead(s.state))) return "unavailable";
  return "off";
}

/** A light that is on takes its icon fill from `attributes.rgb_color` when present; unset otherwise, so `.dev.on path`'s `var(--fp-dev-fill,var(--fp-on))` falls through to the flat colour. Untrusted `state`: a malformed value is silently ignored, not thrown on. */
function lightFill(s: StateOverlay[string] | undefined): string | null {
  const rgb = s?.attributes.rgb_color;
  if (Array.isArray(rgb) && rgb.length === 3 && rgb.every((n) => typeof n === "number" && Number.isFinite(n))) return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  return null;
}

/** `attributes.brightness / 255`, floored at 0.35 so a dimmed lamp's icon never goes near-invisible; unset (full opacity through the cascade) with no `brightness` attribute. */
function lightOpacity(s: StateOverlay[string] | undefined): number | null {
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

/** S2.10: what an air conditioner is doing, read from the entity at render time and never stored. `off`, `unavailable` and `unknown` win over everything; otherwise `hvac_action` decides, and `state` stands in when the attribute is missing. */
function acMode(d: Device, o: RenderOpts): "cool" | "heat" | null {
  const s = o.state?.[d.entity];
  if (!s || s.state === "off" || s.state === "unavailable" || s.state === "unknown") return null;
  const a = s.attributes?.hvac_action;
  const v = typeof a === "string" ? a : s.state === "cool" ? "cooling" : s.state === "heat" ? "heating" : "";
  return v === "cooling" ? "cool" : v === "heating" ? "heat" : null;
}

function classOf(d: Device, o: RenderOpts): Cls {
  if (d.type === "light" && d.bound) return boundClassOf(d, o);
  const s = o.state?.[d.entity];
  if (!s) return "off";
  if (s.state === "unavailable" || s.state === "unknown") return "unavailable";
  if (d.type === "ac") return acMode(d, o) ? "on" : "off";
  if (d.type === "climate" || d.type === "heater") return s.attributes.hvac_action === "heating" ? "on" : "off";
  if (d.type === "media") return s.state === "playing" ? "on" : "off";
  return s.state === "on" || s.state === "open" ? "on" : "off";
}

/** S1.37: a room or a piece of furniture with an entity carries "on" when that entity is on, open or playing. */
const ON_STATES = new Set(["on", "open", "playing"]);
function entityOn(o: RenderOpts, entity: string | undefined): boolean {
  if (!entity) return false;
  const s = o.state?.[entity];
  return !!s && ON_STATES.has(s.state);
}

/**
 * One stairs object: the polygon (or, round, an even-odd path with the well cut out), its treads and its edges, turned
 * together by `rot` about the centre of the polygon's box. Only an unturned straight flight has edge lines a click can
 * pick (`data-e`): the stored corners are those of the unturned polygon, so for any other stairs they are not where the
 * lines are drawn. The whole group is `data-s`.
 */
function stairsGroup(t: Stairs, i: number): string {
  const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rot = typeof t.rot === "number" && Number.isFinite(t.rot) ? t.rot : 0;
  const steps = stairSteps(t);
  const round = t.shape === "round" && typeof t.dia === "number" && t.dia > 0;
  const inner = round && typeof t.inner === "number" && t.inner > 0 ? t.inner / 2 : 0;
  const g: string[] = [];
  if (round) {
    const R = t.dia! / 2;
    const hole = inner ? ` M${num(cx + inner)} ${num(cy)}A${num(inner)} ${num(inner)} 0 1 0 ${num(cx - inner)} ${num(cy)}A${num(inner)} ${num(inner)} 0 1 0 ${num(cx + inner)} ${num(cy)}Z` : "";
    g.push(`<path class="stairs room"${paintAttr(t)} fill-rule="evenodd" d="M${t.pts.map((p) => `${num(p[0])} ${num(p[1])}`).join("L")}Z${hole}"/>`);
    for (let n = 1; n < steps; n++) {
      const a = (n * 2 * Math.PI) / steps;
      g.push(`<line class="tread" x1="${num(cx + inner * Math.cos(a))}" y1="${num(cy + inner * Math.sin(a))}" x2="${num(cx + R * Math.cos(a))}" y2="${num(cy + R * Math.sin(a))}"/>`);
    }
  } else {
    g.push(`<polygon class="stairs room"${paintAttr(t)} points="${pts(t.pts)}"/>`);
    // Treads run across the short side of the box, one every (long side / steps).
    const along = x1 - x0 > y1 - y0;
    for (let n = 1; n < steps; n++) {
      if (along) { const x = x0 + ((x1 - x0) * n) / steps; g.push(`<line class="tread" x1="${num(x)}" y1="${num(y0)}" x2="${num(x)}" y2="${num(y1)}"/>`); }
      else { const y = y0 + ((y1 - y0) * n) / steps; g.push(`<line class="tread" x1="${num(x0)}" y1="${num(y)}" x2="${num(x1)}" y2="${num(y)}"/>`); }
    }
  }
  t.pts.forEach((a, j) => {
    const b = t.pts[(j + 1) % t.pts.length], e = !round && !rot ? ` data-e="s${i}:${j}"` : "";
    g.push(`<line class="e se"${e} x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"/>`);
  });
  return `<g data-s="${i}" transform="rotate(${num(rot)} ${num(cx)} ${num(cy)})">${g.join("")}</g>`;
}

export function renderFloor(f: Floor, o: RenderOpts): string {
  const k = 1 / (o.scale || 1);
  const turn = o.rotate && o.rotate.deg % 360 ? o.rotate : null, planDeg = turn ? turn.deg : 0;
  /** Attribute that keeps a text upright in a turned plan: turns it back about its own anchor. */
  const up = (x: number, y: number) => (turn ? ` transform="rotate(${num(-planDeg)} ${num(x)} ${num(y)})"` : "");
  const out: string[] = [];
  const now = o.now ?? Date.now();

  // One fixed id: two cards on a page declare the same pattern twice, and both are identical (see DECISIONS).
  const textured = [...f.rooms, ...(f.stairs ?? [])]
    .filter((r): r is typeof r & { texture: string } => typeof r.texture === "string" && TEXTURE_IDS.includes(r.texture))
    .map((r) => ({ id: r.texture, rot: normTextureRot(r.textureRot), scale: normTextureScale(r.textureScale) }));
  const hatch = f.rooms.some((r) => r.kind === "fill") ? '<pattern id="fp-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="var(--fp-fill)"/><line x1="0" y1="0" x2="0" y2="12" stroke="var(--fp-fill-line)" stroke-width="2"/></pattern>' : "";
  if (hatch || textured.length) out.push(`<defs>${hatch}${texturePatterns(textured)}</defs>`);
  // S2.6: room_glow. A room glows when any light "in" it (point-in-polygon of the device's x,y; a light never has
  // a/b, only a heater does, but the same "a" in d guard the rest of the file uses is kept here too) is on. Untrusted
  // layout/state: a non-finite coordinate or a light outside every room's polygon is simply not counted, never thrown.
  // S7.6: the same set decides which rooms stay bright at night.
  const glowRooms = new Set<number>();
  if (o.roomGlow || o.night)
    for (const d of f.devices) {
      if (d.type !== "light" || classOf(d, o) !== "on") continue;
      const c = "a" in d ? mid(d.a, d.b) : ([d.x, d.y] as Pt);
      if (!c.every(Number.isFinite)) continue;
      f.rooms.forEach((r, i) => { if (inside(c, r.pts)) glowRooms.add(i); });
    }
  // Zones are painted after every other room so they sit on top whatever the array order (the editor picks the top polygon).
  [...f.rooms.keys()].sort((a, b) => +(f.rooms[a].kind === "zone") - +(f.rooms[b].kind === "zone")).forEach((i) => {
    const r = f.rooms[i];
    if (r.kind === "fill" && !r.name) return;
    const own = paintAttr(r);
    const glow = o.roomGlow && glowRooms.has(i) ? " glow" : "";
    const on = !r.area && entityOn(o, r.entity) ? " on" : "";
    out.push(`<polygon data-r="${i}" class="room room-${esc(String(r.kind))}${r.kind === "water" ? " water" : ""}${glow}${on}"${own} points="${pts(r.pts)}"/>`);
  });

  f.stairs.forEach((t, i) => out.push(stairsGroup(t, i)));

  // S7.6: the night overlay, over every room fill and staircase, under walls, names and devices, so lines and icons stay
  // crisp. Zones and structures sit on a room and share its overlay; a fill with no name is not drawn, so it gets none.
  // No data-r: the overlay is never a pick target (class room-night carries pointer-events:none, CLAUDE.md finding 18).
  if (o.night)
    f.rooms.forEach((r, i) => {
      if (r.kind === "zone" || r.kind === "structure" || (r.kind === "fill" && !r.name)) return;
      out.push(`<polygon data-night="${i}" class="room-night${glowRooms.has(i) ? " lit" : ""}" points="${pts(r.pts)}"/>`);
    });

  const polys: { id: string; pts: Pt[]; wk?: EdgeKind[]; zone?: boolean }[] = [{ id: "o", pts: f.outline, wk: f.owk }, ...f.rooms.map((r, i) => ({ id: `r${i}`, pts: r.pts, wk: r.wk, zone: r.kind === "zone" }))];
  // Every edge has a white twin drawn first (the line version of the text outline), so a dark line stays visible on a dark floor.
  const edgeLines: { cls: string; attr: string; a: Pt; b: Pt }[] = [], guides: typeof edgeLines = [];
  for (const P of polys)
    P.pts.forEach((a, i) => {
      // The outline defaults external (the house perimeter, S1.52); a room with no wk yet is never valid, so "wall" is only a defensive fallback.
      const b = P.pts[(i + 1) % P.pts.length], kind = P.zone ? "boundary" : P.wk ? P.wk[i] : P.id === "o" ? "external" : "wall";
      if (kind === "none") { if (o.editor) guides.push({ cls: "e none", attr: ` data-e="${P.id}:${i}"`, a, b }); return; } // not drawn: the editor keeps a faint guide so it can be picked again
      edgeLines.push({ cls: edgeClass(kind), attr: ` data-e="${P.id}:${i}"`, a, b });
    });
  f.walls.forEach((w, i) => edgeLines.push({ cls: edgeClass(w.kind), attr: ` data-w="${i}"`, a: w.a, b: w.b }));
  const seg = (a: Pt, b: Pt) => `x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"`;
  for (const l of edgeLines) out.push(`<line class="eh${l.cls.slice(1)}" ${seg(l.a, l.b)}/>`);
  for (const l of [...guides, ...edgeLines]) out.push(`<line class="${l.cls}"${l.attr} ${seg(l.a, l.b)}/>`);

  // S2.9 round 3: a room's own boundary is almost always also a wall, and a wall's white halo (3.5-5px) is drawn
  // right on top of the room polygon and fully covers a same-width stroke on it — the .room.on rule above proves
  // correct in a computed-style pair, but on screen the "on" ring all but vanished behind the wall it traces
  // (Opus review: rendered and looked at). A second, undecorated pass draws the ring again after every wall line,
  // on top of them, so it actually reads. fill="none" makes the :not([fill]) room rules leave it alone; it takes
  // no clicks of its own, the polygon underneath still does.
  [...f.rooms.keys()].forEach((i) => {
    const r = f.rooms[i];
    if (r.kind === "fill" && !r.name) return;
    if (r.area || !entityOn(o, r.entity)) return;
    out.push(`<polygon class="room on ring" fill="none" pointer-events="none" points="${pts(r.pts)}"/>`);
  });

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
  /** Centroid, 32k below, 32k above, 64k below, 64k above: 32k clears a 16k disc and a 14k name either way. */
  const rows = (a: Pt): Pt[] => [a, screenOff(a, 0, 32 * k), screenOff(a, 0, -32 * k), screenOff(a, 0, 64 * k), screenOff(a, 0, -64 * k)];
  const disc = (c: Pt, r: number) => { const [x, y] = toScreen(c); placed.push([x - r, y - r, 2 * r, 2 * r]); };
  f.devices.forEach((d, i) => {
    const sel = o.selection?.t === "dev" && o.selection.i === i;
    if (o.filter && o.filter.length && !o.filter.includes(d.type) && !sel) return;
    const c = "a" in d ? mid(d.a, d.b) : ([d.x, d.y] as Pt);
    if (c.every(Number.isFinite)) disc(c, 16 * k);
  });
  for (const u of f.unlinked ?? []) {
    const scale = typeof u.scale === "number" && Number.isFinite(u.scale) && u.scale > 0 ? u.scale : 1;
    if (Number.isFinite(u.x) && Number.isFinite(u.y)) disc([u.x, u.y], 16 * k * scale);
  }
  const centroid = (p: Pt[]): Pt => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  const named = (r: Floor["rooms"][number]) => !!r.name && r.kind !== "fill";
  const nameAt: Pt[] = [], labelAt: Pt[] = [], zoneAt: Pt[] = [];
  f.rooms.forEach((r, i) => { if (named(r) && r.kind !== "zone") nameAt[i] = place(rows(centroid(r.pts)), 14 * k, r.name); });
  f.rooms.forEach((r, i) => { if (nameAt[i] && r.label) labelAt[i] = place(rows(screenOff(nameAt[i], 0, 16 * k)), 11 * k, r.label); });
  f.rooms.forEach((r, i) => { if (named(r) && r.kind === "zone") zoneAt[i] = place(rows(centroid(r.pts)), 10 * k, r.name); });

  // Openings erase the wall under them; extras are dashed outlines with a name. Both sit under devices and names.
  f.openings.forEach((op) => out.push(`<line class="opening" x1="${num(op.a[0])}" y1="${num(op.a[1])}" x2="${num(op.b[0])}" y2="${num(op.b[1])}"/>`));
  f.extras.forEach((x, i) => {
    const mx = Math.min(x.a[0], x.b[0]), my = Math.min(x.a[1], x.b[1]), w = Math.abs(x.a[0] - x.b[0]), h = Math.abs(x.a[1] - x.b[1]);
    out.push(w && h
      ? `<rect class="extra" data-ex="${i}" x="${num(mx)}" y="${num(my)}" width="${num(w)}" height="${num(h)}"/>`
      : `<line class="extra" data-ex="${i}" x1="${num(x.a[0])}" y1="${num(x.a[1])}" x2="${num(x.b[0])}" y2="${num(x.b[1])}"/>`);
    const [tx, ty] = place(rows([mx + w / 2, my + h / 2]), 11 * k, x.name);
    out.push(`<text class="lbl" x="${num(tx)}" y="${num(ty)}"${up(tx, ty)} text-anchor="middle" font-size="${num(11 * k)}">${esc(x.name)}</text>`);
  });

  f.furniture.forEach((m, i) => {
    const sym = FURNITURE[m.symbol];
    if (!sym) return;
    const on = entityOn(o, m.entity) ? " on" : "";
    out.push(`<g data-f="${i}" class="furn${on}" transform="translate(${num(m.x)} ${num(m.y)}) rotate(${num(m.rot)}) scale(${num(m.w / 100)} ${num(m.h / 100)}) translate(-50 -50)" color="var(--fp-furniture)">${sym.svg}</g>`);
  });

  f.doors.forEach((d, i) => {
    // S4.24: several contact sensors may be attached; the door reads open if any one of them does.
    const open = (d.sensors ?? []).some((e) => o.state?.[e]?.state === "on"), cover = d.cover ? o.state?.[d.cover] : undefined;
    const cls = ["door", `door-${esc(String(d.kind))}`, open ? "open" : "", cover?.state === "open" ? "cover-open" : ""].filter(Boolean).join(" ");
    const sel = o.selection?.t === "door" && o.selection.i === i;
    out.push(`<line data-d="${i}" class="${cls}${sel ? " sel" : ""}" x1="${num(d.a[0])}" y1="${num(d.a[1])}" x2="${num(d.b[0])}" y2="${num(d.b[1])}" stroke-width="${sel ? 30 : 22}"><title>${esc(d.name ?? "")}</title></line>`);
  });

  f.rooms.forEach((r, i) => {
    if (!r.name || r.kind === "fill") return;
    if (r.kind === "zone") { const [x, y] = zoneAt[i]; out.push(`<text class="lbl zone" x="${num(x)}" y="${num(y)}"${up(x, y)} text-anchor="middle" font-size="${num(10 * k)}">${esc(r.name)}</text>`); return; }
    const [x, y] = nameAt[i];
    out.push(`<text class="lbl" x="${num(x)}" y="${num(y)}"${up(x, y)} text-anchor="middle" font-size="${num(14 * k)}" font-weight="600">${esc(r.name)}</text>`);
    if (labelAt[i]) { const [lx, ly] = labelAt[i]; out.push(`<text class="lbl" x="${num(lx)}" y="${num(ly)}"${up(lx, ly)} text-anchor="middle" font-size="${num(11 * k)}">${esc(r.label)}</text>`); }
  });

  // S2.8: every lit lamp's aura, drawn as one flat pass before any device group. One pass, not interleaved with the
  // devices loop below, so two overlapping auras never sit between one lamp's icon and the next lamp's icon; the
  // icons themselves (drawn after every aura) stay on top and legible. The colour is the lamp's own rgb_color, read
  // the same way as the device group's --fp-dev-fill (S2.2): from the light entity's own state, never the bound switch's.
  f.devices.forEach((d, i) => {
    const sel = o.selection?.t === "dev" && o.selection.i === i;
    if (d.type !== "light") return;
    if (o.filter && o.filter.length && !o.filter.includes(d.type) && !sel) return;
    if (classOf(d, o) !== "on") return;
    const c = "a" in d ? mid(d.a, d.b) : ([d.x, d.y] as Pt);
    if (!c.every(Number.isFinite)) return;
    const fill = lightFill(o.state?.[d.entity]);
    const style = fill ? ` style="--fp-aura:${fill}"` : "";
    out.push(`<circle class="aura" cx="${num(c[0])}" cy="${num(c[1])}" r="${DEVICE_REACH}"${style}/>`);
  });

  f.devices.forEach((d, i) => {
    const sel = o.selection?.t === "dev" && o.selection.i === i;
    if (o.filter && o.filter.length && !o.filter.includes(d.type) && !sel) return;
    const c = "a" in d ? mid(d.a, d.b) : ([d.x, d.y] as Pt);
    if (!c.every(Number.isFinite)) return;
    // Value sensors in a garden room are outdoor sensors. Motion and contact keep their own state colours.
    const outdoor = (d.type === "temp" || d.type === "humidity") && f.rooms.some((r) => r.kind === "garden" && inside(c, r.pts));
    const cls = classOf(d, o) + (outdoor ? " outdoor" : "");
    const s = o.state?.[d.entity];
    const styleParts: string[] = [];
    if (d.type === "motion" && s) {
      const fade = o.fade ?? 300;
      const t = Date.parse(s.last_changed);
      const age = Number.isNaN(t) ? 0 : now - t; // unreadable time: treat as just changed
      const v = fade > 0 ? Math.max(0, Math.min(1, 1 - age / (fade * 1000))) : cls === "on" ? 1 : 0;
      styleParts.push(`--fp-fade:${num(v)}`);
    }
    // S2.2: a lit lamp's own colour and brightness, read from its own state (not the bound switch's) and set as
    // custom properties the stylesheet consumes (`.dev.on path`), not literal fill/opacity attributes — so a
    // future rule (S2.9's aura) can read the same `--fp-dev-fill` instead of a second, possibly different, source.
    if (d.type === "light" && cls === "on" && s) {
      const fill = lightFill(s);
      if (fill) styleParts.push(`--fp-dev-fill:${fill}`);
      const opacity = lightOpacity(s);
      if (opacity !== null) styleParts.push(`--fp-dev-opacity:${num(opacity)}`);
    }
    const style = styleParts.length ? ` style="${styleParts.join(";")}"` : "";
    const label = d.name ?? d.id;
    const bound = d.type === "light" && d.bound ? d.bound : "";
    const bname = bound ? o.state?.[bound]?.attributes.friendly_name : undefined;
    const title = `${esc(d.type)}: ${esc(label)}${bound ? ` + ${esc(typeof bname === "string" && bname ? bname : bound)}` : ""}`;
    // The group turns by `rot` about the icon's centre; the icon turns back so the glyph stays upright (only what else is drawn in the group turns).
    const rot = typeof d.rot === "number" && Number.isFinite(d.rot) && d.rot !== 0 ? d.rot : 0;
    // A turned plan turns the group again from outside; the icon takes that back too, the cone (in the group's frame) does not.
    const back = (rot + planDeg) % 360 ? rot + planDeg : 0;
    // Camera: a 120 degree, 100 cm cone about "up" (-90 degrees), in plan units (the group is scaled by k). It comes first, so the icon covers its tip.
    let cone = "";
    if (d.type === "camera") {
      const R = DEVICE_REACH / k, p = (deg: number) => at([12 + R * Math.cos((deg * Math.PI) / 180), 12 + R * Math.sin((deg * Math.PI) / 180)]);
      cone = `<path class="cone" d="M12 12L${p(-150)}A${num(R)} ${num(R)} 0 0 1 ${p(-30)}Z"/>`;
    }
    const icon = `<circle class="halo" cx="12" cy="12" r="16"/><path d="${DEVICE_ICONS[d.type] ?? DEVICE_ICONS.other}"/>`;
    // The bar draws first so the icon group (fix/heater-bar-under-icon), with its white disc and halo, always paints on top of it.
    // S2.5: the bar carries the same on/off/unavailable class as the icon, so it goes orange only while heating (classOf already reads hvac_action).
    if ("a" in d) out.push(`<line data-xbar="${i}" class="heater ${cls}${sel ? " sel" : ""}" x1="${num(d.a[0])}" y1="${num(d.a[1])}" x2="${num(d.b[0])}" y2="${num(d.b[1])}" stroke-width="${sel ? 12 : 8}"/>`);
    const dim = o.dimmed?.has(d.entity) ? " dim" : "";
    out.push(`<g data-x="${i}" class="dev dev-${esc(String(d.type))}${d.type === "ac" ? ` ${acMode(d, o) ?? ""}`.trimEnd() : ""}${bound ? " bound" : ""}${o.editor && d.entity === "" ? " unbound" : ""} ${cls}${sel ? " sel" : ""}${dim}"${style} transform="translate(${at([c[0] - 12 * k, c[1] - 12 * k])}) scale(${num(k)})${rot ? ` rotate(${num(rot)} 12 12)` : ""}"><title>${title}</title>${cone}${back ? `<g transform="rotate(${num(-back)} 12 12)">${icon}</g>` : icon}</g>`);
    if ((d.type === "temp" || d.type === "humidity") && s) {
      // Anything that is not a finite number reads as "–". `unknown` and `unavailable` are only the two HA spells for it;
      // an integration can report an empty string, a comma decimal or a word, and printing "not-a-number °C" is worse than saying nothing.
      const bad = !/^-?\d+(\.\d+)?$/.test(s.state.trim()) || !Number.isFinite(Number(s.state));
      const unit = typeof s.attributes.unit_of_measurement === "string" ? ` ${s.attributes.unit_of_measurement}` : "";
      const text = bad ? "–" : s.state + unit, vs = 11 * k, gap = 16 * k + 2 * k; // 2k clear of the 16k disc
      // S7.1: below the icon, then above, then to the right (the box centred on the icon's centre line).
      const [vx, vy] = place([screenOff(c, 0, gap + 0.75 * vs), screenOff(c, 0, -gap - 0.25 * vs), screenOff(c, gap + (text.length * 0.6 * vs) / 2, 0.25 * vs)], vs, text);
      out.push(`<text class="val" x="${num(vx)}" y="${num(vy)}"${up(vx, vy)} text-anchor="middle" font-size="${num(vs)}">${esc(text)}</text>`);
    }
    if (o.showNames || sel) out.push(`<text class="lbl" x="${num(c[0])}" y="${num(c[1] - 16 * k)}"${up(c[0], c[1] - 16 * k)} text-anchor="middle" font-size="${num(9 * k)}">${esc(label)}</text>`);
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
    if (o.showNames || sel) out.push(`<text class="lbl" x="${num(u.x)}" y="${num(u.y - 16 * k)}"${up(u.x, u.y - 16 * k)} text-anchor="middle" font-size="${num(9 * k)}">${esc(label)}</text>`);
  });

  if (o.editor)
    for (const P of polys) P.pts.forEach((p, j) => out.push(`<circle class="h" data-h="${P.id}:${j}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`));
  const body = out.join("\n");
  const turned = turn ? `<g class="plan-turn" transform="rotate(${num(turn.deg)} ${num(turn.pivot[0])} ${num(turn.pivot[1])})">${body}</g>` : body;
  // Custom properties inherit, so one style on a group reaches every device. Only known types and strict #rrggbb go in: the value ends up in an attribute.
  const vars = Object.entries(o.colors ?? {}).filter(([t, v]) => (DEVICE_TYPES as readonly string[]).includes(t) && typeof v === "string" && COLOR.test(v)).map(([t, v]) => `--fp-dev-${t}:${v}`);
  const coloured = vars.length ? `<g class="dev-colours" style="${vars.join(";")}">${turned}</g>` : turned;
  // A plan-level theme, so one plan can differ from its host. No o.theme writes nothing and inherits the host's. o.theme is checked against THEMES:
  // it lands in an attribute, and a caller's stray string must not.
  const night = o.night ? ' class="night"' : "";
  if (!o.theme || !(THEMES as readonly string[]).includes(o.theme)) return night ? `<g${night}>${coloured}</g>` : coloured;
  return `<g data-theme="${o.theme}"${o.theme === "ha" && o.dark ? ' data-mode="dark"' : ""}${night}>${coloured}</g>`;
}
