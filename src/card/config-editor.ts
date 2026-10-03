import { LitElement, css, html } from "lit";
import { DEFAULT_TILT, THEMES, WALLS_LABELS, WALLS_MODES, wallsModeOf, clampTilt, migrate, validate } from "../core";
import type { Layout, Theme, WallsMode } from "../core";
import type { FloorplanStudioCardConfig, Hass } from "./floorplan-studio-card";
import { defineElement } from "./define";
import { ROTATION_STEP, normaliseRotation } from "./view-state";

/** The form edits the card's own config type; every key it shows is one the card reads (S7.5 kiosk, S7.6 night and sun). */
export type EditorConfig = FloorplanStudioCardConfig;

type ZoomChoice = "on" | "wheel" | "off";

const DEFAULT_THEME: Theme = "blueprint";
const DEFAULT_FADE = 300;
const DEFAULT_ROOM_GLOW = false;
// Matches PLUG_ACTIVE_WATTS in core/power.ts, kept apart like the defaults around it.
const DEFAULT_PLUG_WATTS = 2;
const DEFAULT_KIOSK = false;
const DEFAULT_ACTIVE_LIST = true;
const DEFAULT_NIGHT = "auto";
const DEFAULT_SUN = "sun.sun";
/** S9.1: the theme's own default for an open contact door (--fp-dev-contact's value, render.ts LIGHT_TOKENS)
 * shown in the colour field until open_color is set — a plain <input type="color"> can only ever hold a real hex,
 * never "unset", so Clear (below) is the only way to remove the key rather than picking this same colour by hand. */
const DEFAULT_OPEN_COLOR = "#d64545";
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// S9.2: matches ICON_SIZE_MIN/MAX/DEFAULT_ICON_SIZE in floorplan-studio-card.ts — kept as separate constants
// (not exported/shared) since the card and its form are each read independently, same as fade above.
const DEFAULT_ICON_SIZE = 1;
const ICON_SIZE_MIN = 0.5;
const ICON_SIZE_MAX = 3;
// S9.6: matches ZOOM_LEVEL_MIN/MAX_ZOOM in floorplan-studio-card.ts/viewport.ts, same reasoning as icon_size above.
const DEFAULT_ZOOM_LEVEL = 1;
const ZOOM_LEVEL_MIN = 1;
const ZOOM_LEVEL_MAX = 8;

const NIGHT_CHOICES = ["auto", "on", "off"] as const;
const DEFAULT_VIEW = "2d";
const DEFAULT_VIEW_SWITCH = true;
// Same two options as VIEW_OPTIONS in floorplan-studio-card.ts, kept apart for the same reason as the defaults above.
const DEFAULT_LABELS = true;
const VIEW_CHOICES = [["2d", "2D"], ["2.5d", "2.5D"]] as const;

/**
 * `floorplan-studio-card-editor`: the form the Home Assistant Edit-card dialog shows instead of raw YAML, per
 * S7.7's PLAN block. A plain Lit element, no `ha-form`: that would need HA's own elements at test time, and this
 * repo's tests run the built module under plain Chromium (`tests/card/config-editor.spec.ts`), not inside HA
 * itself. Colours only through `--fp-*` variables or HA's `--primary-text-color` family (CLAUDE.md finding 9) —
 * this element is never wrapped in the card's own `FLOORPLAN_CSS`, so it reads Home Assistant's dashboard
 * variables directly, with plain fallbacks for the standalone test harness where those are unset.
 */
export class FloorplanStudioCardEditor extends LitElement {
  static styles = css`
    :host { display: block; font: 14px/1.4 system-ui, sans-serif; color: var(--primary-text-color, #212121); padding: 8px 0; }
    .row { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
    .row label.main { flex: 0 0 120px; }
    .row select, .row input[type="number"], .row input[type="text"] {
      font: inherit; color: inherit; background: var(--card-background-color, #fff);
      border: 1px solid var(--divider-color, #ccc); border-radius: 4px; padding: 4px 6px;
    }
    .floors { display: flex; flex-wrap: wrap; gap: 4px 14px; }
    .floors label { display: flex; align-items: center; gap: 4px; }
    p.hint { margin: 4px 0 0; color: var(--secondary-text-color, #727272); font-size: 12px; }
  `;

  private _config: EditorConfig = {};
  private _hass?: Hass;
  private _layout: Layout | null = null;
  private _urlRequested = false;
  private _wsRequested = false;
  /** S9.6 review (Opus, 2026-09-27): the Center X/Y boxes' own draft, held independently of `_config.center` while
   * the pair is not yet both valid. Both boxes read `.value=${this._centerX()}`/`${this._centerY()}` on every
   * render; without a draft, clearing X to retype it deleted `center` from the config, and the *next* render then
   * read Y's box from that same now-`undefined` `center`, wiping whatever the user had just typed into Y — a
   * field they never touched. `null` means "no draft, follow `_config.center`" (the normal, settled state); it is
   * set only while the pair is not both empty and not both valid, and cleared the moment it is one or the other. */
  private _centerDraft: { x: string; y: string } | null = null;

  setConfig(config: FloorplanStudioCardConfig): void {
    // CLAUDE.md finding 1: config comes from a saved dashboard, which a person (or an LLM helping them) can hand-edit —
    // never trust its shape further than reading the handful of keys this form understands.
    this._config = { ...((config ?? {}) as EditorConfig) };
    this._centerDraft = null; // a fresh config (a different card, or a reload) starts from its own settled values
    this._loadLayout();
    this.requestUpdate();
  }

  get hass(): Hass | undefined {
    return this._hass;
  }

  set hass(h: Hass) {
    this._hass = h;
    if (!this._layout) this._loadLayout();
    this.requestUpdate();
  }

  /** Same three sources and order as the card itself (`FloorplanStudioCard._loadLayout`): `config.layout`, then
   * `config.layout_url` (fetched once), then the stored plan over the websocket. Never throws: an unusable layout
   * just leaves the floor list empty, same as the card leaving its message up. */
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
        .catch(() => { /* no layout: the floor list just stays empty */ });
      return;
    }
    if (this._hass?.connection) {
      if (this._wsRequested) return;
      this._wsRequested = true;
      this._hass.connection
        .sendMessagePromise({ type: "floorplan_studio/load" })
        .then((layout) => this._applyLayout(layout))
        .catch(() => { /* no layout: the floor list just stays empty */ });
    }
  }

  private _applyLayout(raw: unknown): void {
    try {
      const v = validate(migrate(raw));
      if (v.ok) this._layout = v.layout;
    } catch {
      /* untrusted input (CLAUDE.md finding 1): never throws, the floor list just stays empty */
    }
    this.requestUpdate();
  }

  /** The layout's own floor order (`Object.entries`, insertion order — the same order `_floorList`'s `floor: "all"`
   * branch in the card uses), or `[]` before a layout has loaded. */
  private _floorEntries(): [string, string][] {
    if (!this._layout) return [];
    return Object.entries(this._layout.floors).map(([id, f]) => [id, f.title || id]);
  }

  private _theme(): Theme {
    const t = this._config.theme;
    return t && (THEMES as readonly string[]).includes(t) ? t : DEFAULT_THEME;
  }

  private _zoomChoice(): ZoomChoice {
    const z = this._config.zoom;
    return z === false ? "off" : z === "wheel" ? "wheel" : "on";
  }

  private _view(): (typeof VIEW_CHOICES)[number][0] {
    return VIEW_CHOICES.find(([v]) => v === this._config.view)?.[0] ?? DEFAULT_VIEW;
  }

  /** Untrusted like the rest: only a real `false` unticks the box, as on the card. */
  private _labels(): boolean {
    return this._config.labels !== false;
  }

  private _onLabels(e: Event): void {
    this._set("labels", (e.target as HTMLInputElement).checked, DEFAULT_LABELS);
  }

  private _rotation(): number {
    return normaliseRotation(this._config.rotation);
  }

  private _onRotation(e: Event): void {
    this._set("rotation", Number((e.target as HTMLSelectElement).value), 0);
  }

  private _onTilt(e: Event): void {
    this._set("tilt", clampTilt(Number((e.target as HTMLInputElement).value)), DEFAULT_TILT);
  }

  private _walls(): WallsMode {
    return wallsModeOf(this._config.walls);
  }

  private _onWalls(e: Event): void {
    this._set("walls", wallsModeOf((e.target as HTMLSelectElement).value), "cut");
  }

  private _night(): "auto" | "on" | "off" {
    const n = this._config.night;
    return n && (NIGHT_CHOICES as readonly string[]).includes(n) ? n : DEFAULT_NIGHT;
  }

  /** Sets `key` to `value`, or drops it when `value` equals its default (so the emitted YAML stays short, per the
   * PLAN block), then fires `config-changed` with the new config — Home Assistant's own event shape:
   * `{ config }` in `detail`, bubbling and composed so it crosses this element's shadow boundary. */
  private _set<K extends keyof EditorConfig>(key: K, value: EditorConfig[K], def: EditorConfig[K]): void {
    const next: EditorConfig = { ...this._config };
    if (value === def) delete next[key];
    else next[key] = value;
    this._config = next;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: next }, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  private _toggleFloor(id: string, checked: boolean): void {
    const order = this._floorEntries().map(([fid]) => fid);
    const set = new Set(this._config.floors ?? []);
    if (checked) set.add(id);
    else set.delete(id);
    const floors = order.filter((fid) => set.has(fid));
    this._set("floors", floors.length ? floors : undefined, undefined);
  }

  /** S8.12: the Floor select's own value — a real layout floor id `_config.floor` names, or `""` for "All floors
   * (switcher)", which covers `floor` unset, `floor: "all"`, and an id the loaded layout doesn't (yet, or ever)
   * have. Before a layout has loaded, `_floorEntries()` is empty, so this always reads `""` and the select shows
   * only its one option, per the PLAN block. */
  private _floorChoice(): string {
    const f = this._config.floor;
    return typeof f === "string" && f !== "all" && this._floorEntries().some(([id]) => id === f) ? f : "";
  }

  /** S8.12: picking a real floor pins `floor` to it and drops `floors` in the same `config-changed` (a single
   * pinned floor makes the switcher's own floor list moot, and the checkboxes that write it are hidden the same
   * render — CLAUDE.md finding 12 does not apply, `floor`/`floors` are plain config keys, not schema). Picking
   * "All floors" removes `floor` outright rather than writing `floor: "all"`: the card already treats the two the
   * same (S8.12's default), so the shorter, key-absent form is what "minimal emitted YAML" means here. */
  private _onFloor(e: Event): void {
    const value = (e.target as HTMLSelectElement).value;
    const next: EditorConfig = { ...this._config };
    if (value) {
      next.floor = value;
      delete next.floors;
    } else {
      delete next.floor;
    }
    this._config = next;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: next }, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  private _onTheme(e: Event): void {
    this._set("theme", (e.target as HTMLSelectElement).value as Theme, DEFAULT_THEME);
  }

  private _onFade(e: Event): void {
    // Opus review 2026-09-25: an emptied field is not 0 s (no fade), and a negative fade is no fade either; both fall
    // back to the default, which `_set` then leaves out of the payload.
    const raw = (e.target as HTMLInputElement).value.trim();
    const n = Number(raw);
    this._set("fade", raw !== "" && Number.isFinite(n) && n >= 0 ? n : DEFAULT_FADE, DEFAULT_FADE);
  }

  private _onPlugWatts(e: Event): void {
    // Same shape as _onFade: an emptied or negative field is the default, which `_set` leaves out of the payload.
    const raw = (e.target as HTMLInputElement).value.trim();
    const n = Number(raw);
    this._set("plug_watts", raw !== "" && Number.isFinite(n) && n >= 0 ? n : DEFAULT_PLUG_WATTS, DEFAULT_PLUG_WATTS);
  }

  private _onRoomGlow(e: Event): void {
    this._set("room_glow", (e.target as HTMLInputElement).checked, DEFAULT_ROOM_GLOW);
  }

  /** S9.2: `config.icon_size`, clamped to [0.5, 3] for display, same as the card itself reads it. */
  private _iconSize(): number {
    const v = this._config.icon_size;
    return typeof v === "number" && Number.isFinite(v) ? Math.min(ICON_SIZE_MAX, Math.max(ICON_SIZE_MIN, v)) : DEFAULT_ICON_SIZE;
  }

  /** S9.6: `config.center`'s two fields, each shown empty until a real pin is set — there is no single numeric
   * default to fall back to display-wise, unlike `fade`/`icon_size`, since "unset" (the whole floor) is not a
   * point on the plan. */
  private _centerX(): string {
    if (this._centerDraft) return this._centerDraft.x;
    const c = this._config.center;
    return Array.isArray(c) && typeof c[0] === "number" && Number.isFinite(c[0]) ? String(c[0]) : "";
  }

  private _centerY(): string {
    if (this._centerDraft) return this._centerDraft.y;
    const c = this._config.center;
    return Array.isArray(c) && typeof c[1] === "number" && Number.isFinite(c[1]) ? String(c[1]) : "";
  }

  /** S9.6: Center X and Center Y write one `center` tuple together — reads both fields' live values (not just the
   * one that changed) so either box editing the other's partner in place still emits a consistent pair.
   * S9.6 review (Opus, 2026-09-27): a half-filled pair (one box emptied or holding something that is not yet a
   * finite number) used to drop `center` from the payload immediately, and the *other* box then read that
   * deletion back on its own next render — the box the user never touched lost its value too. Now a half-filled
   * pair only updates the local draft (both boxes keep showing exactly what is in them) and neither dispatches nor
   * touches `_config`, so the untouched box's config value survives until the pair is completed or both are
   * cleared. `center` is written, or dropped, only on the two settled states: both valid, or both empty. */
  private _onCenter(): void {
    const xEl = this.renderRoot.querySelector<HTMLInputElement>("#center_x");
    const yEl = this.renderRoot.querySelector<HTMLInputElement>("#center_y");
    const xRaw = xEl?.value.trim() ?? "", yRaw = yEl?.value.trim() ?? "";
    const x = Number(xRaw), y = Number(yRaw);
    const bothEmpty = xRaw === "" && yRaw === "";
    const bothValid = xRaw !== "" && yRaw !== "" && Number.isFinite(x) && Number.isFinite(y);
    if (!bothEmpty && !bothValid) {
      // Half-filled, or not-yet-a-number: keep the draft so the next render shows exactly this, and leave
      // `_config`/the dashboard's saved config alone until the pair is completed.
      this._centerDraft = { x: xRaw, y: yRaw };
      this.requestUpdate();
      return;
    }
    this._centerDraft = null;
    const next: EditorConfig = { ...this._config };
    if (bothValid) next.center = [x, y];
    else delete next.center;
    this._config = next;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: next }, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  /** S9.6: `config.zoom_level`, clamped to [1, 8] for display, same as the card itself reads it (MAX_ZOOM). */
  private _zoomLevel(): number {
    const v = this._config.zoom_level;
    return typeof v === "number" && Number.isFinite(v) ? Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, v)) : DEFAULT_ZOOM_LEVEL;
  }

  private _onZoomLevel(e: Event): void {
    // Same shape as _onIconSize: an emptied or non-numeric field is the default, 1 (the whole floor), not a
    // silent clamp to the range's own bottom.
    const raw = (e.target as HTMLInputElement).value.trim();
    const n = Number(raw);
    const v = raw !== "" && Number.isFinite(n) ? Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, n)) : DEFAULT_ZOOM_LEVEL;
    this._set("zoom_level", v, DEFAULT_ZOOM_LEVEL);
  }

  private _onIconSize(e: Event): void {
    // Same shape as _onFade: an emptied or non-numeric field is not 0 (out of range, would silently clamp to
    // 0.5) — it falls back to the default, which _set then drops from the payload.
    const raw = (e.target as HTMLInputElement).value.trim();
    const n = Number(raw);
    const v = raw !== "" && Number.isFinite(n) ? Math.min(ICON_SIZE_MAX, Math.max(ICON_SIZE_MIN, n)) : DEFAULT_ICON_SIZE;
    this._set("icon_size", v, DEFAULT_ICON_SIZE);
  }

  private _onZoom(e: Event): void {
    const choice = (e.target as HTMLSelectElement).value as ZoomChoice;
    const value: EditorConfig["zoom"] = choice === "off" ? false : choice === "wheel" ? "wheel" : true;
    this._set("zoom", value, true);
  }

  private _onKiosk(e: Event): void {
    this._set("kiosk", (e.target as HTMLInputElement).checked, DEFAULT_KIOSK);
  }

  private _onActiveList(e: Event): void {
    this._set("active_list", (e.target as HTMLInputElement).checked, DEFAULT_ACTIVE_LIST);
  }

  private _onView(e: Event): void {
    this._set("view", (e.target as HTMLSelectElement).value as EditorConfig["view"], DEFAULT_VIEW);
  }

  private _onViewSwitch(e: Event): void {
    this._set("view_switch", (e.target as HTMLInputElement).checked, DEFAULT_VIEW_SWITCH);
  }

  /** Only a real `false` unticks the box, as on the card; `true` (the kiosk opt-in) is YAML only and shows ticked. */
  private _onRotateSwitch(e: Event): void {
    this._set("rotate_switch", (e.target as HTMLInputElement).checked, true);
  }

  private _onNames(e: Event): void {
    this._set("names", (e.target as HTMLInputElement).checked, false);
  }

  private _onNight(e: Event): void {
    this._set("night", (e.target as HTMLSelectElement).value as EditorConfig["night"], DEFAULT_NIGHT);
  }

  private _onSun(e: Event): void {
    const v = (e.target as HTMLInputElement).value.trim() || DEFAULT_SUN;
    this._set("sun", v, DEFAULT_SUN);
  }

  /** The colour field's own value: a set, valid open_color, or the theme's default so the field never shows a
   * value the config doesn't have (CLAUDE.md finding 1: an invalid saved value is dropped, not surfaced as-is). */
  private _openColor(): string {
    const c = this._config.open_color;
    return c && HEX_COLOR.test(c) ? c : DEFAULT_OPEN_COLOR;
  }

  private _onOpenColor(e: Event): void {
    this._set("open_color", (e.target as HTMLInputElement).value, DEFAULT_OPEN_COLOR);
  }

  /** Clear removes open_color outright, distinct from picking the default colour by hand (the field can't tell
   * those apart on its own — see DEFAULT_OPEN_COLOR's comment). */
  private _onOpenColorClear(): void {
    const next: EditorConfig = { ...this._config };
    delete next.open_color;
    this._config = next;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: next }, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  protected render() {
    const floors = this._floorEntries();
    const checked = new Set(this._config.floors ?? []);
    const floorChoice = this._floorChoice();
    return html`
      <div class="row">
        <label class="main" for="theme">Theme</label>
        <select id="theme" @change=${this._onTheme}>
          ${THEMES.map((t) => html`<option value=${t} ?selected=${t === this._theme()}>${t}</option>`)}
        </select>
      </div>

      <div class="row">
        <label class="main" for="floor">Floor</label>
        <select id="floor" @change=${this._onFloor}>
          <option value="" ?selected=${floorChoice === ""}>All floors (switcher)</option>
          ${floors.map(([id, title]) => html`<option value=${id} ?selected=${floorChoice === id}>${title}</option>`)}
        </select>
      </div>

      ${floorChoice === ""
        ? html`<div class="row">
              <label class="main">Switcher shows</label>
              ${floors.length
                ? html`<div class="floors">
                    ${floors.map(
                      ([id, title]) => html`<label
                        ><input type="checkbox" data-floor=${id} .checked=${checked.has(id)} @change=${(e: Event) => this._toggleFloor(id, (e.target as HTMLInputElement).checked)} />${title}</label
                      >`,
                    )}
                  </div>`
                : html`<p class="hint">No layout loaded yet — the floor list fills in once one has.</p>`}
            </div>
            ${floors.length ? html`<p class="hint">None ticked: every floor.</p>` : null}`
        : null}

      <div class="row">
        <label class="main" for="fade">Fade (s)</label>
        <input id="fade" type="number" min="0" step="1" .value=${String(this._config.fade ?? DEFAULT_FADE)} @change=${this._onFade} />
      </div>

      <div class="row">
        <label class="main" for="plug_watts">Plug active from (W)</label>
        <input id="plug_watts" type="number" min="0" step="0.5" .value=${String(this._config.plug_watts ?? DEFAULT_PLUG_WATTS)} @change=${this._onPlugWatts} />
      </div>

      <div class="row">
        <label class="main" for="room_glow">Room glow</label>
        <input id="room_glow" type="checkbox" .checked=${this._config.room_glow ?? DEFAULT_ROOM_GLOW} @change=${this._onRoomGlow} />
      </div>

      <div class="row">
        <label class="main" for="icon_size">Icon size</label>
        <input id="icon_size" type="number" min=${ICON_SIZE_MIN} max=${ICON_SIZE_MAX} step="0.25" .value=${String(this._iconSize())} @change=${this._onIconSize} />
      </div>

      <div class="row">
        <label class="main" for="center_x">Center X, Y (cm)</label>
        <input id="center_x" type="number" step="1" placeholder="whole floor" .value=${this._centerX()} @change=${this._onCenter} />
        <input id="center_y" type="number" step="1" placeholder="whole floor" .value=${this._centerY()} @change=${this._onCenter} />
      </div>

      <div class="row">
        <label class="main" for="zoom_level">Zoom level</label>
        <input id="zoom_level" type="number" min=${ZOOM_LEVEL_MIN} max=${ZOOM_LEVEL_MAX} step="0.1" .value=${String(this._zoomLevel())} @change=${this._onZoomLevel} />
      </div>

      <div class="row">
        <label class="main" for="zoom">Zoom</label>
        <select id="zoom" @change=${this._onZoom}>
          <option value="on" ?selected=${this._zoomChoice() === "on"}>On</option>
          <option value="wheel" ?selected=${this._zoomChoice() === "wheel"}>On, wheel too</option>
          <option value="off" ?selected=${this._zoomChoice() === "off"}>Off</option>
        </select>
      </div>

      <div class="row">
        <label class="main" for="view">View</label>
        <select id="view" @change=${this._onView}>
          ${VIEW_CHOICES.map(([v, label]) => html`<option value=${v} ?selected=${this._view() === v}>${label}</option>`)}
        </select>
      </div>

      <div class="row">
        <label class="main" for="view_switch">View switch</label>
        <input id="view_switch" type="checkbox" .checked=${this._config.view_switch ?? DEFAULT_VIEW_SWITCH} @change=${this._onViewSwitch} />
      </div>

      <div class="row">
        <label class="main" for="rotate_switch">Rotate buttons</label>
        <input id="rotate_switch" type="checkbox" .checked=${this._config.rotate_switch !== false} @change=${this._onRotateSwitch} />
      </div>

      <div class="row">
        <label class="main" for="tilt">Tilt (2.5D)</label>
        <input id="tilt" type="range" min="0" max="1" step="0.01" .value=${String(clampTilt(this._config.tilt))} @change=${this._onTilt} />
      </div>

      <div class="row">
        <label class="main" for="walls">Walls (2.5D)</label>
        <select id="walls" @change=${this._onWalls}>
          ${WALLS_MODES.map((m) => html`<option value=${m} ?selected=${this._walls() === m}>${WALLS_LABELS[m]}</option>`)}
        </select>
      </div>

      <div class="row">
        <label class="main" for="rotation">Rotation</label>
        <select id="rotation" @change=${this._onRotation}>
          ${Array.from({ length: 360 / ROTATION_STEP }, (_, i) => i * ROTATION_STEP).map((d) => html`<option value=${d} ?selected=${this._rotation() === d}>${d}°</option>`)}
        </select>
      </div>
      <p class="hint">The card remembers each viewer's zoom, position, rotation, 2D or 2.5D view and theme in that browser. These
        settings are the starting view and what Reset view returns to.</p>

      <div class="row">
        <label class="main" for="labels">Show names and text</label>
        <input id="labels" type="checkbox" .checked=${this._labels()} @change=${this._onLabels} />
      </div>

      <div class="row">
        <label class="main" for="names">Show device names</label>
        <input id="names" type="checkbox" .checked=${this._config.names === true} @change=${this._onNames} />
      </div>

      <div class="row">
        <label class="main" for="kiosk">Kiosk</label>
        <input id="kiosk" type="checkbox" .checked=${this._config.kiosk ?? DEFAULT_KIOSK} @change=${this._onKiosk} />
      </div>

      <div class="row">
        <label class="main" for="active_list">Active list</label>
        <input id="active_list" type="checkbox" .checked=${this._config.active_list ?? DEFAULT_ACTIVE_LIST} @change=${this._onActiveList} />
      </div>

      <div class="row">
        <label class="main" for="night">Night</label>
        <select id="night" @change=${this._onNight}>
          <option value="auto" ?selected=${this._night() === "auto"}>Auto</option>
          <option value="on" ?selected=${this._night() === "on"}>On</option>
          <option value="off" ?selected=${this._night() === "off"}>Off</option>
        </select>
      </div>

      <div class="row">
        <label class="main" for="sun">Sun entity</label>
        <input id="sun" type="text" .value=${this._config.sun ?? DEFAULT_SUN} @change=${this._onSun} />
      </div>

      <div class="row">
        <label class="main" for="open_color">Open door colour</label>
        <input id="open_color" type="color" .value=${this._openColor()} @change=${this._onOpenColor} />
        <button id="open_color_clear" type="button" @click=${this._onOpenColorClear}>Clear</button>
      </div>
      <p class="hint">Night darkens rooms after sunset; Kiosk shows only the plan, for a wall tablet. Active list is
        the floating panel of what's on; kiosk hides it too. Center and Zoom level pin the card to one room or
        corridor instead of the whole floor — the editor's View menu has a "Copy card view" button that reads
        these two values off its own current view.</p>
    `;
  }
}

defineElement("floorplan-studio-card-editor", FloorplanStudioCardEditor);
