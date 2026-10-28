import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from "lit";
import { planPatch } from "./plan-patch"; // S25.6: the plan is patched, not replaced, on a state update
import { DETAIL_MODES, detailFor, type DetailMode, DEFAULT_MOTION_FADE_S, FLOORPLAN_CSS, UI_ICONS, wallsModeOf, type PlanView, findPowerSensor, floorsAroundKey, floorPlace, floorPose, floorBelow, floorsBelow, floorElevation, floorSwitch, deviceColourVars, plugThreshold, heatRange, anyRoomHeated, heatKindOf, heatLegend, ThumbFeed, camThumbOf, HEAT_FROM, HEAT_TO, clampTilt, migrate, planPivot, renderFloor, rotateAbout, tag, validate, viewBoxFor } from "../core";
import type { CamThumb, HeatKind, LayerId, OffRow, SearchEntry } from "../core";
import type { Attention, ThingRef, PowerCandidate, Theme, WallsMode } from "../core";
import type { Device, Door, Floor, Layout } from "../core";
import { tapActionOf, holdActionOf } from "./tap-action";
import { favouritesOf, type FavouritesRead } from "./favourites";
import { bindDeviceActions, type TapTarget } from "./actions";
import { SCENES_CSS } from "./room-scenes-ui";
import { TOUCH_CSS } from "./touch-css";
import { POPUP_CSS, type PopupSubject, type SliderKind } from "./popup-ui";
import { defineElement } from "./define";
import { strategyElement } from "./strategy";
import { CARD_VERSION } from "./version";
import { INSTALL_HINT, NOTHING_SAVED, PLAN_UNUSABLE, STALE_PAGE, NO_ANSWER, loadErrorText, loadShared, pageIsStale, type Conn, type StoredError } from "./load";
import { mark, t } from "../core/i18n";
import { currentLanguage, useLanguage } from "./i18n";
import { clamp, pinnedView, sameView, zoomAt, type Pt, type View } from "./viewport";
import { firstFocus, nextInDirection, type FocusDir } from "./plan-focus";
import { type FrameMode, type SheetStop, type Stops } from "./frame";
// S24.8: registers <fp-search>, the search box the Studio uses too.
import "./search-box";
// S31.6: <fp-menu>, the header's ⋯: everything about how the plan looks.
import "./more-menu";
import type { View3D } from "./three/view3d";
import { liveDeps, sceneDeps, textureDeps } from "../core/three-deps";
import { belowModeOf, type BelowMode, ROTATION_STEP, easeInOut, normaliseRotation, viewAround, type FloorView } from "./view-state";
export { THEME_LABELS } from "./card-menu"; // the catalogue test reads it from here
export { DOUBLE_TAP_MS, DOUBLE_TAP_PX } from "./card-zoom"; // the 3D host and its test read them from here
import { chooserDialogTemplate, coverDialogTemplate, offDialogTemplate, onDialogKeydown, openChooserDialog, openCoverDialog, openVacuumDialog, vacuumDialogTemplate } from "./card-dialogs";
import { header, isTheme, isView, onMenuPick, optionsMenu } from "./card-menu";
import { pauseReplay, REPLAY_CSS, replayBar, replayStates, replayTap, syncReplay, type ReplayState } from "./card-replay";
import { activePanel, attentionOf, floorTitle, keptHere, pickRoom, picked, placePulse, restorePick } from "./card-overview";
import { bindHover, bindSpider, closePopup, hideTip, onOutsideDown, openPopup, popupMarkup, showTip, spiderSpots, subjectOf, subjectText, syncPopup, syncTip, tapOpts, tapStack, targetOf } from "./card-popup";
import { applyWidthDefault, fitHeight, measureFrame, onHandleCancel, onHandleClick, onHandleDown, onHandleKey, onHandleMove, onHandleUp, panBoxIn, panIntoVisible, stopsNow, visibleBox } from "./card-sheet";
import { loadActiveState, loadViewState, saveViewNow, scheduleSave } from "./card-view-state";
import { bindZoom, fitView, measurePx, onViewKey, qpx, qstrip, rotatedCenter, scale, viewStack, zoomLevel } from "./card-zoom";

const NO_LAYOUT: StoredError = { key: INSTALL_HINT };

declare const __FP_FORM_FILE__: string | undefined;
/** S38.0: the built form's file beside the card, `./floorplan-studio-form-<hash>.js`, compiled in by vite.config.ts. Empty in the dev server and in
 * vitest, where the form is imported from source. */
const FORM_FILE: string = typeof __FP_FORM_FILE__ === "string" ? __FP_FORM_FILE__ : "";
let formFails = 0;

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
  connection?: Conn;
  /** Only `is_admin` is read: the Studio's sidebar entry is admin only, so a link to it is for admins. */
  user?: { is_admin?: boolean };
  /** S37.5: the user's language code as HA writes it ("it", "pt-BR", "zh-Hans"); `locale.language` is the same value on a frontend that has no top-level field. */
  language?: string;
  locale?: { language?: string; time_format?: string };
  callService?(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
  /** HA's own display text for a state ("21.5 °C", "Heat/Cool"). Absent on an old frontend; the card then prints the raw state. */
  formatEntityState?(stateObj: HassEntity): string;
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
  /** S33.4: what a tap on a device icon does: `popup` (default), `more-info`, `toggle` or `none`; a string is the action. `toggle` turns ON at once and a light OFF at once; any other OFF opens the popup at Confirm turn off. Anything else (navigate, a number, junk) is `popup`, with one console warning. See docs/card.md. */
  tap_action?: unknown;
  /** S33.4: what a hold of 500 ms does: `more-info` (default) or `none`. Kiosk never holds. */
  hold_action?: unknown;
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
  /** How much of the plan is drawn at a zoom (docs/card.md, Detail): `"auto"` follows the zoom, `"full"` always draws everything, `"minimal"` always draws rooms and what needs attention. Unset (or anything else) is `"auto"`, except where the viewer can neither zoom nor reach the Detail button (kiosk, or `active_list: false` with `zoom: false`): there it is `"full"`, so no idle device is unreachable. The Detail button in the Overview changes it for one viewer, and the card remembers the pick. */
  detail?: DetailMode;
  /** `true` draws the floor below as faint lines under the shown floor, at its place in the house (the floors' `offset`s); anything but `true` is off (default). The Floor below button in the view controls changes it for one viewer, and the card remembers the pick. The lowest floor has none. */
  ghost_floor?: boolean;
  /** How the 3D view draws the floors under the shown one (docs/card.md): `"off"` (default), `"ghost"` translucent, `"solid"` in their own colours. Anything else is `"off"`. A Floors below select next to Walls in 3D changes it for one viewer, and the card remembers the pick. */
  floors_below?: BelowMode;
  /** The heat map (docs/card.md, Heat map): `"off"` (default), `"temperature"` or `"humidity"` fills each room that has a reading of that kind on a fixed scale and draws a legend. 2D and 2.5D only. Anything else is `"off"`, with one console warning. The Heat map items of the ⋯ menu change it for one viewer, and the card remembers the pick. */
  heat_map?: unknown;
  /** S16.3 (docs/card.md, Camera thumbnail): `on` (or YAML's `true`) draws a small live picture beside each camera icon, from the camera's `entity_picture` through Home Assistant's own proxy, refreshed every 10 s while the tab is shown. Default off, and then no picture is requested. The ⋯ menu changes it for one viewer, and the card remembers the pick. */
  camera_thumb?: unknown;
  /** `small`, `medium` (default) or `large`; anything else is `medium`. */
  camera_thumb_size?: unknown;
  /** Where the picture sits next to the icon: `above`, `below` (default), `left` or `right`; anything else is `below`. */
  camera_thumb_pos?: unknown;
}

/** What the View dropdown offers: the two flat plans `renderFloor` draws and the 3D model, which is a renderer of its own. */
export type CardView = PlanView | "3d";

/** A 45 degree turn takes this long; a longer one (Reset from 135 away) takes proportionally more, up to twice. */
const TURN_MS = 350;

/** Card config is untrusted input (CLAUDE.md finding 1): only a plain `#rrggbb` hex is accepted for open_color. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** The 3D chunk (three/host.ts) sets these English texts as `_fallback3d` and cannot call `t`; the card translates them where it shows them. Listed here so the catalogue test sees the keys. */
export const FALLBACK_3D_KEYS = [mark("3D view unavailable: this browser has no WebGL. Showing 2D."), mark("3D view unavailable: it could not start. Showing 2D.")] as const;

/** What a double tap restores: the room or floor pick as it stood before the first tap changed it. */
export interface PickMemo { pick: { floor: string; id: string } | null; floor: string | null; filter: boolean }

/** S9.2: `icon_size` default and clamp range. */
const DEFAULT_ICON_SIZE = 1;
const ICON_SIZE_MIN = 0.5;
const ICON_SIZE_MAX = 3;

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string; getEntitySuggestion?: (hass: unknown, entityId: string) => { config: { type: string } } | null }[];
  }
}

type Lib3d = typeof import("./three/host");
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
      : import("./three/host");
    lib3dLoading = load.then((m) => (lib3d = m), (err) => { lib3dLoading = null; throw err; }); // a failed load may be tried again
  }
  return lib3dLoading;
};

/** What the 3D chunk takes from code the 2D plan also ships (S36.4). The chunk may not import it: it would import the card. */
const DEPS_3D = { scene: sceneDeps, live: liveDeps, texture: textureDeps.texture, floorsAroundKey, floorsBelow, floorElevation, floorPlace, plugThreshold, bindDeviceActions };

/** The card that has focus (or has something inside it focused), whatever shadow roots it sits in. */
let focusedCard: FloorplanStudioCard | null = null;

/*
 * S31.5: the chrome around the plan (docs/specs/card-layout-touch.md, decisions D1 to D4).
 *
 * The grid. The host is a CSS grid: `"head head" "sheet stage"`, one auto row for the header, one 1fr row below it, and
 * two columns, `--fp-sheet-w` (set on the host by `_measureFrame()`: `sideWidth()` open, 52 px as the rail, 0 where there
 * is no side sheet) and the rest. The header holds the floor tabs, Search and View options. The stage is the plan's
 * `<svg>` (or `.fp-3d`); the zoom cluster (View options box and the + - Fit stack) sits on the stage's corner and is the
 * one thing that floats over the plan on purpose. The sheet (the Overview, `.fp-active.fp-side`) is the "sheet" cell,
 * beside the plan and never over it. `frame.ts` decides the mode from the card's own width: side from 640 px, the old
 * floating panel under it (until S31.8), none in kiosk or with `active_list: false`.
 *
 * Why the zoom maths did not move. The pan, the pinch and the double tap read `svg.getBoundingClientRect()`. The svg is
 * the stage, so it is the box they read; they land where they did. The header holds no `<svg>` (its buttons are text),
 * because `updated()` binds the plan to the first svg in the shadow root.
 *
 * Gone: the dragged panel (`_activePos`, `_onActiveDragStart`: a stored x or y is ignored, the fold is kept),
 * `_positionToolbar` and `_placeTopDock` (nothing floats over the top any more, bar the cluster).
 *
 * The test migration. Tests that read an old chrome position or reached a control now behind View options moved their
 * premise, not their assertion. The look controls are in the closed ⋯ menu, so those tests open it first
 * (tests/card/menu-helper.ts, since S31.6). The plan is smaller than the card (header 52 px, sheet 320 px), so a test that
 * expected the plan to be the card measures the stage. The drag tests became "a stored position is ignored" and "the
 * head moves nothing". Each one is listed in the S31.5 commit message and the report.
 */
/*
 * S31.8: the phone bottom sheet (D2, criterion 6). JUDGEMENT: the drag and the pan-to-visible. Why each is the way it is.
 *
 * Under 640 px the Overview is one sheet along the bottom of the card, three stops (frame.ts: peek 64, half, full). The peek
 * has a row of its own in the grid (`--fp-peek-row`), so the plan ends where the peek starts: at rest nothing is over the plan.
 * Half and full lie over it, on purpose, and the plan is panned so what the sheet opened for stands in what is left.
 *
 * The levels (Overview, Floor, Room, Device) are not a new state: they are what the card already holds (`_pickedFloor`,
 * `_pickedRoom`, `_popup`). The Device level is the popup, drawn in the sheet instead of floating. So a tap, a locate, a row,
 * the search and the keyboard all reach the same code as on a tablet, and only where it is drawn differs. `active_list: false`
 * and kiosk have no sheet, so the popup floats there on every width, as before.
 *
 * The drag. The handle takes the pointer (`setPointerCapture`) and the sheet's height follows the finger one to one, written
 * straight into the element's style: a re-render per move would redraw the whole plan sixty times a second. The render reads
 * the same number (`_sheetDrag`), so a `hass` update in the middle of a drag repaints the same height, and the handle element
 * is never replaced, so the capture holds. The release goes to `snapSheet` with the velocity of the last 100 ms of the drag: a
 * finger that stopped before it lifted has no velocity, however fast it came. A press that never moved 6 px is a tap, which
 * is the click that follows (so Enter and Space on the handle work too); a drag that moved swallows the click it ends with.
 * Reduced motion: no transition, the height jumps.
 *
 * The pan. After a render that opened the sheet for a room or a thing (`_panTarget`), the thing's own box is measured on screen
 * and, if it is not wholly inside the part the sheet at its new stop leaves, the plan is moved by the pixel difference that
 * puts its centre in the middle of that part. Measured, not computed from plan coordinates, so a turned plan, a letterboxed
 * plan and any zoom give the same answer; the box that is wanted is the stop's height, not the animating one, so it is right
 * at once. A thing already in view stays where it is. In 3D there is nothing to pan: the camera frames the house in what the
 * sheet leaves (`apply3dFrame`, in the 3D chunk).
 */
/** `custom:floorplan-studio-card`: renders one floor of the layout, live from `hass`. */

// S36.4: the underscore members that are not `private` are the ones the 3D glue in `three/host.ts` (the lazy chunk) reads.
export class FloorplanStudioCard extends LitElement {
  static styles = [unsafeCSS(FLOORPLAN_CSS), css`
    /* S8.2: height 100% on both, matching Home Assistant's own cards (thermostat, map). In an "auto" grid row
       (no numeric height set by getGridOptions/computeCardGridSize) the containing block's height is indefinite,
       so height:100% computes to auto and the svg sizes by width and its viewBox aspect exactly as before; in a
       fixed-height row (HA's sections layout, .card.fit-rows) it fills the row instead of overflowing it, and
       the svg's own default preserveAspectRatio (xMidYMid meet) keeps the whole plan visible, letterboxed rather
       than cropped or stretched. */
    :host { display: grid; grid-template-columns: var(--fp-sheet-w, 0px) minmax(0, 1fr); grid-template-rows: auto 1fr var(--fp-peek-row, 0px) auto; grid-template-areas: "head head" "sheet stage" "peek peek" "bar bar"; position: relative; height: 100%; }
    /* S8.3: hui-panel-view gives the card no definite height either, so the plan grew by width past the bottom of
       the screen and "fit" looked zoomed in. In panel layout the card takes the screen below HA's header. */
    :host([panel]) { height: calc(100vh - var(--header-height, 56px)); }
    svg { width: 100%; height: 100%; display: block; }
    /* S31.5: the plan is the stage, the cell of the grid that is left when the header and the side sheet have theirs.
       Its box is the box the zoom maths read, so a pan, a pinch and a double tap land where they did. */
    svg.fp-zoomable, .fp-3d { grid-area: stage; min-width: 0; min-height: 0; }
    /* S12.3: the 3D view takes the place of the plan's svg, in the same box (aspect-ratio is the plan's own: with an
       indefinite height it sizes like the svg, in a fixed row it fills it). */
    .fp-3d { position: relative; width: 100%; height: 100%; display: block; }
    .fp-head { grid-area: head; box-sizing: border-box; height: 52px; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 0 8px; border-bottom: 1px solid var(--fp-idle); }
    .fp-head-gap { flex: 1 1 0; min-width: 0; }
    .fp-head-btn { flex: 0 0 auto; font: 12px/1.2 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 999px; padding: 4px 10px; min-width: 32px; cursor: pointer; }
    /* The cluster: +, - and Fit (Reset camera in 3D), top right of the stage. Over the plan on purpose; the one thing that is.
       In kiosk it also holds the ⋯ menu when \`rotate_switch: true\` brings one. */
    .fp-cluster { grid-area: stage; justify-self: end; align-self: start; z-index: 1; margin: 8px; min-width: 0; max-width: calc(100% - 16px); display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    /* S34.8: the heat map's legend, bottom left of the stage, over the plan like the cluster: end labels as text, a ramp between. */
    .fp-heat-legend { grid-area: stage; justify-self: start; align-self: end; z-index: 1; margin: 8px; display: flex; align-items: center; gap: 6px; padding: 4px 8px; font: 12px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 6px; pointer-events: none; }
    .fp-heat-legend.fp-heat-legend-up { align-self: start; } /* the 3D fallback note holds the bottom left: the legend goes to the top */
    .fp-heat-ramp { width: 96px; height: 10px; border-radius: 5px; }
    /* One line, over the plan, when 3D cannot run: why, and that 2D is what is shown. */
    .fp-3d-note { position: absolute; left: 8px; bottom: 8px; z-index: 1; margin: 0; max-width: calc(100% - 16px); padding: 4px 8px; font: 12px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 6px; }
    p.msg { grid-area: 1 / 1 / -1 / -1; padding: 16px; margin: 0; font: 14px sans-serif; color: var(--fp-text); }
    /* S2.6: the floor switcher is card chrome (like p.msg above), not plan content, so it sits outside the <svg>
       renderFloor draws and is positioned over it instead. */
    /* Opus review finding 13: the active-devices panel below (also z-index: 1, and later in DOM order, so it
       would otherwise win ties) can be dragged to sit right under this row; the floor chips must still take the
       click, not the panel behind — or in front of, without this — them. */
    .fp-floors { flex: 0 1 auto; min-width: 0; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 3px 4px; }
    .fp-floors button { flex: 0 0 auto; white-space: nowrap; }
    .fp-floors button { font: 12px/1.2 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 999px; padding: 4px 10px; cursor: pointer; }
    /* Same combination the editor's floor chips already proved at 4.5:1 (S1.40); the current floor is carried by
       aria-pressed, not by this colour alone (CLAUDE.md finding: a toggle must not state its direction twice —
       one attribute serves both the visual state and the accessible one, no added "(current)" text). */
    .fp-floors button[aria-pressed="true"] { background: var(--fp-ink); color: var(--fp-bg); border-color: var(--fp-ink); }
    /* S20.2: the floor whose panel is open. A ring in the primary colour, so it reads beside the fill that marks the floor shown. */
    .fp-floors button.fp-floor-picked { box-shadow: 0 0 0 2px var(--fp-bg), 0 0 0 4px var(--fp-primary); }
    /* S24.7: a floor with a triggered alarm. After the pressed rule, so the shown floor keeps the warn border too; the count
       sits on a warn badge in --fp-on-light, readable on the pressed pill's ink and on the plain one alike. */
    .fp-floors button.fp-floor-alarm { border-color: var(--fp-warn); }
    .fp-floor-alarm .fp-floor-count { background: var(--fp-warn); color: var(--fp-on-light); border-radius: 999px; padding: 0 5px; font-weight: 600; }
    /* S2.7: the cover confirm dialog is card chrome too (same reasoning as .fp-floors above) — it acts on the
       real home, so it sits over the whole card, not only the plan. */
    .fp-dialog-backdrop { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.35); }
    .fp-dialog { background: var(--fp-room); color: var(--fp-ink); border-radius: 8px; padding: 16px 20px; min-width: 200px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); }
    .fp-dialog p { margin: 0 0 14px; font: 14px/1.3 var(--fp-font, system-ui, sans-serif); }
    .fp-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .fp-dialog-actions button { font: 13px/1.2 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-bg); border: 1px solid var(--fp-idle); border-radius: 6px; padding: 6px 14px; cursor: pointer; }
    /* S7.4: the zoom buttons are card chrome, the same colours as the floor chips, in the corner of the stage. S31.6: only +, - and
       Fit (Reset camera in 3D) are left here; the look controls are the ⋯ menu's (more-menu.ts). */
    .fp-stack { display: flex; flex-direction: column; gap: 4px; }
    .fp-stack button { width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; font: 16px/1 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 6px; cursor: pointer; }
    .fp-stack button:disabled { opacity: 0.45; cursor: default; }
    .fp-stack svg { width: 14px; height: 14px; }
    /* While the plan turns it takes no taps: a tap would land on a device that is moving away from the finger.
       The star reaches the children that carry their own pointer-events (.room{pointer-events:all} in the editor's
       rules, .extra, .door-hit), which an inherited value on the svg alone would lose to. */
    svg.fp-turning, svg.fp-turning * { pointer-events: none; }
    /* S7.15: with zoom on, the plan takes every touch once it is zoomed in, so the page does not scroll or zoom under
       a pan or a pinch. At fit there is nothing to pan, so a vertical swipe scrolls the dashboard as it would over
       any other card; the browser still leaves a pinch and a double-tap to the plan (pan-y allows neither). */
    svg.fp-zoomable { touch-action: pan-y; }
    svg.fp-zoomable.fp-zoomed { touch-action: none; }
    /* S37.7: room for the zoom buttons (28 px + the cluster's 8 px margin) beside the plan, so the floor below does not run under them. */
    svg.fp-zoomable.fp-clear-stack { width: calc(100% - 40px); justify-self: start; }
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
    .fp-chooser-list button { display: flex; justify-content: space-between; gap: 12px; text-align: left; font: 13px/1.2 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-bg); border: 1px solid var(--fp-idle); border-radius: 6px; padding: 8px 12px; cursor: pointer; }
    .fp-chooser-list button .state { opacity: 0.7; white-space: nowrap; }
    .fp-chooser-dialog .fp-dialog-actions { justify-content: flex-end; }
    /* S9.5: the active-devices panel, card chrome like .fp-floors/.fp-zoom above (CLAUDE.md finding 8 — nothing here
       is drawn inside the plan's <svg>). Default position clears the floor chips' own top-left corner; a drag
       overrides top/left with an inline style, clamped in TS against the card's own box so it can never be lost
       off-screen (S9.5 spec). */
    /* Opus review finding 5: min(200px, 45%) instead of a flat 200px, so a narrow (phone-width) card gets a panel
       that fits it rather than one that is most of the card's own width at 200px on a ~380px card. */
    .fp-active { grid-area: stage; position: absolute; top: 8px; left: 8px; z-index: 1; width: min(200px, 45%); max-width: calc(100% - 16px); max-height: calc(100% - 16px); display: flex; flex-direction: column; overflow: hidden; background: var(--fp-room); color: var(--fp-ink); border: 1px solid var(--fp-idle); border-radius: 8px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25); }
    .fp-active-head { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 6px 8px; user-select: none; font: 600 12px/1.2 var(--fp-font, system-ui, sans-serif); border-bottom: 1px solid var(--fp-idle); }
    .fp-active-title { flex: 1; }
    .fp-active-count { font-weight: 400; color: var(--fp-text); }
    .fp-active-collapse { border: none; background: transparent; color: inherit; font: inherit; line-height: 1; cursor: pointer; padding: 2px 4px; }
    .fp-active-body { overflow-y: auto; padding: 4px 8px 8px; }
    .fp-active-group-label { font: 600 10px/1.6 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 6px; }
    .fp-active-group-label:first-child { margin-top: 0; }
    /* S14.6: a category header is a button (keyboard, aria-expanded); it keeps the label's look. */
    button.fp-cat { display: flex; align-items: center; gap: 4px; width: 100%; min-height: 28px; text-align: left; border: none; background: transparent; padding: 0 2px; cursor: pointer; border-radius: 4px; }
    .fp-cat-name { flex: 1; min-width: 0; }
    .fp-cat-chev { flex: 0 0 10px; }
    .fp-active-row { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: none; background: transparent; color: inherit; font: 12px/1.3 var(--fp-font, system-ui, sans-serif); padding: 4px 2px; cursor: pointer; border-radius: 4px; }
    .fp-active-row svg { width: 16px; height: 16px; flex: 0 0 16px; fill: var(--fp-active-row-color, var(--fp-ink)); }
    .fp-active-empty { margin: 4px 2px; font: 12px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); }
    /* S11.3/S11.4: the room section and the details under a row. Same card chrome and tokens as the list above. */
    /* S31.5: from 640 px the Overview is the side sheet: the whole sheet cell of the grid, beside the plan, not over it.
       It is absolute inside its cell (inset 0), so a long list scrolls in the body and never makes the card taller. */
    .fp-active.fp-side { inset: 0; width: auto; max-width: none; max-height: none; border-radius: 0; border-width: 0 1px 0 0; box-shadow: none; z-index: 0; grid-area: sheet; }
    .fp-active.fp-side .fp-active-body, .fp-active.fp-bottom .fp-active-body { flex: 1 1 auto; min-height: 0; }
    /* S31.8: the phone's sheet: along the bottom, over the plan above its 64 px peek (the peek has its own grid row). The stops are
       lengths on the host (\`_measureFrame\`); a drag writes the height inline, with the transition off. Reduced motion: it jumps. */
    .fp-active.fp-bottom { grid-area: 1 / 1 / 4 / -1; inset: auto 0 0 0; width: auto; max-width: none; max-height: none; box-sizing: border-box; border-radius: 12px 12px 0 0; border-width: 1px 0 0; z-index: 2; height: var(--fp-sheet-peek, 64px); transition: height 0.2s ease; }
    .fp-active.fp-bottom[data-stop="half"] { height: var(--fp-sheet-half, 50%); }
    .fp-active.fp-bottom[data-stop="full"] { height: var(--fp-sheet-full, 100%); }
    .fp-active.fp-bottom.fp-dragging { transition: none; }
    @media (prefers-reduced-motion: reduce) { .fp-active.fp-bottom { transition: none; } }
    .fp-sheet-top { flex: 0 0 64px; box-sizing: border-box; height: 64px; display: flex; align-items: stretch; }
    .fp-sheet-top .fp-back { align-self: center; flex: 0 0 auto; margin-left: 4px; font-size: 18px; min-width: 40px; min-height: 40px; }
    .fp-handle { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 0 12px; border: 0; background: transparent; color: inherit; font: 600 13px/1.2 var(--fp-font, system-ui, sans-serif); text-align: left; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
    .fp-handle:focus-visible { outline: 2px solid var(--fp-primary); outline-offset: -2px; }
    .fp-grab { flex: 0 0 4px; width: 36px; height: 4px; border-radius: 2px; background: var(--fp-idle); }
    .fp-handle-line { max-width: 100%; box-sizing: border-box; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fp-handle-line .fp-active-title { flex: none; }
    .fp-handle-line .fp-ov-chips { flex: none; display: inline; }
    .fp-handle-line .fp-ov-chips::before { content: " · "; }
    .fp-pop.fp-pop-sheet { position: static; width: auto; max-height: none; border: 0; border-radius: 0; box-shadow: none; background: transparent; padding: 4px 4px 12px; }
    .fp-active.fp-rail { align-items: center; padding-top: 8px; }
    .fp-rail-open { position: relative; width: 36px; height: 36px; border: 1px solid var(--fp-idle); border-radius: 8px; background: var(--fp-bg); color: var(--fp-ink); font: 14px/1 var(--fp-font, system-ui, sans-serif); cursor: pointer; }
    .fp-rail-count { position: absolute; top: -6px; right: -6px; min-width: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 999px; background: var(--fp-warn); color: var(--fp-on-light); font: 600 11px/16px var(--fp-font, system-ui, sans-serif); text-align: center; }
    .fp-back { flex: 0 0 auto; border: none; background: transparent; color: inherit; font: inherit; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
    .fp-item { display: flex; flex-wrap: wrap; align-items: center; }
    .fp-item .fp-active-row { flex: 1 1 0; width: auto; min-width: 0; }
    .fp-row-state { margin-left: auto; padding-left: 6px; flex: 0 0 auto; white-space: nowrap; font-size: 11px; color: var(--fp-text); overflow-wrap: anywhere; text-align: right; }
    .fp-active-row.fp-off svg { opacity: 0.6; }
    .fp-room-facts > div { display: flex; gap: 6px; }
    .fp-room-facts dt { flex: 0 0 88px; color: var(--fp-text); }
    .fp-room-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    /* S24.7: the Overview. The header's chips sit under the title; the alerts chip in the warn colour. */
    .fp-crumb { font-weight: 400; color: var(--fp-text); }
    .fp-ov-chips { flex: 0 0 100%; font: 400 11px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); }
    .fp-chip-warn { color: var(--fp-warn); font-weight: 600; }
    /* Folded, the header is one line so it covers as little plan as before S24.7; the crumb goes, the chips end in an ellipsis. */
    .fp-ov-search:empty { display: none; }
    /* S24.8: the search at the top of the sheet; its list drops over the rows below. */
    .fp-ov-search { margin: 2px 0 6px; font: 12px/1.3 var(--fp-font, system-ui, sans-serif); }
    /* S24.8: one row of tools: Turn off on this floor…, Layers, All floors. */
    .fp-ov-scopes { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; margin-bottom: 6px; }
    .fp-ov-scopes .fp-floor-off { margin-right: auto; }
    /* S24.8: the note for a kept thing (the family chips are the ⋯ menu's Layers section since S31.6). */
    .fp-ov-layers:empty { display: none; }
    .fp-ov-layers { margin: 0 0 6px; }
    .fp-layer-note button { border: 1px solid var(--fp-idle); background: transparent; color: var(--fp-ink); font: 11px/1.4 var(--fp-font, system-ui, sans-serif); border-radius: 999px; padding: 2px 8px; cursor: pointer; min-height: 24px; }
    .fp-layer-note button:hover, .fp-layer-note button:focus-visible { border-color: var(--fp-primary); }
    .fp-layer-note { margin: 4px 0 0; font: 12px/1.4 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); }
    .fp-floor-off:disabled { opacity: 0.5; cursor: default; }
    .fp-floor-off:disabled:hover { border-color: var(--fp-idle); }
    .fp-ov-scope { border: 1px solid var(--fp-idle); background: transparent; color: var(--fp-ink); font: 11px/1.4 var(--fp-font, system-ui, sans-serif); border-radius: 999px; padding: 2px 10px; cursor: pointer; min-height: 24px; }
    .fp-ov-scope[aria-pressed="true"] { background: var(--fp-ink); color: var(--fp-bg); border-color: var(--fp-ink); }
    .fp-ov-section + .fp-ov-section { margin-top: 8px; }
    .fp-ov-head { font: 600 11px/1.6 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); }
    .fp-ov-attn .fp-ov-head { color: var(--fp-warn); }
    .fp-ov-row { align-items: flex-start; }
    .fp-ov-row svg, .fp-ov-mark { margin-top: 1px; }
    .fp-ov-mark { flex: 0 0 16px; width: 16px; text-align: center; color: var(--fp-warn); font-size: 13px; line-height: 16px; }
    .fp-ov-text { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
    .fp-ov-name { overflow-wrap: anywhere; }
    .fp-ov-where { font-size: 10px; color: var(--fp-text); display: flex; gap: 4px; flex-wrap: wrap; }
    .fp-row-floor { border: 1px solid var(--fp-idle); border-radius: 4px; padding: 0 3px; line-height: 1.3; }
    .fp-ov-row .fp-row-state { white-space: normal; max-width: 45%; }
    .fp-ov-age { white-space: nowrap; }
    /* S34.4: a favourite row is the Active row and the popup's button. The button sits right; Confirm and Cancel take their own line so a phone's row never squeezes the name. */
    .fp-fav-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 2px 6px; }
    .fp-fav-row .fp-active-row { flex: 1 1 9em; width: auto; min-width: 0; }
    .fp-fav-gone { opacity: 0.5; }
    .fp-fav-act, .fp-fav-cancel { flex: 0 0 auto; border: 1px solid var(--fp-idle); background: transparent; color: var(--fp-ink); font: 11px/1.4 var(--fp-font, system-ui, sans-serif); border-radius: 999px; padding: 2px 10px; cursor: pointer; min-height: 24px; margin-top: 3px; }
    .fp-fav-act:hover, .fp-fav-cancel:hover, .fp-fav-act:focus-visible, .fp-fav-cancel:focus-visible { border-color: var(--fp-primary); }
    .fp-fav-confirm { flex: 1 1 100%; display: flex; gap: 6px; padding-left: 22px; }
    .fp-fav-confirm button { flex: 1 1 0; }
    .fp-fav-confirm .fp-fav-act { color: var(--fp-on-dark, #fff); background: var(--fp-primary); border-color: var(--fp-primary); font-weight: 600; }
    .fp-ov-hint { margin: 8px 2px 0; font: 10px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); }
    /* One target per row, finger-sized on a touch screen (S24.7). */
    /* S24.7: the ring a row tap puts on its thing. Card chrome over the plan, never a hit target. Reduced motion: a steady ring. */
    .fp-pulse { position: absolute; z-index: 1; pointer-events: none; box-sizing: border-box; border: 3px solid var(--fp-primary); border-radius: 50%; transform: translate(-50%, -50%); animation: fp-pulse-ring 0.8s ease-out 3; }
    /* Not fp-locate: that is the plan's own ring (render.ts), and one name in one shadow root means one wins (S24.R7). */
    @keyframes fp-pulse-ring { 0% { opacity: 1; box-shadow: 0 0 0 0 var(--fp-primary); } 100% { opacity: 0.6; box-shadow: 0 0 0 10px transparent; } }
    @media (prefers-reduced-motion: reduce) { .fp-pulse { animation: none; } }
    /* S31.10 (D4): the ring of the device a key stands on, and the line a screen reader reads. Chrome over the plan like the pulse, never a hit
       target: the behaviour is this class rule, not an attribute (a presentation attribute loses to the editor's own \`.room { pointer-events }\`
       kind of rule, finding 18). The plan itself is the Tab stop; its outline is the thin frame of the focused stop, the ring says which device. Ink inside a bg and a primary halo, so it reads on every theme. */
    .fp-focus { position: absolute; z-index: 1; pointer-events: none; box-sizing: border-box; border: 3px solid var(--fp-ink); border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 0 2px var(--fp-bg, #fff), 0 0 0 4px var(--fp-primary); }
    .fp-focus[hidden] { display: none; }
    .fp-focus-status { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    svg.fp-zoomable:focus { outline: none; }
    svg.fp-zoomable:focus-visible { outline: 2px solid var(--fp-primary); outline-offset: -2px; }
    .fp-room { padding-bottom: 6px; margin-bottom: 6px; border-bottom: 1px solid var(--fp-idle); }
    .fp-room-head { display: flex; align-items: center; gap: 6px; font: 600 13px/1.3 var(--fp-font, system-ui, sans-serif); }
    .fp-room-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .fp-room-clear { flex: 0 0 24px; width: 24px; height: 24px; border: none; background: transparent; color: inherit; font: 14px/1 var(--fp-font, system-ui, sans-serif); border-radius: 4px; cursor: pointer; }
    /* S20.1: the same look as a scene button, with classes of its own so the Scenes section's tests and counts stay about scenes. */
    /* one hover grey for the panel rows and buttons: ink 12 % into bg keeps text above 4.5:1 in every theme (G23) */
    button.fp-cat:is(:hover, :focus-visible),
    .fp-active-row:is(:hover, :focus-visible),
    .fp-back:is(:hover, :focus-visible),
    .fp-room-clear:is(:hover, :focus-visible),
    .fp-show-all:is(:hover, :focus-visible) { background: color-mix(in srgb, var(--fp-ink) 12%, transparent); }
    .fp-alloff-row { margin: 2px 0 6px; display: flex; flex-wrap: wrap; gap: 6px; }
    .fp-alloff, .fp-floor-off { min-height: 32px; padding: 0 10px; font: 12px/1.2 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-bg); border: 1px solid var(--fp-idle); border-radius: 8px; cursor: pointer; }
    .fp-alloff:hover, .fp-alloff:focus-visible, .fp-floor-off:hover, .fp-floor-off:focus-visible { border-color: var(--fp-primary); }
    /* S24.8: the floor-off checklist. A long list scrolls inside the dialog; the buttons stay. */
    .fp-off-dialog { display: flex; flex-direction: column; max-width: min(360px, calc(100% - 32px)); max-height: calc(100% - 32px); box-sizing: border-box; }
    .fp-off-list { overflow-y: auto; margin: 0 0 14px; min-height: 0; }
    .fp-off-group { border: none; margin: 0 0 8px; padding: 0; }
    .fp-off-group legend { padding: 0; font: 600 12px/1.6 var(--fp-font, system-ui, sans-serif); }
    .fp-off-row { display: flex; align-items: center; gap: 8px; min-height: 32px; font: 13px/1.3 var(--fp-font, system-ui, sans-serif); cursor: pointer; }
    .fp-off-row input { width: 18px; height: 18px; margin: 0; flex: 0 0 auto; accent-color: var(--fp-primary); }
    .fp-off-via { font-size: 11px; color: var(--fp-text); }
    .fp-room-facts { margin: 4px 0 6px; font: 12px/1.4 var(--fp-font, system-ui, sans-serif); }
    .fp-filter { display: flex; align-items: center; gap: 6px; font: 600 10px/1.6 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); text-transform: uppercase; letter-spacing: 0.04em; }
    .fp-show-all { margin-left: auto; border: 1px solid var(--fp-idle); background: transparent; color: var(--fp-ink); font: 11px/1.4 var(--fp-font, system-ui, sans-serif); text-transform: none; letter-spacing: 0; border-radius: 4px; padding: 1px 6px; cursor: pointer; }
  `, POPUP_CSS, SCENES_CSS, TOUCH_CSS, unsafeCSS(REPLAY_CSS)];

  _config: FloorplanStudioCardConfig = {};
  _hass?: Hass;
  _layout: Layout | null = null;
  private _error: StoredError | null = null;
  private _urlRequested = false;
  private _wsRequested = false;
  /** Failed websocket loads since the last success or reconnect: one retry on the next `hass`, then wait for the connection's `ready`. */
  private _wsFails = 0;
  private _readyCb: (() => void) | null = null;
  /** The `floorplan_studio_updated` subscription (a Studio save), so an open card follows it. */
  private _sub: Promise<() => void> | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _actionsSvg: SVGSVGElement | null = null;
  private _unbindActions: (() => void) | null = null;
  /** S2.6: which floor `floor: "all"` currently shows. Only read/written through `_floorKey`/`_selectFloor`, which
   * fall back to the layout's first floor when this is unset, stale (the layout changed) or names a floor that
   * no longer exists. */
  _shownFloor: string | null = null;
  /** S2.7: the door whose cover confirm dialog is open, or `null` for none. Only `_openCoverDialog` sets it, and
   * only when it is already `null` — a second tap while the dialog is open (CLAUDE.md-style "Break it") must not
   * replace it with a different door or stack a second dialog. */
  _coverDialog: Door | null = null;
  /** Tracks whether the dialog was open on the *previous* render, so `updated()` moves focus into it exactly once
   * per open (not on every unrelated re-render while it stays open) and back out exactly once per close. */
  private _coverDialogWasOpen = false;
  /** S7.10: the vacuum whose Start/Pause/Return-to-dock dialog is open, or `null` for none. Same "ignore a second
   * tap while open" rule as `_coverDialog`, and its own was-open flag for the same once-per-open/close focus move. */
  _vacuumDialog: Device | null = null;
  private _vacuumDialogWasOpen = false;

  /** S10.4: the chooser dialog, or `null` for none. Opened whenever a tap or hold would have opened more-info but
   *  the object (a device or a non-cover door) names more than one entity — `entitiesOfDevice`/`entitiesOfDoor`,
   *  read by `bindDeviceActions`, decide that, not this file. Same "one dialog at a time, once-per-open/close
   *  focus move" rules as `_coverDialog`/`_vacuumDialog`. */
  _chooserDialog: { title: string; entities: string[]; line?: () => string } | null = null;
  private _chooserDialogWasOpen = false;
  /** S24.8 (C2): "Turn off on this floor…": the floor, its title, the rows that were on when it opened (a snapshot: a row
   *  does not vanish under the finger while a light goes off elsewhere), and which rows are ticked. Same one-dialog rules. */
  _offDialog: { floor: string; title: string; rows: OffRow[]; ticked: boolean[] } | null = null;
  private _offDialogWasOpen = false;
  /** S24.8: the families this viewer hid with the layer chips, kept in the view memory. */
  /** S25.8: the detail mode this viewer picked with the Detail button; `null` leaves the card's YAML `detail` in charge. */
  _pickedDetail: DetailMode | null = null;
  /** S27.13: the Floor below button's pick; `null` leaves the card's YAML `ghost_floor` in charge. */
  _pickedGhost: boolean | null = null;
  /** S27.14: the Floors below select's pick (3D); `null` leaves the card's YAML `floors_below` in charge. */
  _pickedBelow: BelowMode | null = null;
  /** S34.8: the Heat map pick; `null` leaves the card's YAML `heat_map` in charge. */
  _pickedHeat: HeatKind | null = null;
  /** S16.3: the Camera thumbnail picks (on, size, position), each field a viewer's own; `null` leaves the YAML in charge. */
  _pickedCam: Partial<CamThumb> | null = null;
  /** S16.3: the pictures' refresh clock (10 s, stopped while the tab is hidden or the card is off the page) and the cameras whose picture failed. */
  private _cam = new ThumbFeed(() => this.requestUpdate());
  _hiddenLayers: LayerId[] = [];
  /** What search or a row tap located under a hidden family: drawn anyway (`keep`) on its floor, with a note and Show. */
  _kept: { floor: string; t: "dev" | "furn"; i: number; fam: LayerId } | null = null;
  /** S24.8 (F1): the search's entries, built once per layout and state source, not per keystroke (`<fp-search>` indexes on a new array). */
  _searchMemo: { layout: Layout; known: boolean; floors: string; entries: SearchEntry[] } | null = null;
  /** S14.2: the tap popup, or `null` for none. One at a time; `s.key` is who it is about, `x`/`y` where the pointer landed (client px), `opener` the
   *  focusable thing that opened it (an Active row), `confirming` the turn-OFF question, `draft` a slider's shown value until Home Assistant answers. */
  /** S25.5: the device indices of the stack fanned out into a ring, on the floor `_spiderFloor`; null when folded. */
  _spider: number[] | null = null;
  _spiderFloor: string | null = null;
  _popup: { s: PopupSubject; x: number; y: number; opener: Element | null; confirming: boolean; draft: { kind: SliderKind; value: number; from: number | null } | null } | null = null;
  _popupFocusKey: string | null = null;
  _popupReturn: Element | null = null;
  /** S14.2: the hover tooltip (mouse only). `_tipKey` is who it shows, `_tipHost` the card's box read once when it appears, `_tipTitle` a plan `<title>` held back so the browser's own tooltip does not double ours. */
  _tipKey: string | null = null;
  _tipHost: DOMRect | null = null;
  _tipEl: Element | null = null;
  _tipTitle: { el: Element; title: Element } | null = null;
  /** The tooltip's subject and the selector of its plan element, so a re-render (which replaces the plan's elements) can refresh its text and take the new element's `<title>` out again. */
  _tipTarget: TapTarget | null = null;
  _tipSel: string | null = null;
  /** Where the pointer was when the tooltip last moved: a render checks the plan element is still under it (a zoom or turn moves icons under a still pointer). */
  _tipAt: { x: number; y: number } | null = null;
  /** S7.4: the zoomed viewBox, or `null` for fit. Card state: reset by `setConfig` and a floor change, never by `hass`. */
  _view: View | null = null;
  /** S12.3: the live 3D view, the floor and stair context it was built for, and why 3D cannot run (`null` while it can). */
  _view3d: View3D | null = null;
  /** S27.15: the direction the next render's plan root fades in from, set by `_selectFloor` and consumed by `updated`. */
  private _switchDir: "up" | "down" | null = null;
  _fallback3d: string | null = null;
  /** The fallback came from a lost graphics context: the card tries 3D once more when it is attached or shown again. */
  _retry3d = false;
  /** How many 3D renderers are alive in this page: a test hook (a lifecycle test reads that it returns to 0). */
  static get liveRenderers(): number { return lib3d?.liveRenderers() ?? 0; }

  /** The view picked in the dropdown; `null` means the config's own. Card state like `_view`: reset by `setConfig`, never by `hass`. */
  _pickedView: CardView | null = null;
  /** The tilt dragged on the slider; `null` means the config's own. Card state like `_pickedView`: reset by `setConfig`, never by `hass`. */
  _pickedTilt: number | null = null;
  /** The wall heights chosen in the Walls select; `null` means the config's own. Same rule as `_pickedTilt`. */
  _pickedWalls: WallsMode | null = null;
  /** The theme chosen in the Theme select, the labels toggle and the turn the buttons made (a multiple of 45 in
   * 0..315); each `null` means the config's own. Same rule as `_pickedView`, with one more: these and the view,
   * tilt, zoom and focus are what the card remembers (see `_saveViewNow`), so a field is only ever stored once the
   * person has chosen it, and the config stays in charge of the rest. */
  _pickedTheme: Theme | null = null;
  _pickedLabels: boolean | null = null;
  _pickedNames: boolean | null = null;
  _pickedRot: number | null = null;
  /** S33.8: the id of the saved view the viewer last picked from the Views section; it is the checked item until the viewer
   * does anything that is not that view (another floor, Reset view, a new config). View state like `_pickedRot`: never reset by `hass`. */
  _appliedView: string | null = null;
  /** Whether the pointer is over this card: with focus, what decides which card the view keys belong to. */
  private _hovered = false;
  /** A turn in flight: `from` and `to` are user angles in degrees, unwrapped (`to` may be 360, or -45) so the
   * interpolation never takes the long way; `anchor` is the plan point and zoom to hold at the centre, or `null`
   * when the card is at home and home itself follows the angle. */
  _turn: { from: number; to: number; t0: number; dur: number; anchor: { focus: Pt; zoom: number } | null; raf: number } | null = null;
  /** The user angle drawn this frame while `_turn` runs. */
  private _turnAngle = 0;
  /** A stored zoom and focus (plan cm) waiting for the first render, the first moment the fit box is known. */
  _pendingView: { focus: Pt; zoom: number } | null = null;
  /** S14.4: what the viewer left each floor looking like (2D zoom and spot, the turn, the 3D camera), by floor key. Kept
   * in memory too, so a floor remembers even when storage is blocked. `_memFloor` is the floor the live view state
   * (`_view`, `_pickedRot`, the camera) belongs to; `null` until the first render knows the floor. */
  _floorViews = new Map<string, FloorView>();
  _memFloor: string | null = null;
  /** The floor key the 3D view's scene was built for, and whether the person moved its camera on that floor. */
  _view3dKey: string | null = null;
  _camMoved = false;
  /** S32.7: the room the 3D view was last told to frame. A canvas tap's pick waits out the double-tap window before it reaches the view (`_focusHold`), so a double tap never moves the camera. */
  _focus3d: number | null = null;
  _focusHold = false;
  _focusTimer: ReturnType<typeof setTimeout> | null = null;
  /** The debounce timer for pan and zoom saves; non-null means there is something unsaved. */
  _saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The fit box of the floor on show, from the last render; the zoom handlers clamp against it. */
  _fit: View | null = null;
  private _unbindZoom: (() => void) | null = null;
  private _unbindCam: (() => void) | null = null;
  /** S9.5: the Overview's fold, per card, in browser storage (try/catch: private browsing or blocked storage just means
   * the sheet forgets between reloads). S31.5: the panel is no longer dragged, so the stored `x` and `y` of older builds
   * are ignored and not written back; the fold is kept. */
  _activeCollapsed = false;
  /** S14.6: the category groups the viewer folded, as `list:category` ids (`a:` Active list, `r:` Room panel). Per card, in browser storage. */
  _foldedCats = new Set<string>();
  /** S34.4: the card's cleaned `favourites` (read once per `setConfig`), and the entities as a set for Search. */
  _fav: FavouritesRead = { ids: [], warn: false };
  _favSet: ReadonlySet<string> = new Set();
  /** The favourite whose Turn off is at its confirm step. Card state: kept through `hass`, dropped by `setConfig`. */
  _favAsk: string | null = null;
  /** S31.5: what the card's width gives it (frame.ts). Measured in `render()` and by the ResizeObserver; 0 wide (not laid
   * out) keeps the last answer. */
  _frame: FrameMode = "bottom";
  /** S31.8: the bottom sheet's stop. Not remembered: a cold card is at peek, and `setConfig` puts it back. */
  _sheetStop: SheetStop = "peek";
  /** S31.8: a drag in flight. `h` is the sheet's height now, `trail` the last heights with their times (for the fling). */
  _sheetDrag: { id: number; y0: number; h0: number; h: number; moved: boolean; stops: Stops; trail: { t: number; h: number }[] } | null = null;
  /** S31.8: a drag just ended on the handle; the click the browser sends after it is not a tap. */
  _dragEnded = false;
  /** S31.8: the selector of what the sheet just opened for; the next `updated()` pans it above the sheet. */
  _panTarget: string | null = null;
  /** Whether the user has folded or unfolded the list by hand (kept in storage with the rest). Until then the card's
   * own width decides: folded under `ACTIVE_FOLD_BELOW_PX`, open from there up, followed on every resize (0.12.17;
   * it was a one-off check at 500px that a stored drag position switched off). After, the choice is theirs. */
  _activeUserChose = false;
  private _activeResizeObserver: ResizeObserver | null = null;
  /** S11.3: the room the person tapped, by floor key and room id (not index, so a reloaded layout keeps it), or null.
   *  Card chrome state, not a layout field: nothing here is saved, and a `hass` update leaves it alone. */
  _pickedRoom: { floor: string; id: string } | null = null;
  /** S20.2: the floor key whose pill was pressed, or null. Like `_pickedRoom` it is card chrome, and it excludes it: a room
   *  pick clears the floor and a floor pick clears the room, so the one panel always has one subject. */
  _pickedFloor: string | null = null;
  /** S14.7: the scene button (`custom:<id>`) that waits for its confirm, because it turns a switch off. */
  _sceneAsk: string | null = null;
  /** Whether the Active list is cut to the picked room's entities (the default on a pick); "Show all" turns it off. */
  _roomFilter = true;
  /** S24.7 (F3): the Overview lists every floor, not only the one shown. Kept with the panel's other view memory. */
  _overviewAll = false;
  /** S24.7: the thing a row tap went to, ringed on the plan for `PULSE_MS`; null when none. */
  _pulse: ({ floor: string } & ThingRef) | null = null;
  /** S31.10: the index (`data-x`) of the device the keys stand on, or null. Card state: kept through `hass`, dropped by a floor switch, `setConfig`,
   *  a click on the plan and focus leaving the plan (its own popup excepted). */
  _focusDev: number | null = null;
  _pulseTimer: ReturnType<typeof setTimeout> | null = null;
  /** `attention()` for the layout and states on show, computed once per pair: the pills and the Overview both read it. */
  _attnMemo: { layout: Layout; states: unknown; reg: unknown; a: Attention } | null = null;
  private _actionsPanel: HTMLElement | null = null;
  private _unbindPanel: (() => void) | null = null;
  /** S12.4: the 3D host the taps are bound on, and what unbinds them. */
  private _actions3d: HTMLElement | null = null;
  private _unbind3d: (() => void) | null = null;
  private _unbindHover: (() => void) | null = null;
  private _unbindSpider: (() => void) | null = null;

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
  _storageSeed(): unknown[] {
    const source = this._config.layout_url ?? (this._config.layout ? "inline" : "ws");
    const seed: unknown[] = [source, this._config.floor ?? null, this._config.floors ?? null];
    if (this._config.center !== undefined) seed.push(this._config.center);
    if (this._config.zoom_level !== undefined) seed.push(this._config.zoom_level);
    return seed;
  }

  _activeStorageKey(): string {
    return `fp-active-panel:${tag(JSON.stringify(this._storageSeed()))}`;
  }

  /** Makes the live view state (zoom box, turn) the shown floor's own, when the shown floor is not the one it belongs
   * to: on the first render, and on a floor switch. A floor with nothing remembered starts at the config's look. */
  private _syncFloorMemory(): void {
    const key = this._floorKey();
    if (!key || key === this._memFloor) return;
    const fv = this._floorViews.get(key);
    this._pickedRot = fv?.rotation !== undefined && fv.rotation !== normaliseRotation(this._config.rotation) ? fv.rotation : null;
    this._pendingView = fv?.zoom !== undefined && fv.focus ? { focus: fv.focus, zoom: fv.zoom } : null;
    this._view = null;
    this._memFloor = key;
  }

  _scheduleSave(): void { return scheduleSave(this); } // card-view-state.ts

  /** A pending debounced save goes out now (the card is leaving, or the page is). */
  private _flushSave = (): void => {
    if (this._saveTimer !== null) saveViewNow(this);
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
  _ownsViewKeys(): boolean {
    if (focusedCard) return focusedCard === this;
    return this._hovered;
  }

  private _onViewKey = (ev: KeyboardEvent): void => onViewKey(this, ev); // card-zoom.ts

  // ---- S31.10: keys on the plan (D4) --------------------------------------------------------------------------------------------------

  _stageSvg(): SVGSVGElement | null {
    return this.shadowRoot?.querySelector<SVGSVGElement>("svg.fp-zoomable") ?? null;
  }

  _dropFocus = (): void => {
    if (this._focusDev === null) return;
    this._focusDev = null;
    this.requestUpdate();
  };

  /** The plan got focus. By keyboard (a Tab or Shift+Tab, `:focus-visible`) the device nearest the middle of what is visible takes it; a mouse or a
   *  finger on the plan gives focus to the plan only. Coming back from the popup the device is still set and stays. */
  private _onStageFocus = (ev: FocusEvent): void => {
    const svg = ev.currentTarget as SVGSVGElement;
    if (this._focusDev !== null || !svg.matches(":focus-visible")) return;
    const v = visibleBox(this), pts = this._planPoints();
    const at = firstFocus(pts, v ? { x: (v.left + v.right) / 2, y: (v.top + v.bottom) / 2 } : null);
    if (at >= 0) this._focusOn(pts[at]!.i);
  };

  /** Focus left the plan: the device goes with it, unless it went into the popup that device opened. */
  private _onStageBlur = (ev: FocusEvent): void => {
    if ((ev.relatedTarget as Element | null)?.closest?.(".fp-pop")) return;
    this._dropFocus();
  };

  /** The devices the plan draws, in reading order, with the centre of each one's box on screen. A device hidden by Layers or Detail has no box. */
  private _planPoints(): { i: number; x: number; y: number }[] {
    const out: { i: number; x: number; y: number }[] = [], seen = new Set<number>();
    this._stageSvg()?.querySelectorAll<SVGGElement>("g[data-x]").forEach((g) => {
      const i = Number(g.getAttribute("data-x")), r = g.getBoundingClientRect();
      if (!Number.isInteger(i) || seen.has(i) || getComputedStyle(g).display === "none" || !(r.width + r.height > 0)) return;
      seen.add(i);
      out.push({ i, x: r.left + r.width / 2, y: r.top + r.height / 2 });
    });
    return out;
  }

  /** An arrow with a device focused: the nearest drawn device that way on screen. True when focus moved (the key is then taken). */
  _moveFocus(dir: FocusDir): boolean {
    const pts = this._planPoints(), at = pts.findIndex((p) => p.i === this._focusDev);
    const to = at < 0 ? firstFocus(pts, null) : nextInDirection(pts, at, dir);
    if (to < 0 || to === at) return at >= 0; // the edge of the house: the key is ours, nothing moves
    this._focusOn(pts[to]!.i);
    return true;
  }

  /** The device `i` takes the keys' focus; off the visible part of the plan, the plan pans it in. The ring follows in `updated`. */
  private _focusOn(i: number): void {
    this._focusDev = i;
    const g = this._stageSvg()?.querySelector(`g[data-x="${i}"]`);
    if (g && !this._shows3d()) panBoxIn(this, g);
    this.requestUpdate();
  }

  /** Enter or Space: the popup of the focused device, as a tap on it opens it (the Device level of the sheet on a phone). */
  _openFocused(): boolean {
    const svg = this._stageSvg(), i = this._focusDev, t = i === null ? null : this._targetOf("x", i);
    const r = i === null ? null : svg?.querySelector(`g[data-x="${i}"]`)?.getBoundingClientRect();
    if (!svg || !t || !r) return false;
    this._openPopup(t, { x: r.left + r.width / 2, y: r.top + r.height / 2 }, svg);
    return true;
  }

  /** What the hidden status line says: "Kitchen spot 1, light, on". */
  private _focusText(): string {
    const t = this._focusDev === null ? null : this._targetOf("x", this._focusDev), s = t && subjectOf(this, t);
    return s ? [s.name, s.type, subjectText(this, s)].filter(Boolean).join(", ") : "";
  }

  /** After every render: the ring sits over the focused device's box, or hides when the plan does not show it. */
  private _placeFocusRing(): void {
    const ring = this.shadowRoot?.querySelector<HTMLElement>(".fp-focus");
    if (!ring) return;
    const g = this._focusDev === null ? null : this._stageSvg()?.querySelector(`g[data-x="${this._focusDev}"]`);
    const r = g && getComputedStyle(g).display !== "none" ? g.getBoundingClientRect() : null, h = this.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) { ring.hidden = true; return; }
    ring.hidden = false;
    ring.style.left = `${r.left - h.left + r.width / 2}px`;
    ring.style.top = `${r.top - h.top + r.height / 2}px`;
    ring.style.width = ring.style.height = `${Math.max(24, Math.min(r.width, r.height) + 16)}px`;
  }

  /** Whether the two rotate buttons exist, which is when [ and ] turn the plan. `rotate_switch` decides
   * when it is a boolean; otherwise they come with any other control the card draws (zoom or the View dropdown)
   * and go with kiosk. Rotation does not depend on 2.5D: it turns the 2D plan too. */
  _rotateOn(): boolean {
    const r = this._config.rotate_switch;
    if (r === true || r === false) return r;
    return !this._kiosk() && (this._zoomMode() !== false || this._config.view_switch !== false);
  }

  _viewSwitchOn(): boolean {
    return this._config.view_switch !== false && !this._kiosk();
  }

  /** Whether the toolbar has a Reset view button, which is when Space resets the whole view. */
  _hasViewControls(): boolean {
    return this._viewSwitchOn() || this._rotateOn();
  }

  /** The zoomed view as what survives a turn and a reload: its zoom against fit and its centre in plan cm, which is
   * the layout's own coordinates before any rotation. `null` at home. */
  _anchorOfView(): { focus: Pt; zoom: number } | null {
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

  _catStorageKey(): string {
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

  _saveActiveState(): void {
    try {
      globalThis.localStorage?.setItem(this._activeStorageKey(), JSON.stringify({ collapsed: this._activeUserChose && this._activeCollapsed, chosen: this._activeUserChose, all: this._overviewAll }));
    } catch {
      /* private browsing or storage blocked: the fold just does not persist */
    }
  }

  static getStubConfig(): FloorplanStudioCardConfig {
    return { type: "custom:floorplan-studio-card" };
  }

  /** S7.7: the Edit-card dialog's own form instead of raw YAML.
   * S38.0: the form is a chunk beside the card (floorplan-studio-form-<hash>.js), fetched here on first use; it registers
   * `floorplan-studio-card-editor` as it loads. Home Assistant awaits this call (frontend `hui-card-element-editor.ts` returns it from an async method,
   * `hui-element-editor.ts` does `await this.getConfigElement()`), so a viewer who never edits the card never downloads the form. */
  static async getConfigElement(): Promise<HTMLElement> {
    // A browser remembers a failed `import()` of one URL (as for the 3D chunk above), so each call after a failure asks under a new
    // query (the count of failures so far; a success is cached under its own URL, so it is never imported twice). A failure does not
    // reject: Home Assistant would show a broken dialog until the page is reloaded; it gets the words instead.
    // The URL is built from `import.meta.url`, not a template over the compiled-in name (Vite would bundle every file the template could
    // match), and the import is not inside a `try` (Rollup then keeps the dead `./config-editor` branch and the card splits in two).
    const fails = formFails;
    const url = fails > 0 ? `${import.meta.url.split(/[?#]/)[0].replace(/[^/]*$/, "")}${FORM_FILE.slice(2)}?r=${fails}` : FORM_FILE;
    return (FORM_FILE ? import(/* @vite-ignore */ url) : import("./config-editor")).then(
      () => document.createElement("floorplan-studio-card-editor"),
      () => { formFails++; return Object.assign(document.createElement("p"), { textContent: t(STALE_PAGE), setConfig: () => undefined }); },
    );
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._syncCam();
    // S2.7: programmatically focusable (not in the tab order) so the card itself can take focus back after the
    // cover dialog closes, without adding a stop no keyboard user would otherwise want. Set here, not in the
    // constructor: the custom element spec forbids gaining attributes during construction (jsdom enforces this
    // and throws NotSupportedError; a real browser is more forgiving, but this is the correct place regardless).
    if (!this.hasAttribute("tabindex")) this.tabIndex = -1;
    // Opus review findings 3/4: a host resize (a dashboard column narrowing, a sidebar opening, a card being
    // dragged to a new grid size) must re-clamp the panel too, not only a fresh render. jsdom has no
    // ResizeObserver; the unit suite never needs this path, so it is skipped there rather than polyfilled.
    if (typeof ResizeObserver !== "undefined") {
      this._activeResizeObserver = new ResizeObserver(() => { fitHeight(this); applyWidthDefault(this); this._positionActivePanel(); this._measurePx(); });
      this._activeResizeObserver.observe(this);
      // S31.7: and the parent, whose height is what says whether the card is fitted: a sections row resized by hand moves it
      // while the card, held at its own pixel height, would not move at all.
      const parent = this.parentElement ?? (this.getRootNode() as ShadowRoot | undefined)?.host;
      if (parent) this._activeResizeObserver.observe(parent);
    }
    // S31.7: the screen's height is not the host's, so the observer above never hears of it. The visual viewport also
    // shrinks when a phone's address bar comes back or the keyboard opens.
    globalThis.addEventListener?.("resize", this._fitHeight);
    globalThis.visualViewport?.addEventListener("resize", this._fitHeight);
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
    this._watchUpdates();
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
    this._releaseFocus();
    this._flushSave(); // under the old config's key
    this._settleTurn(false);
    const prev = this._config;
    this._config = config ?? {};
    // A new config with the same source keeps the loaded plan: the card editor calls setConfig on every keystroke.
    const sameSource = !!this._layout && !this._config.layout && !prev.layout && prev.layout_url === this._config.layout_url;
    this._warnActions();
    this._readFavourites();
    this._warnHeat();
    this._closePopup();
    this._focusDev = null;
    hideTip(this);
    if (!sameSource) {
      this._layout = null;
      this._error = null;
      this._urlRequested = false;
      this._wsRequested = false;
      this._wsFails = 0;
    }
    this._shownFloor = null;
    this._pickedRoom = null;
    this._pickedFloor = null;
    this._sheetStop = "peek"; // S31.8: a new config starts the sheet over, at peek, on the Overview
    this._panTarget = null;
    this._view = null;
    this._fallback3d = null;
    loadViewState(this);
    loadActiveState(this);
    this._loadFoldedCats();
    this._loadLayout();
    this.requestUpdate();
  }

  get hass(): Hass | undefined {
    return this._hass;
  }

  set hass(h: Hass) {
    this._hass = h;
    if (!this._layout) this._loadLayout();
    this._syncTimer();
    // S37.5: a language change is a re-render and nothing else. The layout, the view and the selection are not touched, so zoom and edits survive.
    void useLanguage(h?.language ?? h?.locale?.language).then((changed) => { if (changed) this.requestUpdate(); });
    this.requestUpdate();
  }

  /** The states the render reads. A motion sensor's own `last_changed` is the moment it went off, so it is also the moment its
   * fade starts (2026-10-06: the card used to remember when it went on, which ended a long motion's fade before it began). */
  /** G9: HA's display text for an entity (precision, translated state), or undefined when the frontend has no formatter or it throws. */
  _format = (entity: string): string | undefined => {
    const h = this._hass, st = this._stateForRender()?.[entity];
    if (!h?.formatEntityState || !st) return undefined;
    try { return h.formatEntityState(st) || undefined; } catch { return undefined; }
  };

  /** S39.3: the replay, while the bar is open (card-replay.ts). Null is live. */
  _replay: ReplayState | null = null;

  /** S39.3: the states the plan is drawn from: the replayed ones while the bar is open and its history is there, else Home Assistant's. */
  _stateForRender(): Hass["states"] | undefined {
    return replayStates(this) ?? this._hass?.states;
  }

  /** S39.3: the card's one clock for drawing (motion fade, the 3D `now`), the replayed moment while the bar is open. Service calls keep the real one. */
  _now(): number {
    return this._replay?.drawnT ?? Date.now();
  }

  /** S39.3: a tap acts on nothing in the past; the bar says why. Passed to the gesture binders. */
  _replayGuard() {
    return { replaying: () => this._replay !== null, onReplay: () => replayTap(this) };
  }

  /** S14.8: the draw range plugs are tinted over, from the two card options (untrusted: junk is the default range). */
  _plugHeat(): [number, number] {
    return heatRange([this._config.plug_heat_from ?? HEAT_FROM, this._config.plug_heat_to ?? HEAT_TO]);
  }

  /**
   * Plug entity -> power sensor, for plugs with no `power` in the layout: the one `sensor.*` of device class `power`
   * on the plug's own HA device (`hass.entities` gives the device, the sensor's state its class). An explicit
   * `power` is never overridden (the renderer reads it first), and two candidates link nothing (`findPowerSensor`).
   */
  _powerLinks(): Record<string, string> | undefined {
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
    fitHeight(this); // a panel view bounds the card itself (the :host([panel]) rule): take the pixel height off
  }
  get layout(): string | undefined {
    return this.hasAttribute("panel") ? "panel" : undefined;
  }

  getGridOptions(): { columns: number; rows: number; min_columns: number; min_rows: number } {
    return { columns: 12, rows: this._rows(), min_columns: 6, min_rows: 3 };
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cam.want(false);
    this._releaseFocus();
    this._stopTimer();
    pauseReplay(this);
    const sub = this._sub; // may still be on its way: unsubscribe when it lands
    this._sub = null;
    void sub?.then((u) => u(), () => undefined);
    if (this._readyCb) this._hass?.connection?.removeEventListener?.("ready", this._readyCb);
    this._readyCb = null;
    if (this._pulseTimer !== null) { globalThis.clearTimeout(this._pulseTimer); this._pulseTimer = null; this._pulse = null; }
    globalThis.removeEventListener?.("pagehide", this._flushSave);
    globalThis.document?.removeEventListener("visibilitychange", this._onVisibility);
    globalThis.removeEventListener?.("keydown", this._onViewKey);
    globalThis.document?.removeEventListener("pointerdown", this._onOutsideDown, true);
    globalThis.removeEventListener?.("scroll", this._hideTip, true);
    this._popup = null;
    hideTip(this);
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
    this._unbindSpider?.();
    this._unbindSpider = null;
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
    globalThis.removeEventListener?.("resize", this._fitHeight);
    globalThis.visualViewport?.removeEventListener("resize", this._fitHeight);
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
      this._spider = null; // its indices belonged to the layout just replaced
      this._closePopup(); // its subject belonged to the layout just replaced
      hideTip(this);
      this._error = null;
    } catch (e) {
      const why = e instanceof Error ? e.message : "";
      this._error = why ? { key: PLAN_UNUSABLE, vars: { why } } : NO_LAYOUT;
      // A plan this build rejects may be one a newer Studio wrote: a cached card after an update. Say so.
      if (why && this._hass?.connection) void pageIsStale(this._hass.connection).then((stale) => { if (stale && !this._layout) { this._error = { key: STALE_PAGE }; this.requestUpdate(); } });
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
      this._fetchLayout(false);
      this._watchUpdates();
      return;
    }
    this._error = NO_LAYOUT;
  }

  /** S7.16: the integration answers `{ layout }` (websocket.py); `null` when nothing has been saved yet. The reply is shared by
   * every card on the connection, so each applies its own copy. A `reload` (after a Studio save) keeps what is on screen if it fails. */
  private _fetchLayout(reload: boolean): void {
    const conn = this._hass!.connection!;
    loadShared(conn).then((r) => {
      this._wsFails = 0;
      if (r?.layout == null) {
        if (!reload) { this._error = { key: NOTHING_SAVED }; this.requestUpdate(); }
        return;
      }
      this._applyLayout(structuredClone(r.layout));
    }).catch((e) => { if (!reload) this._loadFailed(conn, e); });
  }

  /** Says why, allows one retry on the next `hass`, and loads again when the connection is ready again. Bounded: no timer, no loop. */
  private _loadFailed(conn: Conn, e: unknown): void {
    this._error = loadErrorText(e);
    if (this._wsFails++ < 1) this._wsRequested = false;
    if (!this._readyCb) {
      this._readyCb = () => { this._wsFails = 0; this._wsRequested = false; this._loadLayout(); };
      conn.addEventListener?.("ready", this._readyCb);
    }
    this.requestUpdate();
  }

  /** G3: a Studio save pushes an event; follow it. Only for a plan that comes from the websocket. `floorplan_studio/subscribe` works
   * for any user; an older integration lacks it (`unknown_command`), so fall back to the bus event, which only admins may subscribe to. */
  private _watchUpdates(): void {
    const conn = this._hass?.connection;
    if (!conn || (!conn.subscribeMessage && !conn.subscribeEvents) || this._sub || this._config.layout || this._config.layout_url) return;
    const onSave = (): void => { if (!this._config.layout && !this._config.layout_url) this._fetchLayout(true); };
    const old = (): Promise<() => void> => conn.subscribeEvents ? conn.subscribeEvents(onSave, "floorplan_studio_updated") : Promise.reject(new Error("no subscribeEvents"));
    this._sub = conn.subscribeMessage
      ? conn.subscribeMessage(onSave, { type: "floorplan_studio/subscribe" }).catch((e: { code?: string }) => { if (e?.code === "unknown_command") return old(); throw e; })
      : old();
    this._sub.catch(() => { this._sub = null; });
  }

  private _openStudio = (e: Event): void => {
    e.preventDefault();
    history.pushState(null, "", "/floorplan-studio"); // HA's own `navigate`: push, then tell the router
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  };

  /** The turn the plan is drawn at: the layout's own rotate plus the user's. Turned into the `{ deg, pivot }`
   * renderFloor and viewBoxFor take, or `undefined` for none. Shared so getCardSize sees the same box render() draws. */
  _rotate(): { deg: number; pivot: [number, number] } | undefined {
    if (!this._layout) return undefined;
    const deg = (this._layout.rotate ?? 0) + this._userAngle();
    return deg % 360 ? { deg, pivot: planPivot(this._layout) } : undefined;
  }

  /** The user's turn in degrees: the settled step, or the frame of a turn in flight. */
  _userAngle(): number {
    return this._turn ? this._turnAngle : this._pickedRot ?? normaliseRotation(this._config.rotation);
  }

  private _reducedMotion(): boolean {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  }

  /** One click of a rotate button: 45 degrees from where the turn in flight is going, or from where the plan is.
   * The plan point at the centre of the screen stays there (`anchor`), so zoom and focus survive the turn. */
  _turnBy(delta: number): void {
    const to = (this._turn ? this._turn.to : this._userAngle()) + delta;
    this._startTurn(to, this._turn ? this._turn.anchor : this._anchorOfView());
  }

  /** Turns the user's angle to `to` (unwrapped degrees). A turn already running is replaced from its current frame,
   * so a second click neither jumps nor drifts. Reduced motion lands at once. */
  _startTurn(to: number, anchor: { focus: Pt; zoom: number } | null): void {
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
  _settleTurn(render: boolean): void {
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
    saveViewNow(this);
    if (render) this.requestUpdate();
  }

  /** The whole-floor box at the angle, view and tilt on show, or `null` with no floor. */
  private _fitNow(): View | null {
    const f = this._floor();
    return f ? viewBoxFor(f, 60, this._rotate(), this._planView(), this._tilt()) : null;
  }

  /** The card's theme: the Theme select's pick, else `config.theme`, blueprint when there is none or it is not a theme. The OS and Home Assistant's dark mode no longer pick it: only `theme: ha` follows Home Assistant. */
  _theme(): Theme {
    if (this._pickedTheme) return this._pickedTheme;
    const t = this._config.theme;
    return isTheme(t) ? t : "blueprint";
  }

  /** Whether the names and values show: the toggle's pick, else `config.labels` (only a real `false` hides). */
  _labels(): boolean {
    return this._pickedLabels ?? this._config.labels !== false;
  }

  /** Whether every device's name shows: the toggle's pick, else `config.names` (only a real `true` shows them). */
  _names(): boolean {
    return this._pickedNames ?? this._config.names === true;
  }

  /** Home Assistant's dark mode, used only by `theme: ha` to choose the dark set for what its CSS variables do not cover. */
  _haDark(): boolean {
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
  _floorList(): [string, Floor][] | null {
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
  _floorKey(): string | null {
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

  _floor(): Floor | null {
    const key = this._floorKey();
    return key && this._layout ? this._layout.floors[key] : null;
  }

  /** S2.6: switches which floor `floor: "all"` shows. Ordinary card chrome, not a plan gesture, so it is wired with
   * a plain button click, not `bindDeviceActions` (CLAUDE.md finding 3: that gesture implementation is for hits on
   * the plan itself).  */
  _selectFloor(key: string): void {
    if (this._shownFloor === key) return;
    this._appliedView = null; // a saved view is checked only while its floor is the one on show
    // S27.15: 2D and 2.5D fade the new floor in from the way it travels; 3D cuts (no plan root to animate), and reduced motion cuts.
    const from = this._floorKey(), keys = this._layout ? Object.keys(this._layout.floors) : [];
    this._switchDir = from && this._viewPick() !== "3d" ? floorSwitch(keys, from, key, this._reducedMotion())?.dir ?? null : null;
    this._closePopup(); // its subject is on the floor just left
    this._focusDev = null; // and so is the device the keys stood on
    this._settleTurn(false); // a turn in flight ends where it was going, under the floor it began on
    saveViewNow(this); // the floor just left keeps its zoom, turn and camera (S14.4)
    this._shownFloor = key;
    this._kept = null; // a kept thing is kept on its floor only, and only until the person looks elsewhere
    this._pickedRoom = null; // a room of the floor just left means nothing on this one
    this._pickedFloor = null;
    this._releaseFocus(); // a canvas tap's hold on the floor just left must not send its room index to this one,
    this._focus3d = null; // where the same index is another room
    this._syncFloorMemory(); // and the floor now shown brings its own
    this._scheduleSave();
    this.requestUpdate();
  }

  /** S27.15: starts the floor switch animation on the plan root, after the render that drew the new floor. The attribute is taken off
   * and put back after a reflow so a second switch restarts the motion; `animationend` takes it off again, so nothing stale is left. */
  private _playSwitch(): void {
    const dir = this._switchDir;
    this._switchDir = null;
    const svg = this.shadowRoot?.querySelector<SVGSVGElement>("svg.fp-zoomable");
    if (!dir || !svg) return;
    if (!this._switchEnds.has(svg)) {
      this._switchEnds.add(svg);
      svg.addEventListener("animationend", (e) => { if (e.target === svg && e.animationName.startsWith("fp-floor-in")) svg.removeAttribute("data-switch"); });
    }
    svg.removeAttribute("data-switch");
    void svg.getBoundingClientRect();
    svg.setAttribute("data-switch", dir);
  }
  private _switchEnds = new WeakSet<Element>();

  /** True while any motion sensor on the shown floor (a motion device, or a room's own `motion` list) is off and inside its fade window,
   * or for one tick after it, so the last render is made past the window and leaves no faint border behind. */
  private _motionFading(): boolean {
    const f = this._floor();
    const fadeMs = (this._config.fade ?? DEFAULT_MOTION_FADE_S) * 1000;
    if (!f || !this._hass || fadeMs <= 0 || this._replay) return false; // a replayed fade follows the bar's moment, not the clock
    const now = Date.now();
    const ids = [...f.devices.filter((d) => d.type === "motion").map((d) => d.entity), ...f.rooms.flatMap((r) => r.motion ?? [])];
    return ids.some((id) => {
      const s = this._hass!.states[id];
      if (!s || s.state === "on") return false;
      const t = Date.parse(s.last_changed);
      return !Number.isNaN(t) && now - t < fadeMs + 1000;
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
  _syncTimer(): void {
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
   * S7.8: a render once replaced every node under the <svg>, so `.dev-person`'s transform transition would never fire on
   * its own: the new node started where it ended. Since S25.6 the node is kept and only its style changes, but the FLIP stays: it also covers a full render. For each person that moved, the new node is put back
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
    syncReplay(this);
    applyWidthDefault(this);
    this._positionActivePanel();
    if (this._panTarget) panIntoVisible(this);
    // S24.8: the search box draws itself after this render; the panel grows by its height then, so place it again.
    const box = this.shadowRoot?.querySelector<HTMLElement & { hasUpdated: boolean; updateComplete: Promise<unknown> }>("fp-search");
    if (box && !box.hasUpdated) void box.updateComplete.then(() => this._positionActivePanel());
    this._measurePx();
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
    this._playSwitch();

    const svg = this.shadowRoot?.querySelector("svg") ?? null;
    if (svg !== this._actionsSvg) {
      // Lit keeps the <svg> element itself across renders (only its content is patched, S25.6), so binding
      // once per element, not once per render, avoids piling up duplicate listeners (S2.2 "Break it": no
      // debounce, but also no double-firing from a stale second listener).
      this._unbindActions?.();
      this._unbindActions = svg
        ? bindDeviceActions(svg, this, (i) => this._floor()?.devices[i], (i) => this._floor()?.doors[i], {
            longPress: !this._kiosk(),
            openVacuumDialog: (d) => this._openVacuumDialog(d),
            openChooser: (title, entities, line) => this._openChooserDialog(title, entities, line),
            openPopup: (t, at, from) => this._openPopup(t, at, from),
            getUnlinked: (i) => this._floor()?.unlinked[i],
            getPiece: (i) => this._floor()?.furniture?.[i],
            stack: (i) => tapStack(this, i),
            ...this._tapOpts(),
            ...this._replayGuard(),
          })
        : null;
      this._unbindSpider?.();
      this._unbindSpider = svg ? bindSpider(this, svg) : null;
      this._unbindHover?.();
      this._unbindHover = svg ? bindHover(this, svg) : null;
      this._unbindZoom?.();
      this._unbindZoom = svg ? this._bindZoom(svg) : null;
      // S16.3: an <image> that fails to load fires `error` on itself and does not bubble, so it is heard on the way down.
      this._unbindCam?.();
      svg?.addEventListener("error", this._onCamError, true);
      this._unbindCam = svg ? () => svg.removeEventListener("error", this._onCamError, true) : null;
      this._actionsSvg = svg;
    }
    this._syncCam();

    // S12.4: the 3D view's taps, on its own host, bound once per element like the plan's.
    const host3 = this.shadowRoot?.querySelector<HTMLElement>(".fp-3d") ?? null;
    if (host3 !== this._actions3d) {
      this._unbind3d?.();
      this._unbind3d = host3 && lib3d ? lib3d.bind3d(this, host3, DEPS_3D) : null;
      this._actions3d = host3;
    }

    // S11.3: the panel's device rows go through the same gesture binder as the plan's icons, bound once per element.
    const panel = this.shadowRoot?.querySelector<HTMLElement>(".fp-active") ?? null;
    if (panel !== this._actionsPanel) {
      this._unbindPanel?.();
      this._unbindPanel = panel
        ? bindDeviceActions(panel, this, (i) => this._floor()?.devices[i], undefined, {
            longPress: !this._kiosk(),
            openVacuumDialog: (d) => this._openVacuumDialog(d),
            openChooser: (title, entities, line) => this._openChooserDialog(title, entities, line),
            openPopup: (t, at, from) => this._openPopup(t, at, from),
            ...this._replayGuard(),
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

    // S24.8: the floor-off checklist, the same rule: Cancel on open, the card on close, once each.
    const offOpen = this._offDialog !== null;
    if (offOpen && !this._offDialogWasOpen) {
      this.shadowRoot?.querySelector<HTMLButtonElement>(".fp-off-dialog button.cancel")?.focus();
    } else if (!offOpen && this._offDialogWasOpen) {
      this.focus();
    }
    this._offDialogWasOpen = offOpen;
    syncPopup(this);
    syncTip(this);
    placePulse(this);
    this._placeFocusRing();
  }

  /** Whether the 3D model is what the card draws: 3D is picked, its module is loaded, it has not failed, and there is a floor. */
  _shows3d(): boolean {
    return this._viewPick() === "3d" && lib3d !== null && this._fallback3d === null && this._floor() !== null;
  }

  _dispose3d(): void {
    if (this._view3d && this._camMoved) saveViewNow(this); // the camera is read from the view: before it goes
    this._view3d?.dispose();
    this._view3d = null;
    this._view3dKey = null;
  }

  /** Brings the 3D view in line with what the card shows, after every render: loads the module on the first need and ends the
   * view when the pick moves away. The rest (S36.4) is `sync3d` in the 3D chunk. It never throws; every failure is the one line and the 2D plan. */
  private _sync3d(): void {
    const f = this._floor();
    if (this._viewPick() !== "3d" || !f) { this._dispose3d(); return; }
    if (this._fallback3d !== null) { this._dispose3d(); return; }
    if (!lib3d) {
      loadLib3d().then(() => this.requestUpdate(), () => { this._fallback3d = mark("3D view unavailable: its code did not load. Showing 2D."); this.requestUpdate(); });
      return;
    }
    lib3d.sync3d(this, DEPS_3D);
  }

  /** Ends the wait: a second tap, another way of picking, a new config or a disconnect. Says nothing to the view. */
  _releaseFocus(): void {
    if (this._focusTimer !== null) globalThis.clearTimeout(this._focusTimer);
    this._focusTimer = null;
    this._focusHold = false;
  }

  _openCoverDialog(door: Door): void { return openCoverDialog(this, door); } // card-dialogs.ts

  _openVacuumDialog(d: Device): void { return openVacuumDialog(this, d); } // card-dialogs.ts

  _openChooserDialog(title: string, entities: string[], line?: () => string): void { return openChooserDialog(this, title, entities, line); } // card-dialogs.ts

  // ---- S14.2: the tap popup and the hover tooltip ------------------------------------------------------------------------------------

  private _onOutsideDown = (e: Event): void => onOutsideDown(this, e); // card-popup.ts

  _targetOf(kind: "x" | "d" | "u" | "f", i: number): TapTarget | null { return targetOf(this, kind, i); } // card-popup.ts

  _pulseRaf = 0;

  /** S34.4 (F1): reads `favourites` once per config, and warns once per card when the list had junk in it. Never throws. */
  private _favWarned = false;
  private _readFavourites(): void {
    this._fav = favouritesOf(this._config);
    this._favSet = new Set(this._fav.ids);
    this._favAsk = null;
    if (!this._fav.warn || this._favWarned) return;
    this._favWarned = true;
    console.warn(`floorplan-studio-card: favourites has an item that is not an entity id (or a repeat, or more than 24), so it was left out. Use a list of ids like light.kitchen (docs/card.md).`);
  }

  /** S34.8 (H8): one console warning per card for a `heat_map` that is there but is not `off`, `temperature` or `humidity`; absent is no warning. */
  private _heatWarned = false;
  private _warnHeat(): void {
    if (this._heatWarned || !heatKindOf(this._config.heat_map).warn) return;
    this._heatWarned = true;
    console.warn(`floorplan-studio-card: heat_map is not off, temperature or humidity, so it is off. Use one of the three words, in lower case (docs/card.md).`);
  }

  /** S16.3: the thumbnail choice: this viewer's picks over the YAML, junk as the defaults. */
  _camThumb(): CamThumb {
    return camThumbOf(this._config as Record<string, unknown>, this._pickedCam);
  }

  /** S16.3: what `renderFloor` and the 3D view are given, or `undefined` while the option is off (then no picture is asked for). */
  _camOpts() {
    const t = this._camThumb();
    return t.on ? { ...t, bust: this._cam.bust, failed: this._cam.failed } : undefined;
  }

  /** S16.3: the refresh clock runs while pictures are on and the card is on the page; a picture that fails to load is dropped until the next refresh. */
  private _syncCam(): void {
    this._cam.want(this.isConnected && !!this._config && this._camThumb().on);
  }

  private _onCamError = (e: Event): void => {
    const i = Number((e.target as Element | null)?.closest?.("g[data-cam]")?.getAttribute("data-cam")), entity = this._floor()?.devices[i]?.entity;
    if (entity) this._cam.fail(entity);
  };

  /** S34.8: the heat map mode: this viewer's pick, else the YAML `heat_map`, else off. Junk is off. */
  _heatKind(): HeatKind {
    return this._pickedHeat ?? heatKindOf(this._config.heat_map).kind;
  }

  /** S34.8 (H5, H7): the legend strip, text and a ramp, at the plan's bottom left. Card chrome, drawn from the one `heatLegend` the Studio's status bar uses. A heat mode in 2D and 2.5D only: in live 3D no room is coloured, so there is nothing to explain. */
  private _heatLegend() {
    const lg = heatLegend(this._heatKind()), f = this._floor();
    if (!lg || this._shows3d() || !f) return null;
    const cls = this._fallback3d && this._viewPick() === "3d" ? "fp-heat-legend fp-heat-legend-up" : "fp-heat-legend";
    // Same check as the Studio's status bar: a scale with no room on it would explain colours that are not there.
    if (!anyRoomHeated(f, lg.kind, this._stateForRender())) return html`<div class=${cls}><span class="fp-heat-end">${t("Heat map: no readings")}</span></div>`;
    const ramp = `background:linear-gradient(to right in oklch,${lg.stops.map((s) => `var(${s.token})`).join(",")})`;
    return html`<div class=${cls}><span class="fp-heat-end">${lg.from}</span><span class="fp-heat-ramp" style=${ramp} aria-hidden="true"></span><span class="fp-heat-end">${lg.to}</span></div>`;
  }

  /** S33.4: one console warning per card for a `tap_action` or `hold_action` that is there but not usable; absent is no warning. */
  private _actionsWarned = false;
  private _warnActions(): void {
    if (this._actionsWarned) return;
    const keys = [tapActionOf(this._config.tap_action).warn ? "tap_action" : "", holdActionOf(this._config.hold_action).warn ? "hold_action" : ""].filter(Boolean);
    if (!keys.length) return;
    this._actionsWarned = true;
    console.warn(`floorplan-studio-card: ${keys.join(" and ")} not supported, using the default. tap_action takes popup, more-info, toggle or none; hold_action takes more-info or none (docs/card.md).`);
  }

  _tapOpts() { return tapOpts(this); } // card-popup.ts

  _openPopup(t: TapTarget, at: { x: number; y: number }, from: Element | null): void { return openPopup(this, t, at, from); } // card-popup.ts

  _closePopup(): void { return closePopup(this); } // card-popup.ts

  // ---- S25.5: spiderfy ----------------------------------------------------------------------------------------------

  _showTip(t: TapTarget, x: number, y: number, el: Element | null): void { return showTip(this, t, x, y, el); } // card-popup.ts

  _hideTip = (): void => hideTip(this); // card-popup.ts

  _onDialogKeydown = (e: KeyboardEvent): void => onDialogKeydown(this, e); // card-dialogs.ts

  _onMenuPick = (ev: Event): void => onMenuPick(this, ev); // card-menu.ts

  /** S9.5: hidden under `kiosk` (a wall tablet shows only the plan) and under `active_list: false`. Untrusted
   *  config: anything other than the literal `false` counts as the default, shown. */
  _activeListVisible(): boolean {
    return this._config.active_list !== false && !this._kiosk();
  }

  /** After each render and resize: the 3D camera frames the house in what the side panel leaves. (The floating panel and its
   * dock are gone: the side sheet is a grid cell and the bottom sheet sits below the house.) */
  private _positionActivePanel(): void {
    lib3d?.apply3dFrame(this);
  }

  /** The sheet column's width in px, as `_measureFrame` last set it: what the stage is short of the card's width. */
  _sheetPx = 0;
  /** The pixel height `_fitHeight` last gave the host. An inline height that is not this one is somebody else's. */
  _fitted = "";

  private _fitHeight = (): void => fitHeight(this); // card-sheet.ts

  _picked(): number | null { return picked(this); } // card-overview.ts

  _pickRoom(i: number | null): void { return pickRoom(this, i); } // card-overview.ts

  _restorePick(before: PickMemo): void { return restorePick(this, before); } // card-overview.ts

  // ---- S31.8: the bottom sheet's handle ---------------------------------------------------------------------------------------------

  _onHandleDown = (e: PointerEvent): void => onHandleDown(this, e); // card-sheet.ts

  _onHandleMove = (e: PointerEvent): void => onHandleMove(this, e); // card-sheet.ts

  _onHandleUp = (e: PointerEvent): void => onHandleUp(this, e); // card-sheet.ts

  _onHandleCancel = (e: PointerEvent): void => onHandleCancel(this, e); // card-sheet.ts

  _onHandleClick = (): void => onHandleClick(this); // card-sheet.ts

  _onHandleKey = (e: KeyboardEvent): void => onHandleKey(this, e); // card-sheet.ts

  _stopsNow(): Stops | null { return stopsNow(this); } // card-sheet.ts

  // ---- S25.8: detail mode ---------------------------------------------------------------------------------------------------------

  /** The mode on show: this viewer's pick, else the card's YAML `detail`, else the default. Config is untrusted, so junk
   *  counts as no `detail` at all. The default is `auto` only when the viewer can change the level: the Detail button
   *  (Overview shown, so neither `kiosk` nor `active_list: false`) or the zoom buttons and gestures (`zoom` not off, no
   *  kiosk). Otherwise `auto` would hide idle devices at fit with no way to bring them back, so it is `full`. */
  _detailMode(): DetailMode {
    if (this._pickedDetail !== null) return this._pickedDetail;
    const set = this._config.detail;
    if (typeof set === "string" && (DETAIL_MODES as readonly string[]).includes(set)) return set as DetailMode;
    const canChange = this._activeListVisible() || (this._zoomMode() !== false && !this._kiosk());
    return canChange ? "auto" : "full";
  }

  _setLayers(next: LayerId[]): void {
    this._hiddenLayers = next;
    this._kept = null;
    saveViewNow(this);
    this.requestUpdate();
  }

  _sunId(): string {
    return typeof this._config.sun === "string" && this._config.sun ? this._config.sun : "sun.sun";
  }

  /** S7.6: whether the plan is drawn at night. `on`/`off` force it; anything else is `auto`: the sun entity (config
   * `sun`, default `sun.sun`) is `below_horizon`, or `on` for a binary sensor. Missing or `unavailable` is day. */
  _night(): boolean {
    const mode = this._config.night;
    if (mode === "on") return true;
    if (mode === "off") return false;
    const s = this._stateForRender()?.[this._sunId()]?.state;
    return s === "below_horizon" || s === "on";
  }

  /** S38.2: the sun entity's own `azimuth` and `elevation` (Home Assistant sends floats), with the plan's `north`, for the 3D view,
   * which works out the direction and ignores a sun below the horizon or at night. Anything else is no sun. */
  _sun(): { azimuth: number; elevation: number; north: number } | null {
    const a = this._stateForRender()?.[this._sunId()]?.attributes;
    const azimuth = a?.azimuth, elevation = a?.elevation;
    if (!(typeof azimuth === "number" && Number.isFinite(azimuth) && typeof elevation === "number" && Number.isFinite(elevation))) return null;
    // The view draws the shown floor in its stored frame, which sits in the house turned by the floor's `rotation`, so the sun's
    // bearing there is azimuth + north - rotation. Kept in [0, 360): `sunDir` takes nothing else. The floors below hang on the same frame.
    const key = this._floorKey(), turn = this._layout && key ? floorPose(this._layout, key).rot : 0;
    return { azimuth, elevation, north: ((((this._layout?.north ?? 0) - turn) % 360) + 360) % 360 };
  }

  /** S38.6: the stored error in the language of now. */
  private _errorText(): string {
    const vars = this._error?.vars && Object.fromEntries(Object.entries(this._error.vars).map(([k, v]) => [k, v ?? t(NO_ANSWER)]));
    return t(this._error?.key ?? NO_LAYOUT.key, vars);
  }

  protected render() {
    const f = this._floor();
    if (!f) return html`<p class="msg">${this._errorText()}${this._error?.key === NOTHING_SAVED && this._hass?.user?.is_admin !== false ? html` <a class="fp-studio-link" href="/floorplan-studio" @click=${this._openStudio}>${t("Open Floorplan Studio")}</a>` : nothing}</p>`;
    this._syncFloorMemory();
    const rotate = this._rotate();
    const view = this._planView();
    const fit = viewBoxFor(f, 60, rotate, view, this._tilt());
    this._fit = fit;
    const turn = this._turn;
    const zoom = this._zoomMode() !== false;
    const showZoomButtons = zoom && !this._kiosk(); // S7.5: kiosk still zooms/pans by gesture, just draws no buttons
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
    // S37.7: with the floor below on, its outline runs past the fit box and under the zoom buttons; the plan then stops short of them.
    const svgClass = (this._view !== null ? "fp-zoomable fp-zoomed" : "fp-zoomable") + (turn ? " fp-turning" : "") + (showZoomButtons && this._ghost() !== undefined ? " fp-clear-stack" : "");
    // S12.3: 3D takes the plan's place once its module is loaded and WebGL works; until then, and if it cannot, the 2D plan is on show.
    const live3d = this._shows3d();
    const body = live3d ? "" : renderFloor(f, {
      scale: this._scale(fit),
      tr: currentLanguage() ? t : undefined, // S38.8: English keeps the type id in a title, as before; another language names the type

      px: qpx(this._px) || undefined, // S23.2: the 11 px floor for names and discs (quantised: see `qpx`)
      zoom: box.w > 0 ? fit.w / box.w : undefined, // S25.4: labels keep their on-screen size at any zoom
      bounds: this._px ? { ...fit, w: Math.max(fit.w / 2, fit.w - qstrip(this._strip, fit.w)) } : undefined, // S23 review S3: names stay off the control stack
      state: this._stateForRender(),
      formatState: this._format,
      now: this._now(),
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
      hiddenLayers: this._hiddenLayers,
      attention: attentionOf(this) ? { floor: this._floorKey()!, result: attentionOf(this)! } : undefined, // the Overview's own result, with the registry
      detail: detailFor(fit, box, this._detailMode(), this._iconsOn ? Infinity : 0), // S25.2: the level for this zoom and mode; S37.6/S38.7: auto draws icons at fit from a plan 420 px wide, dots under 380, the last level between
      ghost: this._ghost(), // S27.13: the floor below, as faint lines at its place in the house
      spider: spiderSpots(this, f, fit, box, rotate), // S25.5: a fanned stack, or nothing
      keep: keptHere(this),
      heat: this._heatKind(), // S34.8: rooms with a reading of that kind are filled by it; `off` draws the plan as before
      camThumb: this._camOpts(), // S16.3: a picture beside each camera icon; off asks for none
      colors: this._layout!.colors, // S19.E3: the studio's per-type colours, as the editor draws them
    });
    // The zoom buttons come after the plan's <svg> in the DOM (they are positioned, so order is not placement):
    // their own icon is an <svg> too, and `querySelector("svg")` must keep finding the plan first.
    const stage = live3d ? html`<div class="fp-3d" style="aspect-ratio:${fit.w} / ${fit.h}${deviceColourVars(this._layout!.colors).map((v) => `;${v}`).join("")}"></div>` : html`<svg class=${svgClass} viewBox="${box.x} ${box.y} ${box.w} ${box.h}" tabindex="0" role="group" aria-label=${t("Floor plan, {floor}", { floor: floorTitle(this, this._floorKey() ?? "") })} @focus=${this._onStageFocus} @blur=${this._onStageBlur} @pointerdown=${this._dropFocus} ${planPatch(body)}></svg>`;
    const note = this._fallback3d && this._viewPick() === "3d" ? html`<p class="fp-3d-note">${t(this._fallback3d)}</p>` : null;
    measureFrame(this);
    const stack3d = live3d ? (this._kiosk() ? null : html`<div class="fp-stack"><button type="button" aria-label=${t("Reset camera")} title=${t("Reset camera")} @click=${() => { this._forgetCamera(); saveViewNow(this); this.requestUpdate(); }}>${this._icon(UI_ICONS.reset)}</button></div>`) : undefined;
    const stackEl = stack3d !== undefined ? stack3d : showZoomButtons ? viewStack(this, box, home, fit) : null;
    // Kiosk has no header: a menu the config still brings (`rotate_switch: true`) sits in the cluster, over the stack.
    const kioskMenu = this._kiosk() ? optionsMenu(this) : null;
    const cluster = kioskMenu || stackEl ? html`<div class="fp-cluster">${kioskMenu}${stackEl}</div>` : null;
    return html`${header(this)}${stage}${note}${activePanel(this)}${cluster}${this._heatLegend()}${replayBar(this)}${this._pulse ? html`<div class="fp-pulse" aria-hidden="true" hidden></div>` : null}${this._focusDev !== null ? html`<div class="fp-focus" aria-hidden="true" hidden></div>` : null}<div class="fp-focus-status" role="status">${this._focusText()}</div>${popupMarkup(this)}${coverDialogTemplate(this)}${vacuumDialogTemplate(this)}${chooserDialogTemplate(this)}${offDialogTemplate(this)}<div class="fp-tip" id="fp-tip" role="tooltip" hidden><b></b><span></span></div>`;
  }

  /** The view picked: the dropdown's, else `config.view`, else 2D. Config is untrusted, so junk is 2D, not an error. */
  _viewPick(): CardView {
    return this._pickedView ?? (isView(this._config.view) ? this._config.view : "2d");
  }

  /** The flat plan `renderFloor` draws: the pick, or 2D when the pick is 3D (what the card shows while 3D loads or if it cannot run). */
  private _planView(): PlanView {
    const v = this._viewPick();
    return v === "3d" ? "2d" : v;
  }

  /** S27.13: whether the floor below is drawn: this viewer's pick, else the YAML `ghost_floor` (only `true` counts: junk is off). */
  _ghostOn(): boolean {
    return this._pickedGhost ?? this._config.ghost_floor === true;
  }

  /** The floor below and its shift for `renderFloor`, or `undefined`: off, 3D (its own Floors below select), or the lowest floor. */
  private _ghost(): { floor: Floor; shift: Pt; turn: number } | undefined {
    const key = this._floorKey(), layout = this._layout;
    if (!this._ghostOn() || !key || !layout) return undefined;
    const below = floorBelow(layout, key);
    if (!below) return undefined;
    const place = floorPlace(layout, below, key); // S29.5: the turn and the shift, as the Studio's ghost reads them
    return { floor: layout.floors[below], shift: place.shift, turn: place.turn };
  }

  /** The tilt on show: the slider's, else `config.tilt`, else the default. Clamped, since config is untrusted. */
  _tilt(): number {
    return clampTilt(this._pickedTilt ?? this._config.tilt);
  }

  /** The wall heights on show: the select's pick, else `config.walls`, else cut. Config is untrusted, so junk is cut. */
  _walls(): WallsMode {
    return this._pickedWalls ?? wallsModeOf(this._config.walls);
  }

  /** S27.14: the floors below in 3D: this viewer's pick, else `config.floors_below`, else off. Junk is off. */
  _below(): BelowMode {
    return this._pickedBelow ?? belowModeOf(this._config.floors_below);
  }

  /** A toolbar icon: 24x24 path from the inlined set, drawn in the button's own colour. */
  private _icon(path: string) {
    return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${path} fill="currentColor"/></svg>`;
  }

  /** Whether anything about the view differs from what the config alone would show: a pick, a zoom, a turn. */
  _modified(): boolean {
    return this._turn !== null || this._view !== null || this._pendingView !== null || this._camMoved
      || [this._pickedView, this._pickedTilt, this._pickedWalls, this._pickedTheme, this._pickedLabels, this._pickedNames, this._pickedRot, this._pickedDetail, this._pickedGhost, this._pickedBelow, this._pickedHeat, this._pickedCam].some((v) => v !== null);
  }

  /** The 3D camera goes back to its first view and the shown floor forgets it (Reset view, Reset camera). The floor's
   * zoom and turn are not touched here: `_stashFloor` rewrites them from the live state. */
  _forgetCamera(): void {
    this._view3d?.reset();
    this._camMoved = false;
    const key = this._floorKey(), fv = key ? this._floorViews.get(key) : undefined;
    if (key && fv) {
      delete fv.cam;
      if (!Object.keys(fv).length) this._floorViews.delete(key);
    }
  }

  /** S7.4: `config.zoom`, read as untrusted: only `false` turns zoom off and only `"wheel"` widens it. */
  _zoomMode(): boolean | "wheel" {
    const z = this._config.zoom;
    return z === false ? false : z === "wheel" ? "wheel" : true;
  }

  /** S7.5: `config.kiosk`, `false` unless it is exactly `true` — `setConfig` already refuses anything else. */
  _kiosk(): boolean {
    return this._config.kiosk === true;
  }

  /** S9.2: `config.icon_size`, read as untrusted — a missing key, a non-number, or `NaN` all mean the default,
   * `1`; a real number clamps to [0.5, 3] rather than being refused, so a slider or a stray digit never breaks
   * the card. */
  _iconSize(): number {
    const v = this._config.icon_size;
    return typeof v === "number" && Number.isFinite(v) ? Math.min(ICON_SIZE_MAX, Math.max(ICON_SIZE_MIN, v)) : DEFAULT_ICON_SIZE;
  }

  /** S23.2: screen px per plan unit at fit (see `_measurePx`); 0 until known. */
  _px = 0;
  /** S23 review S3: plan units at the right of the fit box that the control stack covers (see `_measurePx`); 0 for none. */
  _strip = 0;

  _measurePx(): void { return measurePx(this); } // card-zoom.ts

  /** S37.6: the floor's rendered width at fit for a measured `px`, or Infinity while nothing is laid out (the level then reads "cannot tell": icons). */
  _planPx(fit: { w: number }, px = this._px): number { return px > 0 ? px * fit.w : Infinity; }
  /** S38.7: icons (true) or dots at fit; the last level is kept while the plan is between 380 and 420 px wide. Unmeasured: icons. */
  _iconsOn = true;

  _scale(fit: { w: number; h: number }): number { return scale(this, fit); } // card-zoom.ts

  /** S9.6: `config.center`, read as untrusted config (CLAUDE.md finding 1) — anything other than a two-element
   * array of finite numbers is `null` (no pin), silently. Unlike `zoom`/`kiosk` (which throw on a typo, per the
   * comment on `_validateConfig`, because those are a closed set where a wrong value would otherwise hide behind
   * a default no one asked for) `center` is a wide-open pair of numbers, the same shape of untrusted input as
   * `icon_size`: a bad value here has an obviously safe fallback (the whole floor) that a slider or a stray digit
   * must never break out of. */
  _center(): Pt | null {
    const c = this._config.center;
    if (!Array.isArray(c) || c.length !== 2) return null;
    const [x, y] = c;
    return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }

  _rotatedCenter(): Pt | null { return rotatedCenter(this); } // card-zoom.ts

  _zoomLevel(): number { return zoomLevel(this); } // card-zoom.ts

  /** S9.6: the card's "home" view — the whole floor (`fit`) unless `center`/`zoom_level` pin it to part of the
   * plan. Every place that used to treat `fit` as "no zoom" (the `fp-zoomed` class, `_current`, `_zoomed`,
   * `_setView`, the zoom buttons' own reset) now treats this instead: reset returns here, not to the whole floor,
   * so a room-pinned card stays pinned across a pinch-zoom-and-reset. `_scale` (icon sizing, S9.2) deliberately
   * keeps reading `fit` itself, not this — see its own comment — so a room card's icons match the full-plan
   * card's icons at the same zoom, per the S9.6 brief. */
  _home(): View | null {
    return this._fit ? pinnedView(this._fit, this._rotatedCenter(), this._zoomLevel()) : null;
  }

  /** The view on screen now: the zoomed one, clamped to the whole floor (a pinned card can still pinch/pan out to
   * see the rest of the house), or home. */
  _current(): View | null {
    const fit = this._fit;
    if (!fit) return null;
    return this._view ? clamp(this._view, fit) : this._home();
  }

  /** Opus review of S9.6: this used to compare `_current()`'s width against `_home()`'s, so a sideways pan at
   * home's own zoom level (same width, different centre) read as "not zoomed" — a double-tap after panning a
   * pinned card then zoomed in from home instead of returning to it. `_setView` already normalises "back at home"
   * to `_view === null` (its own comment above), so "zoomed" is exactly "not that": no separate width check. */
  _zoomed(): boolean {
    return this._view !== null;
  }

  /** Stores `v`, clamped to the whole floor, as the view; home itself is stored as `null` (the same "no override"
   * state `_current`/`_zoomed` already read), so a pinch or pan that lands back exactly on home does not pin an
   * equivalent-but-distinct box that would, say, disable the fit button. */
  _setView(v: View): void {
    const fit = this._fit, home = this._home();
    if (!fit || !home) return;
    if (this._turn) return; // the plan is moving: a gesture would be applied to a box that is already leaving
    const c = clamp(v, fit);
    this._view = sameView(c, home, fit) ? null : c;
    this._scheduleSave();
    this.requestUpdate();
  }

  /** Zooms by `k` about the centre of what is on screen: the + and − buttons. */
  _zoomCentre(k: number): void {
    const v = this._current();
    if (v) this._setView(zoomAt(v, k, v.x + v.w / 2, v.y + v.h / 2));
  }

  _fitView(): void { return fitView(this); } // card-zoom.ts

  _bindZoom(svg: SVGSVGElement): () => void { return bindZoom(this, svg); } // card-zoom.ts

}

if (typeof window !== "undefined") {
  window.customCards = window.customCards ?? [];
  if (!window.customCards.some((c) => c.type === "floorplan-studio-card"))
    window.customCards.push({
      type: "floorplan-studio-card",
      name: "Floorplan Studio",
      description: "Draw your home and use it as a live dashboard.",
      // S36.3: HA 2026.6's "By entity" picker lists the card under Community for an entity a plan can draw (docs/DECISIONS.md, 2026-10-22).
      getEntitySuggestion: (_hass, id) => (/^(light|switch|sensor|binary_sensor|climate|cover|camera|fan|lock|media_player|person|device_tracker|vacuum|siren|alarm_control_panel)\./.test(id) ? { config: { type: "custom:floorplan-studio-card" } } : null),
    });
}
defineElement("floorplan-studio-card", FloorplanStudioCard, CARD_VERSION);
// S33.10: the dashboard strategy (`strategy: { type: custom:floorplan-studio }`); the same registry race as the card (S8.3).
if (typeof window !== "undefined" && window.customElements) defineElement("ll-strategy-dashboard-floorplan-studio", strategyElement(), CARD_VERSION);
// One line, so "which card is my dashboard running" is a look at the console, not a guess.
if (typeof console !== "undefined" && CARD_VERSION !== "dev") console.info(`Floorplan Studio card ${CARD_VERSION}`);
