import { LitElement, css, html, unsafeCSS, type PropertyValues } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { DEVICE_ICONS, DEVICE_TYPE_LABELS, FLOORPLAN_CSS, THEMES, type PlanView, activeDevices, groupActiveByType, migrate, planPivot, renderFloor, rotateAbout, tag, validate, viewBoxFor } from "../core";
import type { ActiveDevice, Theme } from "../core";
import type { Device, Door, Floor, Layout } from "../core";
import { TAP_SLOP_PX, bindDeviceActions, fireEvent } from "./actions";
// S7.7: side-effect import only — registers floorplan-studio-card-editor so getConfigElement() below can create
// one. vite.config.ts's card entry is this file, so the editor ships inside dist/floorplan-studio-card.js, not a
// second built file (PLAN block interface).
import "./config-editor";
import { defineElement } from "./define";
import { MAX_ZOOM, MIN_ZOOM, clamp, panBy, pinch, pinnedView, sameView, zoomAt, type Pt, type View } from "./viewport";

const NO_LAYOUT = "No layout: install the Floorplan Studio integration or set layout_url";

/** What the card needs of `hass`. Home Assistant's real object has far more; this is only what the card reads. */
export interface HassEntity { state: string; attributes: Record<string, unknown>; last_changed: string }
export interface Hass {
  states: Record<string, HassEntity>;
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
  /** `"2d"` (default) draws the flat plan, `"2.5d"` the same plan with walls and furniture drawn up (docs/card.md).
   * The dropdown (`view_switch`) can change it for as long as the card is on screen. Anything else is `"2d"`. */
  view?: PlanView;
  /** `true` (default) shows the View dropdown next to the zoom buttons; `false` hides it, and so does `kiosk`. */
  view_switch?: boolean;
}

/** The View dropdown's options, one list for the markup and for reading the choice back (a value that is not here
 * is refused). 3D joins this list when it exists. */
const VIEW_OPTIONS: readonly { value: PlanView; label: string }[] = [
  { value: "2d", label: "2D" },
  { value: "2.5d", label: "2.5D" },
];
const isView = (v: unknown): v is PlanView => VIEW_OPTIONS.some((o) => o.value === v);

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
    /* S7.4: the zoom buttons are card chrome, the same colours as the floor chips, in the other top corner. */
    .fp-zoom { position: absolute; top: 8px; right: 8px; z-index: 1; display: flex; gap: 4px; }
    .fp-zoom button { width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; font: 16px/1 system-ui, sans-serif; color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 6px; cursor: pointer; }
    .fp-zoom button:disabled { opacity: 0.45; cursor: default; }
    .fp-zoom svg { width: 14px; height: 14px; }
    .fp-zoom select { height: 28px; padding: 0 4px; font: 13px/1 system-ui, sans-serif; color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 6px; cursor: pointer; }
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
    .fp-active-row { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: none; background: transparent; color: inherit; font: 12px/1.3 system-ui, sans-serif; padding: 4px 2px; cursor: pointer; border-radius: 4px; }
    .fp-active-row:hover, .fp-active-row:focus-visible { background: var(--fp-idle); }
    .fp-active-row svg { width: 16px; height: 16px; flex: 0 0 16px; fill: var(--fp-active-row-color, var(--fp-ink)); }
    .fp-active-empty { margin: 4px 2px; font: 12px/1.3 system-ui, sans-serif; color: var(--fp-text); }
  `];

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
  /** S7.4: the zoomed viewBox, or `null` for fit. Card state: reset by `setConfig` and a floor change, never by `hass`. */
  private _view: View | null = null;
  /** The view picked in the dropdown; `null` means the config's own. Card state like `_view`: reset by `setConfig`, never by `hass`. */
  private _pickedView: PlanView | null = null;
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
  private _activePos: { x: number; y: number } | null = null;
  /** Whether the user has folded or unfolded the list by hand (kept in storage with the rest). Until then the card's
   * own width decides: folded under `ACTIVE_FOLD_BELOW_PX`, open from there up, followed on every resize (0.12.17;
   * it was a one-off check at 500px that a stored drag position switched off). After, the choice is theirs. */
  private _activeUserChose = false;
  private _activeResizeObserver: ResizeObserver | null = null;

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
  private _activeStorageKey(): string {
    const source = this._config.layout_url ?? (this._config.layout ? "inline" : "ws");
    const seed: unknown[] = [source, this._config.floor ?? null, this._config.floors ?? null];
    if (this._config.center !== undefined) seed.push(this._config.center);
    if (this._config.zoom_level !== undefined) seed.push(this._config.zoom_level);
    return `fp-active-panel:${tag(JSON.stringify(seed))}`;
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
      this._activeResizeObserver = new ResizeObserver(() => { this._applyWidthDefault(); this._positionActivePanel(); });
      this._activeResizeObserver.observe(this);
    }
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
    this._config = config ?? {};
    this._layout = null;
    this._error = null;
    this._urlRequested = false;
    this._wsRequested = false;
    this._shownFloor = null;
    this._view = null;
    this._pickedView = null;
    this._loadActiveState();
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

  /** Row count from the plan's own aspect ratio (60 cm pad, the layout's rotate), shared by getCardSize and
   * getGridOptions so the masonry view and the sections view agree on how tall the card wants to be. */
  private _rows(): number {
    const f = this._floor();
    if (!f || !f.outline.length) return 6;
    const box = viewBoxFor(f, 60, this._rotate(), this._planView());
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
    this._unbindActions?.();
    this._unbindActions = null;
    this._unbindZoom?.();
    this._unbindZoom = null;
    this._actionsSvg = null;
    this._activeResizeObserver?.disconnect();
    this._activeResizeObserver = null;
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

  /** The layout's own rotate, if any, turned into the `{ deg, pivot }` renderFloor and viewBoxFor take. Shared so getCardSize sees the same box render() draws. */
  private _rotate(): { deg: number; pivot: [number, number] } | undefined {
    if (!this._layout?.rotate) return undefined;
    return { deg: this._layout.rotate, pivot: planPivot(this._layout) };
  }

  /** The configured theme, blueprint when there is none or it is not one of the three. The OS and Home Assistant's dark mode no longer pick it: only `theme: ha` follows Home Assistant. */
  private _theme(): Theme {
    const t = this._config.theme;
    return t && (THEMES as readonly string[]).includes(t) ? t : "blueprint";
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
    this._view = null;
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

    const svg = this.shadowRoot?.querySelector("svg") ?? null;
    if (svg !== this._actionsSvg) {
      // Lit keeps the <svg> element itself across renders (only unsafeSVG's content is replaced), so binding
      // once per element, not once per render, avoids piling up duplicate listeners (S2.2 "Break it": no
      // debounce, but also no double-firing from a stale second listener).
      this._unbindActions?.();
      this._unbindActions = svg
        ? bindDeviceActions(svg, this, (i) => this._floor()?.devices[i], (i) => this._floor()?.doors[i], (door) => this._openCoverDialog(door), {
            longPress: !this._kiosk(),
            openVacuumDialog: (d) => this._openVacuumDialog(d),
            openChooser: (title, entities) => this._openChooserDialog(title, entities),
            getUnlinked: (i) => this._floor()?.unlinked[i],
          })
        : null;
      this._unbindZoom?.();
      this._unbindZoom = svg ? this._bindZoom(svg) : null;
      this._actionsSvg = svg;
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

  /** Opus review findings 3/4: sets the panel's on-screen position directly (bypassing Lit's template, which does
   * not bind `style` any more — see `_activePanel` — so this survives an unrelated re-render), from `_activePos`'s
   * fraction and the *current* card/panel geometry. Called from `updated()` on every render and from the
   * ResizeObserver on a host resize, so a stored fraction always lands inside the card, whatever changed since it
   * was saved: a narrower viewport, a taller panel after expanding from collapsed, or nothing at all. With
   * `_activePos` still `null` (never dragged) this clears any inline position, leaving the CSS default in place. */
  private _positionActivePanel(): void {
    const panel = this.shadowRoot?.querySelector<HTMLElement>(".fp-active");
    if (!panel) return;
    if (!this._activePos) {
      panel.style.left = "";
      panel.style.top = "";
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

  /** S9.5: the floating panel of every active device across every floor (`activeDevices`/`groupActiveByType`,
   *  `src/core/active.ts` — the one place that decides "active", reused here rather than repeated). Card chrome,
   *  positioned outside the `<svg>` like `_floorChips`/`_zoomButtons` (CLAUDE.md finding 8): nothing here is part
   *  of the plan `renderFloor` draws, so it never steals a hit-test from a device or door under it. */
  private _activePanel() {
    if (!this._activeListVisible() || !this._layout) return null;
    const groups = groupActiveByType(activeDevices(this._layout, this._stateForRender()));
    const count = groups.reduce((n, [, rows]) => n + rows.length, 0);
    const row = (it: ActiveDevice) => html`<button
      type="button"
      class="fp-active-row"
      style="--fp-active-row-color:var(${it.colorVar})"
      @click=${() => fireEvent(this, "hass-more-info", { entityId: it.entity })}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${DEVICE_ICONS[it.type]}></path></svg>
      <span>${it.name}</span>
    </button>`;
    // No `style=` binding here on purpose (Opus review findings 3/4): Lit would rewrite the whole `style`
    // attribute on every render, wiping out the position `_positionActivePanel` sets imperatively after render —
    // that function is the only thing that ever touches this element's inline position.
    return html`<div class="fp-active" role="region" aria-label="Active devices">
      <div class="fp-active-head" @pointerdown=${(e: PointerEvent) => this._onActiveDragStart(e)}>
        <span class="fp-active-title">Active</span>
        <span class="fp-active-count">${count}</span>
        <button
          type="button"
          class="fp-active-collapse"
          aria-label=${this._activeCollapsed ? "Expand the active devices list" : "Collapse the active devices list"}
          aria-expanded=${this._activeCollapsed ? "false" : "true"}
          @click=${() => this._toggleActiveCollapsed()}
        >${this._activeCollapsed ? "▸" : "▾"}</button>
      </div>
      ${this._activeCollapsed
        ? null
        : html`<div class="fp-active-body">
            ${groups.length
              ? groups.map(([type, rows]) => html`<div class="fp-active-group">
                  <div class="fp-active-group-label">${DEVICE_TYPE_LABELS[type]}</div>
                  ${rows.map(row)}
                </div>`)
              : html`<p class="fp-active-empty">Nothing on</p>`}
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
    const fit = viewBoxFor(f, 60, rotate, view);
    this._fit = fit;
    const zoom = this._zoomMode() !== false;
    const showZoomButtons = zoom && !this._kiosk(); // S7.5: kiosk still zooms/pans by gesture, just draws no buttons
    const showViewSwitch = this._config.view_switch !== false && !this._kiosk();
    // S9.6: `home` is the whole floor unless `center`/`zoom_level` pin the card to part of it — the base the box
    // rests on when there is no explicit `_view`, and what "zoomed" (the fp-zoomed class, below) is measured
    // against, so a pinned card reads as its own resting state, not as permanently zoomed in from the full plan.
    const home = pinnedView(fit, this._rotatedCenter(), this._zoomLevel());
    // Diego field report, 0.12.14: pan must work even under `zoom: false` — that config key only turns off pinch,
    // wheel and the buttons (`_bindZoom` gates those on `_zoomMode()` itself); a one-finger drag always reaches
    // `_setView`, so `_view` can be set regardless, and the box here must reflect it regardless too.
    const box = this._view ? clamp(this._view, fit) : home;
    // Opus review of S9.6: "zoomed" (like `_zoomed()` below) means "not at home", not "narrower than home" — a
    // sideways pan at home's own width used to read as not-zoomed here, which left `touch-action` at `pan-y` (so
    // the page's own vertical scroll fought the pan) even while `_view` was already pinning a panned box.
    // `fp-zoomable` (the touch-action override) is unconditional too: it enables the drag gesture, not zoom.
    const svgClass = this._view !== null ? "fp-zoomable fp-zoomed" : "fp-zoomable";
    const body = renderFloor(f, {
      scale: this._scale(fit),
      state: this._stateForRender(),
      now: Date.now(),
      fade: this._config.fade,
      roomGlow: this._config.room_glow,
      theme: this._theme(),
      dark: this._haDark(),
      rotate,
      night: this._night(),
      view,
    });
    // The zoom buttons come after the plan's <svg> in the DOM (they are positioned, so order is not placement):
    // their own icon is an <svg> too, and `querySelector("svg")` must keep finding the plan first.
    return html`${this._floorChips()}<svg class=${svgClass} viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${unsafeSVG(body)}</svg>${this._activePanel()}${showZoomButtons ? this._zoomButtons(box, home, fit, showViewSwitch) : showViewSwitch ? html`<div class="fp-zoom">${this._viewSelect(view)}</div>` : null}${this._coverDialogTemplate()}${this._vacuumDialogTemplate()}${this._chooserDialogTemplate()}`;
  }

  /** The view on show: the dropdown's pick, else `config.view`, else 2D. Config is untrusted, so junk is 2D, not an error. */
  private _planView(): PlanView {
    return this._pickedView ?? (isView(this._config.view) ? this._config.view : "2d");
  }

  /** Compact `<select>` in the card chrome, outside the plan's `<svg>` like the zoom buttons. A pick redraws the
   * plan only: `_view` (zoom and pan) is left alone, `render` clamps it against the new fit. */
  private _viewSelect(current: PlanView) {
    const onChange = (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      if (!isView(v)) return;
      this._pickedView = v;
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
    const c = clamp(v, fit);
    this._view = sameView(c, home, fit) ? null : c;
    this.requestUpdate();
  }

  /** Zooms by `k` about the centre of what is on screen: the + and − buttons. */
  private _zoomCentre(k: number): void {
    const v = this._current();
    if (v) this._setView(zoomAt(v, k, v.x + v.w / 2, v.y + v.h / 2));
  }

  private _fitView(): void {
    this._view = null;
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
  private _zoomButtons(box: View, home: View, fit: View, withViewSwitch: boolean) {
    const atMin = box.w >= (fit.w / MIN_ZOOM) * (1 - 1e-6);
    const atHome = !this._zoomed();
    const atMax = box.w <= (fit.w / MAX_ZOOM) * (1 + 1e-6);
    const pinned = !sameView(home, fit, fit);
    const resetLabel = pinned ? "Reset view" : "Fit";
    return html`<div class="fp-zoom">
      ${withViewSwitch ? this._viewSelect(this._planView()) : null}
      <button type="button" aria-label="Zoom in" title="Zoom in" ?disabled=${atMax} @click=${() => this._zoomCentre(BUTTON_ZOOM)}>+</button>
      <button type="button" aria-label="Zoom out" title="Zoom out" ?disabled=${atMin} @click=${() => this._zoomCentre(1 / BUTTON_ZOOM)}>−</button>
      <button type="button" aria-label=${resetLabel} title=${resetLabel} ?disabled=${atHome} @click=${() => this._fitView()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
      </button>
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
    let lastTap: { t: number; x: number; y: number } | null = null;

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
        lastTap = null;
        if (this._zoomMode() === false) return; // a double tap zooms; pan alone stays on when zoom is off
        // S9.6: zooms in from `home` (the pinned box, or the whole floor with no pin), not the whole floor — the
        // screen shows `home` at rest, so the plan point under the tap must be read against that same box.
        const home = this._home();
        if (this._zoomed() || !home) this._fitView();
        else this._setView(zoomAt(home, 2, ...toPlan(home, e.clientX, e.clientY)));
        return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
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
defineElement("floorplan-studio-card", FloorplanStudioCard);
