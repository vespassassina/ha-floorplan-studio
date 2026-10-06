import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { entitiesOfDevice, entitiesOfDoor, stateText, wattsOf, DEVICE_ICONS, FLOORPLAN_CSS, THEMES, UI_ICONS, WALLS_LABELS, WALLS_MODES, wallsModeOf, type PlanView, activeDevices, findPowerSensor, floorsAroundKey, plugThreshold, heatRange, HEAT_FROM, HEAT_TO, clampTilt, groupByCategory, ROOM_ROW_TAP, deviceInfo, filterToRoom, formatChanged, roomSummary, migrate, planPivot, renderFloor, rotateAbout, tag, validate, viewBoxFor } from "../core";
import type { ActiveDevice, DeviceType, PowerCandidate, RoomDeviceRow, RoomSensorRow, RoomSummary, Theme, WallsMode } from "../core";
import type { Device, Door, Floor, Layout } from "../core";
import { TAP_SLOP_PX, bindDeviceActions, fireEvent, type TapTarget } from "./actions";
import { lightCaps, popupOp, type PopupOp } from "./popup";
import { POPUP_CSS, placeNear, popupTemplate, type PopupSubject, type SliderKind } from "./popup-ui";
// S7.7: side-effect import only — registers floorplan-studio-card-editor so getConfigElement() below can create
// one. vite.config.ts's card entry is this file, so the editor ships inside dist/floorplan-studio-card.js, not a
// second built file (PLAN block interface).
import "./config-editor";
import { defineElement } from "./define";
import { CARD_VERSION } from "./version";
import { MAX_ZOOM, MIN_ZOOM, clamp, panBy, pinch, pinnedView, sameView, zoomAt, type Pt, type View } from "./viewport";
import { viewKeyFor, type ViewKey } from "./view-keys";
import type { View3D } from "./three/view3d";
import type { Pick as Pick3D } from "./three/pick";
import { liveDeps, sceneDeps, textureDeps } from "../core/three-deps";
import { ROTATION_STEP, easeInOut, normaliseRotation, parseStoredView, shortestDelta, viewAround, type StoredView } from "./view-state";

const NO_LAYOUT = "No layout: install the Floorplan Studio integration or set layout_url";

/** What the card needs of `hass`. Home Assistant's real object has far more; this is only what the card reads. */
export interface HassEntity { state: string; attributes: Record<string, unknown>; last_changed: string }
export interface Hass {
  states: Record<string, HassEntity>;
  /** HA's entity registry (display copy): the device an entity belongs to, and its category. Absent on an old frontend; the plug auto-link then does nothing. */
  entities?: Record<string, { device_id?: string | null; area_id?: string | null; entity_category?: string | null } | undefined>;
  /** S11.4: HA's device and area registries (display copies), for a device row's details. Shapes from the frontend's own `hass` (src/types.ts: `devices: Record<string, DeviceRegistryEntry>`, `areas: Record<string, AreaRegistryEntry>`), only the fields read. Absent on an old frontend; the details then show entity, state and last changed. */
  devices?: Record<string, { manufacturer?: string | null; model?: string | null; sw_version?: string | null; area_id?: string | null } | undefined>;
  areas?: Record<string, { name?: string | null } | undefined>;
  themes?: { darkMode?: boolean };
  connection?: { sendMessagePromise<T>(msg: Record<string, unknown>): Promise<T> };
  callService?(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
}

export interface FloorplanStudioCardConfig {
  type?: string;
  /** Which floor to draw, by its id, or `"all"` to force the switcher. S8.12: with `floor` unset, or naming an id
   * the layout doesn't have (which now behaves as unset rather than silently pinning the first floor), the card
   * shows the switcher over every floor when the layout has more than one — a single floor never gets a chip of
   * its own. `floor: <a real id>` still pins that floor, with no switcher. */
  floor?: string | "all";
  /** Restricts the floor switcher to these floor ids, in this order; the first one is what shows by default.
   * Takes precedence over `floor`. An unknown id is dropped; an empty array, or one where every id is unknown,
   * behaves as if `floors` were not set at all. */
  floors?: string[];
  fade?: number;
  /** A plug is active from this many watts of measured power, not merely while switched on. A number >= 0; anything else is 2 (untrusted YAML). See docs/card.md, Plugs. */
  plug_watts?: number;
  /** S14.8: a plug that is on is tinted from idle to hot by its draw, between these two wattages (default 0 and 2000). Both must be numbers with from < to, else the default pair. See docs/card.md, Plugs. */
  plug_heat_from?: number;
  plug_heat_to?: number;
  room_glow?: boolean;
  layout?: Layout;
  layout_url?: string;
  /** `blueprint` (default), `midnight`, `light`, `slate`, `terminal`, `solarized`, or `ha` to take the neutrals from Home Assistant's own theme variables. */
  theme?: Theme;
  /** S7.4: `true` (default) pinch, drag, double-tap, Ctrl/Cmd+wheel and the +/−/fit buttons; `"wheel"` also zooms
   * on a plain wheel; `false` a fixed plan, as before. */
  zoom?: boolean | "wheel";
  /** S7.6: `auto` (default) darkens the plan while the sun entity is `below_horizon` (or `on`); `on` always, `off` never. */
  night?: "auto" | "on" | "off";
  /** S7.6: the entity `night: auto` reads; default `sun.sun`. */
  sun?: string;
  /** S7.5: `true` shows only the plan for a wall tablet — no floor chips, no zoom buttons, no version, no cover
   * dialog chrome beyond the dialog itself, and holding a device never opens more-info. Taps still act. Default
   * `false`. Whatever would otherwise produce a switcher — `floors`, `floor: "all"`, or (S8.12) simply a
   * multi-floor layout with neither key set — instead shows just its first floor, with no switcher: use one card
   * per floor instead (see `docs/card.md`). */
  kiosk?: boolean;
  /** S9.1: the colour an open contact door or window (and its S8.13 alert line) draws in, as `#rrggbb`; unset
   * keeps the theme's own default (--fp-dev-contact). A value that is not a plain 6-digit hex is ignored, the
   * same as any other untrusted config (CLAUDE.md finding 1) — never thrown on. */
  open_color?: string;
  /** S9.2: icons, names, values and radar dots grow by this factor on top of the automatic large-plan scale-up
   * (see `_iconSize`/`_scale` below). A number from 0.5 to 3; anything else (missing, non-numeric, `NaN`) is the
   * default, 1. Out-of-range numbers clamp rather than being refused, since a slider or a typo should never break
   * the card. */
  icon_size?: number;
  /** S9.5: `false` hides the floating active-devices panel. Default `true` (shown, open, on the left). */
  active_list?: boolean;
  /** S9.6: the centre of a pinned view, in plan cm — [x, y]. Untrusted config (CLAUDE.md finding 1): anything
   * other than a two-element array of finite numbers is ignored, silently, the same as `icon_size`/`open_color`
   * (not thrown on like `zoom`/`kiosk` — see `_center`'s comment for why). Unset, or with `zoom_level` at 1, the
   * card draws the whole floor as before. */
  center?: [number, number];
  /** S9.6: 1 (default) is the whole floor, exactly as `viewBoxFor` fits it today; 2 shows half the width and
   * height of that box, and so on up to `MAX_ZOOM` (`viewport.ts`). Anything other than a finite number is the
   * default, 1; an in-range-but-odd number (0, negative, past `MAX_ZOOM`) clamps rather than being refused, the
   * same as `icon_size`. `zoom` (the pinch/wheel switch) was already taken, so this is a separate key. */
  zoom_level?: number;
  /** `"2d"` (default) draws the flat plan, `"2.5d"` the same plan with walls and furniture drawn up, `"3d"` the house as a real 3D model you can turn (docs/card.md).
   * The dropdown (`view_switch`) can change it for as long as the card is on screen. Anything else is `"2d"`. */
  view?: CardView;
  /** `true` (default) shows the View dropdown next to the zoom buttons; `false` hides it, and so does `kiosk`. */
  view_switch?: boolean;
  /** `true` (default) shows the two rotate buttons next to the zoom buttons, and takes Left/Right; `false` hides them
   * and the keys. Unset follows the other controls: shown whenever the card draws any (zoom or the View dropdown),
   * not under `kiosk`. `true` shows them under `kiosk` too, the one control a wall panel may want. */
  rotate_switch?: boolean;
  /** `false` hides every name and value on the plan, leaving icons and state. Anything but `false` shows them (default). */
  labels?: boolean;
  /** `true` writes every device's name under its icon, the studio's Names toggle; default `false`. The View controls'
   * Device names button changes it for as long as the card is on screen, and the card remembers the pick. */
  names?: boolean;
  /** 0..1, how steeply 2.5D looks down: 0 is top-down, 1 side-on. Out-of-range clamps, junk is 0.5 (the look before this key existed). The slider next to the View select moves it for as long as the card is on screen. */
  tilt?: number;
  /** How 2.5D draws wall heights: `"full"`, `"cut"` (default) or `"low"` (docs/card.md, Walls). Anything else is `"cut"`. A Walls select next to the Tilt slider changes it for as long as the card is on screen, and the card remembers the pick. */
  walls?: WallsMode;
  /** Degrees the plan starts turned, on top of the layout's own `rotate`. Rounded to a multiple of 45 and wrapped to 0..359; junk is 0. The two buttons next to the zoom buttons turn it in steps of 45 for as long as the card is on screen, and the card remembers where it was left. */
  rotation?: number;
}

/** What the View dropdown offers: the two flat plans `renderFloor` draws and the 3D model, which is a renderer of its own. */
export type CardView = PlanView | "3d";
/** The View dropdown's options, one list for the markup and for reading the choice back (a value that is not here
 * is refused). */
const VIEW_OPTIONS: readonly { value: CardView; label: string }[] = [
  { value: "2d", label: "2D" },
  { value: "2.5d", label: "2.5D" },
  { value: "3d", label: "3D" },
];
const isView = (v: unknown): v is CardView => VIEW_OPTIONS.some((o) => o.value === v);

/** The Theme dropdown's labels. A Record over `Theme`, so a theme added to core fails the build here until it has a name. */
const THEME_LABELS: Record<Theme, string> = {
  blueprint: "Blueprint", midnight: "Midnight", light: "Light", slate: "Slate", terminal: "Terminal", solarized: "Solarized",
  ha: "Home Assistant", coffee: "Coffee", "a-team": "A-Team", space: "Space", cyberpunk: "Cyberpunk",
  "carpenter-brut": "Carpenter Brut", "beach-house": "Beach house",
};
const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);

/** A 45 degree turn takes this long; a longer one (Reset from 135 away) takes proportionally more, up to twice. */
const TURN_MS = 350;
/** Pan and zoom write to storage once they have been still this long. Short on purpose: a tablet that is put to
 * sleep or a tab that is discarded may never fire pagehide, so the write must not wait long for it. */
const SAVE_DEBOUNCE_MS = 150;

/** Card config is untrusted input (CLAUDE.md finding 1): only a plain `#rrggbb` hex is accepted for open_color. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Below this card width the Active list starts folded: it would cover the plan. */
const ACTIVE_FOLD_BELOW_PX = 480;
/** Two taps closer than this in time and space are a double-tap. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 24;
/** One click of a zoom button. */
const BUTTON_ZOOM = 1.5;
/** S9.2: `icon_size` default and clamp range. */
const DEFAULT_ICON_SIZE = 1;
const ICON_SIZE_MIN = 0.5;
const ICON_SIZE_MAX = 3;
/** S9.6: `zoom_level` default and clamp range — 1 is the whole floor, `MAX_ZOOM` (viewport.ts) is as deep as the
 * pinch zoom itself ever goes. */
const DEFAULT_ZOOM_LEVEL = 1;
const ZOOM_LEVEL_MIN = 1;

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string }[];
  }
}

type Lib3d = typeof import("./three/view3d");
/** The 3D module, once loaded: one for the page, shared by every card. It is a chunk of its own beside this file (three.js,
 * about 170 KB gzipped) and is fetched by `import()` the first time anyone picks 3D, never with the card. Its URL is
 * resolved from this module's own URL, so it works wherever Home Assistant serves the card from. */
let lib3d: Lib3d | null = null;
let lib3dLoading: Promise<Lib3d> | null = null;
/** The build puts the chunk's hashed file name here; unbuilt (vitest, dev) it stays a placeholder and the plain import is used. */
const CHUNK_FILE = "__FP3D_CHUNK__";
let lib3dTries = 0;
const loadLib3d = (): Promise<Lib3d> => {
  if (!lib3dLoading) {
    // A browser remembers a failed `import()` of one URL and never asks the network again. The first try is the plain import;
    // each later one asks for the same file under a new query, which is a new URL to the browser (and the same file to the server).
    const n = lib3dTries++;
    const load: Promise<Lib3d> = n > 0 && /^floorplan-studio-3d-.+\.js$/.test(CHUNK_FILE)
      ? import(/* @vite-ignore */ `${import.meta.url.split(/[?#]/)[0].replace(/[^/]*$/, "")}${CHUNK_FILE}?r=${n}`) // not `new URL(.., import.meta.url)`: Vite reads that as an asset and rewrites it
      : import("./three/view3d");
    lib3dLoading = load.then((m) => (lib3d = m), (err) => { lib3dLoading = null; throw err; }); // a failed load may be tried again
  }
  return lib3dLoading;
};

/** The card that has focus (or has something inside it focused), whatever shadow roots it sits in. */
let focusedCard: FloorplanStudioCard | null = null;

/** `custom:floorplan-studio-card`: renders one floor of the layout, live from `hass`. */
export class FloorplanStudioCard extends LitElement {
  static styles = [unsafeCSS(FLOORPLAN_CSS), css`
    /* S8.2: height 100% on both, matching Home Assistant's own cards (thermostat, map). In an "auto" grid row
       (no numeric height set by getGridOptions/computeCardGridSize) the containing block's height is indefinite,
       so height:100% computes to auto and the svg sizes by width and its viewBox aspect exactly as before; in a
       fixed-height row (HA's sections layout, .card.fit-rows) it fills the row instead of overflowing it, and
       the svg's own default preserveAspectRatio (xMidYMid meet) keeps the whole plan visible, letterboxed rather
       than cropped or stretched. */
    :host { display: block; position: relative; height: 100%; }
    /* S8.3: hui-panel-view gives the card no definite height either, so the plan grew by width past the bottom of
       the screen and "fit" looked zoomed in. In panel layout the card takes the screen below HA's header. */
    :host([panel]) { height: calc(100vh - var(--header-height, 56px)); }
    svg { width: 100%; height: 100%; display: block; }
    /* S12.3: the 3D view takes the place of the plan's svg, in the same box (aspect-ratio is the plan's own: with an
       indefinite height it sizes like the svg, in a fixed row it fills it). */
    .fp-3d { position: relative; width: 100%; height: 100%; display: block; }
    /* One line, over the plan, when 3D cannot run: why, and that 2D is what is shown. */
    .fp-3d-note { position: absolute; left: 8px; bottom: 8px; z-index: 1; margin: 0; max-width: calc(100% - 16px); padding: 4px 8px; font: 12px/1.3 system-ui, sans-serif; color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 6px; }
    p.msg { padding: 16px; margin: 0; font: 14px sans-serif; color: var(--fp-text); }
    /* S2.6: the floor switcher is card chrome (like p.msg above), not plan content, so it sits outside the <svg>
       renderFloor draws and is positioned over it instead. */
    /* Opus review finding 13: the active-devices panel below (also z-index: 1, and later in DOM order, so it
       would otherwise win ties) can be dragged to sit right under this row; the floor chips must still take the
       click, not the panel behind — or in front of, without this — them. */
    .fp-floors { position: absolute; top: 8px; left: 8px; z-index: 2; display: flex; gap: 6px; }
    .fp-floors button { font: 12px/1.2 system-ui, sans-serif; color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 999px; padding: 4px 10px; cursor: pointer; }
    /* Same combination the editor's floor chips already proved at 4.5:1 (S1.40); the current floor is carried by
       aria-pressed, not by this colour alone (CLAUDE.md finding: a toggle must not state its direction twice —
       one attribute serves both the visual state and the accessible one, no added "(current)" text). */
    .fp-floors button[aria-pressed="true"] { background: var(--fp-ink); color: var(--fp-bg); border-color: var(--fp-ink); }
    /* S2.7: the cover confirm dialog is card chrome too (same reasoning as .fp-floors above) — it acts on the
       real home, so it sits over the whole card, not only the plan. */
    .fp-dialog-backdrop { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.35); }
    .fp-dialog { background: var(--fp-room); color: var(--fp-ink); border-radius: 8px; padding: 16px 20px; min-width: 200px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); }
    .fp-dialog p { margin: 0 0 14px; font: 14px/1.3 system-ui, sans-serif; }
    .fp-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .fp-dialog-actions button { font: 13px/1.2 system-ui, sans-serif; color: var(--fp-ink); background: var(--fp-bg); border: 1px solid var(--fp-idle); border-radius: 6px; padding: 6px 14px; cursor: pointer; }
    /* S7.4: the view controls are card chrome, the same colours as the floor chips, in the other top corner.
       Like the studio: a horizontal toolbar (.fp-zoom) for the look controls and a vertical stack (.fp-stack) for
       zoom, fit, rotate and reset, just below it. .fp-viewonly is the toolbar when zoom is off, not .fp-zoom, so
       "zoom: false shows no zoom chrome" holds. */
    /* The toolbar wraps: on a narrow card (375 px) its controls take two rows, right-aligned, rather than running
       off the left edge. The right-hand 8 px plus the floor chips' room on the left are what max-width leaves.
       The stack's top is set in _positionToolbar, from where the toolbar ends. */
    .fp-zoom, .fp-viewonly { position: absolute; top: 8px; right: 8px; z-index: 1; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; max-width: calc(100% - 16px); }
    .fp-stack { position: absolute; top: 8px; right: 8px; z-index: 1; display: flex; flex-direction: column; gap: 4px; }
    .fp-stack.fp-stack-row { flex-direction: row; flex-wrap: wrap; justify-content: flex-end; left: 8px; }
    .fp-zoom button, .fp-viewonly button, .fp-stack button { width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; font: 16px/1 system-ui, sans-serif; color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 6px; cursor: pointer; }
    .fp-zoom button:disabled, .fp-viewonly button:disabled, .fp-stack button:disabled { opacity: 0.45; cursor: default; }
    .fp-zoom button[aria-pressed="false"], .fp-viewonly button[aria-pressed="false"] { opacity: 0.6; }
    .fp-zoom svg, .fp-viewonly svg, .fp-stack svg { width: 14px; height: 14px; }
    /* While the plan turns it takes no taps: a tap would land on a device that is moving away from the finger.
       The star reaches the children that carry their own pointer-events (.room{pointer-events:all} in the editor's
       rules, .extra, .door-hit), which an inherited value on the svg alone would lose to. */
    svg.fp-turning, svg.fp-turning * { pointer-events: none; }
    .fp-zoom input[type="range"], .fp-viewonly input[type="range"] { width: 72px; height: 28px; margin: 0; accent-color: var(--fp-primary); cursor: pointer; }
    .fp-zoom select, .fp-viewonly select { height: 28px; padding: 0 4px; font: 13px/1 system-ui, sans-serif; color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 6px; cursor: pointer; }
    /* S7.15: with zoom on, the plan takes every touch once it is zoomed in, so the page does not scroll or zoom under
       a pan or a pinch. At fit there is nothing to pan, so a vertical swipe scrolls the dashboard as it would over
       any other card; the browser still leaves a pinch and a double-tap to the plan (pan-y allows neither). */
    svg.fp-zoomable { touch-action: pan-y; }
    svg.fp-zoomable.fp-zoomed { touch-action: none; }
    .fp-dialog-actions button.confirm { color: var(--fp-on-dark, #fff); background: var(--fp-primary); border-color: var(--fp-primary); }
    /* S7.10: the vacuum dialog has four buttons where the cover dialog has two; wrap rather than overflow the
       card on a narrow width, and a disabled action reads as inert (dimmed, no pointer) without a separate class. */
    .fp-vacuum-dialog .fp-dialog-actions { flex-wrap: wrap; }
    .fp-dialog-actions button:disabled { opacity: 0.45; cursor: default; }
    /* S10.4: the chooser lists one button per entity, column layout (unlike the cover/vacuum row of verbs), each
       row left-aligned since it carries a name, not a short verb; Cancel stays a separate, right-aligned row like
       every other dialog's own Cancel. */
    .fp-chooser-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    /* Review fix: a row wears the same button look as Cancel (it had the browser's default white box), the name
       on the left and the live state on the right, muted, so the list reads as "which one, and what is it doing". */
    .fp-chooser-list button { display: flex; justify-content: space-between; gap: 12px; text-align: left; font: 13px/1.2 system-ui, sans-serif; color: var(--fp-ink); background: var(--fp-bg); border: 1px solid var(--fp-idle); border-radius: 6px; padding: 8px 12px; cursor: pointer; }
    .fp-chooser-list button .state { opacity: 0.7; white-space: nowrap; }
    .fp-chooser-dialog .fp-dialog-actions { justify-content: flex-end; }
    /* S9.5: the active-devices panel, card chrome like .fp-floors/.fp-zoom above (CLAUDE.md finding 8 — nothing here
       is drawn inside the plan's <svg>). Default position clears the floor chips' own top-left corner; a drag
       overrides top/left with an inline style, clamped in TS against the card's own box so it can never be lost
       off-screen (S9.5 spec). */
    /* Opus review finding 5: min(200px, 45%) instead of a flat 200px, so a narrow (phone-width) card gets a panel
       that fits it rather than one that is most of the card's own width at 200px on a ~380px card. */
    .fp-active { position: absolute; top: 44px; left: 8px; z-index: 1; width: min(200px, 45%); max-width: calc(100% - 16px); max-height: calc(100% - 52px); display: flex; flex-direction: column; overflow: hidden; background: var(--fp-room); color: var(--fp-ink); border: 1px solid var(--fp-idle); border-radius: 8px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25); }
    .fp-active-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: grab; touch-action: none; user-select: none; font: 600 12px/1.2 system-ui, sans-serif; border-bottom: 1px solid var(--fp-idle); }
    .fp-active-title { flex: 1; }
    .fp-active-count { font-weight: 400; color: var(--fp-text); }
    .fp-active-collapse { border: none; background: transparent; color: inherit; font: inherit; line-height: 1; cursor: pointer; padding: 2px 4px; }
    .fp-active-body { overflow-y: auto; padding: 4px 8px 8px; }
    .fp-active-group-label { font: 600 10px/1.6 system-ui, sans-serif; color: var(--fp-text); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 6px; }
    .fp-active-group-label:first-child { margin-top: 0; }
    /* S14.6: a category header is a button (keyboard, aria-expanded); it keeps the label's look. */
    button.fp-cat { display: flex; align-items: center; gap: 4px; width: 100%; min-height: 28px; text-align: left; border: none; background: transparent; padding: 0 2px; cursor: pointer; border-radius: 4px; }
    button.fp-cat:hover, button.fp-cat:focus-visible { background: var(--fp-idle); }
    .fp-cat-name { flex: 1; min-width: 0; }
    .fp-cat-chev { flex: 0 0 10px; }
    .fp-active-row { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: none; background: transparent; color: inherit; font: 12px/1.3 system-ui, sans-serif; padding: 4px 2px; cursor: pointer; border-radius: 4px; }
    .fp-active-row:hover, .fp-active-row:focus-visible { background: var(--fp-idle); }
    .fp-active-row svg { width: 16px; height: 16px; flex: 0 0 16px; fill: var(--fp-active-row-color, var(--fp-ink)); }
    .fp-active-empty { margin: 4px 2px; font: 12px/1.3 system-ui, sans-serif; color: var(--fp-text); }
    /* S11.3/S11.4: the room section and the details under a row. Same card chrome and tokens as the list above. */
    .fp-active.fp-room-open { width: min(260px, 70%); }
    .fp-item { display: flex; flex-wrap: wrap; align-items: center; }
    .fp-item .fp-active-row { flex: 1 1 0; width: auto; min-width: 0; }
    .fp-row-state { margin-left: auto; padding-left: 6px; flex: 0 0 auto; white-space: nowrap; font-size: 11px; color: var(--fp-text); overflow-wrap: anywhere; text-align: right; }
    .fp-active-row.fp-off svg { opacity: 0.6; }
    .fp-info-btn { flex: 0 0 24px; width: 24px; height: 24px; border: none; background: transparent; color: var(--fp-text); font: 12px/1 system-ui, sans-serif; border-radius: 4px; cursor: pointer; }
    .fp-info-btn:hover, .fp-info-btn:focus-visible { background: var(--fp-idle); }
    .fp-info { flex: 0 0 100%; margin: 0 0 4px 22px; font: 11px/1.4 system-ui, sans-serif; }
    .fp-info > div, .fp-room-facts > div { display: flex; gap: 6px; }
    .fp-info dt, .fp-room-facts dt { flex: 0 0 88px; color: var(--fp-text); }
    .fp-info dd, .fp-room-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .fp-room { padding-bottom: 6px; margin-bottom: 6px; border-bottom: 1px solid var(--fp-idle); }
    .fp-room-head { display: flex; align-items: center; gap: 6px; font: 600 13px/1.3 system-ui, sans-serif; }
    .fp-room-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .fp-room-clear { flex: 0 0 24px; width: 24px; height: 24px; border: none; background: transparent; color: inherit; font: 14px/1 system-ui, sans-serif; border-radius: 4px; cursor: pointer; }
    .fp-room-clear:hover, .fp-room-clear:focus-visible { background: var(--fp-idle); }
    .fp-room-facts { margin: 4px 0 6px; font: 12px/1.4 system-ui, sans-serif; }
    .fp-filter { display: flex; align-items: center; gap: 6px; font: 600 10px/1.6 system-ui, sans-serif; color: var(--fp-text); text-transform: uppercase; letter-spacing: 0.04em; }
    .fp-show-all { margin-left: auto; border: 1px solid var(--fp-idle); background: transparent; color: var(--fp-ink); font: 11px/1.4 system-ui, sans-serif; text-transform: none; letter-spacing: 0; border-radius: 4px; padding: 1px 6px; cursor: pointer; }
    .fp-show-all:hover, .fp-show-all:focus-visible { background: var(--fp-idle); }
  `, POPUP_CSS];

  private _config: FloorplanStudioCardConfig = {};
  private _hass?: Hass;
  private _layout: Layout | null = null;
  private _error: string | null = null;
  private _urlRequested = false;
  private _wsRequested = false;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _actionsSvg: SVGSVGElement | null = null;
  private _unbindActions: (() => void) | null = null;
  /** S2.4: the last time each entity was seen `on`, in ms. `last_changed` moves to the moment a motion sensor goes
   * `off`, which is no use for a fade that must keep counting from when it was last `on` — so the card remembers
   * that moment itself and hands it to `renderFloor` in place of the entity's own `last_changed`. */
  private _lastOn: Record<string, number> = {};
  /** S2.4 review: the `entity` of every motion device across every floor of the loaded layout (not only the one
   * shown: S2.6 adds a floor switcher and a sensor must keep fading across it), recomputed only when the layout
   * changes. `hass` can carry hundreds to thousands of entities and is set on every state change anywhere in the
   * house, so `_recordLastOn`/`_stateForRender` walk this small, bounded set instead of every entity `hass` has. */
  private _motionEntities: Set<string> = new Set();
  /** S2.6: which floor `floor: "all"` currently shows. Only read/written through `_floorKey`/`_selectFloor`, which
   * fall back to the layout's first floor when this is unset, stale (the layout changed) or names a floor that
   * no longer exists. */
  private _shownFloor: string | null = null;
  /** S2.7: the door whose cover confirm dialog is open, or `null` for none. Only `_openCoverDialog` sets it, and
   * only when it is already `null` — a second tap while the dialog is open (CLAUDE.md-style "Break it") must not
   * replace it with a different door or stack a second dialog. */
  private _coverDialog: Door | null = null;
  /** Tracks whether the dialog was open on the *previous* render, so `updated()` moves focus into it exactly once
   * per open (not on every unrelated re-render while it stays open) and back out exactly once per close. */
  private _coverDialogWasOpen = false;
  /** S7.10: the vacuum whose Start/Pause/Return-to-dock dialog is open, or `null` for none. Same "ignore a second
   * tap while open" rule as `_coverDialog`, and its own was-open flag for the same once-per-open/close focus move. */
  private _vacuumDialog: Device | null = null;
  private _vacuumDialogWasOpen = false;

  /** S10.4: the chooser dialog, or `null` for none. Opened whenever a tap or hold would have opened more-info but
   *  the object (a device or a non-cover door) names more than one entity — `entitiesOfDevice`/`entitiesOfDoor`,
   *  read by `bindDeviceActions`, decide that, not this file. Same "one dialog at a time, once-per-open/close
   *  focus move" rules as `_coverDialog`/`_vacuumDialog`. */
  private _chooserDialog: { title: string; entities: string[] } | null = null;
  private _chooserDialogWasOpen = false;
  /** S14.2: the tap popup, or `null` for none. One at a time; `s.key` is who it is about, `x`/`y` where the pointer landed (client px), `opener` the
   *  focusable thing that opened it (an Active row), `confirming` the turn-OFF question, `draft` a slider's shown value until Home Assistant answers. */
  private _popup: { s: PopupSubject; x: number; y: number; opener: Element | null; confirming: boolean; draft: { kind: SliderKind; value: number; from: number | null } | null } | null = null;
  private _popupFocusKey: string | null = null;
  private _popupReturn: Element | null = null;
  /** S14.2: the hover tooltip (mouse only). `_tipKey` is who it shows, `_tipHost` the card's box read once when it appears, `_tipTitle` a plan `<title>` held back so the browser's own tooltip does not double ours. */
  private _tipKey: string | null = null;
  private _tipHost: DOMRect | null = null;
  private _tipEl: Element | null = null;
  private _tipTitle: { el: Element; title: Element } | null = null;
  /** S7.4: the zoomed viewBox, or `null` for fit. Card state: reset by `setConfig` and a floor change, never by `hass`. */
  private _view: View | null = null;
  /** S12.3: the live 3D view, the floor and stair context it was built for, and why 3D cannot run (`null` while it can). */
  private _view3d: View3D | null = null;
  private _view3dFloor: unknown = null;
  private _view3dAround = "";  // JSON of `FloorsAround`, to compare
  private _fallback3d: string | null = null;
  /** The fallback came from a lost graphics context: the card tries 3D once more when it is attached or shown again. */
  private _retry3d = false;
  /** How many 3D renderers are alive in this page: a test hook (a lifecycle test reads that it returns to 0). */
  static get liveRenderers(): number { return lib3d?.liveRenderers() ?? 0; }

  /** The view picked in the dropdown; `null` means the config's own. Card state like `_view`: reset by `setConfig`, never by `hass`. */
  private _pickedView: CardView | null = null;
  /** The tilt dragged on the slider; `null` means the config's own. Card state like `_pickedView`: reset by `setConfig`, never by `hass`. */
  private _pickedTilt: number | null = null;
  /** The wall heights chosen in the Walls select; `null` means the config's own. Same rule as `_pickedTilt`. */
  private _pickedWalls: WallsMode | null = null;
  /** The theme chosen in the Theme select, the labels toggle and the turn the buttons made (a multiple of 45 in
   * 0..315); each `null` means the config's own. Same rule as `_pickedView`, with one more: these and the view,
   * tilt, zoom and focus are what the card remembers (see `_saveViewNow`), so a field is only ever stored once the
   * person has chosen it, and the config stays in charge of the rest. */
  private _pickedTheme: Theme | null = null;
  private _pickedLabels: boolean | null = null;
  private _pickedNames: boolean | null = null;
  private _pickedRot: number | null = null;
  /** Whether the pointer is over this card: with focus, what decides which card the view keys belong to. */
  private _hovered = false;
  /** A turn in flight: `from` and `to` are user angles in degrees, unwrapped (`to` may be 360, or -45) so the
   * interpolation never takes the long way; `anchor` is the plan point and zoom to hold at the centre, or `null`
   * when the card is at home and home itself follows the angle. */
  private _turn: { from: number; to: number; t0: number; dur: number; anchor: { focus: Pt; zoom: number } | null; raf: number } | null = null;
  /** The user angle drawn this frame while `_turn` runs. */
  private _turnAngle = 0;
  /** A stored zoom and focus (plan cm) waiting for the first render, the first moment the fit box is known. */
  private _pendingView: { focus: Pt; zoom: number } | null = null;
  /** The debounce timer for pan and zoom saves; non-null means there is something unsaved. */
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The fit box of the floor on show, from the last render; the zoom handlers clamp against it. */
  private _fit: View | null = null;
  private _unbindZoom: (() => void) | null = null;
  /** S9.5: the active-devices panel. `_activePos` is `null` for the CSS default position (top-left, below the
   * floor chips); once dragged it holds the panel's position as a *fraction* (0..1) of the card's own free width
   * and height (`hostSize - panelSize`), not raw px (Opus review findings 3/4: a px position stored at one size
   * and reclamped only mid-drag could end up outside the card the moment the geometry it was clamped against
   * changes — a reload at a narrower width, or expanding a panel that was dragged low while collapsed and much
   * shorter). `_positionActivePanel` re-derives the actual px position from this fraction on every render and on
   * a host resize, so the panel is inside the card by construction. Both fields are read from, and written to,
   * `localStorage` (wrapped in try/catch: private browsing or blocked storage just means the panel forgets
   * between reloads, never a thrown error — CLAUDE.md finding 1's spirit applied to browser state). */
  private _activeCollapsed = false;
  /** S14.6: the category groups the viewer folded, as `list:category` ids (`a:` Active list, `r:` Room panel). Per card, in browser storage. */
  private _foldedCats = new Set<string>();
  private _activePos: { x: number; y: number } | null = null;
  /** Whether the user has folded or unfolded the list by hand (kept in storage with the rest). Until then the card's
   * own width decides: folded under `ACTIVE_FOLD_BELOW_PX`, open from there up, followed on every resize (0.12.17;
   * it was a one-off check at 500px that a stored drag position switched off). After, the choice is theirs. */
  private _activeUserChose = false;
  private _activeResizeObserver: ResizeObserver | null = null;
  /** S11.3: the room the person tapped, by floor key and room id (not index, so a reloaded layout keeps it), or null.
   *  Card chrome state, not a layout field: nothing here is saved, and a `hass` update leaves it alone. */
  private _pickedRoom: { floor: string; id: string } | null = null;
  /** Whether the Active list is cut to the picked room's entities (the default on a pick); "Show all" turns it off. */
  private _roomFilter = true;
  /** S11.4: entities whose details are open, keyed by entity so the same device is open in both lists at once. */
  private _infoOpen: Set<string> = new Set();
  private _actionsPanel: HTMLElement | null = null;
  private _unbindPanel: (() => void) | null = null;
  /** S12.4: the 3D host the taps are bound on, and what unbinds them. */
  private _actions3d: HTMLElement | null = null;
  private _unbind3d: (() => void) | null = null;
  private _unbindHover: (() => void) | null = null;
  private _pick3dCache: { stamp: number; x: number; y: number; pick: Pick3D | null } | null = null;

  /** `localStorage` key for this card's panel state. Opus review finding 7: the seed used to be the layout's own
   * content (`layout_url`, or the inline `layout` verbatim), which meant two cards in websocket mode — no
   * `layout`/`layout_url`, the default install — both seeded from `""` and shared one key even though each pins a
   * different `floor`, and an inline layout got a *new* key on every edit (autosave rewrites `layout` in place).
   * The seed is now the layout's *source* only — `layout_url`, else `"inline"` for a config `layout`, else `"ws"`
   * for the websocket fetch — which two cards on the same source share, plus the `floor`/`floors` config that
   * tells otherwise-identical cards apart (S9.5's own two-floors-of-one-layout case, S7's floor switcher).
   * S9.6 review (Opus, 2026-09-27): `center`/`zoom_level` tell two cards on the same floor apart too — several
   * cards each pinned to a different room shared this key, so folding or dragging one moved the panel on all of
   * them after a reload. Unlike `floor`/`floors` (always in the seed, `?? null`), these two are appended only when
   * actually set: putting them in unconditionally, even as `null`, would change the JSON string — and so the
   * hash — for every card that has neither key, wiping the stored position everyone already has. */
  private _storageSeed(): unknown[] {
    const source = this._config.layout_url ?? (this._config.layout ? "inline" : "ws");
    const seed: unknown[] = [source, this._config.floor ?? null, this._config.floors ?? null];
    if (this._config.center !== undefined) seed.push(this._config.center);
    if (this._config.zoom_level !== undefined) seed.push(this._config.zoom_level);
    return seed;
  }

  private _activeStorageKey(): string {
    return `fp-active-panel:${tag(JSON.stringify(this._storageSeed()))}`;
  }

  /** The view memory's own key, apart from the Active list's (they change at different moments and a bad entry in
   * one must not cost the other). Same seed, so two cards tell apart the way the panels do, plus the config keys
   * that make a card a different view of the same floor: a 2D card and a 2.5D card of one floor, or two turned
   * differently, must not share a memory. Like `center` above they join the seed only when set. A side effect worth
   * knowing: editing one of them in the card's YAML starts a card with a clean memory. */
  private _viewStorageKey(): string {
    const seed = this._storageSeed();
    const c = this._config;
    if (c.view !== undefined) seed.push(["view", c.view]);
    if (c.rotation !== undefined) seed.push(["rotation", c.rotation]);
    if (c.theme !== undefined) seed.push(["theme", c.theme]);
    if (c.tilt !== undefined) seed.push(["tilt", c.tilt]);
    if (c.walls !== undefined) seed.push(["walls", c.walls]);
    if (c.labels !== undefined) seed.push(["labels", c.labels]);
    if (c.names !== undefined) seed.push(["names", c.names]);
    return `fp-view:${tag(JSON.stringify(seed))}`;
  }

  /** Reads this card's remembered view into the picked fields, before the first render so there is no flash of the
   * config's look. Storage is untrusted: `parseStoredView` drops each bad field, and a throwing `localStorage`
   * (private mode, blocked) is nothing stored. */
  private _loadViewState(): void {
    this._pickedView = this._pickedTilt = this._pickedWalls = this._pickedTheme = this._pickedLabels = this._pickedNames = this._pickedRot = null;
    this._pendingView = null;
    this._shownFloor = null;
    let s: StoredView = {};
    try {
      const raw = globalThis.localStorage?.getItem(this._viewStorageKey());
      if (raw) s = parseStoredView(raw, isView, THEMES);
    } catch {
      /* storage blocked: the card starts from its config */
    }
    if (s.view !== undefined) this._pickedView = s.view as CardView;
    if (s.tilt !== undefined) this._pickedTilt = s.tilt;
    if (s.walls !== undefined) this._pickedWalls = wallsModeOf(s.walls);
    if (s.theme !== undefined) this._pickedTheme = s.theme as Theme;
    if (s.labels !== undefined) this._pickedLabels = s.labels;
    if (s.names !== undefined) this._pickedNames = s.names;
    if (s.rotation !== undefined && s.rotation !== normaliseRotation(this._config.rotation)) this._pickedRot = s.rotation;
    if (s.floor !== undefined) this._shownFloor = s.floor; // an unknown id is ignored by _floorKey
    if (s.zoom !== undefined && s.focus !== undefined) this._pendingView = { focus: s.focus, zoom: s.zoom };
  }

  /** Writes what the person has chosen: only the picked fields, and the zoom and focus while zoomed. Nothing to
   * say removes the entry. A turn in flight writes nothing; its end does. Never throws. */
  private _saveViewNow(): void {
    if (this._saveTimer !== null) {
      globalThis.clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this._turn) return;
    const o: Record<string, unknown> = {};
    if (this._pickedRot !== null) o.rotation = this._pickedRot;
    if (this._pickedView !== null) o.view = this._pickedView;
    if (this._pickedTilt !== null) o.tilt = this._pickedTilt;
    if (this._pickedWalls !== null) o.walls = this._pickedWalls;
    if (this._pickedTheme !== null) o.theme = this._pickedTheme;
    if (this._pickedLabels !== null) o.labels = this._pickedLabels;
    if (this._pickedNames !== null) o.names = this._pickedNames;
    if (this._shownFloor !== null) o.floor = this._shownFloor;
    const pending = this._pendingView;
    const anchor = pending ?? this._anchorOfView();
    if (anchor) { o.zoom = anchor.zoom; o.focus = anchor.focus; }
    try {
      const key = this._viewStorageKey();
      if (Object.keys(o).length) globalThis.localStorage?.setItem(key, JSON.stringify({ v: 1, ...o }));
      else globalThis.localStorage?.removeItem(key);
    } catch {
      /* private browsing or storage blocked: the view just does not persist */
    }
  }

  /** Pan and zoom come in bursts: write once they have been still for a moment. */
  private _scheduleSave(): void {
    if (this._saveTimer !== null) globalThis.clearTimeout(this._saveTimer);
    this._saveTimer = globalThis.setTimeout(() => this._saveViewNow(), SAVE_DEBOUNCE_MS);
  }

  /** A pending debounced save goes out now (the card is leaving, or the page is). */
  private _flushSave = (): void => {
    if (this._saveTimer !== null) this._saveViewNow();
  };

  private _onVisibility = (): void => {
    if (globalThis.document?.visibilityState === "hidden") this._flushSave();
    else this._retry3dNow();
  };

  /** A lost graphics context may be back by now (the tab returns, the card is placed again): one more try at 3D. */
  private _retry3dNow(): void {
    if (!this._retry3d || this._fallback3d === null) return;
    this._retry3d = false;
    this._fallback3d = null;
    this.requestUpdate();
  }

  private _onPointerEnter = (): void => { this._hovered = true; };
  private _onPointerLeave = (): void => { this._hovered = false; };

  private _onFocusIn = (ev: Event): void => { focusedCard = ev.currentTarget as FloorplanStudioCard; };
  private _onFocusOut = (): void => { if (focusedCard === this) focusedCard = null; };

  /** The card the view keys belong to: the one with focus, else the one under the pointer. Never two. Focus is
   * tracked by the card's own focusin and focusout, not read from `document.activeElement`: in Home Assistant the
   * card sits inside several shadow roots, where `activeElement` is the outermost host and never the card, so a
   * click on the card and then the pointer moving off it lost the keys. */
  private _ownsViewKeys(): boolean {
    if (focusedCard) return focusedCard === this;
    return this._hovered;
  }

  /** Arrows zoom (up in, down out) and turn (left, right); Space is Reset view. The same keys as the editor's, from
   * `view-keys.ts`. A key is taken (preventDefault) only when it did something, so a card that cannot act, because
   * zoom is off or the controls are hidden, leaves the page its arrows and its Space. Auto-repeat is let through:
   * holding an arrow keeps zooming. */
  private _onViewKey = (ev: KeyboardEvent): void => {
    if (!this.isConnected || !this._ownsViewKeys()) return;
    if (this._coverDialog || this._vacuumDialog || this._chooserDialog) return; // a dialog has its own keys
    if (ev.key === "Escape" && this._popup) { this._closePopup(); ev.preventDefault(); return; }
    if (ev.key === "Escape" && this._pickedRoom) { // S11.3: the same ownership gate as the view keys, so another card never loses its room
      this._pickRoom(null);
      ev.preventDefault();
      return;
    }
    const key = viewKeyFor(ev);
    if (key && this._doViewKey(key)) ev.preventDefault();
  };

  /** Whether the two rotate buttons exist, which is when Left and Right turn the plan. `rotate_switch` decides
   * when it is a boolean; otherwise they come with any other control the card draws (zoom or the View dropdown)
   * and go with kiosk. Rotation does not depend on 2.5D: it turns the 2D plan too. */
  private _rotateOn(): boolean {
    const r = this._config.rotate_switch;
    if (r === true || r === false) return r;
    return !this._kiosk() && (this._zoomMode() !== false || this._config.view_switch !== false);
  }

  private _viewSwitchOn(): boolean {
    return this._config.view_switch !== false && !this._kiosk();
  }

  /** Whether the toolbar has a Reset view button, which is when Space resets the whole view. */
  private _hasViewControls(): boolean {
    return this._viewSwitchOn() || this._rotateOn();
  }

  private _doViewKey(key: ViewKey): boolean {
    if (!this._floor() || this._shows3d()) return false; // the 3D camera is the pointer's; the plan's zoom and turn are not on show
    switch (key) {
      case "zoomIn":
      case "zoomOut":
        if (this._zoomMode() === false) return false;
        this._zoomCentre(key === "zoomIn" ? BUTTON_ZOOM : 1 / BUTTON_ZOOM);
        return true;
      case "rotateLeft":
      case "rotateRight":
        if (!this._rotateOn()) return false;
        this._turnBy(key === "rotateLeft" ? -ROTATION_STEP : ROTATION_STEP);
        return true;
      case "reset":
        if (this._hasViewControls()) {
          if (!this._modified()) return false;
          this._resetView();
          return true;
        }
        if (this._zoomMode() === false || !this._zoomed()) return false;
        this._fitView();
        return true;
    }
  }

  /** The zoomed view as what survives a turn and a reload: its zoom against fit and its centre in plan cm, which is
   * the layout's own coordinates before any rotation. `null` at home. */
  private _anchorOfView(): { focus: Pt; zoom: number } | null {
    const fit = this._fitNow(); // fresh: a View or Tilt pick has changed it since the last render
    if (!this._view || !fit) return null;
    const v = clamp(this._view, fit);
    const centre: Pt = [v.x + v.w / 2, v.y + v.h / 2];
    const rot = this._rotate();
    return { focus: rot ? rotateAbout(centre, -rot.deg, rot.pivot) : centre, zoom: fit.w / v.w };
  }

  /** The box that holds `anchor`'s plan point at the centre at the current angle, kept on the plan by `clamp`. */
  private _boxFromAnchor(anchor: { focus: Pt; zoom: number }, fit: View): View {
    const rot = this._rotate();
    const centre = rot ? rotateAbout(anchor.focus, rot.deg, rot.pivot) : anchor.focus;
    return clamp(viewAround(centre, anchor.zoom, fit), fit);
  }

  private _loadActiveState(): void {
    this._activeCollapsed = false;
    this._activePos = null;
    this._activeUserChose = false;
    try {
      const raw = globalThis.localStorage?.getItem(this._activeStorageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw) as { collapsed?: unknown; chosen?: unknown; x?: unknown; y?: unknown };
      // An entry from before `chosen` existed that says collapsed was a hand fold (nothing else wrote it as true);
      // one that says open may only be a dragged position, so the width still decides.
      if (parsed.chosen === true || parsed.collapsed === true) { this._activeUserChose = true; this._activeCollapsed = parsed.collapsed === true; }
      // Opus review finding 3: untrusted storage, including an older build's raw-px entry — clamped into the 0..1
      // fraction range rather than trusted or thrown on. A stale px value just lands at whichever edge it clamps
      // to (never off-screen); it does not need to reproduce its exact old spot.
      if (typeof parsed.x === "number" && typeof parsed.y === "number" && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        this._activePos = { x: Math.min(Math.max(parsed.x, 0), 1), y: Math.min(Math.max(parsed.y, 0), 1) };
      }
    } catch {
      /* malformed or unavailable storage: the panel just opens at its default place, uncollapsed */
    }
  }

  private _catStorageKey(): string {
    return `fp-active-cats:${tag(JSON.stringify(this._storageSeed()))}`;
  }

  private _loadFoldedCats(): void {
    this._foldedCats = new Set();
    try {
      const raw = globalThis.localStorage?.getItem(this._catStorageKey());
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === "string" && id.length < 40) this._foldedCats.add(id);
    } catch {
      /* malformed or unavailable storage: every group opens */
    }
  }

  private _toggleCat(id: string): void {
    if (!this._foldedCats.delete(id)) this._foldedCats.add(id);
    try { globalThis.localStorage?.setItem(this._catStorageKey(), JSON.stringify([...this._foldedCats])); } catch { /* storage blocked: the fold just does not persist */ }
    this.requestUpdate();
  }

  /** S14.6: one category of rows under a header button. `list` is `a` (Active) or `r` (Room); folded state is per list. */
  private _catGroup(list: "a" | "r", id: string, label: string, count: number, rows: unknown) {
    const key = `${list}:${id}`, folded = this._foldedCats.has(key);
    return html`<div class="fp-active-group" data-cat=${id}>
      <button type="button" class="fp-active-group-label fp-cat" aria-expanded=${folded ? "false" : "true"} @click=${() => this._toggleCat(key)}>
        <span class="fp-cat-chev" aria-hidden="true">${folded ? "▸" : "▾"}</span><span class="fp-cat-name">${label}</span><span class="fp-active-count">${count}</span>
      </button>${folded ? null : rows}
    </div>`;
  }

  private _saveActiveState(): void {
    try {
      globalThis.localStorage?.setItem(this._activeStorageKey(), JSON.stringify({ collapsed: this._activeUserChose && this._activeCollapsed, chosen: this._activeUserChose, x: this._activePos?.x, y: this._activePos?.y }));
    } catch {
      /* private browsing or storage blocked: position/collapse just don't persist */
    }
  }

  static getStubConfig(): FloorplanStudioCardConfig {
    return { type: "custom:floorplan-studio-card" };
  }

  /** S7.7: the Edit-card dialog's own form instead of raw YAML. */
  static getConfigElement(): HTMLElement {
    return document.createElement("floorplan-studio-card-editor");
  }

  connectedCallback(): void {
    super.connectedCallback();
    // S2.7: programmatically focusable (not in the tab order) so the card itself can take focus back after the
    // cover dialog closes, without adding a stop no keyboard user would otherwise want. Set here, not in the
    // constructor: the custom element spec forbids gaining attributes during construction (jsdom enforces this
    // and throws NotSupportedError; a real browser is more forgiving, but this is the correct place regardless).
    if (!this.hasAttribute("tabindex")) this.tabIndex = -1;
    // Opus review findings 3/4: a host resize (a dashboard column narrowing, a sidebar opening, a card being
    // dragged to a new grid size) must re-clamp the panel too, not only a fresh render. jsdom has no
    // ResizeObserver; the unit suite never needs this path, so it is skipped there rather than polyfilled.
    if (typeof ResizeObserver !== "undefined") {
      this._activeResizeObserver = new ResizeObserver(() => { this._applyWidthDefault(); this._positionToolbar(); this._positionActivePanel(); });
      this._activeResizeObserver.observe(this);
    }
    // A reload or a closed tab never runs disconnectedCallback; the debounced save must still go out.
    globalThis.addEventListener?.("pagehide", this._flushSave);
    // pagehide does not fire for a tab that is hidden and then discarded, or a phone app switched away from.
    globalThis.document?.addEventListener("visibilitychange", this._onVisibility);
    this._retry3dNow();
    globalThis.addEventListener?.("keydown", this._onViewKey);
    globalThis.document?.addEventListener("pointerdown", this._onOutsideDown, true);
    globalThis.addEventListener?.("scroll", this._hideTip, true);
    this.addEventListener("pointerenter", this._onPointerEnter);
    this.addEventListener("pointermove", this._onPointerEnter); // a card that appeared under a resting pointer never saw an enter
    this.addEventListener("pointerleave", this._onPointerLeave);
    this.addEventListener("focusin", this._onFocusIn);
    this.addEventListener("focusout", this._onFocusOut);
    this.requestUpdate(); // a turn settled while detached left the last frame on screen
  }

  /**
   * S7.5: config is untrusted (CLAUDE.md finding 1) — an unrecognised `zoom` used to fall silently back to `true`,
   * which hid a typo (`zoom: "yes"`) behind the default instead of surfacing it. Both `zoom` and `kiosk` now throw,
   * the way Home Assistant's own card config errors do, naming the key so the dashboard's error card says what to
   * fix. Every other key stays permissive (CLAUDE.md finding 1 again: never throw on an unknown floor id, theme,
   * and so on — those already have documented, harmless fallbacks).
   */
  private _validateConfig(config: FloorplanStudioCardConfig): void {
    const { zoom, kiosk } = config;
    if (zoom !== undefined && zoom !== true && zoom !== false && zoom !== "wheel") {
      throw new Error(`floorplan-studio-card: zoom must be true, false or "wheel", got ${JSON.stringify(zoom)}`);
    }
    if (kiosk !== undefined && typeof kiosk !== "boolean") {
      throw new Error(`floorplan-studio-card: kiosk must be true or false, got ${JSON.stringify(kiosk)}`);
    }
  }

  setConfig(config: FloorplanStudioCardConfig): void {
    this._validateConfig(config ?? {});
    this._flushSave(); // under the old config's key
    this._settleTurn(false);
    this._config = config ?? {};
    this._layout = null;
    this._error = null;
    this._urlRequested = false;
    this._wsRequested = false;
    this._shownFloor = null;
    this._view = null;
    this._fallback3d = null;
    this._loadViewState();
    this._loadActiveState();
    this._loadFoldedCats();
    this._loadLayout();
    this.requestUpdate();
  }

  get hass(): Hass | undefined {
    return this._hass;
  }

  set hass(h: Hass) {
    this._hass = h;
    this._recordLastOn(h);
    if (!this._layout) this._loadLayout();
    this._syncTimer();
    this.requestUpdate();
  }

  /** S2.4, scoped by review: updates `_lastOn` for the layout's own motion entities that are now `on`, so one that
   * later goes `off` keeps its last `on` moment on record. Never walks the rest of `hass.states`. */
  private _recordLastOn(h: Hass): void {
    for (const id of this._motionEntities) {
      const s = h.states[id];
      if (!s || s.state !== "on") continue;
      const t = Date.parse(s.last_changed);
      if (!Number.isNaN(t)) this._lastOn[id] = t;
    }
  }

  /** `hass.states`, with a motion entity's `last_changed` swapped for its recorded `_lastOn` when the two differ.
   * `renderFloor` reads only `last_changed` for its fade math (S2.4's interface, no new option on `RenderOpts`), so
   * this is how the card hands over the remembered on time. Scoped to `_motionEntities` and copy-on-write: an
   * unrelated entity's real `last_changed` reaches core untouched, and with nothing to override this returns
   * `hass.states` itself, no copy, which is most renders on a card with no motion device fading. */
  private _stateForRender(): Hass["states"] | undefined {
    const states = this._hass?.states;
    if (!states) return states;
    let out: Hass["states"] | undefined;
    for (const id of this._motionEntities) {
      const t = this._lastOn[id];
      const s = states[id];
      if (t === undefined || !s) continue;
      const changed = new Date(t).toISOString();
      if (s.last_changed === changed) continue;
      out = out ?? { ...states };
      out[id] = { ...s, last_changed: changed };
    }
    return out ?? states;
  }

  /** S14.8: the draw range plugs are tinted over, from the two card options (untrusted: junk is the default range). */
  private _plugHeat(): [number, number] {
    return heatRange([this._config.plug_heat_from ?? HEAT_FROM, this._config.plug_heat_to ?? HEAT_TO]);
  }

  /**
   * Plug entity -> power sensor, for plugs with no `power` in the layout: the one `sensor.*` of device class `power`
   * on the plug's own HA device (`hass.entities` gives the device, the sensor's state its class). An explicit
   * `power` is never overridden (the renderer reads it first), and two candidates link nothing (`findPowerSensor`).
   */
  private _powerLinks(): Record<string, string> | undefined {
    const reg = this._hass?.entities, states = this._hass?.states;
    if (!this._layout || !reg || !states) return undefined;
    const plugs = Object.values(this._layout.floors).flatMap((f) => f.devices).filter((d) => d.type === "plug" && !d.power && d.entity);
    const devs = new Set(plugs.map((d) => reg[d.entity]?.device_id).filter((x): x is string => typeof x === "string" && !!x));
    if (!devs.size) return undefined;
    const rows: PowerCandidate[] = [];
    for (const [id, e] of Object.entries(reg)) {
      const dev = e?.device_id;
      if (!dev || !devs.has(dev)) continue;
      const dc = states[id]?.attributes?.device_class;
      rows.push({ id, domain: id.split(".")[0], dc: typeof dc === "string" ? dc : undefined, dev, cat: e.entity_category });
    }
    const links: Record<string, string> = {};
    for (const d of plugs) {
      const found = findPowerSensor(rows, d.entity);
      if (found) links[d.entity] = found;
    }
    return links;
  }

  /** Row count from the plan's own aspect ratio (60 cm pad, the layout's rotate), shared by getCardSize and
   * getGridOptions so the masonry view and the sections view agree on how tall the card wants to be. */
  private _rows(): number {
    const f = this._floor();
    if (!f || !f.outline.length) return 6;
    const box = viewBoxFor(f, 60, this._rotate(), this._planView(), this._tilt());
    return Math.max(3, Math.round((box.h / box.w) * 8));
  }

  getCardSize(): number {
    return this._rows();
  }

  /** S8.2: without this, HA's sections layout gives the card `rows: "auto"` and sizes the row to content, which
   * for a card whose own height tracked its width (`svg{height:auto}`) meant the row grew or shrank with the plan
   * and a user's manual row resize had nothing to hold onto — the card looked "stuck", cropped at whatever height
   * the row happened to be. A numeric `rows`, from the same aspect getCardSize already reads, gives the resize
   * tool a starting height that fits the plan, and the CSS fix above (svg height:100%) means a further manual
   * resize letterboxes the plan instead of cropping it. `min_columns` keeps a narrow card from squeezing the plan
   * illegibly thin; `min_rows` keeps a short one from squeezing it illegibly flat. */
  /** S8.3: HA's hui-card sets `layout` on the card element ("panel" in a panel view, "grid" in sections). */
  set layout(v: string | undefined) {
    this.toggleAttribute("panel", v === "panel");
  }
  get layout(): string | undefined {
    return this.hasAttribute("panel") ? "panel" : undefined;
  }

  getGridOptions(): { columns: number; rows: number; min_columns: number; min_rows: number } {
    return { columns: 12, rows: this._rows(), min_columns: 6, min_rows: 3 };
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopTimer();
    globalThis.removeEventListener?.("pagehide", this._flushSave);
    globalThis.document?.removeEventListener("visibilitychange", this._onVisibility);
    globalThis.removeEventListener?.("keydown", this._onViewKey);
    globalThis.document?.removeEventListener("pointerdown", this._onOutsideDown, true);
    globalThis.removeEventListener?.("scroll", this._hideTip, true);
    this._popup = null;
    this._hideTip();
    this.removeEventListener("pointerenter", this._onPointerEnter);
    this.removeEventListener("pointermove", this._onPointerEnter);
    this.removeEventListener("pointerleave", this._onPointerLeave);
    this.removeEventListener("focusin", this._onFocusIn);
    this.removeEventListener("focusout", this._onFocusOut);
    if (focusedCard === this) focusedCard = null;
    this._hovered = false;
    this._settleTurn(false); // cancels the frame loop; the state lands where the turn was going
    this._flushSave();
    this._unbindActions?.();
    this._unbindActions = null;
    this._unbindHover?.();
    this._unbindHover = null;
    this._unbindZoom?.();
    this._unbindZoom = null;
    this._actionsSvg = null;
    this._unbindPanel?.();
    this._unbindPanel = null;
    this._actionsPanel = null;
    this._unbind3d?.();
    this._unbind3d = null;
    this._actions3d = null;
    this._activeResizeObserver?.disconnect();
    this._activeResizeObserver = null;
    this._dispose3d();
  }

  /** Takes any accepted layout (from config or a fetch), migrates and validates it. Never throws: an unusable one
   * leaves a message up. S7.16: a plan that arrived but failed says why (the first problem), so the message can be
   * matched to the plan; nothing at all (`null`, `undefined`) keeps the install hint. */
  private _applyLayout(raw: unknown): void {
    try {
      if (raw == null) throw new Error();
      const v = validate(migrate(raw));
      if (!v.ok) throw new Error(v.errors[0]);
      if (!Object.keys(v.layout.floors).length) throw new Error("the plan has no floors");
      this._layout = v.layout;
      // S2.4 review: every floor, not only the one on show, so a sensor keeps fading across a floor switch (S2.6).
      this._motionEntities = new Set(Object.values(v.layout.floors).flatMap((f) => f.devices.filter((d) => d.type === "motion").map((d) => d.entity)));
      this._error = null;
    } catch (e) {
      const why = e instanceof Error ? e.message : "";
      this._error = why ? `The plan could not be used: ${why}` : NO_LAYOUT;
    }
    this._syncTimer();
    this.requestUpdate();
  }

  /** Layout source order: `config.layout`, then `config.layout_url` (fetched once), then the websocket `floorplan_studio/load`. */
  private _loadLayout(): void {
    if (this._layout) return;
    if (this._config.layout) {
      this._applyLayout(this._config.layout);
      return;
    }
    if (this._config.layout_url) {
      if (this._urlRequested) return;
      this._urlRequested = true;
      fetch(this._config.layout_url)
        .then((res) => res.json())
        .then((json) => this._applyLayout(json))
        .catch(() => { this._error = NO_LAYOUT; this.requestUpdate(); });
      return;
    }
    if (this._hass?.connection) {
      if (this._wsRequested) return;
      this._wsRequested = true;
      // S7.16: the integration answers `{ layout }` (websocket.py); `null` when nothing has been saved yet.
      this._hass.connection
        .sendMessagePromise<{ layout: unknown }>({ type: "floorplan_studio/load" })
        .then((r) => this._applyLayout(r?.layout))
        .catch(() => { this._error = NO_LAYOUT; this.requestUpdate(); });
      return;
    }
    this._error = NO_LAYOUT;
  }

  /** The turn the plan is drawn at: the layout's own rotate plus the user's. Turned into the `{ deg, pivot }`
   * renderFloor and viewBoxFor take, or `undefined` for none. Shared so getCardSize sees the same box render() draws. */
  private _rotate(): { deg: number; pivot: [number, number] } | undefined {
    if (!this._layout) return undefined;
    const deg = (this._layout.rotate ?? 0) + this._userAngle();
    return deg % 360 ? { deg, pivot: planPivot(this._layout) } : undefined;
  }

  /** The user's turn in degrees: the settled step, or the frame of a turn in flight. */
  private _userAngle(): number {
    return this._turn ? this._turnAngle : this._pickedRot ?? normaliseRotation(this._config.rotation);
  }

  private _reducedMotion(): boolean {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  }

  /** One click of a rotate button: 45 degrees from where the turn in flight is going, or from where the plan is.
   * The plan point at the centre of the screen stays there (`anchor`), so zoom and focus survive the turn. */
  private _turnBy(delta: number): void {
    const to = (this._turn ? this._turn.to : this._userAngle()) + delta;
    this._startTurn(to, this._turn ? this._turn.anchor : this._anchorOfView());
  }

  /** Turns the user's angle to `to` (unwrapped degrees). A turn already running is replaced from its current frame,
   * so a second click neither jumps nor drifts. Reduced motion lands at once. */
  private _startTurn(to: number, anchor: { focus: Pt; zoom: number } | null): void {
    const from = this._userAngle();
    if (to === from && !this._turn) return;
    if (this._turn) globalThis.cancelAnimationFrame(this._turn.raf);
    const steps = Math.abs(to - from) / ROTATION_STEP;
    const dur = TURN_MS * Math.min(2, Math.max(0.4, steps));
    this._turn = { from, to, t0: globalThis.performance.now(), dur, anchor, raf: 0 };
    this._turnAngle = from;
    if (this._reducedMotion()) {
      this._settleTurn(true);
      return;
    }
    this._turn.raf = globalThis.requestAnimationFrame(this._tick);
    this.requestUpdate();
  }

  private _tick = (): void => {
    const t = this._turn;
    if (!t) return;
    const p = (globalThis.performance.now() - t.t0) / t.dur;
    if (p >= 1) {
      this._settleTurn(true);
      return;
    }
    this._turnAngle = t.from + (t.to - t.from) * easeInOut(p);
    t.raf = globalThis.requestAnimationFrame(this._tick);
    this.requestUpdate();
  };

  /** Ends a turn in flight at its target: the angle becomes the stored step (wrapped to 0..315, and back to
   * "config's own" when it is the config's), the zoomed box is rebuilt exactly at the new angle, and the state is
   * written. The last frame is a plain render at that angle, so it is the same markup a direct render gives.
   * `render` false is for a card leaving or being reconfigured: nothing to draw. */
  private _settleTurn(render: boolean): void {
    const t = this._turn;
    if (!t) return;
    globalThis.cancelAnimationFrame(t.raf);
    const step = normaliseRotation(t.to);
    this._pickedRot = step === normaliseRotation(this._config.rotation) ? null : step;
    this._turn = null;
    const fit = this._fitNow();
    this._fit = fit;
    this._view = t.anchor && fit ? this._boxFromAnchor(t.anchor, fit) : null;
    const home = this._home();
    if (this._view && fit && home && sameView(this._view, home, fit)) this._view = null;
    this._saveViewNow();
    if (render) this.requestUpdate();
  }

  /** The whole-floor box at the angle, view and tilt on show, or `null` with no floor. */
  private _fitNow(): View | null {
    const f = this._floor();
    return f ? viewBoxFor(f, 60, this._rotate(), this._planView(), this._tilt()) : null;
  }

  /** The card's theme: the Theme select's pick, else `config.theme`, blueprint when there is none or it is not a theme. The OS and Home Assistant's dark mode no longer pick it: only `theme: ha` follows Home Assistant. */
  private _theme(): Theme {
    if (this._pickedTheme) return this._pickedTheme;
    const t = this._config.theme;
    return isTheme(t) ? t : "blueprint";
  }

  /** Whether the names and values show: the toggle's pick, else `config.labels` (only a real `false` hides). */
  private _labels(): boolean {
    return this._pickedLabels ?? this._config.labels !== false;
  }

  /** Whether every device's name shows: the toggle's pick, else `config.names` (only a real `true` shows them). */
  private _names(): boolean {
    return this._pickedNames ?? this._config.names === true;
  }

  /** Home Assistant's dark mode, used only by `theme: ha` to choose the dark set for what its CSS variables do not cover. */
  private _haDark(): boolean {
    return this._hass?.themes?.darkMode === true;
  }

  /** S6.5/S8.12: the switchable floors and their order — `config.floors`, filtered to the ones the layout
   * actually has, when it names at least one real floor; every floor, in layout order, for `config.floor === "all"`;
   * `null` for a single floor explicitly pinned by a real id. `floors` wins over `floor` when both are set.
   * Untrusted config (CLAUDE.md finding 1): an unknown id is dropped rather than thrown on, and an empty or
   * all-unknown list is the same as `floors` not being set.
   *
   * S8.12: with neither `floors` nor a `floor` pinned to a real floor id (that includes `floor` unset, `floor:
   * "all"` — handled above — and an unknown `floor` id, which now counts as unset rather than a silent pin to the
   * first floor: see docs/DECISIONS.md), every floor becomes the default switcher when the layout has more than
   * one — a single floor's own chip would be noise, so that case still returns `null`. */
  private _floorList(): [string, Floor][] | null {
    if (!this._layout) return null;
    if (this._config.floors?.length) {
      const entries = this._config.floors.filter((k) => this._layout!.floors[k]).map((k) => [k, this._layout!.floors[k]!] as [string, Floor]);
      if (entries.length) return entries;
    }
    if (this._config.floor === "all") return Object.entries(this._layout.floors);
    const pin = this._config.floor;
    const pinnedToRealFloor = pin !== undefined && pin !== "all" && !!this._layout.floors[pin];
    if (!pinnedToRealFloor) {
      const entries = Object.entries(this._layout.floors);
      if (entries.length > 1) return entries;
    }
    return null;
  }

  /** The floor key `_floor()` shows right now: the first of `_floorList()` (or `_shownFloor`, once it's been
   * switched to another entry in that same list) when there is one, else `config.floor` when it names a real
   * floor, else the layout's first floor. Untrusted config: an unknown floor key never throws, it just falls
   * back (CLAUDE.md finding 1). */
  private _floorKey(): string | null {
    if (!this._layout) return null;
    const keys = Object.keys(this._layout.floors);
    if (!keys.length) return null;
    const list = this._floorList();
    if (list) {
      const listKeys = list.map(([k]) => k);
      return this._shownFloor && listKeys.includes(this._shownFloor) ? this._shownFloor : listKeys[0]!;
    }
    const want = this._config.floor;
    return want && this._layout.floors[want] ? want : keys[0]!;
  }

  private _floor(): Floor | null {
    const key = this._floorKey();
    return key && this._layout ? this._layout.floors[key] : null;
  }

  /** S2.6: switches which floor `floor: "all"` shows. Ordinary card chrome, not a plan gesture, so it is wired with
   * a plain button click, not `bindDeviceActions` (CLAUDE.md finding 3: that gesture implementation is for hits on
   * the plan itself). The motion-fade timer state (`_lastOn`) is untouched: it is keyed by entity across every
   * floor already, not by which one is on screen (S2.4 review). */
  private _selectFloor(key: string): void {
    if (this._shownFloor === key) return;
    this._shownFloor = key;
    this._pickedRoom = null; // a room of the floor just left means nothing on this one
    this._view = null;
    this._pendingView = null;
    if (this._turn) this._turn.anchor = null; // a zoom held for the old floor means nothing on this one
    this._scheduleSave();
    this.requestUpdate();
  }

  /** True while any motion device on the shown floor is within its fade window (S2.4 computes the fade itself; this only decides whether the timer runs). */
  private _motionFading(): boolean {
    const f = this._floor();
    const fadeMs = (this._config.fade ?? 300) * 1000;
    if (!f || !this._hass || fadeMs <= 0) return false;
    const now = Date.now();
    return f.devices.some((d) => {
      if (d.type !== "motion") return false;
      const s = this._hass!.states[d.entity];
      if (!s) return false;
      const t = this._lastOn[d.entity] ?? Date.parse(s.last_changed);
      return !Number.isNaN(t) && now - t < fadeMs;
    });
  }

  private _stopTimer(): void {
    if (this._timer !== null) {
      // Explicit `globalThis` lookup: jsdom can run a custom element's `disconnectedCallback` reaction in a realm
      // where the bare `clearInterval` identifier is not defined, throwing `ReferenceError` instead of clearing
      // the timer (seen when a test's `afterEach` clears `document.body.innerHTML` with a card's timer still live).
      globalThis.clearInterval(this._timer);
      this._timer = null;
    }
  }

  /** Starts a 1 s re-render timer while a motion device is fading, stops it the moment none is. Never runs for nothing else. */
  private _syncTimer(): void {
    const active = this._motionFading();
    if (active && this._timer === null) {
      // Each tick checks for itself, so the timer stops the moment the fade window closes rather than running forever once started.
      this._timer = globalThis.setInterval(() => {
        if (this._motionFading()) this.requestUpdate();
        else this._stopTimer();
      }, 1000);
    } else if (!active) {
      this._stopTimer();
    }
  }

  /**
   * The host's own chrome (this `p.msg`, anything outside the `<svg>`) is styled by `FLOORPLAN_CSS`'s `:host` rules,
   * which read `data-theme` off the host element itself, not off `renderFloor`'s output. Kept in sync with the
   * value passed into `renderFloor`, and always set: blueprint unless the config says otherwise. `data-mode` says
   * whether Home Assistant is dark, for `theme: ha` only.
   */
  /** S7.8: where each person stood before this render, by entity. Read by `_glidePeople`. */
  private _peopleWere = new Map<string, string>();

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    this._peopleWere = new Map();
    const devices = this._floor()?.devices;
    this.shadowRoot?.querySelectorAll<SVGGElement>("g.dev-person[data-x]").forEach((g) => {
      const e = devices?.[Number(g.dataset.x)]?.entity;
      if (e) this._peopleWere.set(e, g.style.transform);
    });
  }

  /**
   * S7.8: each render replaces every node under the <svg> (unsafeSVG), so `.dev-person`'s transform transition would
   * never fire on its own: the new node starts where it ends. For each person that moved, the new node is put back
   * where the old one stood, its style is flushed, and then it is given its new place, so the class rule animates the
   * move (a FLIP). Under prefers-reduced-motion the rule has no transition and the person jumps.
   */
  private _glidePeople(): void {
    const devices = this._floor()?.devices;
    this.shadowRoot?.querySelectorAll<SVGGElement>("g.dev-person[data-x]").forEach((g) => {
      const e = devices?.[Number(g.dataset.x)]?.entity, was = e ? this._peopleWere.get(e) : undefined, now = g.style.transform;
      if (!was || was === now) return;
      g.style.transition = "none";
      g.style.transform = was;
      void getComputedStyle(g).transform;
      g.style.transition = "";
      g.style.transform = now;
    });
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._glidePeople();
    this._applyWidthDefault();
    this._positionToolbar();
    this._positionActivePanel();
    const t = this._theme();
    this.setAttribute("data-theme", t);
    if (t === "ha" && this._haDark()) this.setAttribute("data-mode", "dark");
    else this.removeAttribute("data-mode");

    // S9.1: open_color overrides --fp-open-door on the host itself, which every theme's own [data-theme] rule
    // already defines (default var(--fp-dev-contact)) — an inline host style always wins the cascade over it. An
    // invalid value is dropped instead of thrown on (CLAUDE.md finding 1) and leaves the theme's default in place.
    const openColor = this._config.open_color;
    if (openColor && HEX_COLOR.test(openColor)) this.style.setProperty("--fp-open-door", openColor);
    else this.style.removeProperty("--fp-open-door");

    this._sync3d();

    const svg = this.shadowRoot?.querySelector("svg") ?? null;
    if (svg !== this._actionsSvg) {
      // Lit keeps the <svg> element itself across renders (only unsafeSVG's content is replaced), so binding
      // once per element, not once per render, avoids piling up duplicate listeners (S2.2 "Break it": no
      // debounce, but also no double-firing from a stale second listener).
      this._unbindActions?.();
      this._unbindActions = svg
        ? bindDeviceActions(svg, this, (i) => this._floor()?.devices[i], (i) => this._floor()?.doors[i], {
            longPress: !this._kiosk(),
            openVacuumDialog: (d) => this._openVacuumDialog(d),
            openChooser: (title, entities) => this._openChooserDialog(title, entities),
            openPopup: (t, at, from) => this._openPopup(t, at, from),
            getUnlinked: (i) => this._floor()?.unlinked[i],
          })
        : null;
      this._unbindHover?.();
      this._unbindHover = svg ? this._bindHover(svg) : null;
      this._unbindZoom?.();
      this._unbindZoom = svg ? this._bindZoom(svg) : null;
      this._actionsSvg = svg;
    }

    // S12.4: the 3D view's taps, on its own host, bound once per element like the plan's.
    const host3 = this.shadowRoot?.querySelector<HTMLElement>(".fp-3d") ?? null;
    if (host3 !== this._actions3d) {
      this._unbind3d?.();
      this._unbind3d = host3 ? this._bind3d(host3) : null;
      this._actions3d = host3;
    }

    // S11.3: the panel's device rows go through the same gesture binder as the plan's icons, bound once per element.
    const panel = this.shadowRoot?.querySelector<HTMLElement>(".fp-active") ?? null;
    if (panel !== this._actionsPanel) {
      this._unbindPanel?.();
      this._unbindPanel = panel
        ? bindDeviceActions(panel, this, (i) => this._floor()?.devices[i], undefined, {
            longPress: !this._kiosk(),
            openChooser: (title, entities) => this._openChooserDialog(title, entities),
            openPopup: (t, at, from) => this._openPopup(t, at, from),
          })
        : null;
      this._actionsPanel = panel;
    }

    // S2.7: move focus into the dialog the moment it appears (Cancel, the default action, not Open) and back to
    // the card itself the moment it is gone, at most once per open/close — a later re-render while it stays open
    // (a hass update arriving mid-dialog) must not steal focus back from wherever the person has since tabbed to.
    // A door line is not a focusable element (no tabindex, no keyboard trigger of its own — the dialog only ever
    // opens from a pointer tap), so the card itself, not the door, is what focus returns to.
    const dialogOpen = this._coverDialog !== null;
    if (dialogOpen && !this._coverDialogWasOpen) {
      this.shadowRoot?.querySelector<HTMLButtonElement>(".fp-dialog button.cancel")?.focus();
    } else if (!dialogOpen && this._coverDialogWasOpen) {
      this.focus();
    }
    this._coverDialogWasOpen = dialogOpen;

    // S7.10: same focus-in-once/focus-out-once rule as the cover dialog above, its own dialog, its own flag.
    const vacuumOpen = this._vacuumDialog !== null;
    if (vacuumOpen && !this._vacuumDialogWasOpen) {
      this.shadowRoot?.querySelector<HTMLButtonElement>(".fp-vacuum-dialog button.cancel")?.focus();
    } else if (!vacuumOpen && this._vacuumDialogWasOpen) {
      this.focus();
    }
    this._vacuumDialogWasOpen = vacuumOpen;

    // S10.4: same focus-in-once/focus-out-once rule as the two dialogs above, its own dialog, its own flag.
    const chooserOpen = this._chooserDialog !== null;
    if (chooserOpen && !this._chooserDialogWasOpen) {
      this.shadowRoot?.querySelector<HTMLButtonElement>(".fp-chooser-dialog button.cancel")?.focus();
    } else if (!chooserOpen && this._chooserDialogWasOpen) {
      this.focus();
    }
    this._chooserDialogWasOpen = chooserOpen;
    this._syncPopup();
  }

  /** Whether the 3D model is what the card draws: 3D is picked, its module is loaded, it has not failed, and there is a floor. */
  private _shows3d(): boolean {
    return this._viewPick() === "3d" && lib3d !== null && this._fallback3d === null && this._floor() !== null;
  }

  private _dispose3d(): void {
    this._view3d?.dispose();
    this._view3d = null;
    this._view3dFloor = null;
  }

  /** Brings the 3D view in line with what the card shows, after every render: loads the module on the first need, makes the
   * view once its container is on screen, and ends it when the pick moves away. It never throws; every failure is the
   * one line and the 2D plan. */
  private _sync3d(): void {
    const f = this._floor();
    if (this._viewPick() !== "3d" || !f) { this._dispose3d(); return; }
    if (this._fallback3d !== null) { this._dispose3d(); return; }
    if (!lib3d) {
      loadLib3d().then(() => this.requestUpdate(), () => { this._fallback3d = "3D view unavailable: its code did not load. Showing 2D."; this.requestUpdate(); });
      return;
    }
    const host = this.shadowRoot?.querySelector<HTMLElement>(".fp-3d") ?? null;
    if (!host) return;
    if (!this._view3d) {
      try {
        this._view3d = lib3d.createView3D(host, {
          turnDeg: this._rotate()?.deg ?? 0,
          deps: { scene: sceneDeps, live: liveDeps, texture: textureDeps.texture },
          onFail: (why, retry) => { this._retry3d = retry === true; this._fallback3d = `3D view unavailable: ${why}. Showing 2D.`; this._dispose3d(); this.requestUpdate(); },
        });
      } catch (err) {
        this._fallback3d = err instanceof lib3d.NoWebGL ? "3D view unavailable: this browser has no WebGL. Showing 2D." : "3D view unavailable: it could not start. Showing 2D.";
        this.requestUpdate();
        return;
      }
      this._view3dFloor = null;
    }
    // A theme change (or Home Assistant's dark mode) re-reads the colours; a new floor, or one the layout reload replaced, rebuilds the scene.
    this._view3d.setTheme(`${this._theme()}|${this._haDark()}`);
    this._view3d.setWalls(this._walls());
    const around = floorsAroundKey(this._layout!, this._floorKey()!), aroundKey = JSON.stringify(around);
    // Only the selected floor is drawn (3D fixes): the dimmed stack of lower floors drifted out of line, so it is gone.
    if (f !== this._view3dFloor || aroundKey !== this._view3dAround) {
      this._view3dFloor = f;
      this._view3dAround = aroundKey;
      this._view3d.setFloor(f, around);
    }
    // The live state, decided by the plan's own rules (core/live.ts); the view changes its parts in place, and does nothing when it is the same as the last.
    const now = Date.now();
    this._view3d.setLive(f, { scale: 1, state: this._stateForRender(), now, fade: this._config.fade, plugWatts: plugThreshold(this._config.plug_watts), plugHeat: this._plugHeat(), powerLinks: this._powerLinks(), roomGlow: this._config.room_glow, night: this._night(), labels: this._labels(), showNames: this._names(), around: floorsAroundKey(this._layout!, this._floorKey()!) }, now);
    this._view3d.setRing(this._picked());
    this._apply3dInset();
  }

  /** What the 3D view has under a pointer event, read once per event: the gesture code and the room tap both ask. */
  private _pick3d(e: PointerEvent): Pick3D | null {
    const c = this._pick3dCache;
    if (c && c.stamp === e.timeStamp && c.x === e.clientX && c.y === e.clientY) return c.pick;
    const pick = this._view3d?.pick(e.clientX, e.clientY) ?? null;
    this._pick3dCache = { stamp: e.timeStamp, x: e.clientX, y: e.clientY, pick };
    return pick;
  }

  /** S12.4: taps in 3D mean what they mean in 2D. A device, a door or window and an unlinked appliance go to the same
   *  gesture code as the plan's (`bindDeviceActions`, told what is under the pointer by a ray instead of the DOM):
   *  tap toggles, hold opens more-info, `NO_TOGGLE` types do not toggle. Any other tap picks the room under it, or clears.
   *  A drag (the view says so), a pinch and a double tap pick nothing; a double tap puts the pick back as it was. */
  private _bind3d(host: HTMLElement): () => void {
    const svgEl = (tag: string, attr: string, v: number): Element => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
      el.setAttribute(attr, String(v));
      return el;
    };
    const unbindGestures = bindDeviceActions(host, this, (i) => this._floor()?.devices[i], (i) => this._floor()?.doors[i], {
      longPress: !this._kiosk(),
      openVacuumDialog: (d) => this._openVacuumDialog(d),
      openChooser: (title, entities) => this._openChooserDialog(title, entities),
      openPopup: (t, at, from) => this._openPopup(t, at, from),
      getUnlinked: (i) => this._floor()?.unlinked[i],
      resolve: (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return null;
        const p = this._pick3d(e);
        return !p ? null : p.type === "device" ? svgEl("g", "data-x", p.index) : p.type === "door" ? svgEl("line", "data-d", p.index) : p.type === "unlinked" ? svgEl("g", "data-u", p.index) : null;
      },
    });
    let start: { x: number; y: number } | null = null, pointers = 0;
    let last: { t: number; x: number; y: number; before: { pick: { floor: string; id: string } | null; filter: boolean } } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.isPrimary) pointers = 0;
      pointers++;
      if (pointers > 1) { start = null; last = null; return; }
      start = e.pointerType === "mouse" && e.button !== 0 ? null : { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      pointers = Math.max(0, pointers - 1);
      const s = start;
      start = null;
      if (!s || this._view3d?.dragged !== false || Math.hypot(e.clientX - s.x, e.clientY - s.y) > TAP_SLOP_PX) { if (s && this._view3d?.dragged) this._closePopup(); last = null; return; }
      const p = this._pick3d({ clientX: s.x, clientY: s.y, timeStamp: -1 } as PointerEvent);
      if (p && (p.type === "device" || p.type === "door" || p.type === "unlinked")) { last = null; return; } // its own thing, never a pick
      this._closePopup(); // a tap on anything else is an outside tap
      const now = performance.now();
      if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_PX) {
        this._restorePick(last.before);
        last = null;
        return;
      }
      last = { t: now, x: e.clientX, y: e.clientY, before: { pick: this._pickedRoom, filter: this._roomFilter } };
      if (!this._activeListVisible()) return;
      const room = p?.type === "room" ? p.index : null;
      this._pickRoom(room !== null && this._picked() !== room ? room : null);
    };
    const onCancel = () => { pointers = 0; start = null; };
    // S14.2: hover (mouse only). The pointer's position is two numbers and the pick runs once a frame, whatever the pointer does in between.
    let hx = 0, hy = 0, hraf = 0;
    const hoverFrame = () => {
      hraf = 0;
      const p = this._view3d?.pick(hx, hy);
      const t = p && !this._popup ? (p.type === "device" ? this._targetOf("x", p.index) : p.type === "door" ? this._targetOf("d", p.index) : p.type === "unlinked" ? this._targetOf("u", p.index) : null) : null;
      if (t) this._showTip(t, hx, hy, null);
      else this._hideTip();
    };
    const onHoverMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) { this._hideTip(); return; }
      hx = e.clientX; hy = e.clientY;
      if (!hraf) hraf = requestAnimationFrame(hoverFrame);
    };
    const onHoverEnd = () => this._hideTip();
    host.addEventListener("pointermove", onHoverMove);
    host.addEventListener("pointerleave", onHoverEnd);
    host.addEventListener("pointerdown", onHoverEnd);
    host.addEventListener("wheel", onHoverEnd, { passive: true });
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onCancel);
    return () => {
      if (hraf) cancelAnimationFrame(hraf);
      host.removeEventListener("pointermove", onHoverMove);
      host.removeEventListener("pointerleave", onHoverEnd);
      host.removeEventListener("pointerdown", onHoverEnd);
      host.removeEventListener("wheel", onHoverEnd);
      this._hideTip();
      unbindGestures();
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onCancel);
    };
  }

  /** The Active list floats over the model. Where it covers the left or the right part of the 3D view, the camera frames the
   * house in the rest (S12.4). Costs a layout read, so it runs after a render and when the panel moves, not per frame. */
  private _apply3dInset(): void {
    const view = this._view3d, host = this.shadowRoot?.querySelector<HTMLElement>(".fp-3d");
    if (!view || !host) return;
    const panel = this.shadowRoot?.querySelector<HTMLElement>(".fp-active"), h = host.getBoundingClientRect();
    let left = 0, right = 0;
    // A folded list is a 36 px header: at phone width its box spans half the view, but it hides almost none of the house. Only an open one insets.
    if (panel && h.width > 0 && panel.querySelector(".fp-active-body")) {
      const p = panel.getBoundingClientRect();
      if (p.width > 0 && p.height > 0) {
        if (p.left + p.width / 2 < h.left + h.width / 2) left = Math.max(0, Math.min(1, (p.right - h.left) / h.width));
        else right = Math.max(0, Math.min(1, (h.right - p.left) / h.width));
      }
    }
    view.setInset(left, right);
  }

  /**
   * S2.7: opens the cover confirm dialog for `door`, unless one is already open — a second tap while the dialog
   * is shown (a door re-tapped, or another cover door tapped through the dialog's own backdrop) does not open a
   * second one or swap which door it acts on ("Break it" in the PLAN block).
   */
  private _openCoverDialog(door: Door): void {
    if (this._coverDialog || this._vacuumDialog || this._chooserDialog) return;
    this._coverDialog = door;
    this.requestUpdate();
  }

  private _closeCoverDialog(): void {
    this._coverDialog = null;
    this.requestUpdate();
  }

  /**
   * S7.10: opens the vacuum dialog for `d`, unless a dialog (this one or the cover one) is already open — the
   * same "ignore a second tap while open" rule as `_openCoverDialog`.
   */
  private _openVacuumDialog(d: Device): void {
    if (this._coverDialog || this._vacuumDialog || this._chooserDialog) return;
    this._vacuumDialog = d;
    this.requestUpdate();
  }

  private _closeVacuumDialog(): void {
    this._vacuumDialog = null;
    this.requestUpdate();
  }

  /**
   * S10.4: opens the chooser dialog listing `entities` under `title`, unless a dialog (any of the three) is
   * already open — the same "ignore a second tap while open" rule as `_openCoverDialog`/`_openVacuumDialog`.
   * `bindDeviceActions` only ever calls this with two or more entities (one opens more-info directly instead), but
   * this checks anyway rather than trusting that, so a future caller mistake shows an empty, if odd, dialog rather
   * than a crash.
   */
  private _openChooserDialog(title: string, entities: string[]): void {
    if (this._coverDialog || this._vacuumDialog || this._chooserDialog) return;
    this._chooserDialog = { title, entities };
    this.requestUpdate();
  }

  private _closeChooserDialog(): void {
    this._chooserDialog = null;
    this.requestUpdate();
  }

  // ---- S14.2: the tap popup and the hover tooltip ------------------------------------------------------------------------------------

  /** A pointer went down somewhere: a popup closes unless the press was in it or on something that decides for itself (an icon, a door, an Active row, the 3D view: those open, swap or close it on their own tap). */
  private _onOutsideDown = (e: Event): void => {
    if (!this._popup) return;
    for (const n of e.composedPath()) {
      if (n instanceof Element && (n.classList.contains("fp-pop") || n.classList.contains("fp-3d") || n.matches("g[data-x], button[data-x], line[data-d], g[data-u], [data-pop]"))) return;
    }
    this._closePopup();
  };

  /** What index `i` of the shown floor is, as the gesture code names it. */
  private _targetOf(kind: "x" | "d" | "u", i: number): TapTarget | null {
    const f = this._floor();
    if (!f || !Number.isFinite(i)) return null;
    if (kind === "x") { const device = f.devices[i]; return device ? { device, index: i } : null; }
    if (kind === "d") { const door = f.doors[i]; return door ? { door, index: i } : null; }
    const unlinked = f.unlinked?.[i];
    return unlinked ? { unlinked, index: i } : null;
  }

  private _deviceSubject(d: Device, name?: string): PopupSubject {
    const friendly = this._hass?.states[d.entity]?.attributes?.friendly_name;
    return {
      key: `d:${d.entity || d.id}`, type: d.type, entity: d.entity || undefined, entities: entitiesOfDevice(d),
      name: name || d.name || (typeof friendly === "string" && friendly) || d.entity || d.id,
      powerEntity: d.power || (d.type === "plug" ? this._powerLinks()?.[d.entity] : undefined),
    };
  }

  /** The popup's (and the tooltip's) subject for a tap target; null when there is nothing to say or do. */
  private _subjectOf(t: TapTarget): PopupSubject | null {
    if ("device" in t) return this._deviceSubject(t.device);
    if ("door" in t) {
      const door = t.door, entities = entitiesOfDoor(door);
      return door.cover || entities.length ? { key: `o:${door.id}`, name: door.name, type: "door", entities, ...(door.cover ? { door } : {}) } : null;
    }
    const u = t.unlinked, entities = entitiesOfDevice(u);
    return { key: `u:${u.id}`, name: u.name ?? u.id, type: u.type, entities };
  }

  /** The one state line: the popup and the tooltip both print this. A door says its cover's state, else its first entity's. */
  private _subjectText(s: PopupSubject): string {
    const states = this._hass?.states, e = s.door?.cover || (s.door ? s.entities[0] : s.entity);
    if (!e) return "";
    const w = s.powerEntity ? wattsOf(states?.[s.powerEntity]) : null;
    return stateText(s.type, states?.[e], w === null ? undefined : `${Math.round(w * 10) / 10} W`);
  }

  private _tapActiveRow(it: ActiveDevice, e: MouseEvent): void {
    const d = this._layout?.floors[it.floor]?.devices.find((x) => x.entity === it.entity);
    const row = e.currentTarget as Element, b = row.getBoundingClientRect();
    const s = d ? this._deviceSubject(d, it.name) : { key: `d:${it.entity}`, name: it.name, type: it.type, entity: it.entity, entities: [it.entity] };
    this._openSubject(s, e.detail > 0 ? { x: e.clientX, y: e.clientY } : { x: b.left + b.width / 2, y: b.bottom }, row);
  }

  private _openPopup(t: TapTarget, at: { x: number; y: number }, from: Element | null): void {
    const s = this._subjectOf(t);
    if (s) this._openSubject(s, at, from);
  }

  /** Opens the popup, swaps it for another subject's, or closes it when the same subject is tapped again. Nothing is operated here. */
  private _openSubject(s: PopupSubject, at: { x: number; y: number }, from: Element | null): void {
    if (this._coverDialog || this._vacuumDialog || this._chooserDialog) return;
    this._hideTip();
    if (this._popup?.s.key === s.key) { this._closePopup(); return; }
    this._popup = { s, x: at.x, y: at.y, opener: from, confirming: false, draft: null };
    this.requestUpdate();
  }

  private _closePopup(): void {
    if (!this._popup) return;
    this._popupReturn = this._popup.opener;
    this._popup = null;
    this.requestUpdate();
  }

  private _levelOf(kind: SliderKind, a: Record<string, unknown> | undefined): number | null {
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    if (kind === "b") { const b = n(a?.brightness); return b === null ? null : Math.max(1, Math.min(100, Math.round((b / 255) * 100))); }
    if (kind === "t") return n(a?.color_temp_kelvin);
    const hs = a?.hs_color;
    const h = Array.isArray(hs) ? n(hs[0]) : null;
    return h === null ? null : Math.round(h);
  }

  private _popupOp(s: PopupSubject): PopupOp | null {
    return s.door ? null : popupOp(s.type, s.entity, this._hass?.states[s.entity ?? ""]?.state);
  }

  private _popupTemplate() {
    const p = this._popup;
    if (!p) return null;
    const s = p.s, st = this._hass?.states[s.entity ?? ""], op = this._popupOp(s);
    const light = op !== null && s.entity?.startsWith("light.") && st?.state !== "off" ? true : op !== null && s.entity?.startsWith("light.");
    const caps = light ? lightCaps(st?.attributes) : null;
    const level = (k: SliderKind) => {
      const now = this._levelOf(k, st?.attributes);
      return p.draft && p.draft.kind === k && p.draft.from === now ? p.draft.value : now;
    };
    return popupTemplate({
      subject: s, text: this._subjectText(s), op, confirming: p.confirming, caps,
      doorLabel: s.door?.cover ? (this._coverService(s.door) === "close_cover" ? "Close" : "Open") : null,
      level: { b: caps?.brightness ? level("b") : null, t: caps?.temp ? level("t") : null, h: caps?.hue ? level("h") : null },
      act: () => this._popupAct(),
      cancel: () => { if (this._popup) { this._popup.confirming = false; this.requestUpdate(); } },
      more: () => this._popupMore(),
      key: (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this._closePopup(); } },
      slide: (kind, value, commit) => this._popupSlide(kind, value, commit),
    });
  }

  /** The popup's one button. A cover door's opens the card's confirm dialog; a turn OFF (not a light's) first turns the button into its confirm; anything else is one service call. */
  private _popupAct(): void {
    const p = this._popup;
    if (!p) return;
    if (p.s.door?.cover) {
      const door = p.s.door;
      this._closePopup();
      this._openCoverDialog(door);
      return;
    }
    const op = this._popupOp(p.s);
    if (!op || !p.s.entity) return;
    if (op.confirm && !p.confirming) { p.confirming = true; this.requestUpdate(); return; }
    this._hass?.callService?.(op.domain, op.service, { entity_id: p.s.entity });
    this._closePopup();
  }

  private _popupMore(): void {
    const p = this._popup;
    if (!p) return;
    this._closePopup();
    if (p.s.entities.length > 1) this._openChooserDialog(p.s.name, p.s.entities);
    else if (p.s.entities.length === 1) fireEvent(this, "hass-more-info", { entityId: p.s.entities[0]! });
  }

  /** A slider moving only changes the number shown; its release (`change`) is the one `light.turn_on`, so dragging never floods Home Assistant. */
  private _popupSlide(kind: SliderKind, value: number, commit: boolean): void {
    const p = this._popup, entity = p?.s.entity;
    if (!p || !entity || !Number.isFinite(value)) return;
    const a = this._hass?.states[entity]?.attributes;
    p.draft = { kind, value, from: this._levelOf(kind, a) };
    if (commit) {
      const hs = a?.hs_color, sat = Array.isArray(hs) && typeof hs[1] === "number" && Number.isFinite(hs[1]) ? hs[1] : 100;
      const data = kind === "b" ? { brightness_pct: value } : kind === "t" ? { color_temp_kelvin: value } : { hs_color: [value, sat] };
      this._hass?.callService?.("light", "turn_on", { entity_id: entity, ...data });
    }
    this.requestUpdate();
  }

  /** After every render: the popup sits near where it was tapped, inside the card; focus goes to its button when it opens and back to what opened it when it closes. */
  private _syncPopup(): void {
    const key = this._popup?.s.key ?? null, el = this.shadowRoot?.querySelector<HTMLElement>(".fp-pop") ?? null;
    if (this._popup && el) {
      const o = this._popup.opener;
      placeNear(el, this, this._popup.x, this._popup.y, 14, o?.isConnected && o.matches(".fp-active-row") ? o.getBoundingClientRect() : null);
    }
    if (key === this._popupFocusKey) return;
    this._popupFocusKey = key;
    if (key && el) (el.querySelector<HTMLElement>(".fp-pop-do") ?? el.querySelector<HTMLElement>(".fp-pop-more"))?.focus({ preventScroll: true });
    else if (!key) {
      if (this._coverDialog || this._vacuumDialog || this._chooserDialog) { this._popupReturn = null; return; } // the dialog took focus; it hands it back itself
      const back = this._popupReturn as HTMLElement | null;
      this._popupReturn = null;
      (back?.isConnected ? back : this).focus({ preventScroll: true });
    }
  }

  /** Hover on the plan (mouse only; a finger has the popup). The tooltip follows the pointer over an icon, a door or an appliance and goes when it leaves, is pressed or the page scrolls. */
  private _bindHover(svg: Element): () => void {
    const move = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType !== "mouse" || pe.buttons || this._popup) { this._hideTip(); return; }
      const el = (pe.target as Element | null)?.closest?.("g[data-x], line[data-d], g[data-u]");
      const kind = el?.hasAttribute("data-x") ? "x" : el?.hasAttribute("data-d") ? "d" : "u";
      const t = el ? this._targetOf(kind, Number(el.getAttribute(`data-${kind}`))) : null;
      if (t && el) this._showTip(t, pe.clientX, pe.clientY, el);
      else this._hideTip();
    };
    const hide = () => this._hideTip();
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("pointerdown", hide);
    return () => {
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerleave", hide);
      svg.removeEventListener("pointerdown", hide);
      this._hideTip();
    };
  }

  /** Shows (or moves) the tooltip for `t` at the client point (x, y). The text is worked out when the target changes, not on every move. `el` is the plan's element, which gets `aria-describedby`. */
  private _showTip(t: TapTarget, x: number, y: number, el: Element | null): void {
    const tip = this.shadowRoot?.querySelector<HTMLElement>(".fp-tip");
    const s = tip ? this._subjectOf(t) : null;
    if (!tip || !s) { this._hideTip(); return; }
    if (s.key !== this._tipKey) {
      this._hideTip();
      (tip.firstElementChild as HTMLElement).textContent = s.name;
      (tip.lastElementChild as HTMLElement).textContent = this._subjectText(s);
      tip.hidden = false;
      this._tipKey = s.key;
      this._tipHost = this.getBoundingClientRect();
      if (el) {
        el.setAttribute("aria-describedby", "fp-tip");
        const title = el.querySelector(":scope > title"); // the browser's own tooltip would sit beside ours
        if (title) { el.removeChild(title); this._tipTitle = { el, title }; }
        this._tipEl = el;
      }
    }
    const h = this._tipHost!, w = tip.offsetWidth, ht = tip.offsetHeight;
    const left = Math.max(4, Math.min(h.width - w - 4, x - h.left + 12));
    const below = y - h.top + 18;
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(below + ht > h.height - 4 ? Math.max(4, y - h.top - ht - 10) : below)}px)`;
  }

  private _hideTip = (): void => {
    if (this._tipKey === null) return;
    this._tipKey = null;
    const tip = this.shadowRoot?.querySelector<HTMLElement>(".fp-tip");
    if (tip) tip.hidden = true;
    this._tipEl?.removeAttribute("aria-describedby");
    this._tipEl = null;
    const t = this._tipTitle;
    this._tipTitle = null;
    if (t?.el.isConnected && !t.el.querySelector(":scope > title")) t.el.prepend(t.title);
  };

  /** The chooser's own row label: HA's `friendly_name` when the entity has state, else the plan id itself — same
   *  fallback order `active.ts`'s `nameFor` already uses for a device row, so the two never disagree about what an
   *  entity is called. Untrusted state (finding 1): anything that is not text is skipped. */
  private _chooserEntityName(entityId: string): string {
    const friendly = this._hass?.states[entityId]?.attributes?.friendly_name;
    if (typeof friendly === "string" && friendly) return friendly;
    // Review fix: the plan's own catalog name before the bare id, the order the S10.4 brief asked for.
    const cat = Array.isArray(this._layout?.catalog) ? this._layout!.catalog.find((c) => c?.entity === entityId)?.name : undefined;
    return typeof cat === "string" && cat ? cat : entityId;
  }

  /** The row's live state, with its unit when HA gives one; empty when HA has no state for it. Untrusted: only text. */
  private _chooserEntityState(entityId: string): string {
    const st = this._hass?.states[entityId];
    if (!st || typeof st.state !== "string") return "";
    const unit = st.attributes?.unit_of_measurement;
    return typeof unit === "string" && unit ? `${st.state} ${unit}` : st.state;
  }

  private _pickChooserEntity(entityId: string): void {
    this._closeChooserDialog();
    fireEvent(this, "hass-more-info", { entityId });
  }

  /** S7.10: Break it — `unavailable`/`unknown` (or no state at all) disables the three action buttons; Cancel
   *  always stays enabled, so the dialog can still be dismissed. */
  private _vacuumDisabled(): boolean {
    const d = this._vacuumDialog;
    if (!d) return true;
    const s = this._hass?.states[d.entity]?.state;
    return !s || s === "unavailable" || s === "unknown";
  }

  private _vacuumAction(service: "start" | "pause" | "return_to_base"): void {
    const d = this._vacuumDialog;
    if (d) this._hass?.callService?.("vacuum", service, { entity_id: d.entity });
    this._closeVacuumDialog();
  }

  /** The one place that reads a cover's live state and decides what pressing the button does — the dialog's text
   * (`_coverDialogTemplate`) and the actual service call (`_confirmCoverDialog`) both call this, so they can never
   * disagree (Opus review of S2.7: a dialog that says "Open" while its button closes is worse than no dialog, since
   * the person has been trained to trust the words). Read fresh every time, not cached when the dialog opened, so a
   * cover that changes state while the dialog is up (another user, an automation) re-renders with the matching
   * label before anyone can press anything stale — `hass`'s setter already calls `requestUpdate()` on every change,
   * and `_confirmCoverDialog` reads this same expression again at the moment of the click, so label and action are
   * always the same read, never two. A cover missing from `hass.states`, or `unknown`/`unavailable`/`opening`/
   * `closing`, is anything other than `"open"`, so it opens rather than closes — docs/DECISIONS.md has why. */
  private _coverService(door: Door): "open_cover" | "close_cover" {
    return this._hass?.states[door.cover ?? ""]?.state === "open" ? "close_cover" : "open_cover";
  }

  private _confirmCoverDialog(): void {
    const door = this._coverDialog;
    if (door?.cover) this._hass?.callService?.("cover", this._coverService(door), { entity_id: door.cover });
    this._closeCoverDialog();
  }

  /** Escape cancels; Tab/Shift+Tab cycle only between the open dialog's own buttons, so focus never escapes it into
   * the rest of the card while it is open. Shared by the cover dialog (two buttons), the vacuum dialog (four) and
   * the S10.4 chooser (its entity rows plus Cancel) — `_openCoverDialog`/`_openVacuumDialog`/`_openChooserDialog`
   * never let more than one be open at once, so exactly one dialog's buttons are ever on the page and this reads
   * them generically rather than picking a dialog by name. */
  private _onDialogKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (this._vacuumDialog) this._closeVacuumDialog();
      else if (this._chooserDialog) this._closeChooserDialog();
      else this._closeCoverDialog();
      return;
    }
    if (e.key !== "Tab") return;
    const root = this.shadowRoot;
    const buttons = root ? [...root.querySelectorAll<HTMLButtonElement>(".fp-dialog-actions button, .fp-chooser-list button")] : [];
    if (buttons.length < 2) return;
    const first = buttons[0]!, last = buttons[buttons.length - 1]!;
    const active = root?.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  /** S2.6/S6.5: `_floorList()`'s chips, one per switchable floor in its order, or `null` for anything else. Card
   * chrome (like the no-layout message): drawn outside the `<svg>` renderFloor returns, never inside the plan it
   * draws (CLAUDE.md finding 8, one draw path — the plan is drawn only by `renderFloor`, this is the card's own
   * DOM around it). */
  private _floorChips() {
    if (this._kiosk()) return null; // S7.5: no switcher in kiosk mode, even with floors or floor: "all" configured
    const list = this._floorList();
    if (!list) return null;
    const current = this._floorKey();
    return html`<div class="fp-floors">
      ${list.map(
        ([key, fl]) => html`<button type="button" aria-pressed=${key === current ? "true" : "false"} @click=${() => this._selectFloor(key)}>${fl.title || key}</button>`,
      )}
    </div>`;
  }

  /** S9.5: hidden under `kiosk` (a wall tablet shows only the plan) and under `active_list: false`. Untrusted
   *  config: anything other than the literal `false` counts as the default, shown. */
  private _activeListVisible(): boolean {
    return this._config.active_list !== false && !this._kiosk();
  }

  private _toggleActiveCollapsed(): void {
    this._activeCollapsed = !this._activeCollapsed;
    this._activeUserChose = true;
    this._saveActiveState();
    this.requestUpdate();
  }

  /** The toolbar is anchored top right and the floor chips top left, both over the plan. When the toolbar is wide
   * enough to reach the chips (a wrapped one always is: it fills the card's width), the chips, which sit above it,
   * would cover its first controls and the View select could not be clicked. It then moves down to just below the
   * chips. Measured, not guessed: the toolbar's width depends on the config, the view and the theme's fonts. */
  private _positionToolbar(): void {
    const root = this.shadowRoot;
    const bar = root?.querySelector<HTMLElement>(".fp-zoom, .fp-viewonly");
    const stack = root?.querySelector<HTMLElement>(".fp-stack");
    const chips = root?.querySelector<HTMLElement>(".fp-floors");
    const belowChips = chips ? chips.offsetTop + chips.offsetHeight + 6 : 8;
    if (bar) bar.style.top = "";
    if (stack) { stack.style.top = ""; stack.classList.remove("fp-stack-row"); }
    if (bar && chips && bar.getBoundingClientRect().left < chips.getBoundingClientRect().right + 6) bar.style.top = `${belowChips}px`;
    if (!stack) return;
    // The stack hangs under the toolbar, wherever the toolbar ended up; with no toolbar it keeps the CSS default.
    if (bar) stack.style.top = `${bar.offsetTop + bar.offsetHeight + 4}px`;
    // A card too short for the column (a ~200 px wide one, where the toolbar already takes most of the height):
    // the stack lays out as a wrapping row under the chips and the toolbar moves below it. Zoom and rotate stay
    // reachable; the toolbar's last row is what the card clips.
    if (stack.offsetTop + stack.offsetHeight > this.clientHeight - 4) {
      stack.classList.add("fp-stack-row");
      stack.style.top = `${belowChips}px`;
      if (bar) bar.style.top = `${stack.offsetTop + stack.offsetHeight + 4}px`;
    }
  }

  /** Opus review findings 3/4: sets the panel's on-screen position directly (bypassing Lit's template, which does
   * not bind `style` any more — see `_activePanel` — so this survives an unrelated re-render), from `_activePos`'s
   * fraction and the *current* card/panel geometry. Called from `updated()` on every render and from the
   * ResizeObserver on a host resize, so a stored fraction always lands inside the card, whatever changed since it
   * was saved: a narrower viewport, a taller panel after expanding from collapsed, or nothing at all. With
   * `_activePos` still `null` (never dragged) this clears any inline position, leaving the CSS default in place. */
  private _positionActivePanel(): void {
    this._positionActivePanelNow();
    this._apply3dInset();
  }

  private _positionActivePanelNow(): void {
    const panel = this.shadowRoot?.querySelector<HTMLElement>(".fp-active");
    if (!panel) return;
    if (!this._activePos) {
      panel.style.left = "";
      // The CSS default sits under a one-row toolbar. On a narrow card the toolbar wraps to more rows and would
      // cover the panel's fold button, so the default moves down to just below it.
      const bar = this.shadowRoot?.querySelector<HTMLElement>(".fp-zoom, .fp-viewonly");
      const below = bar ? bar.offsetTop + bar.offsetHeight + 8 : 0; // 44 px for a one-row bar at the top, the CSS default
      let top = below > 44 ? below : 0;
      // The stack is on the right, the list on the left: they meet only on a very narrow card. Then the list goes
      // under the stack, as it goes under the toolbar.
      const stack = this.shadowRoot?.querySelector<HTMLElement>(".fp-stack");
      if (stack && panel.offsetLeft + panel.offsetWidth + 6 > stack.offsetLeft) top = Math.max(top, stack.offsetTop + stack.offsetHeight + 8);
      panel.style.top = top ? `${top}px` : "";
      return;
    }
    const hostRect = this.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const maxX = Math.max(0, hostRect.width - panelRect.width);
    const maxY = Math.max(0, hostRect.height - panelRect.height);
    panel.style.left = `${this._activePos.x * maxX}px`;
    panel.style.top = `${this._activePos.y * maxY}px`;
  }

  /** The list floats over the plan, so on a phone-width card it hides the plan: until the user has chosen, it is
   * folded under 480px and open from there up. Runs from `updated()` and the ResizeObserver; width 0 (detached,
   * `display:none`, not laid out yet) decides nothing. */
  private _applyWidthDefault(): void {
    if (this._activeUserChose) return;
    const width = this.getBoundingClientRect().width;
    if (width === 0) return;
    const narrow = width < ACTIVE_FOLD_BELOW_PX;
    if (narrow === this._activeCollapsed) return;
    this._activeCollapsed = narrow;
    this.requestUpdate();
  }

  /**
   * S9.5: drags the panel by its header, pointer-capture based like `_bindZoom`'s pan above, but clamped inside
   * the card's own box on every move so the panel can never end up partly or wholly off-screen (the spec's own
   * words). A press on the collapse button itself is left alone — `closest` finds it and this returns before
   * `setPointerCapture`, so the button's own click still fires instead of being swallowed by a "drag" that never
   * actually moved the panel. Below `TAP_SLOP_PX` of movement nothing is written, so a plain click on the header
   * bar (not a button) cannot be mistaken for a drag and does not touch the saved position.
   */
  private _onActiveDragStart(e: PointerEvent): void {
    if ((e.target as Element | null)?.closest?.("button")) return;
    const head = e.currentTarget as HTMLElement;
    const panel = head.closest(".fp-active") as HTMLElement | null;
    if (!panel) return;
    e.preventDefault();
    const hostRect = this.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const originLeft = panelRect.left - hostRect.left;
    const originTop = panelRect.top - hostRect.top;
    const startX = e.clientX, startY = e.clientY;
    const pointerId = e.pointerId;
    let moved = false;
    try { head.setPointerCapture(pointerId); } catch { /* the pointer is already gone */ }

    // Opus review findings 3/4: the drag itself still clamps in px against the geometry captured at drag-start
    // (nothing else can resize mid-drag), but the *stored* position is the resulting fraction of that geometry's
    // free width/height, not the px itself — `_positionActivePanel` is what turns it back into px, against
    // whatever the geometry is by the time it runs.
    const maxX = Math.max(0, hostRect.width - panelRect.width);
    const maxY = Math.max(0, hostRect.height - panelRect.height);
    const clampFraction = (x: number, y: number) => ({
      x: maxX > 0 ? Math.min(Math.max(0, x), maxX) / maxX : 0,
      y: maxY > 0 ? Math.min(Math.max(0, y), maxY) / maxY : 0,
    });

    const onMove = (me: PointerEvent) => {
      if (me.pointerId !== pointerId) return;
      const dx = me.clientX - startX, dy = me.clientY - startY;
      if (!moved && Math.hypot(dx, dy) <= TAP_SLOP_PX) return;
      moved = true;
      this._activePos = clampFraction(originLeft + dx, originTop + dy);
      this._positionActivePanel();
    };
    const onEnd = (ue: PointerEvent) => {
      if (ue.pointerId !== pointerId) return;
      head.removeEventListener("pointermove", onMove);
      head.removeEventListener("pointerup", onEnd);
      head.removeEventListener("pointercancel", onEnd);
      if (moved) this._saveActiveState();
    };
    head.addEventListener("pointermove", onMove);
    head.addEventListener("pointerup", onEnd);
    head.addEventListener("pointercancel", onEnd);
  }

  /** S11.3: the index of the picked room on the shown floor, or null: none picked, a room of another floor, or one the
   *  layout no longer has (a reload keeps the id, so it survives an edit that moves the index). */
  private _picked(): number | null {
    const p = this._pickedRoom, f = this._floor();
    if (!p || !f || this._floorKey() !== p.floor) return null;
    const i = f.rooms.findIndex((r) => r.id === p.id);
    return i < 0 ? null : i;
  }

  /** Picks the room at floor index `i` of the shown floor, or clears with `null`. A new pick turns the filter back on. */
  private _pickRoom(i: number | null): void {
    const room = i === null ? undefined : this._floor()?.rooms[i];
    const key = this._floorKey();
    this._pickedRoom = room && key ? { floor: key, id: room.id } : null;
    this._roomFilter = true;
    this.requestUpdate();
  }

  /** S11.3: a tap that landed on no device, door or appliance. It picks the room under the finger: the first room polygon
   *  of everything stacked at that point (`elementsFromPoint`), so the room's name, its readout and its furniture count as
   *  its floor, on a turned plan and in 2.5D too. A zone or a structure lies over a room rather than being one, so it is
   *  looked through; a device's pin or stem is not (it is the device's, and a device never picks). The same room again, anything else, or a hatched fill clears. Only with the panel on: kiosk and
   *  `active_list: false` have nowhere to show a room. */
  private _tapRoom(e: PointerEvent): void {
    if (!this._activeListVisible()) return;
    const rooms = this._floor()?.rooms ?? [];
    const root = this.shadowRoot;
    // jsdom has no elementsFromPoint: the event's own target stands in, as it did before.
    const stack = root && typeof root.elementsFromPoint === "function" ? root.elementsFromPoint(e.clientX, e.clientY) : [e.target as Element | null];
    let i = -1;
    for (const n of stack) {
      const hit = n?.closest?.("polygon[data-r]");
      if (hit) {
        const k = Number(hit.getAttribute("data-r")), kind = rooms[k]?.kind;
        if (kind === "zone" || kind === "structure" || kind === "fill") continue; // not rooms: look through to the room below
        i = k;
        break;
      }
      // A room's own name (data-rl), its readout (data-rv) and its furniture are its floor. Anything else on top (a device's
      // value or name, a structure line's name, a wall) is its own thing: no pick.
      if (!n?.closest?.("text[data-rl], text[data-rv], g.furn")) break;
    }
    const room = rooms[i];
    this._pickRoom(room && this._picked() !== i ? i : null);
  }

  /** What a double tap restores: the pick as it was before its first tap, which `_tapRoom` already changed. */
  private _restorePick(before: { pick: { floor: string; id: string } | null; filter: boolean }): void {
    this._pickedRoom = before.pick;
    this._roomFilter = before.filter;
    this.requestUpdate();
  }

  private _toggleInfo(entity: string): void {
    if (!this._infoOpen.delete(entity)) this._infoOpen.add(entity);
    this.requestUpdate();
  }

  /** S11.4: the chevron that opens a row's details. A sibling of the row's own button, never inside it, so a press on it
   *  is never a tap on the row (no toggle, no more-info). */
  private _infoButton(name: string, entity: string) {
    const open = this._infoOpen.has(entity);
    return html`<button type="button" class="fp-info-btn" aria-label="Details for ${name}" aria-expanded=${open ? "true" : "false"} @click=${() => this._toggleInfo(entity)}>${open ? "▾" : "▸"}</button>`;
  }

  /** The details under an open row: what Home Assistant's registries know (`deviceInfo`, `src/core/room-info.ts`). Values
   *  go through lit's text bindings, which escape them (CLAUDE.md finding 2): a manufacturer named `"><script>` is text. */
  private _infoBlock(entity: string) {
    if (!this._infoOpen.has(entity)) return nothing;
    const rows = deviceInfo(entity, { ...this._hass, states: this._stateForRender() });
    return html`<dl class="fp-info">${rows.map((r) => html`<div><dt>${r.label}</dt><dd>${r.value}</dd></div>`)}</dl>`;
  }

  /** A keyboard press on a toggling row does what a tap on its icon does (S14.2): it opens the popup, anchored on the row. Nothing is operated by the press itself. */
  private _keyToggle(r: RoomDeviceRow, row: Element | null): void {
    const d = this._floor()?.devices[r.index];
    const b = row?.getBoundingClientRect();
    if (d) this._openPopup({ device: d, index: r.index }, { x: b ? b.left + b.width / 2 : 0, y: b ? b.bottom : 0 }, row);
  }

  /** A row of the room section's device list. A toggling type (`ROOM_ROW_TAP`) carries `data-x`, so the panel's own
   *  `bindDeviceActions` gives it tap = toggle and hold = more-info, exactly as on the plan; its `click` only acts for a
   *  keyboard press (`detail` 0), which sends no pointer events. Every other type is a plain more-info button. */
  private _roomDeviceRow(r: RoomDeviceRow) {
    const toggles = ROOM_ROW_TAP[r.type] === "toggle";
    const click = (e: MouseEvent) => {
      if (!toggles) fireEvent(this, "hass-more-info", { entityId: r.entity });
      else if (e.detail === 0) this._keyToggle(r, e.currentTarget as Element);
    };
    return html`<div class="fp-item">
      <button type="button" class=${r.on ? "fp-active-row" : "fp-active-row fp-off"} data-x=${toggles ? String(r.index) : nothing} style="--fp-active-row-color:var(${r.colorVar})" @click=${click}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${DEVICE_ICONS[r.type]}></path></svg>
        <span>${r.name}</span><span class="fp-row-state">${r.state}</span>
      </button>
      ${this._infoButton(r.name, r.entity)}${this._infoBlock(r.entity)}
    </div>`;
  }

  /** A sensor the room owns that has no icon on the plan: listed by its friendly name (or entity id), a plain more-info row. */
  private _roomSensorRow(r: RoomSensorRow) {
    const type = r.kind === "temps" ? "temp" : r.kind;
    return html`<div class="fp-item">
      <button type="button" class=${r.state === "on" ? "fp-active-row" : "fp-active-row fp-off"} style="--fp-active-row-color:var(${r.state === "on" ? "--fp-dev-motion" : "--fp-ink"})" @click=${() => fireEvent(this, "hass-more-info", { entityId: r.entity })}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${DEVICE_ICONS[type]}></path></svg>
        <span>${r.name}</span><span class="fp-row-state">${r.state}</span>
      </button>
      ${this._infoButton(r.name, r.entity)}${this._infoBlock(r.entity)}
    </div>`;
  }

  /** S11.3: the room section: name, the facts the plan only hints at, and the room's devices as rows that act. A fact with
   *  nothing behind it (no sensor, no state) is left out, never printed empty; doors and lights always say "none". */
  private _roomSection(s: RoomSummary) {
    const facts: [string, string][] = [
      ["Area", s.areaM2 === null ? "" : `${s.areaM2} m²`],
      ["Temperature", s.temperature],
      ["Humidity", s.humidity],
      ["Motion", s.motion ? `${s.motion.on ? "on" : "off"} since ${formatChanged(s.motion.since)}` : ""],
      ["Open doors and windows", s.openings.join(", ") || "none"],
      ["Lights on", s.lightsOn.join(", ") || "none"],
    ];
    return html`<div class="fp-room">
      <div class="fp-room-head">
        <span class="fp-room-name">${s.name || "Unnamed room"}</span>
        <button type="button" class="fp-room-clear" aria-label="Clear the room selection" @click=${() => this._pickRoom(null)}>×</button>
      </div>
      <dl class="fp-room-facts">${facts.filter(([, v]) => v).map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      <div class="fp-active-group-label">Devices</div>
      <div class="fp-room-devices">
        ${s.devices.length || s.sensors.length
          ? groupByCategory([...s.devices.map((r) => ({ type: r.type, tpl: this._roomDeviceRow(r) })), ...s.sensors.map((r) => ({ type: (r.kind === "temps" ? "temp" : r.kind) as DeviceType, tpl: this._roomSensorRow(r) }))])
              .map((g) => this._catGroup("r", g.id, g.label, g.items.length, g.items.map((i) => i.tpl)))
          : html`<p class="fp-active-empty">No devices in this room</p>`}
      </div>
    </div>`;
  }

  /** S9.5: the floating panel of every active device across every floor (`activeDevices`/`groupActiveByType`,
   *  `src/core/active.ts` — the one place that decides "active", reused here rather than repeated). Card chrome,
   *  positioned outside the `<svg>` like `_floorChips`/`_viewStack` (CLAUDE.md finding 8): nothing here is part
   *  of the plan `renderFloor` draws, so it never steals a hit-test from a device or door under it.
   *
   *  S11.3: with a room picked, a room section comes first and the list below is cut to that room's entities
   *  (`filterToRoom`) until "Show all". The panel stays open while a room is picked, even folded by default on a
   *  narrow card: the person just asked for it. */
  private _activePanel() {
    if (!this._activeListVisible() || !this._layout) return null;
    const state = this._stateForRender();
    const opts = { plugWatts: plugThreshold(this._config.plug_watts), powerLinks: this._powerLinks() };
    const at = this._picked(), floor = this._floor();
    const summary = at !== null && floor ? roomSummary(floor, at, state, opts) : null;
    let items = activeDevices(this._layout, state, opts);
    if (summary && this._roomFilter) items = filterToRoom(items, summary);
    const groups = groupByCategory(items);
    const count = items.length;
    const row = (it: ActiveDevice) => html`<div class="fp-item"><button
      type="button"
      class="fp-active-row"
      data-pop
      style="--fp-active-row-color:var(${it.colorVar})"
      @click=${(e: MouseEvent) => this._tapActiveRow(it, e)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${DEVICE_ICONS[it.type]}></path></svg>
      <span>${it.name}</span>
    </button>${this._infoButton(it.name, it.entity)}${this._infoBlock(it.entity)}</div>`;
    const list = groups.length
      ? groups.map((g) => this._catGroup("a", g.id, g.label, g.items.length, g.items.map(row)))
      : html`<p class="fp-active-empty">${summary && this._roomFilter ? "Nothing on in this room" : "Nothing on"}</p>`;
    const folded = this._activeCollapsed && !summary;
    // No `style=` binding here on purpose (Opus review findings 3/4): Lit would rewrite the whole `style`
    // attribute on every render, wiping out the position `_positionActivePanel` sets imperatively after render —
    // that function is the only thing that ever touches this element's inline position.
    return html`<div class=${summary ? "fp-active fp-room-open" : "fp-active"} role="region" aria-label=${summary ? summary.name || "Unnamed room" : "Active devices"}>
      <div class="fp-active-head" @pointerdown=${(e: PointerEvent) => this._onActiveDragStart(e)}>
        <span class="fp-active-title">Active</span>
        <span class="fp-active-count">${count}</span>
        ${summary
          ? nothing
          : html`<button
          type="button"
          class="fp-active-collapse"
          aria-label=${this._activeCollapsed ? "Expand the active devices list" : "Collapse the active devices list"}
          aria-expanded=${this._activeCollapsed ? "false" : "true"}
          @click=${() => this._toggleActiveCollapsed()}
        >${this._activeCollapsed ? "▸" : "▾"}</button>`}
      </div>
      ${folded
        ? null
        : html`<div class="fp-active-body">
            ${summary
              ? html`${this._roomSection(summary)}
                <div class="fp-filter"><span>${this._roomFilter ? "Active in this room" : "Active everywhere"}</span><button type="button" class="fp-show-all" @click=${() => { this._roomFilter = !this._roomFilter; this.requestUpdate(); }}>${this._roomFilter ? "Show all" : "This room only"}</button></div>
                <div class="fp-filtered">${list}</div>`
              : list}
          </div>`}
    </div>`;
  }

  /** S7.6: whether the plan is drawn at night. `on`/`off` force it; anything else is `auto`: the sun entity (config
   * `sun`, default `sun.sun`) is `below_horizon`, or `on` for a binary sensor. Missing or `unavailable` is day. */
  private _night(): boolean {
    const mode = this._config.night;
    if (mode === "on") return true;
    if (mode === "off") return false;
    const id = typeof this._config.sun === "string" && this._config.sun ? this._config.sun : "sun.sun";
    const s = this._hass?.states?.[id]?.state;
    return s === "below_horizon" || s === "on";
  }

  protected render() {
    const f = this._floor();
    if (!f) return html`<p class="msg">${this._error ?? NO_LAYOUT}</p>`;
    const rotate = this._rotate();
    const view = this._planView();
    const fit = viewBoxFor(f, 60, rotate, view, this._tilt());
    this._fit = fit;
    const turn = this._turn;
    const zoom = this._zoomMode() !== false;
    const showZoomButtons = zoom && !this._kiosk(); // S7.5: kiosk still zooms/pans by gesture, just draws no buttons
    const showViewSwitch = this._viewSwitchOn();
    const showRotate = this._rotateOn();
    // S9.6: `home` is the whole floor unless `center`/`zoom_level` pin the card to part of it — the base the box
    // rests on when there is no explicit `_view`, and what "zoomed" (the fp-zoomed class, below) is measured
    // against, so a pinned card reads as its own resting state, not as permanently zoomed in from the full plan.
    const home = pinnedView(fit, this._rotatedCenter(), this._zoomLevel());
    // Diego field report, 0.12.14: pan must work even under `zoom: false` — that config key only turns off pinch,
    // wheel and the buttons (`_bindZoom` gates those on `_zoomMode()` itself); a one-finger drag always reaches
    // `_setView`, so `_view` can be set regardless, and the box here must reflect it regardless too.
    if (this._pendingView && !turn) {
      // A remembered zoom and focus: the first render is the first time the fit box is known. `clamp` keeps part of
      // the plan in view whatever the stored focus said.
      const b = this._boxFromAnchor(this._pendingView, fit);
      this._view = sameView(b, home, fit) ? null : b;
      this._pendingView = null;
    }
    // While a turn runs the box follows the angle: it holds the anchored plan point at the centre, or is home.
    const box = turn ? (turn.anchor ? this._boxFromAnchor(turn.anchor, fit) : home) : this._view ? clamp(this._view, fit) : home;
    // Opus review of S9.6: "zoomed" (like `_zoomed()` below) means "not at home", not "narrower than home" — a
    // sideways pan at home's own width used to read as not-zoomed here, which left `touch-action` at `pan-y` (so
    // the page's own vertical scroll fought the pan) even while `_view` was already pinning a panned box.
    // `fp-zoomable` (the touch-action override) is unconditional too: it enables the drag gesture, not zoom.
    const svgClass = (this._view !== null ? "fp-zoomable fp-zoomed" : "fp-zoomable") + (turn ? " fp-turning" : "");
    // S12.3: 3D takes the plan's place once its module is loaded and WebGL works; until then, and if it cannot, the 2D plan is on show.
    const live3d = this._shows3d();
    const body = live3d ? "" : renderFloor(f, {
      scale: this._scale(fit),
      state: this._stateForRender(),
      now: Date.now(),
      fade: this._config.fade,
      plugWatts: plugThreshold(this._config.plug_watts),
      plugHeat: this._plugHeat(),
      powerLinks: this._powerLinks(),
      roomGlow: this._config.room_glow,
      theme: this._theme(),
      dark: this._haDark(),
      rotate,
      night: this._night(),
      view,
      tilt: this._tilt(),
      walls: this._walls(),
      labels: this._labels(),
      showNames: this._names(),
      around: floorsAroundKey(this._layout!, this._floorKey()!),
      selectedRoom: this._picked() ?? undefined,
    });
    // The zoom buttons come after the plan's <svg> in the DOM (they are positioned, so order is not placement):
    // their own icon is an <svg> too, and `querySelector("svg")` must keep finding the plan first.
    const stage = live3d ? html`<div class="fp-3d" style="aspect-ratio:${fit.w} / ${fit.h}"></div>` : html`<svg class=${svgClass} viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${unsafeSVG(body)}</svg>`;
    const note = this._fallback3d && this._viewPick() === "3d" ? html`<p class="fp-3d-note">${this._fallback3d}</p>` : null;
    const stack3d = live3d ? (this._kiosk() ? null : html`<div class="fp-stack"><button type="button" aria-label="Reset camera" title="Reset camera" @click=${() => this._view3d?.reset()}>${this._icon(UI_ICONS.reset)}</button></div>`) : undefined;
    return html`${this._floorChips()}${stage}${note}${this._activePanel()}${showViewSwitch ? html`<div class=${showZoomButtons ? "fp-zoom" : "fp-viewonly"}>${this._viewControls(this._viewPick())}</div>` : null}${stack3d !== undefined ? stack3d : showZoomButtons ? this._viewStack(box, home, fit, showViewSwitch, showRotate) : showViewSwitch || showRotate ? html`<div class="fp-stack">${showRotate ? this._rotateButtons() : null}${this._resetButton()}</div>` : null}${this._popupTemplate()}${this._coverDialogTemplate()}${this._vacuumDialogTemplate()}${this._chooserDialogTemplate()}<div class="fp-tip" id="fp-tip" role="tooltip" hidden><b></b><span></span></div>`;
  }

  /** The view picked: the dropdown's, else `config.view`, else 2D. Config is untrusted, so junk is 2D, not an error. */
  private _viewPick(): CardView {
    return this._pickedView ?? (isView(this._config.view) ? this._config.view : "2d");
  }

  /** The flat plan `renderFloor` draws: the pick, or 2D when the pick is 3D (what the card shows while 3D loads or if it cannot run). */
  private _planView(): PlanView {
    const v = this._viewPick();
    return v === "3d" ? "2d" : v;
  }

  /** The tilt on show: the slider's, else `config.tilt`, else the default. Clamped, since config is untrusted. */
  private _tilt(): number {
    return clampTilt(this._pickedTilt ?? this._config.tilt);
  }

  /** The wall heights on show: the select's pick, else `config.walls`, else cut. Config is untrusted, so junk is cut. */
  private _walls(): WallsMode {
    return this._pickedWalls ?? wallsModeOf(this._config.walls);
  }

  /** Next to the Tilt slider, 2.5D only (the caller decides). A pick redraws the plan only and is remembered at once. */
  private _wallsSelect() {
    const current = this._walls();
    const onChange = (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      if (!(WALLS_MODES as readonly string[]).includes(v)) return;
      this._pickedWalls = v as WallsMode;
      this._saveViewNow();
      this.requestUpdate();
    };
    return html`<select aria-label="Walls" title="Walls" @change=${onChange}>${WALLS_MODES.map((m) => html`<option value=${m} ?selected=${m === current}>${WALLS_LABELS[m]}</option>`)}</select>`;
  }

  /** The slider is for 2.5D only: in 2D there is no lift to tilt. Dragging redraws the plan only, like the View select. */
  private _tiltSlider() {
    const onInput = (e: Event) => {
      this._pickedTilt = clampTilt(Number((e.target as HTMLInputElement).value));
      this._scheduleSave(); // a drag is a burst of inputs
      this.requestUpdate();
    };
    return html`<input type="range" aria-label="Tilt" title="Tilt" min="0" max="1" step="0.01" .value=${String(this._tilt())} @input=${onInput} />`;
  }

  /** Everything that changes how the plan looks, but not where it is zoomed: the View select, the Tilt slider while
   * the view is 2.5D, the Theme select and the Labels toggle. All hidden together (`view_switch: false`, kiosk). */
  private _viewControls(current: CardView) {
    const labels = this._labels();
    const names = this._names();
    const in3d = current === "3d" && this._shows3d(); // Walls is the 2.5D select's value; the model has no tilt slider
    return html`${this._viewSelect(current)}${in3d ? this._wallsSelect() : current === "2.5d" ? html`${this._tiltSlider()}${this._wallsSelect()}` : null}${this._themeSelect()}
      <button type="button" aria-label="Labels" title="Labels" aria-pressed=${labels ? "true" : "false"} @click=${() => { this._pickedLabels = !labels; this._saveViewNow(); this.requestUpdate(); }}>${this._icon(UI_ICONS.labels)}</button>
      <button type="button" aria-label="Device names" title="Device names" aria-pressed=${names ? "true" : "false"} @click=${() => { this._pickedNames = !names; this._saveViewNow(); this.requestUpdate(); }}>Aa</button>`;
  }

  /** The two rotate buttons, next to the zoom buttons: a control of their own (`rotate_switch`), so a card with
   * `view_switch: false` still turns. */
  private _rotateButtons() {
    return html`<button type="button" aria-label="Rotate left" title="Rotate left" @click=${() => this._turnBy(-ROTATION_STEP)}>${this._icon(UI_ICONS.rotateLeft)}</button>
      <button type="button" aria-label="Rotate right" title="Rotate right" @click=${() => this._turnBy(ROTATION_STEP)}>${this._icon(UI_ICONS.rotateRight)}</button>`;
  }

  /** A toolbar icon: 24x24 path from the inlined set, drawn in the button's own colour. */
  private _icon(path: string) {
    return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${path} fill="currentColor"/></svg>`;
  }

  /** Choosing a theme sets the card's own theme live: the host's `data-theme` follows in `updated`. Remembered at once. */
  private _themeSelect() {
    const current = this._theme();
    const onChange = (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      if (!isTheme(v)) return;
      this._pickedTheme = v;
      this._saveViewNow();
      this.requestUpdate();
    };
    return html`<select aria-label="Theme" title="Theme" @change=${onChange}>${THEMES.map((t) => html`<option value=${t} ?selected=${t === current}>${THEME_LABELS[t]}</option>`)}</select>`;
  }

  /** Whether anything about the view differs from what the config alone would show: a pick, a zoom, a turn. */
  private _modified(): boolean {
    return this._turn !== null || this._view !== null || this._pendingView !== null
      || [this._pickedView, this._pickedTilt, this._pickedWalls, this._pickedTheme, this._pickedLabels, this._pickedNames, this._pickedRot].some((v) => v !== null);
  }

  /** Reset view: every view option back to the config's own, the stored entry cleared, the floor kept. The turn goes
   * back the short way (315 to 0 is +45). */
  private _resetView(): void {
    this._fallback3d = null;
    this._pickedView = this._pickedTilt = this._pickedWalls = this._pickedTheme = this._pickedLabels = this._pickedNames = null;
    this._pendingView = null;
    this._view = null;
    const from = this._userAngle();
    this._startTurn(from + shortestDelta(from, normaliseRotation(this._config.rotation)), null);
    if (!this._turn) {
      this._pickedRot = null;
      this._saveViewNow();
    }
    this.requestUpdate();
  }

  private _resetButton() {
    return html`<button type="button" aria-label="Reset view" title="Reset view" ?disabled=${!this._modified()} @click=${() => this._resetView()}>${this._icon(UI_ICONS.reset)}</button>`;
  }

  /** Compact `<select>` in the card chrome, outside the plan's `<svg>` like the zoom buttons. A pick redraws the
   * plan only: `_view` (zoom and pan) is left alone, `render` clamps it against the new fit. */
  private _viewSelect(current: CardView) {
    const onChange = (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      if (!isView(v)) return;
      this._pickedView = v;
      this._fallback3d = null; // a new pick tries 3D again
      this._saveViewNow();
      this.requestUpdate();
    };
    return html`<select aria-label="View" title="View" @change=${onChange}>${VIEW_OPTIONS.map((o) => html`<option value=${o.value} ?selected=${o.value === current}>${o.label}</option>`)}</select>`;
  }

  /** S7.4: `config.zoom`, read as untrusted: only `false` turns zoom off and only `"wheel"` widens it. */
  private _zoomMode(): boolean | "wheel" {
    const z = this._config.zoom;
    return z === false ? false : z === "wheel" ? "wheel" : true;
  }

  /** S7.5: `config.kiosk`, `false` unless it is exactly `true` — `setConfig` already refuses anything else. */
  private _kiosk(): boolean {
    return this._config.kiosk === true;
  }

  /** S9.2: `config.icon_size`, read as untrusted — a missing key, a non-number, or `NaN` all mean the default,
   * `1`; a real number clamps to [0.5, 3] rather than being refused, so a slider or a stray digit never breaks
   * the card. */
  private _iconSize(): number {
    const v = this._config.icon_size;
    return typeof v === "number" && Number.isFinite(v) ? Math.min(ICON_SIZE_MAX, Math.max(ICON_SIZE_MIN, v)) : DEFAULT_ICON_SIZE;
  }

  /** S9.2: the `scale` passed to `renderFloor`. Icons, names, values and radar dots are drawn at `24 * (1/scale)`
   * units, so shrinking `scale` grows them on screen. `auto` keeps a plan of 1000 cm or less exactly as before
   * (icon_size at its own default too, so today's card is byte-identical); past that, icons stop shrinking with
   * the plan, growing with its longest side instead — `fit` is the same view box `render()` already draws, per
   * the S9.2 brief ("the same box the card draws"), so this reads no geometry of its own. */
  private _scale(fit: { w: number; h: number }): number {
    const auto = Math.max(1, Math.max(fit.w, fit.h) / 1000);
    return 1 / (auto * this._iconSize());
  }

  /** S9.6: `config.center`, read as untrusted config (CLAUDE.md finding 1) — anything other than a two-element
   * array of finite numbers is `null` (no pin), silently. Unlike `zoom`/`kiosk` (which throw on a typo, per the
   * comment on `_validateConfig`, because those are a closed set where a wrong value would otherwise hide behind
   * a default no one asked for) `center` is a wide-open pair of numbers, the same shape of untrusted input as
   * `icon_size`: a bad value here has an obviously safe fallback (the whole floor) that a slider or a stray digit
   * must never break out of. */
  private _center(): Pt | null {
    const c = this._config.center;
    if (!Array.isArray(c) || c.length !== 2) return null;
    const [x, y] = c;
    return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }

  /** Opus review of S9.6: `center` is documented as plan cm — the same unrotated coordinates a room or device sits
   * at in the layout — but `_home`'s own box (`viewBoxFor(f, 60, rotate)`, `render()` above) is already in the
   * *rendered* frame: `renderFloor`/`viewBoxFor` turn every point by `rotate` themselves (unlike the editor, which
   * draws unrotated coordinates inside a rotated `<g>`). Passing `_center()` straight into `pinnedView` therefore
   * pinned the wrong spot on any layout with `rotate` set. This turns the config's plan-cm point by the same
   * `rotate` before it reaches `pinnedView`, so it lands on the same plan point the layout itself names. */
  private _rotatedCenter(): Pt | null {
    const c = this._center();
    if (!c) return null;
    const rotate = this._rotate();
    return rotate && rotate.deg % 360 ? rotateAbout(c, rotate.deg, rotate.pivot) : c;
  }

  /** S9.6: `config.zoom_level`, clamped to [1, MAX_ZOOM] — same untrusted-config shape as `_iconSize` above, and
   * the same reasoning as `_center`'s comment for why this defaults silently rather than throwing. */
  private _zoomLevel(): number {
    const v = this._config.zoom_level;
    return typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_ZOOM, Math.max(ZOOM_LEVEL_MIN, v)) : DEFAULT_ZOOM_LEVEL;
  }

  /** S9.6: the card's "home" view — the whole floor (`fit`) unless `center`/`zoom_level` pin it to part of the
   * plan. Every place that used to treat `fit` as "no zoom" (the `fp-zoomed` class, `_current`, `_zoomed`,
   * `_setView`, the zoom buttons' own reset) now treats this instead: reset returns here, not to the whole floor,
   * so a room-pinned card stays pinned across a pinch-zoom-and-reset. `_scale` (icon sizing, S9.2) deliberately
   * keeps reading `fit` itself, not this — see its own comment — so a room card's icons match the full-plan
   * card's icons at the same zoom, per the S9.6 brief. */
  private _home(): View | null {
    return this._fit ? pinnedView(this._fit, this._rotatedCenter(), this._zoomLevel()) : null;
  }

  /** The view on screen now: the zoomed one, clamped to the whole floor (a pinned card can still pinch/pan out to
   * see the rest of the house), or home. */
  private _current(): View | null {
    const fit = this._fit;
    if (!fit) return null;
    return this._view ? clamp(this._view, fit) : this._home();
  }

  /** Opus review of S9.6: this used to compare `_current()`'s width against `_home()`'s, so a sideways pan at
   * home's own zoom level (same width, different centre) read as "not zoomed" — a double-tap after panning a
   * pinned card then zoomed in from home instead of returning to it. `_setView` already normalises "back at home"
   * to `_view === null` (its own comment above), so "zoomed" is exactly "not that": no separate width check. */
  private _zoomed(): boolean {
    return this._view !== null;
  }

  /** Stores `v`, clamped to the whole floor, as the view; home itself is stored as `null` (the same "no override"
   * state `_current`/`_zoomed` already read), so a pinch or pan that lands back exactly on home does not pin an
   * equivalent-but-distinct box that would, say, disable the fit button. */
  private _setView(v: View): void {
    const fit = this._fit, home = this._home();
    if (!fit || !home) return;
    if (this._turn) return; // the plan is moving: a gesture would be applied to a box that is already leaving
    const c = clamp(v, fit);
    this._view = sameView(c, home, fit) ? null : c;
    this._scheduleSave();
    this.requestUpdate();
  }

  /** Zooms by `k` about the centre of what is on screen: the + and − buttons. */
  private _zoomCentre(k: number): void {
    const v = this._current();
    if (v) this._setView(zoomAt(v, k, v.x + v.w / 2, v.y + v.h / 2));
  }

  private _fitView(): void {
    if (this._turn) return;
    this._view = null;
    this._scheduleSave();
    this.requestUpdate();
  }

  /** S7.4: +, − and fit, card chrome in the top-right corner (like `_floorChips`, outside the plan's `<svg>`).
   * S9.6 review (Opus, 2026-09-27): a single `atFit` used to gate both "−" and Fit off `box.w < home.w`, width
   * only. On a pinned card that reads two different things and neither is right for both buttons:
   *  - "−" widens the box; it must stop only at the whole floor (`fit`), since the docs promise a pinned card can
   *    still zoom out to see the rest of the house. Gating it at `home` disabled "−" the moment the card loaded,
   *    even though there was more floor to see.
   *  - Fit/Reset undoes `_view`; it must be disabled exactly when there is nothing to undo, i.e. `_view === null`
   *    (`_zoomed()`, above) — not "box is as wide as home", which stayed true after a same-width sideways pan and
   *    left Fit disabled with no way back to the pinned centre.
   * Unpinned (`home` equals `fit`): both conditions coincide, so this changes nothing for a plain card.
   *
   * Diego field report, 0.12.14: "−" used to disable at `fit` itself, so a shed or a corner `viewBoxFor` did not
   * bound on had no way to come into view. It now disables only at `MIN_ZOOM` (`viewport.ts`), the same floor
   * `clamp` itself enforces, so the button and the drag/pinch gesture agree on how far out the card goes. */
  private _viewStack(box: View, home: View, fit: View, withViewSwitch: boolean, withRotate: boolean) {
    const atMin = box.w >= (fit.w / MIN_ZOOM) * (1 - 1e-6);
    const atHome = !this._zoomed();
    const atMax = box.w <= (fit.w / MAX_ZOOM) * (1 + 1e-6);
    const pinned = !sameView(home, fit, fit);
    // "Reset view" is the stack's own last button (every view option back to the config); Fit only fits.
    const resetLabel = pinned ? "Home view" : "Fit";
    return html`<div class="fp-stack">
      <button type="button" aria-label="Zoom in" title="Zoom in" ?disabled=${atMax} @click=${() => this._zoomCentre(BUTTON_ZOOM)}>+</button>
      <button type="button" aria-label="Zoom out" title="Zoom out" ?disabled=${atMin} @click=${() => this._zoomCentre(1 / BUTTON_ZOOM)}>−</button>
      <button type="button" aria-label=${resetLabel} title=${resetLabel} ?disabled=${atHome} @click=${() => this._fitView()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
      </button>
      ${withRotate ? this._rotateButtons() : null}
      ${withViewSwitch || withRotate ? this._resetButton() : null}
    </div>`;
  }

  /**
   * S7.4: pointer and wheel handlers for zoom and pan on the plan's own `<svg>`, bound once per element like
   * `bindDeviceActions`. Each handler reads `config.zoom` afresh, so `zoom: false` needs no rebinding.
   *
   * One pointer that moves past `TAP_SLOP_PX` pans (`bindDeviceActions` drops its tap at the same threshold); two
   * pinch. A pointer that goes down while none is tracked and is not the primary one is a second finger whose
   * first landed outside the svg: it is ignored, so half a pinch never pans the plan. Taps stay with
   * `bindDeviceActions`, except two quick taps off any device or door: 2x about the tap at fit, back to fit when
   * zoomed. The wheel zooms only with Ctrl/Cmd, or always under `zoom: "wheel"`; it is bound on the svg, so a
   * wheel over a floor chip or a zoom button never reaches it and scrolls the page.
   */
  private _bindZoom(svg: SVGSVGElement): () => void {
    const ptrs = new Map<number, { x: number; y: number }>();
    let start = { x: 0, y: 0 };
    let panning = false;
    let pinched = false;
    let lastTap: { t: number; x: number; y: number; before: { pick: { floor: string; id: string } | null; filter: boolean } } | null = null;

    /** Screen point to plan point under view `v`. */
    const toPlan = (v: View, cx: number, cy: number): Pt => {
      const r = svg.getBoundingClientRect();
      return [v.x + ((cx - r.left) / r.width) * v.w, v.y + ((cy - r.top) / r.height) * v.h];
    };
    const capture = (id: number) => {
      try { svg.setPointerCapture(id); } catch { /* the pointer is already gone */ }
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.isPrimary) ptrs.clear(); // nothing else of its kind is down: forget any pointer whose up went missing
      else if (!ptrs.size) return;
      // Diego field report, 0.12.14: the card must always be draggable, `zoom: false` or not — that config key
      // turns off zoom, not pan. A first finger always starts a pan; a second finger only joins as a pinch when
      // zoom is on, so `zoom: false` still blocks pinch-zoom without blocking the one-finger drag that got here.
      if (ptrs.size === 1 && this._zoomMode() === false) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) {
        start = { x: e.clientX, y: e.clientY };
        panning = false;
        pinched = false;
      } else {
        pinched = true;
        lastTap = null;
        for (const id of ptrs.keys()) capture(id);
      }
    };

    const onMove = (e: PointerEvent) => {
      const p = ptrs.get(e.pointerId);
      const v = this._current();
      if (!p || !v) return;
      if (ptrs.size === 1) {
        if (!panning) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_SLOP_PX) return;
          panning = true;
          capture(e.pointerId);
        }
        const r = svg.getBoundingClientRect();
        this._setView(panBy(v, (-(e.clientX - p.x) / r.width) * v.w, (-(e.clientY - p.y) / r.height) * v.h));
      } else if (ptrs.size === 2) {
        const o = [...ptrs].find(([id]) => id !== e.pointerId)![1];
        this._setView(pinch(v, toPlan(v, p.x, p.y), toPlan(v, o.x, o.y), toPlan(v, e.clientX, e.clientY), toPlan(v, o.x, o.y)));
      }
      p.x = e.clientX;
      p.y = e.clientY;
    };

    const onUp = (e: PointerEvent) => {
      if (!ptrs.delete(e.pointerId)) return;
      if (ptrs.size) {
        // One finger of a pinch lifted: the other carries on as a pan from where it is now.
        panning = true;
        return;
      }
      const tap = !panning && !pinched;
      panning = false;
      pinched = false;
      const onThing = (e.target as Element | null)?.closest?.("g[data-x], line[data-d], g[data-u]");
      if (!tap || onThing) {
        lastTap = null;
        return;
      }
      const now = performance.now();
      if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_PX) {
        this._restorePick(lastTap.before); // a double tap is a zoom, and leaves the room pick as it found it (DECISIONS, S11.3)
        lastTap = null;
        if (this._zoomMode() === false) return; // a double tap zooms; pan alone stays on when zoom is off
        // S9.6: zooms in from `home` (the pinned box, or the whole floor with no pin), not the whole floor — the
        // screen shows `home` at rest, so the plan point under the tap must be read against that same box.
        const home = this._home();
        if (this._zoomed() || !home) this._fitView();
        else this._setView(zoomAt(home, 2, ...toPlan(home, e.clientX, e.clientY)));
        return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY, before: { pick: this._pickedRoom, filter: this._roomFilter } };
      this._tapRoom(e);
    };

    const onCancel = (e: PointerEvent) => {
      ptrs.delete(e.pointerId);
      if (!ptrs.size) {
        panning = false;
        pinched = false;
      }
    };

    const onWheel = (e: WheelEvent) => {
      const mode = this._zoomMode();
      if (mode === false || (mode !== "wheel" && !e.ctrlKey && !e.metaKey)) return;
      const v = this._current();
      if (!v) return;
      e.preventDefault();
      const dy = Math.max(-100, Math.min(100, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
      this._setView(zoomAt(v, Math.exp(-dy * 0.002), ...toPlan(v, e.clientX, e.clientY)));
    };

    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onCancel);
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onCancel);
      svg.removeEventListener("wheel", onWheel);
    };
  }

  /** S2.7: the cover confirm dialog, or `null` when none is open. Card chrome (like `_floorChips` above): outside
   * the `<svg>` renderFloor draws, never inside it (CLAUDE.md finding 8). `lit-html`'s own text-node escaping
   * handles the door's `name` safely, the same guarantee `esc()` gives core's hand-built SVG strings (finding 2).
   * The verb (both the question and the button's own label) comes from `_coverService`, the same call
   * `_confirmCoverDialog` makes, so the text can never promise one thing and do another (Opus review). `role`,
   * `aria-modal` and `aria-labelledby` name this to assistive tech as the modal it is, pointed at the question
   * itself so its name changes along with the verb. */
  private _coverDialogTemplate() {
    const door = this._coverDialog;
    if (!door?.cover) return null;
    const verb = this._coverService(door) === "close_cover" ? "Close" : "Open";
    return html`
      <div class="fp-dialog-backdrop" @keydown=${this._onDialogKeydown}>
        <div class="fp-dialog" role="dialog" aria-modal="true" aria-labelledby="fp-dialog-title">
          <p id="fp-dialog-title">${verb} ${door.name}?</p>
          <div class="fp-dialog-actions">
            <button type="button" class="cancel" @click=${() => this._closeCoverDialog()}>Cancel</button>
            <button type="button" class="confirm" @click=${() => this._confirmCoverDialog()}>${verb}</button>
          </div>
        </div>
      </div>
    `;
  }

  /** S7.10: the vacuum dialog, or `null` when none is open — same shape and rules as `_coverDialogTemplate` above
   * (card chrome outside `<svg>`, `lit-html` escaping the name, `role`/`aria-modal`/`aria-labelledby`), but three
   * actions instead of one, since a vacuum has no single obvious verb. Start/Pause/Return to dock each read
   * `_vacuumDisabled()` fresh on every render, so an entity that goes `unavailable` while the dialog is open
   * (`hass`'s setter calls `requestUpdate()` on every change, same as the cover dialog) disables them at once
   * rather than leaving a stale, clickable button. Cancel is never disabled, so the dialog can always be dismissed. */
  private _vacuumDialogTemplate() {
    const d = this._vacuumDialog;
    if (!d) return null;
    const disabled = this._vacuumDisabled();
    return html`
      <div class="fp-dialog-backdrop" @keydown=${this._onDialogKeydown}>
        <div class="fp-dialog fp-vacuum-dialog" role="dialog" aria-modal="true" aria-labelledby="fp-vacuum-dialog-title">
          <p id="fp-vacuum-dialog-title">${d.name ?? d.id}</p>
          <div class="fp-dialog-actions">
            <button type="button" class="cancel" @click=${() => this._closeVacuumDialog()}>Cancel</button>
            <button type="button" ?disabled=${disabled} @click=${() => this._vacuumAction("start")}>Start</button>
            <button type="button" ?disabled=${disabled} @click=${() => this._vacuumAction("pause")}>Pause</button>
            <button type="button" class="confirm" ?disabled=${disabled} @click=${() => this._vacuumAction("return_to_base")}>Return to dock</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * S10.4: the chooser dialog, or `null` when none is open — a device or a non-cover door that names more than
   * one entity lists them here (each one's HA `friendly_name`, or its id with none) instead of `bindDeviceActions`
   * guessing which one the tap or hold meant. Same card-chrome/escaping/aria shape as the two dialogs above.
   * Clicking a row closes the dialog and opens that entity's own more-info, in one step (`_pickChooserEntity`);
   * clicking the backdrop itself (outside the dialog box) also closes it — the one dialog of the three where the
   * chosen action already needs a second click (row, then whatever HA's own more-info offers), so a quick way to
   * back out of a wrong tap earns its keep here more than it would next to a single Yes/No question.
   */
  private _chooserDialogTemplate() {
    const c = this._chooserDialog;
    if (!c) return null;
    return html`
      <div class="fp-dialog-backdrop" @keydown=${this._onDialogKeydown} @click=${(e: Event) => { if (e.target === e.currentTarget) this._closeChooserDialog(); }}>
        <div class="fp-dialog fp-chooser-dialog" role="dialog" aria-modal="true" aria-labelledby="fp-chooser-dialog-title">
          <p id="fp-chooser-dialog-title">${c.title}</p>
          <div class="fp-chooser-list">
            ${c.entities.map((id) => html`<button type="button" @click=${() => this._pickChooserEntity(id)}><span class="name">${this._chooserEntityName(id)}</span><span class="state">${this._chooserEntityState(id)}</span></button>`)}
          </div>
          <div class="fp-dialog-actions">
            <button type="button" class="cancel" @click=${() => this._closeChooserDialog()}>Cancel</button>
          </div>
        </div>
      </div>
    `;
  }
}

if (typeof window !== "undefined") {
  window.customCards = window.customCards ?? [];
  if (!window.customCards.some((c) => c.type === "floorplan-studio-card"))
    window.customCards.push({
      type: "floorplan-studio-card",
      name: "Floorplan Studio",
      description: "Draw your home and use it as a live dashboard.",
    });
}
defineElement("floorplan-studio-card", FloorplanStudioCard, CARD_VERSION);
// One line, so "which card is my dashboard running" is a look at the console, not a guess.
if (typeof console !== "undefined" && CARD_VERSION !== "dev") console.info(`Floorplan Studio card ${CARD_VERSION}`);
