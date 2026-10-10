import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from "lit";
import { planPatch } from "./plan-patch"; // S25.6: the plan is patched, not replaced, on a state update
import { ALL_OFF_TITLE, SPIDER_MAX, STACK_PX, spiderLayout, stackGroups, DETAIL_LABELS, DETAIL_MODES, detailFor, type DetailMode, DEFAULT_MOTION_FADE_S, allOffTitle, customCalls, NAME_MIN_PX, customScene, presetCalls, roomScenes, sceneNeedsConfirm, entitiesOfDevice, entitiesOfDoor, moreInfoEntities, stateText, wattsOf, DEVICE_ICONS, FLOORPLAN_CSS, THEMES, UI_ICONS, WALLS_LABELS, WALLS_MODES, wallsModeOf, type PlanView, activeDevices, findPowerSensor, floorsAroundKey, floorShift, floorBelow, deviceColourVars, plugThreshold, heatRange, pieceDevice, HEAT_FROM, HEAT_TO, clampTilt, groupByCategory, deviceInfo, filterToRoom, formatChanged, roomSummary, attention, deviceCentre, formatAge, relayText, floorSummary, floorOffRows, floorOffCalls, OFF_GROUPS, OFF_GROUP_LABEL, layoutEntries, LAYERS, layerCounts, layerOfType, layersSummary, soloLayer, toggleLayer, migrate, planPivot, renderFloor, rotateAbout, tag, validate, viewBoxFor } from "../core";
import type { LayerId, OffRow, SearchEntry } from "../core";
import type { ActiveDevice, Attention, AttentionItem, AttentionKind, CategoryId, DeviceType, ThingRef, PowerCandidate, RoomDeviceRow, RoomSensorRow, RoomSummary, Theme, WallsMode } from "../core";
import type { Device, Door, Floor, Layout } from "../core";
import { TAP_SLOP_PX, THINGS, bindDeviceActions, fireEvent, thingKind, type TapTarget } from "./actions";
import { lampOp, lightCaps, popupOp, type PopupOp } from "./popup";
import { SCENES_CSS, scenesTemplate } from "./room-scenes-ui";
import { POPUP_CSS, placeNear, popupTemplate, type PopupSubject, type SliderKind } from "./popup-ui";
// S7.7: side-effect import only — registers floorplan-studio-card-editor so getConfigElement() below can create
// one. vite.config.ts's card entry is this file, so the editor ships inside dist/floorplan-studio-card.js, not a
// second built file (PLAN block interface).
import "./config-editor";
import { defineElement } from "./define";
import { CARD_VERSION } from "./version";
import { MAX_ZOOM, MIN_ZOOM, clamp, panBy, pinch, pinnedView, sameView, zoomAt, type Pt, type View } from "./viewport";
import { PAN_STEP, isSearchChord, viewKeyFor, type ViewKey } from "./view-keys";
// S24.8: registers <fp-search>, the search box the Studio uses too.
import "./search-box";
import type { View3D } from "./three/view3d";
import type { Pick as Pick3D } from "./three/pick";
import { liveDeps, sceneDeps, textureDeps } from "../core/three-deps";
import { ROTATION_STEP, easeInOut, normaliseRotation, parseStoredView, shortestDelta, viewAround, type FloorView, type StoredView } from "./view-state";

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
  /** How much of the plan is drawn at a zoom (docs/card.md, Detail): `"auto"` follows the zoom, `"full"` always draws everything, `"minimal"` always draws rooms and what needs attention. Unset (or anything else) is `"auto"`, except where the viewer can neither zoom nor reach the Detail button (kiosk, or `active_list: false` with `zoom: false`): there it is `"full"`, so no idle device is unreachable. The Detail button in the Overview changes it for one viewer, and the card remembers the pick. */
  detail?: DetailMode;
  /** `true` draws the floor below as faint lines under the shown floor, at its place in the house (the floors' `offset`s); anything but `true` is off (default). The Floor below button in the view controls changes it for one viewer, and the card remembers the pick. The lowest floor has none. */
  ghost_floor?: boolean;
}

/** The Floor below button's icon: Material Design Icons "layers-outline", 24x24 (inlined, no runtime import: CLAUDE.md finding 9). */
const GHOST_ICON = "M12 16L19.36 10.27L21 9L12 2L3 9L4.63 10.27M12 18.54L4.62 12.81L3 14.07L12 21.07L21 14.07L19.37 12.8L12 18.54Z";

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
/** The words the side panel says for a room and for a floor (S20.2): the same panel, one subject. */
interface Scope { unnamed: string; clear: string; noDevices: string; nothingOn: string; activeHere: string; onlyHere: string }
const ROOM_SCOPE: Scope = { unnamed: "Unnamed room", clear: "Clear the room selection", noDevices: "No devices in this room", nothingOn: "Nothing on in this room", activeHere: "Active in this room", onlyHere: "This room only" };
const FLOOR_SCOPE: Scope = { unnamed: "Unnamed floor", clear: "Clear the floor selection", noDevices: "No devices on this floor", nothingOn: "Nothing is on, on this floor", activeHere: "Active on this floor", onlyHere: "This floor only" };
/** What a double tap restores: the room or floor pick as it stood before the first tap changed it. */
interface PickMemo { pick: { floor: string; id: string } | null; floor: string | null; filter: boolean }
/** The Scenes section starts folded, so its fold set entry means "opened by the user" (the other groups start open and the entry means folded). */
const SCENES_OPEN = "r:scenes:open";
/** S24.7: the Overview's Unavailable row starts folded, like Scenes: its entry means "opened". */
const UNAVAILABLE_OPEN = "a:unavailable:open";
/** S24.7: a row tap zooms to at least this, against the whole floor, and rings its thing this long. */
const LOCATE_ZOOM = 2;
const PULSE_MS = 2400;
/** S24.7: one Overview row, an Attention item or an active device, with where it is (`at`) so a tap can go there. */
interface OverviewRow { entity: string; name: string; floor: string; at: ThingRef; room?: string; state: string; age?: string; type?: DeviceType; colorVar: string; attn: boolean }
/** What an Attention row says after its name. Every kind is a decision (finding 17): a new kind fails to compile here. */
const ATTENTION_TEXT: Record<AttentionKind, (it: AttentionItem, level: string) => string> = {
  "alarm-triggered": () => "triggered",
  "alarm-armed": (it) => it.state.replace(/_/g, " "),
  open: () => "open",
  jammed: () => "jammed",
  unlocked: () => "unlocked",
  leak: () => "leak",
  smoke: () => "smoke",
  "battery-low": (_it, level) => (level ? `battery ${level} %` : "battery low"),
  unavailable: () => "unavailable",
};
/** The header's count chips, short: "6 lights · 2 alerts". Singular and plural per category; every category is a decision. */
const CHIP_NOUN: Record<CategoryId, [string, string]> = {
  lights: ["light", "lights"], climate: ["heating", "heating"], security: ["sensor", "sensors"], media: ["playing", "playing"],
  power: ["plug", "plugs"], covers: ["cover", "covers"], computing: ["computer", "computers"], sensors: ["sensor", "sensors"],
  people: ["person", "people"], other: ["other", "other"],
};
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
    .fp-3d-note { position: absolute; left: 8px; bottom: 8px; z-index: 1; margin: 0; max-width: calc(100% - 16px); padding: 4px 8px; font: 12px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 6px; }
    p.msg { padding: 16px; margin: 0; font: 14px sans-serif; color: var(--fp-text); }
    /* S2.6: the floor switcher is card chrome (like p.msg above), not plan content, so it sits outside the <svg>
       renderFloor draws and is positioned over it instead. */
    /* Opus review finding 13: the active-devices panel below (also z-index: 1, and later in DOM order, so it
       would otherwise win ties) can be dragged to sit right under this row; the floor chips must still take the
       click, not the panel behind — or in front of, without this — them. */
    .fp-floors { position: absolute; top: 8px; left: 8px; z-index: 2; display: flex; gap: 6px; }
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
    .fp-zoom button, .fp-viewonly button, .fp-stack button { width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; font: 16px/1 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 6px; cursor: pointer; }
    .fp-zoom button:disabled, .fp-viewonly button:disabled, .fp-stack button:disabled { opacity: 0.45; cursor: default; }
    .fp-zoom button[aria-pressed="false"], .fp-viewonly button[aria-pressed="false"] { opacity: 0.6; }
    .fp-zoom svg, .fp-viewonly svg, .fp-stack svg { width: 14px; height: 14px; }
    /* While the plan turns it takes no taps: a tap would land on a device that is moving away from the finger.
       The star reaches the children that carry their own pointer-events (.room{pointer-events:all} in the editor's
       rules, .extra, .door-hit), which an inherited value on the svg alone would lose to. */
    svg.fp-turning, svg.fp-turning * { pointer-events: none; }
    .fp-zoom input[type="range"], .fp-viewonly input[type="range"] { width: 72px; height: 28px; margin: 0; accent-color: var(--fp-primary); cursor: pointer; }
    .fp-zoom select, .fp-viewonly select { height: 28px; padding: 0 4px; font: 13px/1 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 6px; cursor: pointer; }
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
    .fp-chooser-list button { display: flex; justify-content: space-between; gap: 12px; text-align: left; font: 13px/1.2 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-bg); border: 1px solid var(--fp-idle); border-radius: 6px; padding: 8px 12px; cursor: pointer; }
    .fp-chooser-list button .state { opacity: 0.7; white-space: nowrap; }
    .fp-chooser-dialog .fp-dialog-actions { justify-content: flex-end; }
    /* S9.5: the active-devices panel, card chrome like .fp-floors/.fp-zoom above (CLAUDE.md finding 8 — nothing here
       is drawn inside the plan's <svg>). Default position clears the floor chips' own top-left corner; a drag
       overrides top/left with an inline style, clamped in TS against the card's own box so it can never be lost
       off-screen (S9.5 spec). */
    /* Opus review finding 5: min(200px, 45%) instead of a flat 200px, so a narrow (phone-width) card gets a panel
       that fits it rather than one that is most of the card's own width at 200px on a ~380px card. */
    .fp-active { position: absolute; top: 44px; left: 8px; z-index: 1; width: min(200px, 45%); max-width: calc(100% - 16px); max-height: calc(100% - 52px); display: flex; flex-direction: column; overflow: hidden; background: var(--fp-room); color: var(--fp-ink); border: 1px solid var(--fp-idle); border-radius: 8px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25); }
    .fp-active-head { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 6px 8px; cursor: grab; touch-action: none; user-select: none; font: 600 12px/1.2 var(--fp-font, system-ui, sans-serif); border-bottom: 1px solid var(--fp-idle); }
    .fp-active-title { flex: 1; }
    .fp-active-count { font-weight: 400; color: var(--fp-text); }
    .fp-active-collapse { border: none; background: transparent; color: inherit; font: inherit; line-height: 1; cursor: pointer; padding: 2px 4px; }
    .fp-active-body { overflow-y: auto; padding: 4px 8px 8px; }
    .fp-active-group-label { font: 600 10px/1.6 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 6px; }
    .fp-active-group-label:first-child { margin-top: 0; }
    /* S14.6: a category header is a button (keyboard, aria-expanded); it keeps the label's look. */
    button.fp-cat { display: flex; align-items: center; gap: 4px; width: 100%; min-height: 28px; text-align: left; border: none; background: transparent; padding: 0 2px; cursor: pointer; border-radius: 4px; }
    button.fp-cat:hover, button.fp-cat:focus-visible { background: var(--fp-idle); }
    .fp-cat-name { flex: 1; min-width: 0; }
    .fp-cat-chev { flex: 0 0 10px; }
    .fp-active-row { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: none; background: transparent; color: inherit; font: 12px/1.3 var(--fp-font, system-ui, sans-serif); padding: 4px 2px; cursor: pointer; border-radius: 4px; }
    .fp-active-row:hover, .fp-active-row:focus-visible { background: var(--fp-idle); }
    .fp-active-row svg { width: 16px; height: 16px; flex: 0 0 16px; fill: var(--fp-active-row-color, var(--fp-ink)); }
    .fp-active-empty { margin: 4px 2px; font: 12px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); }
    /* S11.3/S11.4: the room section and the details under a row. Same card chrome and tokens as the list above. */
    .fp-active.fp-room-open { width: min(260px, 70%); }
    /* S14 review: on a card narrower than ACTIVE_FOLD_BELOW_PX an open room panel is a short sheet, not a column down the card: at most 45% of the card high, its body scrolling, and docked on the half opposite the picked room (class set in _positionActivePanelNow) so that room stays in view. */
    .fp-active.fp-sheet { max-height: 45%; }
    .fp-active.fp-sheet.fp-dock-bottom { top: auto; bottom: 8px; }
    /* Docked at the top over the toolbar (z-index 2, as the floor chips; the dialogs come later in the DOM and win). */
    .fp-active.fp-sheet.fp-dock-over { top: 8px; z-index: 2; }
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
    .fp-active-folded .fp-active-head { flex-wrap: nowrap; }
    .fp-active-folded .fp-active-title { flex: 0 0 auto; }
    .fp-active-folded .fp-crumb { display: none; }
    .fp-active-folded .fp-ov-chips { flex: 1 1 auto; order: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fp-active-folded .fp-active-collapse { order: 2; }
    .fp-ov-search:empty { display: none; }
    /* S24.8: the search at the top of the sheet; its list drops over the rows below. */
    .fp-ov-search { margin: 2px 0 6px; font: 12px/1.3 var(--fp-font, system-ui, sans-serif); }
    /* S24.8: one row of tools: Turn off on this floor…, Layers, All floors. */
    .fp-ov-scopes { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; margin-bottom: 6px; }
    .fp-ov-scopes .fp-floor-off { margin-right: auto; }
    /* S24.8: the layer chips, one per family, unfolded by the Layers button; and the note for a kept thing. */
    .fp-ov-layers:empty { display: none; }
    .fp-ov-layers { margin: 0 0 6px; }
    .fp-layer-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .fp-ov-detail { margin: 0 0 6px; }
    .fp-layer, .fp-layers-toggle, .fp-detail, .fp-detail-toggle, .fp-layer-note button { border: 1px solid var(--fp-idle); background: transparent; color: var(--fp-ink); font: 11px/1.4 var(--fp-font, system-ui, sans-serif); border-radius: 999px; padding: 2px 8px; cursor: pointer; min-height: 24px; }
    .fp-layer[aria-pressed="false"] { border-style: dashed; text-decoration: line-through; }
    .fp-detail[aria-pressed="true"] { background: var(--fp-ink); color: var(--fp-bg); border-color: var(--fp-ink); }
    .fp-layers-toggle[aria-expanded="true"], .fp-detail-toggle[aria-expanded="true"] { border-color: var(--fp-ink); }
    .fp-layer:hover, .fp-layer:focus-visible, .fp-layers-toggle:hover, .fp-layers-toggle:focus-visible, .fp-detail:hover, .fp-detail:focus-visible, .fp-detail-toggle:hover, .fp-detail-toggle:focus-visible, .fp-layer-note button:hover, .fp-layer-note button:focus-visible { border-color: var(--fp-primary); }
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
    .fp-ov-hint { margin: 8px 2px 0; font: 10px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); }
    /* One target per row, finger-sized on a touch screen (S24.7). */
    @media (pointer: coarse) { .fp-active-row { min-height: 40px; } }
    /* S24.7: the ring a row tap puts on its thing. Card chrome over the plan, never a hit target. Reduced motion: a steady ring. */
    .fp-pulse { position: absolute; z-index: 1; pointer-events: none; box-sizing: border-box; border: 3px solid var(--fp-primary); border-radius: 50%; transform: translate(-50%, -50%); animation: fp-pulse-ring 0.8s ease-out 3; }
    /* Not fp-locate: that is the plan's own ring (render.ts), and one name in one shadow root means one wins (S24.R7). */
    @keyframes fp-pulse-ring { 0% { opacity: 1; box-shadow: 0 0 0 0 var(--fp-primary); } 100% { opacity: 0.6; box-shadow: 0 0 0 10px transparent; } }
    @media (prefers-reduced-motion: reduce) { .fp-pulse { animation: none; } }
    .fp-room { padding-bottom: 6px; margin-bottom: 6px; border-bottom: 1px solid var(--fp-idle); }
    .fp-room-head { display: flex; align-items: center; gap: 6px; font: 600 13px/1.3 var(--fp-font, system-ui, sans-serif); }
    .fp-room-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .fp-room-clear { flex: 0 0 24px; width: 24px; height: 24px; border: none; background: transparent; color: inherit; font: 14px/1 var(--fp-font, system-ui, sans-serif); border-radius: 4px; cursor: pointer; }
    .fp-room-clear:hover, .fp-room-clear:focus-visible { background: var(--fp-idle); }
    /* S20.1: the same look as a scene button, with classes of its own so the Scenes section's tests and counts stay about scenes. */
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
    .fp-show-all:hover, .fp-show-all:focus-visible { background: var(--fp-idle); }
  `, POPUP_CSS, SCENES_CSS];

  private _config: FloorplanStudioCardConfig = {};
  private _hass?: Hass;
  private _layout: Layout | null = null;
  private _error: string | null = null;
  private _urlRequested = false;
  private _wsRequested = false;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _actionsSvg: SVGSVGElement | null = null;
  private _unbindActions: (() => void) | null = null;
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
  /** S24.8 (C2): "Turn off on this floor…": the floor, its title, the rows that were on when it opened (a snapshot: a row
   *  does not vanish under the finger while a light goes off elsewhere), and which rows are ticked. Same one-dialog rules. */
  private _offDialog: { floor: string; title: string; rows: OffRow[]; ticked: boolean[] } | null = null;
  private _offDialogWasOpen = false;
  /** S24.8: the families this viewer hid with the layer chips, kept in the view memory. */
  /** S25.8: the detail mode this viewer picked with the Detail button; `null` leaves the card's YAML `detail` in charge. */
  private _pickedDetail: DetailMode | null = null;
  /** S27.13: the Floor below button's pick; `null` leaves the card's YAML `ghost_floor` in charge. */
  private _pickedGhost: boolean | null = null;
  /** Whether the Detail choices are unfolded. Not remembered, like `_layersOpen`. */
  private _detailOpen = false;
  private _hiddenLayers: LayerId[] = [];
  /** What search or a row tap located under a hidden family: drawn anyway (`keep`) on its floor, with a note and Show. */
  private _kept: { floor: string; t: "dev" | "furn"; i: number; fam: LayerId } | null = null;
  /** Whether the layer chips are unfolded (the Layers button). Not remembered: folded is where a sheet starts. */
  private _layersOpen = false;
  /** S24.8 (F1): the search's entries, built once per layout and state source, not per keystroke (`<fp-search>` indexes on a new array). */
  private _searchMemo: { layout: Layout; known: boolean; floors: string; entries: SearchEntry[] } | null = null;
  /** S14.2: the tap popup, or `null` for none. One at a time; `s.key` is who it is about, `x`/`y` where the pointer landed (client px), `opener` the
   *  focusable thing that opened it (an Active row), `confirming` the turn-OFF question, `draft` a slider's shown value until Home Assistant answers. */
  /** S25.5: the device indices of the stack fanned out into a ring, on the floor `_spiderFloor`; null when folded. */
  private _spider: number[] | null = null;
  private _spiderFloor: string | null = null;
  private _popup: { s: PopupSubject; x: number; y: number; opener: Element | null; confirming: boolean; draft: { kind: SliderKind; value: number; from: number | null } | null } | null = null;
  private _popupFocusKey: string | null = null;
  private _popupReturn: Element | null = null;
  /** S14.2: the hover tooltip (mouse only). `_tipKey` is who it shows, `_tipHost` the card's box read once when it appears, `_tipTitle` a plan `<title>` held back so the browser's own tooltip does not double ours. */
  private _tipKey: string | null = null;
  private _tipHost: DOMRect | null = null;
  private _tipEl: Element | null = null;
  private _tipTitle: { el: Element; title: Element } | null = null;
  /** The tooltip's subject and the selector of its plan element, so a re-render (which replaces the plan's elements) can refresh its text and take the new element's `<title>` out again. */
  private _tipTarget: TapTarget | null = null;
  private _tipSel: string | null = null;
  /** Where the pointer was when the tooltip last moved: a render checks the plan element is still under it (a zoom or turn moves icons under a still pointer). */
  private _tipAt: { x: number; y: number } | null = null;
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
  /** S14.4: what the viewer left each floor looking like (2D zoom and spot, the turn, the 3D camera), by floor key. Kept
   * in memory too, so a floor remembers even when storage is blocked. `_memFloor` is the floor the live view state
   * (`_view`, `_pickedRot`, the camera) belongs to; `null` until the first render knows the floor. */
  private _floorViews = new Map<string, FloorView>();
  private _memFloor: string | null = null;
  /** The floor key the 3D view's scene was built for, and whether the person moved its camera on that floor. */
  private _view3dKey: string | null = null;
  private _camMoved = false;
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
  /** S20.2: the floor key whose pill was pressed, or null. Like `_pickedRoom` it is card chrome, and it excludes it: a room
   *  pick clears the floor and a floor pick clears the room, so the one panel always has one subject. */
  private _pickedFloor: string | null = null;
  /** S14.7: the scene button (`custom:<id>`) that waits for its confirm, because it turns a switch off. */
  private _sceneAsk: string | null = null;
  /** Whether the Active list is cut to the picked room's entities (the default on a pick); "Show all" turns it off. */
  private _roomFilter = true;
  /** S24.7 (F3): the Overview lists every floor, not only the one shown. Kept with the panel's other view memory. */
  private _overviewAll = false;
  /** S24.7: the thing a row tap went to, ringed on the plan for `PULSE_MS`; null when none. */
  private _pulse: ({ floor: string } & ThingRef) | null = null;
  private _pulseTimer: ReturnType<typeof setTimeout> | null = null;
  /** `attention()` for the layout and states on show, computed once per pair: the pills and the Overview both read it. */
  private _attnMemo: { layout: Layout; states: unknown; reg: unknown; a: Attention } | null = null;
  private _actionsPanel: HTMLElement | null = null;
  private _unbindPanel: (() => void) | null = null;
  /** S12.4: the 3D host the taps are bound on, and what unbinds them. */
  private _actions3d: HTMLElement | null = null;
  private _unbind3d: (() => void) | null = null;
  private _unbindHover: (() => void) | null = null;
  private _unbindSpider: (() => void) | null = null;
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
    // A stored pick must not outlive a config that now says something else (S25 review): detail and kiosk decide the default.
    if (c.detail !== undefined) seed.push(["detail", c.detail]);
    if (c.ghost_floor !== undefined) seed.push(["ghost_floor", c.ghost_floor]);
    if (c.kiosk !== undefined) seed.push(["kiosk", c.kiosk]);
    return `fp-view:${tag(JSON.stringify(seed))}`;
  }

  /** Reads this card's remembered view into the picked fields, before the first render so there is no flash of the
   * config's look. Storage is untrusted: `parseStoredView` drops each bad field, and a throwing `localStorage`
   * (private mode, blocked) is nothing stored. */
  private _loadViewState(): void {
    this._pickedView = this._pickedTilt = this._pickedWalls = this._pickedTheme = this._pickedLabels = this._pickedNames = this._pickedRot = this._pickedDetail = this._pickedGhost = null;
    this._pendingView = null;
    this._shownFloor = null;
    this._floorViews = new Map();
    this._memFloor = null;
    this._camMoved = false;
    this._kept = null;
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
    if (s.detail !== undefined) this._pickedDetail = s.detail;
    if (s.ghost !== undefined) this._pickedGhost = s.ghost;
    if (s.floor !== undefined) this._shownFloor = s.floor; // an unknown id is ignored by _floorKey
    this._hiddenLayers = s.layers ?? [];
    for (const [k, fv] of s.floors ?? []) this._floorViews.set(k, fv); // the live fields follow once the first render knows the floor
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

  /** The live view state of the shown floor, written into `_floorViews` (an empty one removes the entry). The 3D camera
   * is read from the view only when the person has moved it on this floor; otherwise what was stored stays. */
  private _stashFloor(): void {
    const key = this._floorKey();
    if (!key || key !== this._memFloor) return;
    const fv: FloorView = {};
    if (this._pickedRot !== null) fv.rotation = this._pickedRot;
    const anchor = this._pendingView ?? this._anchorOfView();
    if (anchor) { fv.zoom = anchor.zoom; fv.focus = anchor.focus; }
    const cam = this._camMoved && this._view3d && this._view3dKey === key ? this._view3d.camera() : this._floorViews.get(key)?.cam;
    if (cam) fv.cam = cam;
    if (Object.keys(fv).length) this._floorViews.set(key, fv);
    else this._floorViews.delete(key);
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
    if (this._pickedView !== null) o.view = this._pickedView;
    if (this._pickedTilt !== null) o.tilt = this._pickedTilt;
    if (this._pickedWalls !== null) o.walls = this._pickedWalls;
    if (this._pickedTheme !== null) o.theme = this._pickedTheme;
    if (this._pickedLabels !== null) o.labels = this._pickedLabels;
    if (this._pickedNames !== null) o.names = this._pickedNames;
    if (this._pickedDetail !== null) o.detail = this._pickedDetail;
    if (this._pickedGhost !== null) o.ghost = this._pickedGhost;
    if (this._shownFloor !== null) o.floor = this._shownFloor;
    if (this._hiddenLayers.length) o.layers = this._hiddenLayers;
    this._stashFloor();
    if (this._floorViews.size) o.floors = [...this._floorViews];
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
    if (this._dialogOpen()) return; // a dialog has its own keys
    // S24.8: ⌘K, Ctrl+K or / opens the search, under the same gate as the view keys: the card focused, else hovered.
    if (isSearchChord(ev)) { if (this._openSearch()) ev.preventDefault(); return; }
    if (ev.key === "Escape" && this._popup) { this._closePopup(); ev.preventDefault(); return; }
    if (ev.key === "Escape" && this._spider) { this._foldSpider(); ev.preventDefault(); return; }
    if (ev.key === "Escape" && (this._pickedRoom || this._pickedFloor)) { // S11.3: the same ownership gate as the view keys, so another card never loses its room
      this._pickRoom(null);
      ev.preventDefault();
      return;
    }
    const key = viewKeyFor(ev);
    if (key && this._doViewKey(key)) ev.preventDefault();
  };

  /** Whether the two rotate buttons exist, which is when [ and ] turn the plan. `rotate_switch` decides
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
      case "panLeft":
      case "panRight":
      case "panUp":
      case "panDown": {
        if (this._zoomMode() === false) return false;
        const v = this._current(), fit = this._fit;
        if (!v || !fit) return false;
        const dx = key === "panLeft" ? -PAN_STEP * v.w : key === "panRight" ? PAN_STEP * v.w : 0;
        const dy = key === "panUp" ? -PAN_STEP * v.h : key === "panDown" ? PAN_STEP * v.h : 0;
        const to = clamp(panBy(v, dx, dy), fit);
        if (sameView(to, v, fit)) return false; // at the edge, or not zoomed: nothing moved, so the page keeps the key
        this._setView(to);
        return true;
      }
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
    this._overviewAll = false;
    try {
      const raw = globalThis.localStorage?.getItem(this._activeStorageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw) as { collapsed?: unknown; chosen?: unknown; x?: unknown; y?: unknown; all?: unknown };
      this._overviewAll = parsed.all === true;
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
      globalThis.localStorage?.setItem(this._activeStorageKey(), JSON.stringify({ collapsed: this._activeUserChose && this._activeCollapsed, chosen: this._activeUserChose, x: this._activePos?.x, y: this._activePos?.y, all: this._overviewAll }));
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
      this._activeResizeObserver = new ResizeObserver(() => { this._applyWidthDefault(); this._positionToolbar(); this._positionActivePanel(); this._measurePx(); });
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
    this._closePopup();
    this._hideTip();
    this._layout = null;
    this._error = null;
    this._urlRequested = false;
    this._wsRequested = false;
    this._shownFloor = null;
    this._pickedRoom = null;
    this._pickedFloor = null;
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
    if (!this._layout) this._loadLayout();
    this._syncTimer();
    this.requestUpdate();
  }

  /** The states the render reads. A motion sensor's own `last_changed` is the moment it went off, so it is also the moment its
   * fade starts (2026-10-06: the card used to remember when it went on, which ended a long motion's fade before it began). */
  private _stateForRender(): Hass["states"] | undefined {
    return this._hass?.states;
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
    if (this._pulseTimer !== null) { globalThis.clearTimeout(this._pulseTimer); this._pulseTimer = null; this._pulse = null; }
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
      this._hideTip();
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
   * the plan itself).  */
  private _selectFloor(key: string): void {
    if (this._shownFloor === key) return;
    this._closePopup(); // its subject is on the floor just left
    this._settleTurn(false); // a turn in flight ends where it was going, under the floor it began on
    this._saveViewNow(); // the floor just left keeps its zoom, turn and camera (S14.4)
    this._shownFloor = key;
    this._kept = null; // a kept thing is kept on its floor only, and only until the person looks elsewhere
    this._pickedRoom = null; // a room of the floor just left means nothing on this one
    this._pickedFloor = null;
    this._syncFloorMemory(); // and the floor now shown brings its own
    this._scheduleSave();
    this.requestUpdate();
  }

  /** True while any motion sensor on the shown floor (a motion device, or a room's own `motion` list) is off and inside its fade window,
   * or for one tick after it, so the last render is made past the window and leaves no faint border behind. */
  private _motionFading(): boolean {
    const f = this._floor();
    const fadeMs = (this._config.fade ?? DEFAULT_MOTION_FADE_S) * 1000;
    if (!f || !this._hass || fadeMs <= 0) return false;
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
    this._applyWidthDefault();
    this._positionToolbar();
    this._positionActivePanel();
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
            openChooser: (title, entities) => this._openChooserDialog(title, entities),
            openPopup: (t, at, from) => this._openPopup(t, at, from),
            getUnlinked: (i) => this._floor()?.unlinked[i],
            getPiece: (i) => this._floor()?.furniture?.[i],
            stack: (i) => this._tapStack(i),
          })
        : null;
      this._unbindSpider?.();
      this._unbindSpider = svg ? this._bindSpider(svg) : null;
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
            openVacuumDialog: (d) => this._openVacuumDialog(d),
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

    // S24.8: the floor-off checklist, the same rule: Cancel on open, the card on close, once each.
    const offOpen = this._offDialog !== null;
    if (offOpen && !this._offDialogWasOpen) {
      this.shadowRoot?.querySelector<HTMLButtonElement>(".fp-off-dialog button.cancel")?.focus();
    } else if (!offOpen && this._offDialogWasOpen) {
      this.focus();
    }
    this._offDialogWasOpen = offOpen;
    this._syncPopup();
    this._syncTip();
    this._placePulse();
  }

  /** Whether the 3D model is what the card draws: 3D is picked, its module is loaded, it has not failed, and there is a floor. */
  private _shows3d(): boolean {
    return this._viewPick() === "3d" && lib3d !== null && this._fallback3d === null && this._floor() !== null;
  }

  private _dispose3d(): void {
    if (this._view3d && this._camMoved) this._saveViewNow(); // the camera is read from the view: before it goes
    this._view3d?.dispose();
    this._view3d = null;
    this._view3dFloor = null;
    this._view3dKey = null;
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
          onCamera: () => { this._camMoved = true; this._scheduleSave(); },
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
      const key = this._floorKey()!;
      if (key !== this._view3dKey) { // S14.4: another floor (or a new view) brings the camera its floor was left with
        this._view3dKey = key;
        const cam = this._floorViews.get(key)?.cam;
        this._camMoved = cam !== undefined;
        if (cam) this._view3d.setCamera(cam);
      }
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
    const svgEl = (tag: string, attr: string, v: number, linked = false): Element => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
      el.setAttribute(attr, String(v));
      if (linked) el.setAttribute("data-linked", "");
      return el;
    };
    const unbindGestures = bindDeviceActions(host, this, (i) => this._floor()?.devices[i], (i) => this._floor()?.doors[i], {
      longPress: !this._kiosk(),
      openVacuumDialog: (d) => this._openVacuumDialog(d),
      openChooser: (title, entities) => this._openChooserDialog(title, entities),
      openPopup: (t, at, from) => this._openPopup(t, at, from),
      getUnlinked: (i) => this._floor()?.unlinked[i],
      getPiece: (i) => this._floor()?.furniture?.[i],
      resolve: (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return null;
        const p = this._pick3d(e);
        return !p ? null : p.type === "device" ? svgEl("g", "data-x", p.index) : p.type === "door" ? svgEl("line", "data-d", p.index) : p.type === "unlinked" ? svgEl("g", "data-u", p.index) : p.type === "piece" ? svgEl("g", "data-f", p.index, true) : null;
      },
    });
    let start: { x: number; y: number } | null = null, pointers = 0;
    let last: { t: number; x: number; y: number; before: PickMemo } | null = null;
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
      if (p && (p.type === "device" || p.type === "door" || p.type === "unlinked" || p.type === "piece")) { last = null; return; } // its own thing, never a pick
      this._closePopup(); // a tap on anything else is an outside tap
      const now = performance.now();
      if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_PX) {
        this._restorePick(last.before);
        last = null;
        return;
      }
      last = { t: now, x: e.clientX, y: e.clientY, before: { pick: this._pickedRoom, floor: this._pickedFloor, filter: this._roomFilter } };
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
      const t = p && !this._popup ? (p.type === "device" ? this._targetOf("x", p.index) : p.type === "door" ? this._targetOf("d", p.index) : p.type === "unlinked" ? this._targetOf("u", p.index) : p.type === "piece" ? this._targetOf("f", p.index) : null) : null;
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
  /** Whether any of the card's dialogs is open. Only one is ever open; each `_open…Dialog` checks this first. */
  private _dialogOpen(): boolean {
    return !!(this._coverDialog || this._vacuumDialog || this._chooserDialog || this._offDialog);
  }

  private _openCoverDialog(door: Door): void {
    if (this._dialogOpen()) return;
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
    if (this._dialogOpen()) return;
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
    if (this._dialogOpen()) return;
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
      // Only what is in this card's own shadow tree counts as inside: an icon of another card must close this card's popup.
      if (n instanceof Element && n.getRootNode() === this.shadowRoot && (n.classList.contains("fp-pop") || n.classList.contains("fp-3d") || n.matches(`${THINGS}, button[data-x], [data-pop]`))) return;
    }
    this._closePopup();
  };

  /** What index `i` of the shown floor is, as the gesture code names it. */
  private _targetOf(kind: "x" | "d" | "u" | "f", i: number): TapTarget | null {
    const f = this._floor();
    if (!f || !Number.isFinite(i)) return null;
    if (kind === "x") { const device = f.devices[i]; return device ? { device, index: i } : null; }
    // A linked piece speaks for its device (`pieceDevice`): the same name and state line as a device icon. `index` is the piece's, nothing reads it for a hover.
    if (kind === "f") { const m = f.furniture?.[i], device = m && pieceDevice(m); return device ? { device, index: i } : null; }
    if (kind === "d") { const door = f.doors[i]; return door ? { door, index: i } : null; }
    const unlinked = f.unlinked?.[i];
    return unlinked ? { unlinked, index: i } : null;
  }

  private _deviceSubject(d: Device, name?: string): PopupSubject {
    const friendly = this._hass?.states[d.entity]?.attributes?.friendly_name;
    return {
      key: `d:${d.entity || d.id}`, type: d.type, entity: d.entity || undefined, entities: moreInfoEntities(d),
      ...(d.type === "light" && d.bound ? { lamp: d } : {}),
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
    // S22.1: a lamp lit only by its relay reads as the plan draws it, and names what keeps it on.
    const via = s.lamp ? relayText(s.lamp, states) : null;
    if (via) return via;
    const w = s.powerEntity ? wattsOf(states?.[s.powerEntity]) : null;
    return stateText(s.type, states?.[e], w === null ? undefined : `${Math.round(w * 10) / 10} W`);
  }

  /** S24.7 (F2): a tap on an Overview row goes to its thing; the popup opens beside the row. */
  private _tapOverviewRow(o: OverviewRow, e: MouseEvent): void {
    const row = e.currentTarget as Element, b = row.getBoundingClientRect();
    this._locate({ floor: o.floor, ...o.at }, row, e.detail > 0 ? { x: e.clientX, y: e.clientY } : { x: b.left + b.width / 2, y: b.bottom });
  }

  /**
   * S24.7: go to a thing of the layout. It switches to its floor when the card can show that floor (a card pinned to one
   * floor cannot: it only opens the popup), centres the plan on it at `LOCATE_ZOOM` or closer (not in 3D, and with
   * `zoom: false` at the zoom on show), rings it for `PULSE_MS`, and opens its popup beside `from`. A linked piece opens
   * more-info, as its tap on the plan does. A ref that names nothing does nothing. The search (S24.8) calls this too.
   */
  private _locate(ref: { floor: string } & ThingRef, from: Element | null = null, at: { x: number; y: number } | null = null): void {
    const f = this._layout?.floors[ref.floor];
    if (!f || !Number.isInteger(ref.index) || ref.index < 0) return;
    const device = ref.what === "device" ? f.devices[ref.index] : undefined;
    const piece = ref.what === "piece" ? f.furniture?.[ref.index] : undefined;
    const door = ref.what === "door" ? f.doors?.[ref.index] : undefined;
    const p: Pt | null = device ? deviceCentre(device) : piece ? [piece.x, piece.y] : door ? [(door.a[0] + door.b[0]) / 2, (door.a[1] + door.b[1]) / 2] : null;
    if (!device && !piece && !door) return;
    const shows = ref.floor === this._floorKey() || !!this._floorList()?.some(([k]) => k === ref.floor);
    if (shows) {
      this._selectFloor(ref.floor); // a no-op on the floor already shown
      if (p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && !this._shows3d()) {
        const now = this._pendingView?.zoom ?? this._anchorOfView()?.zoom ?? 1;
        this._pendingView = { focus: p, zoom: this._zoomMode() === false ? now : Math.max(now, LOCATE_ZOOM) };
        this._scheduleSave();
      }
      this._startPulse({ floor: ref.floor, what: ref.what, index: ref.index });
    }
    // S24.8: search and rows do not follow Layers. A thing of a hidden family is drawn anyway, and the sheet says why it is alone.
    const fam: LayerId | null = device ? layerOfType(device.type) : piece ? "furniture" : null;
    this._kept = shows && fam && this._hiddenLayers.includes(fam) ? { floor: ref.floor, t: device ? "dev" : "furn", i: ref.index, fam } : null;
    const point = at ?? (() => { const b = (from ?? this).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.bottom }; })();
    if (piece) { const d = pieceDevice(piece); if (d) fireEvent(this, "hass-more-info", { entityId: d.entity }); }
    else if (device) this._openSubject(this._deviceSubject(device), point, from);
    else if (door) { const s = this._subjectOf({ door, index: ref.index }); if (s) this._openSubject(s, point, from); }
    this.requestUpdate();
  }

  private _startPulse(p: { floor: string } & ThingRef): void {
    this._pulse = p;
    if (this._pulseTimer !== null) globalThis.clearTimeout(this._pulseTimer);
    this._pulseTimer = globalThis.setTimeout(() => { this._pulseTimer = null; this._pulse = null; this.requestUpdate(); }, PULSE_MS);
  }

  /** After every render: the ring sits over its thing's icon, door or piece on the plan, or hides when the plan does not show it. */
  private _placePulse(): void {
    const ring = this.shadowRoot?.querySelector<HTMLElement>(".fp-pulse");
    const p = this._pulse;
    if (!ring || !p) return;
    const sel = p.what === "device" ? `svg g[data-x="${p.index}"]` : p.what === "piece" ? `svg g[data-f="${p.index}"]` : `svg line[data-d="${p.index}"]`;
    const el = p.floor === this._floorKey() ? this.shadowRoot?.querySelector(sel) : null;
    const r = el?.getBoundingClientRect(), h = this.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) { ring.hidden = true; return; }
    const size = Math.max(24, Math.min(r.width, r.height) + 16);
    ring.hidden = false;
    ring.style.left = `${r.left - h.left + r.width / 2}px`;
    ring.style.top = `${r.top - h.top + r.height / 2}px`;
    ring.style.width = ring.style.height = `${size}px`;
  }

  private _openPopup(t: TapTarget, at: { x: number; y: number }, from: Element | null): void {
    const s = this._subjectOf(t);
    if (s) this._openSubject(s, at, from);
  }

  /** Opens the popup, swaps it for another subject's, or closes it when the same subject is tapped again. Nothing is operated here. */
  private _openSubject(s: PopupSubject, at: { x: number; y: number }, from: Element | null): void {
    if (this._dialogOpen()) return;
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

  // ---- S25.5: spiderfy ----------------------------------------------------------------------------------------------

  private _foldSpider(): void {
    if (!this._spider) return;
    this._spider = null;
    this.requestUpdate();
  }

  /** The devices whose discs overlap device `i`'s on screen and are drawn at this detail level, `i` included; fewer than two when it stands alone. */
  private _stackOf(i: number): number[] {
    const f = this._floor(), fit = this._fit, v = this._current(), svg = this.shadowRoot?.querySelector("svg.fp-zoomable");
    if (!f || !fit || !v || !svg || !(this._px > 0) || !(v.w > 0)) return [];
    const unit = 1 / (this._px * (fit.w / v.w));
    const ids: number[] = [], spots: Pt[] = [];
    f.devices.forEach((d, j) => {
      const g = svg.querySelector<SVGGElement>(`g[data-x="${j}"]`);
      if (!g || getComputedStyle(g).display === "none") return; // not drawn: layer hidden, or idle at far
      ids.push(j);
      spots.push("a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y]);
    });
    const at = ids.indexOf(i);
    if (at < 0) return [];
    const group = stackGroups(spots, STACK_PX * unit).find((g) => g.includes(at)) ?? [];
    // Overlaps chain, so a packed grid is one group of dozens and its ring would be wider than the card: the tapped device and its nearest neighbours.
    const near = group.length > SPIDER_MAX ? [...group].sort((a, b) => Math.hypot(spots[a][0] - spots[at][0], spots[a][1] - spots[at][1]) - Math.hypot(spots[b][0] - spots[at][0], spots[b][1] - spots[at][1])).slice(0, SPIDER_MAX).sort((a, b) => a - b) : group;
    return near.map((k) => ids[k]);
  }

  /** The tap of a device icon asks here first. A tap on a stack opens its ring and is handled; a tap on a ring member, or on a lone device, is not (it acts as ever). */
  private _tapStack(i: number): boolean {
    if (this._spider?.includes(i)) return false;
    const members = this._stackOf(i);
    if (members.length < 2) return false;
    this._closePopup();
    this._spider = members;
    this._spiderFloor = this._floorKey();
    this.requestUpdate();
    return true;
  }

  /** The ring's spots for `renderFloor`, or none. The ring is a fixed size on screen (`spiderLayout`), kept inside the view. */
  private _spiderSpots(f: Floor, fit: View, box: View, rotate: unknown): { i: number; at: Pt }[] | undefined {
    if (this._spider && this._spiderFloor !== this._floorKey()) this._spider = null;
    if (!this._spider || !(this._px > 0) || !(box.w > 0)) return undefined;
    const ids = this._spider.filter((i) => i < f.devices.length);
    const spots = ids.map((i) => { const d = f.devices[i]; return "a" in d ? ([(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] as Pt) : ([d.x, d.y] as Pt); });
    // A turned plan is rotated after the drawing, so its view box is not in the drawing's frame: no clamp then.
    const room = rotate ? { x: -1e9, y: -1e9, w: 2e9, h: 2e9 } : box;
    const at = spiderLayout(spots, 1 / (this._px * (fit.w / box.w)), room);
    return at.length ? ids.map((i, j) => ({ i, at: at[j] })) : undefined;
  }

  /** A press on the plan that is not on a member of the open ring folds it. Escape does the same (`_onViewKey`). */
  private _bindSpider(svg: Element): () => void {
    const onDown = (e: Event) => {
      if (!this._spider) return;
      const g = (e.target as Element | null)?.closest?.("g[data-x]");
      if (g && this._spider.includes(Number(g.getAttribute("data-x")))) return;
      this._foldSpider();
    };
    svg.addEventListener("pointerdown", onDown);
    return () => svg.removeEventListener("pointerdown", onDown);
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
    if (s.door) return null;
    return s.lamp ? lampOp(s.lamp, this._hass?.states) : popupOp(s.type, s.entity, this._hass?.states[s.entity ?? ""]?.state);
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
      subject: s, text: this._subjectText(s), op, confirming: p.confirming, kiosk: this._kiosk(), caps,
      info: this._kiosk() || !(s.entity ?? s.entities[0]) ? [] : deviceInfo((s.entity ?? s.entities[0])!, { ...this._hass, states: this._stateForRender() }),
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
    if (op.calls) for (const c of op.calls) this._hass?.callService?.(c.domain, c.service, c.data);
    else this._hass?.callService?.(op.domain, op.service, { entity_id: p.s.entity });
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
      placeNear(el, this, this._popup.x, this._popup.y, 14, o?.isConnected && o.matches(".fp-active-row, fp-search") ? this._besideRect(o) : null);
    }
    if (key === this._popupFocusKey) return;
    this._popupFocusKey = key;
    if (key && el) (el.querySelector<HTMLElement>(".fp-pop-do") ?? el.querySelector<HTMLElement>(".fp-pop-more"))?.focus({ preventScroll: true });
    else if (!key) {
      if (this._dialogOpen()) { this._popupReturn = null; return; } // the dialog took focus; it hands it back itself
      const back = this._popupReturn as HTMLElement | null;
      this._popupReturn = null;
      (back?.isConnected ? back : this).focus({ preventScroll: true });
    }
  }

  /** Where a popup opened from the sheet stands beside: the opener's height, the sheet's sides, so it clears the sheet's
   *  border and padding as well as the row or the search box (S24.8). */
  private _besideRect(o: Element): DOMRect {
    const r = o.getBoundingClientRect(), sheet = o.closest(".fp-active")?.getBoundingClientRect();
    return sheet ? new DOMRect(sheet.left, r.top, sheet.width, r.height) : r;
  }

  /** Hover on the plan (mouse only; a finger has the popup). The tooltip follows the pointer over an icon, a door or an appliance and goes when it leaves, is pressed or the page scrolls. */
  private _bindHover(svg: Element): () => void {
    const move = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType !== "mouse" || pe.buttons || this._popup) { this._hideTip(); return; }
      const el = (pe.target as Element | null)?.closest?.(THINGS);
      const kind = el ? thingKind(el) : "u";
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
      this._tipTarget = t;
      this._tipHost = this.getBoundingClientRect();
      if (el) {
        const kind = thingKind(el);
        this._tipSel = `[data-${kind}="${el.getAttribute(`data-${kind}`)}"]`;
        this._holdTipEl(el);
      }
    }
    this._tipAt = el || this._tipSel ? { x, y } : null;
    const h = this._tipHost!, w = tip.offsetWidth, ht = tip.offsetHeight;
    const left = Math.max(4, Math.min(h.width - w - 4, x - h.left + 12));
    const below = y - h.top + 18;
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(below + ht > h.height - 4 ? Math.max(4, y - h.top - ht - 10) : below)}px)`;
  }

  /** The plan's element under the tooltip: it points at the tooltip and its own `<title>` is held back, so the browser's tooltip does not sit under ours. */
  private _holdTipEl(el: Element): void {
    el.setAttribute("aria-describedby", "fp-tip");
    const title = el.querySelector(":scope > title");
    if (title) { el.removeChild(title); this._tipTitle = { el, title }; }
    this._tipEl = el;
  }

  /** After every render: a state change while the tooltip is up rewrites its text, and the plan's elements, drawn again by that render, get the same treatment as the first (the new `<title>` out, `aria-describedby` on). The subject gone from the plan hides it. */
  private _syncTip(): void {
    const tip = this.shadowRoot?.querySelector<HTMLElement>(".fp-tip");
    if (this._tipKey === null || !tip) return;
    const s = this._tipTarget ? this._subjectOf(this._tipTarget) : null;
    if (!s || s.key !== this._tipKey) { this._hideTip(); return; }
    (tip.firstElementChild as HTMLElement).textContent = s.name;
    (tip.lastElementChild as HTMLElement).textContent = this._subjectText(s);
    if (this._tipSel) {
      const el = this.shadowRoot?.querySelector(`svg ${this._tipSel}`) ?? null;
      if (!el) { this._hideTip(); return; }
      if (el !== this._tipEl) { this._tipTitle = null; this._holdTipEl(el); } // the old element and its title are gone with the old drawing
      // A zoom or a turn moves the icon from under a pointer that did not move, and no pointermove follows: a tooltip names what is under the pointer.
      const at = this._tipAt, top = at ? this.shadowRoot?.elementFromPoint(at.x, at.y)?.closest(THINGS) ?? null : el;
      if (top !== el) { this._hideTip(); return; }
    }
  }

  private _hideTip = (): void => {
    if (this._tipKey === null) return;
    this._tipKey = null;
    this._tipTarget = null;
    this._tipSel = null;
    this._tipAt = null;
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
      else if (this._offDialog) this._closeOffDialog();
      else this._closeCoverDialog();
      return;
    }
    if (e.key !== "Tab") return;
    const root = this.shadowRoot;
    const buttons = root ? [...root.querySelectorAll<HTMLElement>(".fp-dialog-actions button:not(:disabled), .fp-chooser-list button, .fp-off-list input")] : [];
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
    const current = this._floorKey(), selected = this._pickedFloorKey(), floors = this._attention()?.floors ?? {};
    // aria-pressed marks the floor shown; the class marks the floor whose panel is open (S20.2), a separate fact.
    // S24.7: "Ground · 3", the floor's attention count (things, not items; nothing at 0); an alarm turns the pill --fp-warn.
    return html`<div class="fp-floors">
      ${list.map(([key, fl]) => {
        const n = floors[key]?.count ?? 0, alarm = floors[key]?.alarm === true;
        const cls = [key === selected ? "fp-floor-picked" : "", alarm ? "fp-floor-alarm" : ""].filter(Boolean).join(" ");
        return html`<button type="button" class=${cls} aria-pressed=${key === current ? "true" : "false"} aria-expanded=${this._activeListVisible() ? (key === selected ? "true" : "false") : nothing} @click=${() => this._tapFloorChip(key)}>${fl.title || key}${n ? html`<span class="fp-floor-sep"> · </span><span class="fp-floor-count">${n}</span>` : nothing}</button>`;
      })}
    </div>`;
  }

  /** S20.2: a pill shows its floor, as before, and selects it so the side panel opens on the floor. The selected floor's
   *  pill again lets go. With the panel off (`active_list: false`) there is nowhere to show a floor, so it only switches, as a
   *  room tap does nothing there. Kiosk has no pills, so it never gets here. */
  private _tapFloorChip(key: string): void {
    const letGo = this._pickedFloorKey() === key;
    this._selectFloor(key);
    this._pickFloor(letGo || !this._activeListVisible() ? null : key);
  }

  /** The key of the selected floor while it is the one shown, else null (a floor the config no longer lists means nothing). */
  private _pickedFloorKey(): string | null {
    return this._pickedFloor !== null && this._pickedFloor === this._floorKey() ? this._pickedFloor : null;
  }

  private _pickFloor(key: string | null): void {
    this._pickedRoom = null;
    this._pickedFloor = key;
    this._roomFilter = true;
    this._sceneAsk = null;
    this.requestUpdate();
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

  /** Puts the undragged panel at the top: the CSS default under a one-row toolbar, lower when the toolbar wraps. */
  private _placeTopDock(panel: HTMLElement): void {
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
  }

  private _positionActivePanelNow(): void {
    const panel = this.shadowRoot?.querySelector<HTMLElement>(".fp-active");
    if (!panel) return;
    const sheet = panel.classList.contains("fp-room-open") && this.getBoundingClientRect().width < ACTIVE_FOLD_BELOW_PX;
    panel.classList.toggle("fp-sheet", sheet);
    // A sheet docks where it hides less of the picked room. Three places are laid out and the one whose box overlaps
    // the room's bounding box least wins: under the toolbar (which wraps on a narrow card, so it can be low), at the
    // bottom, or at the top over the toolbar (8 px; the controls are back when the panel closes). On a tie the dock
    // away from the room's centre goes first.
    let bottom = false;
    if (sheet && !this._activePos) {
      const poly = this.shadowRoot?.querySelector("svg polygon.room-picked");
      if (poly) {
        const h = this.getBoundingClientRect(), r = poly.getBoundingClientRect();
        const hidden = () => {
          const p = panel.getBoundingClientRect();
          return Math.max(0, Math.min(p.right, r.right) - Math.max(p.left, r.left)) * Math.max(0, Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top));
        };
        const place = {
          below: () => { panel.classList.remove("fp-dock-bottom", "fp-dock-over"); this._placeTopDock(panel); },
          bottom: () => { panel.classList.remove("fp-dock-over"); panel.classList.add("fp-dock-bottom"); panel.style.top = ""; panel.style.left = ""; },
          over: () => { panel.classList.remove("fp-dock-bottom"); panel.classList.add("fp-dock-over"); panel.style.left = ""; panel.style.top = ""; },
        };
        const roomInUpperHalf = r.top + r.height / 2 - h.top < h.height / 2;
        const order = (roomInUpperHalf ? ["bottom", "below", "over"] : ["below", "bottom", "over"]) as (keyof typeof place)[];
        let best = order[0]!, least = Infinity;
        for (const k of order) { place[k](); const o = hidden(); if (o < least) { least = o; best = k; } }
        place[best]();
        bottom = best === "bottom";
        if (best === "over") return;
      }
    }
    panel.classList.remove("fp-dock-over");
    panel.classList.toggle("fp-dock-bottom", bottom);
    if (bottom) { panel.style.top = ""; panel.style.left = ""; return; }
    if (!this._activePos) { this._placeTopDock(panel); return; }
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
    this._pickedFloor = null;
    this._roomFilter = true;
    this._sceneAsk = null;
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
  private _restorePick(before: PickMemo): void {
    this._pickedRoom = before.pick;
    this._pickedFloor = before.floor;
    this._roomFilter = before.filter;
    this.requestUpdate();
  }

  /** A keyboard press on a toggling row does what a tap on its icon does (S14.2): it opens the popup, anchored on the row. Nothing is operated by the press itself. */
  private _keyToggle(r: RoomDeviceRow, row: Element | null): void {
    const d = this._floor()?.devices[r.index];
    const b = row?.getBoundingClientRect();
    if (d?.type === "vacuum") { this._openVacuumDialog(d); return; } // as its tap on the plan does
    if (d) this._openPopup({ device: d, index: r.index }, { x: b ? b.left + b.width / 2 : 0, y: b ? b.bottom : 0 }, row);
  }

  /** A row of the room section's device list. It carries `data-x`, so the panel's own `bindDeviceActions` gives it the
   *  plan icon's gestures: a tap opens the popup, a hold opens more-info. Its `click` only acts for a keyboard press
   *  (`detail` 0), which sends no pointer events. */
  private _roomDeviceRow(r: RoomDeviceRow) {
    // S14 review: every row is the plan icon's twin (`data-x`): a tap opens the popup, a hold opens more-info, whatever the type.
    const click = (e: MouseEvent) => { if (e.detail === 0) this._keyToggle(r, e.currentTarget as Element); };
    // A linked piece has no `data-x` (its index is in `furniture`, not `devices`): its row is its tap on the plan, more-info.
    if (r.piece) {
      return html`<div class="fp-item">
      <button type="button" class=${r.on ? "fp-active-row" : "fp-active-row fp-off"} style="--fp-active-row-color:var(${r.colorVar})" @click=${() => fireEvent(this, "hass-more-info", { entityId: r.entity })}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${DEVICE_ICONS[r.type]}></path></svg>
        <span>${r.name}</span><span class="fp-row-state">${r.state}</span>
      </button>
    </div>`;
    }
    return html`<div class="fp-item">
      <button type="button" class=${r.on ? "fp-active-row" : "fp-active-row fp-off"} data-x=${String(r.index)} style="--fp-active-row-color:var(${r.colorVar})" @click=${click}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${DEVICE_ICONS[r.type]}></path></svg>
        <span>${r.name}</span><span class="fp-row-state">${r.state}</span>
      </button>
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
    </div>`;
  }

  /** S14.7: the room's scene buttons: Home Assistant scenes, custom scenes, All off and All on. */
  private _scenesBlock() {
    const f = this._floor(), at = this._picked();
    if (!f || at === null) return nothing;
    const menu = roomScenes(f, at, this._hass);
    return scenesTemplate({ menu, asking: this._sceneAsk, run: (key) => this._runScene(key), cancel: () => { this._sceneAsk = null; this.requestUpdate(); }, open: this._foldedCats.has(SCENES_OPEN), toggle: () => this._toggleCat(SCENES_OPEN) });
  }

  /** One tap on a scene button. A Home Assistant scene is `scene.turn_on`; a custom scene and the presets go through the light and switch services (`customCalls`, `presetCalls`). A custom scene that turns a switch off asks first. */
  private _runScene(key: string): void {
    const f = this._floor(), at = this._picked(), call = this._hass?.callService;
    if (!f || at === null || !call) return;
    const [kind, id = ""] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    const send = (c: { domain: string; service: string; data: Record<string, unknown> }) => this._hass?.callService?.(c.domain, c.service, c.data);
    if (kind === "ha") {
      if (!roomScenes(f, at, this._hass).ha.some((s) => s.entity === id)) return;
      send({ domain: "scene", service: "turn_on", data: { entity_id: id } });
    } else if (kind === "preset") {
      if (id !== "on") return; // S24.8: the only preset left; the room's Lights off button is the off
      for (const c of presetCalls("on", roomScenes(f, at, this._hass).lights)) send(c);
    } else if (kind === "custom") {
      const scene = customScene(f, at, id);
      if (!scene) return;
      if (sceneNeedsConfirm(scene) && this._sceneAsk !== key) { this._sceneAsk = key; this.requestUpdate(); return; }
      for (const c of customCalls(scene)) send(c);
    }
    this._sceneAsk = null;
    this.requestUpdate();
  }

  /** S20.1: the room's or floor's Lights off (S24.8; was All off). One call per domain (`presetCalls`, the scene preset's own builder) over
   *  `offEntities`: the lights that are on, and (S22.1) the bound relays that are on, each once. In practice one
   *  `light.turn_off` and, with a relay-lit lamp, one `switch.turn_off`. */
  private _allOff(lights: string[]): void {
    for (const c of presetCalls("off", lights)) this._hass?.callService?.(c.domain, c.service, c.data);
    this.requestUpdate();
  }

  /** S11.3: the room section: name, the facts the plan only hints at, and the room's devices as rows that act. A fact with
   *  nothing behind it (no sensor, no state) is left out, never printed empty; doors and lights always say "none". */
  private _roomSection(s: RoomSummary, active: unknown, scope: Scope) {
    const facts: [string, string][] = [
      ["Area", s.areaM2 === null ? "" : `${s.areaM2} m²`],
      ["Temperature", s.temperature],
      ["Humidity", s.humidity],
      ["Motion", s.motion ? `${s.motion.on ? "on" : "off"} since ${formatChanged(s.motion.since)}` : ""],
      // S24.3 (G3): an unlocked door is not an open one. "Unlocked" shows only where a door carries a lock.
      ["Open", s.openings.join(", ") || "none"],
      ["Unlocked", s.hasLocks ? s.unlocked.join(", ") || "none" : ""],
      ["Lights on", s.lightsOn.join(", ") || "none"],
    ];
    return html`<div class="fp-room">
      <div class="fp-room-head">
        <span class="fp-room-name">${s.name || scope.unnamed}</span>
        <button type="button" class="fp-room-clear" aria-label=${scope.clear} @click=${() => this._pickRoom(null)}>×</button>
      </div>
      <dl class="fp-room-facts">${facts.filter(([, v]) => v).map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      ${s.offEntities.length || scope === FLOOR_SCOPE ? html`<div class="fp-alloff-row">${s.offEntities.length ? html`<button type="button" class="fp-alloff" aria-label=${`Turn off all lights in ${s.name || scope.unnamed}`} title=${this._layout ? allOffTitle(this._layout.floors, this._floorKey() ?? "", s) : ALL_OFF_TITLE} @click=${() => this._allOff(s.offEntities)}>Lights off</button>` : nothing}${scope === FLOOR_SCOPE ? this._floorOffButton() : nothing}</div>` : nothing}
      ${this._scenesBlock()}
      ${active}
      <div class="fp-active-group-label">Devices</div>
      <div class="fp-room-devices">
        ${s.devices.length || s.sensors.length
          ? groupByCategory([...s.devices.map((r) => ({ type: r.type, tpl: this._roomDeviceRow(r) })), ...s.sensors.map((r) => ({ type: (r.kind === "temps" ? "temp" : r.kind) as DeviceType, tpl: this._roomSensorRow(r) }))])
              .map((g) => this._catGroup("r", g.id, g.label, g.items.length, g.items.map((i) => i.tpl)))
          : html`<p class="fp-active-empty">${scope.noDevices}</p>`}
      </div>
    </div>`;
  }

  /** `attention()` for the layout and states on show; computed once per pair (the pills and the Overview both read it). */
  private _attention(): Attention | null {
    const layout = this._layout, states = this._stateForRender(), reg = this._hass?.entities;
    if (!layout) return null;
    const m = this._attnMemo;
    if (m && m.layout === layout && m.states === states && m.reg === reg) return m.a;
    // The registry finds a placed device's battery sensor on its own HA device (S24.R1).
    const a = attention(layout, states, reg);
    this._attnMemo = { layout, states, reg, a };
    return a;
  }

  private _floorTitle(key: string): string {
    return this._layout?.floors[key]?.title || key;
  }

  /** An Attention item as a row: the name, then what is wrong and for how long ("open · 12 min"). */
  private _attnRow(it: AttentionItem, now: number): OverviewRow {
    // `attention` read the level, from whichever entity or attribute reported it (S24.R1).
    const level = typeof it.level === "number" && Number.isFinite(it.level) ? String(Math.round(it.level)) : "";
    const age = formatAge(it.lastChanged, now);
    const what = ATTENTION_TEXT[it.kind]?.(it, level) ?? it.kind;
    return { entity: it.entity, name: it.name, floor: it.floor, at: { what: it.at.what, index: it.at.index }, ...(it.room ? { room: it.room } : {}), state: what, ...(age ? { age } : {}), ...(it.type ? { type: it.type } : {}), colorVar: "--fp-warn", attn: true };
  }

  /** An active device as a row, its state in the popup's own words (`_subjectText`): a relay-lit lamp reads "on · via …". */
  private _activeRow(it: ActiveDevice): OverviewRow {
    const f = this._layout?.floors[it.floor];
    const d = it.at.what === "device" ? f?.devices[it.at.index] : it.at.what === "piece" ? (f?.furniture?.[it.at.index] && pieceDevice(f.furniture[it.at.index]!)) || undefined : undefined;
    const state = d ? this._subjectText(this._deviceSubject(d)) : stateText(it.type, this._hass?.states?.[it.entity]);
    return { entity: it.entity, name: it.name, floor: it.floor, at: it.at, ...(it.room ? { room: it.room } : {}), state, type: it.type, colorVar: it.colorVar, attn: false };
  }

  /** One row: the whole row is the one target (A3: no chevron; the details are in the popup). Text through lit, escaped (finding 2). */
  private _ovRow(o: OverviewRow, badge: boolean) {
    const icon = o.type && DEVICE_ICONS[o.type];
    return html`<button type="button" class=${o.attn ? "fp-active-row fp-ov-row fp-ov-alert" : "fp-active-row fp-ov-row"} data-pop data-entity=${o.entity} data-floor=${o.floor}
      style="--fp-active-row-color:var(${o.colorVar})" @click=${(e: MouseEvent) => this._tapOverviewRow(o, e)}>
      ${o.attn || !icon ? html`<span class="fp-ov-mark" aria-hidden="true">⚠</span>` : html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${icon}></path></svg>`}
      <span class="fp-ov-text"><span class="fp-ov-name">${o.name}</span>${o.room || badge
        ? html`<span class="fp-ov-where">${o.room ?? ""}${badge ? html`<span class="fp-row-floor">${this._floorTitle(o.floor)}</span>` : nothing}</span>`
        : nothing}</span>
      <span class="fp-row-state">${o.state}${o.age ? html` · <span class="fp-ov-age">${o.age}</span>` : nothing}</span>
    </button>`;
  }

  /** S24.7: Attention on top, then Active by category, over `attn` and `items` (already cut to the scope). */
  private _overviewList(attn: Attention, items: ActiveDevice[], badge: boolean, empty: string) {
    const now = Date.now();
    const unOpen = this._foldedCats.has(UNAVAILABLE_OPEN);
    const attnRows = attn.items.map((it) => this._attnRow(it, now));
    const groups = groupByCategory(items.map((it) => ({ type: it.type, row: this._activeRow(it) })));
    return html`${attnRows.length || attn.unavailable.length ? html`<section class="fp-ov-section fp-ov-attn"><div class="fp-ov-head">Attention · ${attnRows.length}</div>
        ${attnRows.map((o) => this._ovRow(o, badge))}
        ${attn.unavailable.length ? html`<div class="fp-active-group" data-cat="unavailable">
          <button type="button" class="fp-active-group-label fp-cat" aria-expanded=${unOpen ? "true" : "false"} @click=${() => this._toggleCat(UNAVAILABLE_OPEN)}>
            <span class="fp-cat-chev" aria-hidden="true">${unOpen ? "▾" : "▸"}</span><span class="fp-cat-name">Unavailable</span><span class="fp-active-count">${attn.unavailable.length}</span>
          </button>${unOpen ? attn.unavailable.map((it) => this._ovRow(this._attnRow(it, now), badge)) : nothing}
        </div>` : nothing}
      </section>` : nothing}
      <section class="fp-ov-section fp-ov-act"><div class="fp-ov-head">Active · ${items.length}</div>
        ${groups.length ? groups.map((g) => this._catGroup("a", g.id, g.label, g.items.length, g.items.map((i) => this._ovRow(i.row, badge)))) : html`<p class="fp-active-empty">${empty}</p>`}
      </section>`;
  }

  /** The header's chips: the alerts, then one per category with something on, short ("2 alerts · 6 lights"). */
  private _chips(items: ActiveDevice[], alerts: number) {
    const parts = groupByCategory(items).map((g) => ({ text: `${g.items.length} ${CHIP_NOUN[g.id][g.items.length === 1 ? 0 : 1]}`, warn: false }));
    // What is wrong comes first, so a folded header that cuts the line short still shows it.
    if (alerts) parts.unshift({ text: `${alerts} ${alerts === 1 ? "alert" : "alerts"}`, warn: true });
    return html`<span class="fp-ov-chips" title=${parts.map((p) => p.text).join(" · ")}>${parts.length ? parts.map((p, i) => html`${i ? " · " : ""}<span class=${p.warn ? "fp-chip fp-chip-warn" : "fp-chip"}>${p.text}</span>`) : "Nothing on"}</span>`;
  }

  /** S9.5, S24.7: the floating Overview, card chrome outside the `<svg>` (finding 8). What is wrong (`attention`) comes before
   *  what is on (`activeDevices`, the one place that decides "active"); a thing in Attention is not listed again under Active.
   *  The scope is the floor on show, or every floor with "All floors" (F3), which then badges each row with its floor.
   *
   *  S11.3, S20.2: with a room or floor picked, its section comes first and the list below is cut to its entities
   *  (`filterToRoom`) until "Show all", which lists every floor. The panel stays open while a room is picked. */
  private _activePanel() {
    if (!this._activeListVisible() || !this._layout) return null;
    const state = this._stateForRender();
    const opts = { plugWatts: plugThreshold(this._config.plug_watts), powerLinks: this._powerLinks() };
    const at = this._picked(), floor = this._floor();
    const floorKey = this._pickedFloorKey(), shown = this._floorKey();
    // S20.2: the panel's one subject is the picked room, else the selected floor, summed over its rooms by the same builder.
    const summary = at !== null && floor ? roomSummary(floor, at, state, opts) : floorKey && floor ? floorSummary(floor, state, opts) : null;
    if (summary && at === null && floorKey && !summary.name) summary.name = floorKey;
    const scope = at === null && floorKey ? FLOOR_SCOPE : ROOM_SCOPE;
    const many = Object.keys(this._layout.floors).length > 1;
    // The scope: the picked room or floor while its filter is on; every floor under "Show all"; else the floor on show, or all.
    const all = summary ? !this._roomFilter : this._overviewAll || !many;
    const a = this._attention() ?? { items: [], unavailable: [], floors: {} };
    const inScope = <T extends { floor: string; entity: string }>(list: T[]): T[] => (summary && this._roomFilter ? filterToRoom(list.filter((x) => x.floor === shown), summary) : all ? list : list.filter((x) => x.floor === shown));
    const attn: Attention = { items: inScope(a.items), unavailable: inScope(a.unavailable), floors: a.floors };
    // Only what Attention says about the same fact leaves Active (an open door, an unlocked lock). A low battery says
    // nothing about on or off: a lamp that is on and low is in both (S24.R6).
    const flagged = new Set(attn.items.filter((it) => it.kind !== "battery-low").map((it) => it.entity));
    const items = inScope(activeDevices(this._layout, state, opts)).filter((it) => !flagged.has(it.entity));
    const badge = all && many;
    const list = this._overviewList(attn, items, badge, summary && this._roomFilter ? scope.nothingOn : "Nothing on");
    const folded = this._activeCollapsed && !summary;
    const crumb = summary ? (shown ? this._floorTitle(shown) : "") : all && many ? "All floors" : shown ? this._floorTitle(shown) : "";
    // No `style=` binding here on purpose (Opus review findings 3/4): Lit would rewrite the whole `style`
    // attribute on every render, wiping out the position `_positionActivePanel` sets imperatively after render —
    // that function is the only thing that ever touches this element's inline position.
    return html`<div class=${summary ? "fp-active fp-room-open" : folded ? "fp-active fp-active-folded" : "fp-active"} role="region" aria-label=${summary ? summary.name || scope.unnamed : "Overview"}>
      <div class="fp-active-head" @pointerdown=${(e: PointerEvent) => this._onActiveDragStart(e)}>
        <span class="fp-active-title">Home${crumb ? html`<span class="fp-crumb"> › ${crumb}</span>` : nothing}</span>
        ${summary
          ? nothing
          : html`<button
          type="button"
          class="fp-active-collapse"
          aria-label=${this._activeCollapsed ? "Expand the overview" : "Collapse the overview"}
          aria-expanded=${this._activeCollapsed ? "false" : "true"}
          @click=${() => this._toggleActiveCollapsed()}
        >${this._activeCollapsed ? "▸" : "▾"}</button>`}
        ${this._chips(items, attn.items.length)}
      </div>
      ${folded
        ? null
        : html`<div class="fp-active-body">
            ${summary
              ? this._roomSection(summary, html`<div class="fp-filter"><span>${this._roomFilter ? scope.activeHere : "Active everywhere"}</span><button type="button" class="fp-show-all" @click=${() => { this._roomFilter = !this._roomFilter; this.requestUpdate(); }}>${this._roomFilter ? "Show all" : scope.onlyHere}</button></div>
                <div class="fp-filtered">${list}</div>`, scope)
              : html`<div class="fp-ov-search" data-slot="search"><fp-search .entries=${this._searchEntries()} label="Search the plan" placeholder="Search rooms and devices" @fp-pick=${(e: CustomEvent<SearchEntry>) => this._onSearchPick(e)}></fp-search></div>
                <div class="fp-ov-scopes">${this._floorOffButton()}${this._layersToggle()}${this._detailToggle()}${many ? html`<button type="button" class="fp-ov-scope" aria-pressed=${this._overviewAll ? "true" : "false"} @click=${() => this._toggleOverviewAll()}>All floors</button>` : nothing}</div>
                <div class="fp-ov-layers" data-slot="layers">${this._layerChips()}</div>
                ${this._detailChips()}
                ${list}
                <p class="fp-ov-hint">Tap a row: the plan goes to it.</p>`}
          </div>`}
    </div>`;
  }

  private _toggleOverviewAll(): void {
    this._overviewAll = !this._overviewAll;
    this._saveActiveState();
    this.requestUpdate();
  }

  // ---- S24.8 (F1): search -------------------------------------------------------------------------------------------------------

  /** The search's entries: every device and linked piece (a card pinned to one floor still opens another floor's popup, as
   *  `_locate` does), and the floors and rooms this card can show. Cached by layout, whether states are known (names fall
   *  back to `friendly_name`) and the floors on offer, so the box indexes once per layout, not per keystroke or state update. */
  private _searchEntries(): SearchEntry[] {
    const layout = this._layout;
    if (!layout) return [];
    const known = !!this._hass?.states, shown = this._floorKey() ?? "";
    const floors = [shown, ...(this._floorList() ?? []).map(([k]) => k)].join("\n");
    const m = this._searchMemo;
    if (m && m.layout === layout && m.known === known && m.floors === floors) return m.entries;
    const can = new Set(floors.split("\n"));
    const entries = layoutEntries(layout, this._hass?.states).filter((e) => e.kind === "device" || (e.floor !== undefined && can.has(e.floor)));
    this._searchMemo = { layout, known, floors, entries };
    return entries;
  }

  /** The chord: back to the Overview (a room or floor picked hides it), unfolded, no popup, and the search focused. False
   *  when there is no sheet to search in (kiosk, `active_list: false`, no layout), so the page keeps the key. Unfolding is
   *  the person's choice, as a tap on the fold button is. */
  private _openSearch(): boolean {
    if (!this._activeListVisible() || !this._layout) return false;
    if (this._pickedRoom || this._pickedFloor) this._pickRoom(null);
    if (this._activeCollapsed) { this._activeCollapsed = false; this._activeUserChose = true; this._saveActiveState(); }
    this._closePopup();
    this.requestUpdate();
    void this.updateComplete.then(async () => {
      const box = this.shadowRoot?.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>("fp-search");
      if (!box) return;
      await box.updateComplete;
      box.focus();
    });
    return true;
  }

  /** Enter or a click on a result. A device or piece is located as a row tap locates it (floor, centre, ring, popup beside the
   *  sheet). A floor is shown. A room shows its floor and opens its section, and the keyboard goes to the section's close
   *  button, since the search it came from is gone with the Overview. */
  private _onSearchPick(ev: CustomEvent<SearchEntry>): void {
    const e = ev.detail;
    if (!e || typeof e.floor !== "string") return;
    if (e.kind === "device" && typeof e.device === "number") {
      this._locate({ floor: e.floor, what: e.piece ? "piece" : "device", index: e.device }, ev.currentTarget instanceof Element ? ev.currentTarget : null);
    } else if (e.kind === "floor") {
      this._selectFloor(e.floor);
    } else if (e.kind === "room" && typeof e.room === "number") {
      this._selectFloor(e.floor);
      if (this._floorKey() !== e.floor) return;
      this._pickRoom(e.room);
      void this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLElement>(".fp-room-clear")?.focus());
    }
  }

  // ---- S25.8: detail mode ---------------------------------------------------------------------------------------------------------

  /** The mode on show: this viewer's pick, else the card's YAML `detail`, else the default. Config is untrusted, so junk
   *  counts as no `detail` at all. The default is `auto` only when the viewer can change the level: the Detail button
   *  (Overview shown, so neither `kiosk` nor `active_list: false`) or the zoom buttons and gestures (`zoom` not off, no
   *  kiosk). Otherwise `auto` would hide idle devices at fit with no way to bring them back, so it is `full`. */
  private _detailMode(): DetailMode {
    if (this._pickedDetail !== null) return this._pickedDetail;
    const set = this._config.detail;
    if (typeof set === "string" && (DETAIL_MODES as readonly string[]).includes(set)) return set as DetailMode;
    const canChange = this._activeListVisible() || (this._zoomMode() !== false && !this._kiosk());
    return canChange ? "auto" : "full";
  }

  /** The Detail button beside Layers; it unfolds the three choices. Its text never changes (the title names the mode): a
   *  longer one wraps the tools row in a 260 px sheet and the taller sheet covers devices. The pressed chip shows the mode. */
  private _detailToggle() {
    if (!this._floor() || this._shows3d()) return nothing;
    const m = this._detailMode();
    return html`<button type="button" class="fp-detail-toggle" aria-expanded=${this._detailOpen ? "true" : "false"} title=${`Detail: ${DETAIL_LABELS[m]}. How much of the plan is drawn at each zoom`} @click=${() => { this._detailOpen = !this._detailOpen; this.requestUpdate(); }}>Detail</button>`;
  }

  /** Auto, Full, Minimal as pressable chips; the active one is pressed. A pick is remembered at once. */
  private _detailChips() {
    if (!this._detailOpen || !this._floor() || this._shows3d()) return nothing;
    const cur = this._detailMode();
    const titles: Record<DetailMode, string> = { auto: "Follow the zoom: rooms far out, devices closer in", full: "Always draw everything", minimal: "Always draw only rooms and what needs attention" };
    return html`<div class="fp-ov-detail fp-layer-chips" role="group" aria-label="Detail">${DETAIL_MODES.map((m) => html`<button type="button" class="fp-detail" data-detail=${m} aria-pressed=${m === cur ? "true" : "false"} title=${titles[m]} @click=${() => { this._pickedDetail = m; this._saveViewNow(); this.requestUpdate(); }}>${DETAIL_LABELS[m]}</button>`)}</div>`;
  }

  // ---- S24.8: layer chips --------------------------------------------------------------------------------------------------------

  /** The Layers button in the tools row: it unfolds the chips, and counts what is hidden ("Layers · 2 hidden"), with the
   *  Studio's sentence as its title ("Layers: lights hidden"), so a folded sheet still tells. Short, so it shares a line
   *  with All floors in a 260 px sheet. Folded by default: the sheet covers no more of the plan. Not in live 3D. */
  private _layersToggle() {
    if (!this._floor() || this._shows3d()) return nothing;
    const n = this._hiddenLayers.length;
    return html`<button type="button" class="fp-layers-toggle" aria-expanded=${this._layersOpen ? "true" : "false"} title=${layersSummary(this._hiddenLayers) || "Hide or show families on the plan"} @click=${() => { this._layersOpen = !this._layersOpen; this.requestUpdate(); }}>${n ? `Layers · ${n} hidden` : "Layers"}</button>`;
  }

  /** One text chip per family with something on the floor on show (`layerCounts`); pressed means shown. A click hides or
   *  shows the family, Alt-click shows it alone (again: all). Not in live 3D, which draws every family. Then, unfolded or
   *  not, the note for a thing located under a hidden family, with Show for that family. */
  private _layerChips() {
    const f = this._floor();
    if (!f || this._shows3d()) return nothing;
    const n = layerCounts(f), hidden = this._hiddenLayers, k = this._keptHere();
    const word = (id: LayerId) => (LAYERS.find((l) => l.id === id)?.label ?? id).toLowerCase();
    const chips = LAYERS.filter((l) => n[l.id] > 0).map((l) => {
      const shown = !hidden.includes(l.id);
      return html`<button type="button" class="fp-layer" data-layer=${l.id} aria-pressed=${shown ? "true" : "false"} title=${`${shown ? "Hide" : "Show"} ${word(l.id)} (${n[l.id]}). Alt-click: ${word(l.id)} only`} @click=${(e: MouseEvent) => this._setLayers(e.altKey ? soloLayer(hidden, l.id) : toggleLayer(hidden, l.id))}>${l.label}</button>`;
    });
    return html`${this._layersOpen ? html`<div class="fp-layer-chips">${chips}</div>` : nothing}${k ? html`<p class="fp-layer-note" role="status">Hidden by Layers: ${word(k.fam)} <button type="button" @click=${() => this._setLayers(hidden.filter((x) => x !== k.fam))}>Show</button></p>` : nothing}`;
  }

  private _setLayers(next: LayerId[]): void {
    this._hiddenLayers = next;
    this._kept = null;
    this._saveViewNow();
    this.requestUpdate();
  }

  /** The kept thing when it is on the floor on show and its family is still hidden. */
  private _keptHere() {
    const k = this._kept;
    return k && k.floor === this._floorKey() && this._hiddenLayers.includes(k.fam) ? k : null;
  }

  // ---- S24.8 (C2): Turn off on this floor… --------------------------------------------------------------------------------------

  /** The entry: for the floor on show, disabled with its reason when nothing on it is on. */
  private _floorOffButton() {
    const f = this._floor(), key = this._floorKey();
    if (!f || !key) return nothing;
    const none = floorOffRows(f, this._stateForRender()).length === 0;
    return html`<button type="button" class="fp-floor-off" ?disabled=${none} title=${none ? "Nothing is on on this floor" : "Choose what to turn off on this floor"} @click=${() => this._openOffDialog()}>Turn off on this floor…</button>`;
  }

  private _openOffDialog(): void {
    const f = this._floor(), key = this._floorKey();
    if (!f || !key || this._dialogOpen()) return;
    const rows = floorOffRows(f, this._stateForRender());
    if (!rows.length) return;
    this._closePopup();
    this._offDialog = { floor: key, title: this._floorTitle(key), rows, ticked: rows.map(() => true) };
    this.requestUpdate();
  }

  private _closeOffDialog(): void {
    this._offDialog = null;
    this.requestUpdate();
  }

  private _tickOff(i: number, on: boolean): void {
    const d = this._offDialog;
    if (!d || i < 0 || i >= d.ticked.length) return;
    d.ticked = d.ticked.map((t, j) => (j === i ? on : t));
    this.requestUpdate();
  }

  /** One `turn_off` per domain over the ticked rows (`floorOffCalls`), then the dialog closes. */
  private _confirmOffDialog(): void {
    const d = this._offDialog;
    if (!d) return;
    for (const c of floorOffCalls(d.rows.filter((_, i) => d.ticked[i]))) this._hass?.callService?.(c.domain, c.service, c.data);
    this._closeOffDialog();
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
    this._syncFloorMemory();
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
      px: this._px || undefined, // S23.2: the 11 px floor for names and discs
      zoom: box.w > 0 ? fit.w / box.w : undefined, // S25.4: labels keep their on-screen size at any zoom
      bounds: this._px ? { ...fit, w: Math.max(fit.w / 2, fit.w - this._strip) } : undefined, // S23 review S3: names stay off the control stack
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
      hiddenLayers: this._hiddenLayers,
      attention: this._attention() ? { floor: this._floorKey()!, result: this._attention()! } : undefined, // the Overview's own result, with the registry
      detail: detailFor(fit, box, this._detailMode()), // S25.2: the level for this zoom and mode
      ghost: this._ghost(), // S27.13: the floor below, as faint lines at its place in the house
      spider: this._spiderSpots(f, fit, box, rotate), // S25.5: a fanned stack, or nothing
      keep: this._keptHere(),
      colors: this._layout!.colors, // S19.E3: the studio's per-type colours, as the editor draws them
    });
    // The zoom buttons come after the plan's <svg> in the DOM (they are positioned, so order is not placement):
    // their own icon is an <svg> too, and `querySelector("svg")` must keep finding the plan first.
    const stage = live3d ? html`<div class="fp-3d" style="aspect-ratio:${fit.w} / ${fit.h}${deviceColourVars(this._layout!.colors).map((v) => `;${v}`).join("")}"></div>` : html`<svg class=${svgClass} viewBox="${box.x} ${box.y} ${box.w} ${box.h}" ${planPatch(body)}></svg>`;
    const note = this._fallback3d && this._viewPick() === "3d" ? html`<p class="fp-3d-note">${this._fallback3d}</p>` : null;
    const stack3d = live3d ? (this._kiosk() ? null : html`<div class="fp-stack"><button type="button" aria-label="Reset camera" title="Reset camera" @click=${() => { this._forgetCamera(); this._saveViewNow(); this.requestUpdate(); }}>${this._icon(UI_ICONS.reset)}</button></div>`) : undefined;
    return html`${this._floorChips()}${stage}${note}${this._activePanel()}${showViewSwitch ? html`<div class=${showZoomButtons ? "fp-zoom" : "fp-viewonly"}>${this._viewControls(this._viewPick())}</div>` : null}${stack3d !== undefined ? stack3d : showZoomButtons ? this._viewStack(box, home, fit, showViewSwitch, showRotate) : showViewSwitch || showRotate ? html`<div class="fp-stack">${showRotate ? this._rotateButtons() : null}${this._resetButton()}</div>` : null}${this._pulse ? html`<div class="fp-pulse" aria-hidden="true" hidden></div>` : null}${this._popupTemplate()}${this._coverDialogTemplate()}${this._vacuumDialogTemplate()}${this._chooserDialogTemplate()}${this._offDialogTemplate()}<div class="fp-tip" id="fp-tip" role="tooltip" hidden><b></b><span></span></div>`;
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

  /** S27.13: whether the floor below is drawn: this viewer's pick, else the YAML `ghost_floor` (only `true` counts: junk is off). */
  private _ghostOn(): boolean {
    return this._pickedGhost ?? this._config.ghost_floor === true;
  }

  /** The floor below and its shift for `renderFloor`, or `undefined`: off, 3D (its own Floors below select), or the lowest floor. */
  private _ghost(): { floor: Floor; shift: Pt } | undefined {
    const key = this._floorKey(), layout = this._layout;
    if (!this._ghostOn() || !key || !layout) return undefined;
    const below = floorBelow(layout, key);
    return below ? { floor: layout.floors[below], shift: floorShift(layout, below, key) } : undefined;
  }

  /** S27.13: the Floor below button, 2D and 2.5D. Disabled on the lowest floor, which has nothing under it. */
  private _ghostButton() {
    const key = this._floorKey(), none = !key || !this._layout || floorBelow(this._layout, key) === null, on = this._ghostOn();
    return html`<button type="button" aria-label="Floor below" aria-pressed=${on ? "true" : "false"} ?disabled=${none} title=${none ? "Floor below: this is the lowest floor" : "Floor below: show the floor under this one as faint lines"} @click=${() => { this._pickedGhost = !on; this._saveViewNow(); this.requestUpdate(); }}>${this._icon(GHOST_ICON)}</button>`;
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
      <button type="button" aria-label="Device names" title="Device names" aria-pressed=${names ? "true" : "false"} @click=${() => { this._pickedNames = !names; this._saveViewNow(); this.requestUpdate(); }}>Aa</button>${in3d ? null : this._ghostButton()}`;
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
    return this._turn !== null || this._view !== null || this._pendingView !== null || this._camMoved
      || [this._pickedView, this._pickedTilt, this._pickedWalls, this._pickedTheme, this._pickedLabels, this._pickedNames, this._pickedRot, this._pickedDetail, this._pickedGhost].some((v) => v !== null);
  }

  /** Reset view: every view option back to the config's own, the stored entry cleared, the floor kept. The turn goes
   * back the short way (315 to 0 is +45). */
  private _resetView(): void {
    this._fallback3d = null;
    this._pickedView = this._pickedTilt = this._pickedWalls = this._pickedTheme = this._pickedLabels = this._pickedNames = this._pickedDetail = this._pickedGhost = null;
    this._pendingView = null;
    this._view = null;
    this._forgetCamera();
    const from = this._userAngle();
    this._startTurn(from + shortestDelta(from, normaliseRotation(this._config.rotation)), null);
    if (!this._turn) {
      this._pickedRot = null;
      this._saveViewNow();
    }
    this.requestUpdate();
  }

  /** The 3D camera goes back to its first view and the shown floor forgets it (Reset view, Reset camera). The floor's
   * zoom and turn are not touched here: `_stashFloor` rewrites them from the live state. */
  private _forgetCamera(): void {
    this._view3d?.reset();
    this._camMoved = false;
    const key = this._floorKey(), fv = key ? this._floorViews.get(key) : undefined;
    if (key && fv) {
      delete fv.cam;
      if (!Object.keys(fv).length) this._floorViews.delete(key);
    }
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

  /** S23.2: screen px per plan unit at fit (see `_measurePx`); 0 until known. */
  private _px = 0;
  /** S23 review S3: plan units at the right of the fit box that the control stack covers (see `_measurePx`); 0 for none. */
  private _strip = 0;

  /** S23.2: screen px per plan unit of the whole floor at fit, measured after each render and on a resize. Fit, not
   *  the view on show: like S9.2's icon scale, the floor follows the card's size, never its zoom, so zooming in only
   *  enlarges and a pinch costs no second render. The svg keeps its aspect (meet), so the scale is the smaller of the
   *  two ratios. Nothing laid out (jsdom, a hidden card): nothing changes. */
  private _measurePx(): void {
    const svg = this.shadowRoot?.querySelector<SVGSVGElement>("svg.fp-zoomable"), fit = this._fit;
    const r = svg?.getBoundingClientRect();
    if (!svg || !fit || !r || !(fit.w > 0) || !(fit.h > 0) || r.width <= 0 || r.height <= 0) return;
    const px = Math.min(r.width / fit.w, r.height / fit.h), base = 1 / this._scale(fit);
    const k = (p: number) => Math.max(base, p ? NAME_MIN_PX / (12 * p) : 0);
    const was = k(this._px), old = this._px;
    this._px = px;
    // S23 review S3: the stack of buttons at the right covers a strip of the plan; names keep out of it. The svg keeps
    // its aspect (meet, centred), so the fit box starts (r.width - fit.w * px) / 2 in. A stack laid out as a row is
    // above the plan's top, not beside it: no strip. 4 px of air before the buttons.
    const stack = this.shadowRoot?.querySelector<HTMLElement>(".fp-stack");
    const sr = stack && !stack.classList.contains("fp-stack-row") ? stack.getBoundingClientRect() : null;
    const right = r.left + (r.width + fit.w * px) / 2, strip = sr && sr.width > 0 ? Math.max(0, (right - sr.left + 4) / px) : 0, stripWas = this._strip;
    this._strip = strip;
    if (Math.abs(strip - stripWas) > fit.w * 0.005) return void this.requestUpdate();
    if (Math.abs(k(px) - was) > was * 0.01) return void this.requestUpdate();
    // k holds, but a name shrunk to fit its room has its own floor of 11 px: re-render when that floor binds now or did.
    const sizes = [...svg.querySelectorAll("text.lbl[data-rl]")].map((t) => Number(t.getAttribute("font-size"))).filter((s) => s > 0);
    if (!sizes.length || Math.abs(px - old) <= old * 0.01) return;
    const least = Math.min(...sizes), floorNow = NAME_MIN_PX / px, floorWas = old ? NAME_MIN_PX / old : 0;
    if (floorNow > least * 1.01 || floorWas >= least * 0.99) this.requestUpdate();
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
    let lastTap: { t: number; x: number; y: number; before: PickMemo } | null = null;

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
      const onThing = (e.target as Element | null)?.closest?.(THINGS);
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
      lastTap = { t: now, x: e.clientX, y: e.clientY, before: { pick: this._pickedRoom, floor: this._pickedFloor, filter: this._roomFilter } };
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

  /** S24.8: the floor-off checklist. Groups in `OFF_GROUPS` order with their counts, a tick per row (all ticked), and one
   *  confirm that names how many will go. Names go through lit, escaped (finding 2). */
  private _offDialogTemplate() {
    const d = this._offDialog;
    if (!d) return null;
    const n = d.ticked.filter(Boolean).length;
    return html`
      <div class="fp-dialog-backdrop" @keydown=${this._onDialogKeydown}>
        <div class="fp-dialog fp-off-dialog" role="dialog" aria-modal="true" aria-labelledby="fp-off-title">
          <p id="fp-off-title">Turn off on ${d.title}</p>
          <div class="fp-off-list">
            ${OFF_GROUPS.map((g) => {
              const idx = d.rows.flatMap((r, i) => (r.group === g ? [i] : []));
              return idx.length ? html`<fieldset class="fp-off-group"><legend>${OFF_GROUP_LABEL[g]} · ${idx.length}</legend>
                ${idx.map((i) => { const r = d.rows[i]!; return html`<label class="fp-off-row" data-entity=${r.entity}><input type="checkbox" .checked=${d.ticked[i] ?? false} @change=${(e: Event) => this._tickOff(i, (e.target as HTMLInputElement).checked)} /><span>${r.name}${r.via ? html` <span class="fp-off-via">with ${r.via}</span>` : nothing}</span></label>`; })}
              </fieldset>` : nothing;
            })}
          </div>
          <div class="fp-dialog-actions">
            <button type="button" class="cancel" @click=${() => this._closeOffDialog()}>Cancel</button>
            <button type="button" class="confirm" ?disabled=${n === 0} @click=${() => this._confirmOffDialog()}>Turn off ${n}</button>
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
