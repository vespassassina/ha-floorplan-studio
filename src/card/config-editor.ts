import { LitElement, css, html } from "lit";
import { THEMES, migrate, validate } from "../core";
import type { Layout, Theme } from "../core";
import type { FloorplanStudioCardConfig, Hass } from "./floorplan-studio-card";

/** The form edits the card's own config type; every key it shows is one the card reads (S7.5 kiosk, S7.6 night and sun). */
export type EditorConfig = FloorplanStudioCardConfig;

type ZoomChoice = "on" | "wheel" | "off";

const DEFAULT_THEME: Theme = "blueprint";
const DEFAULT_FADE = 300;
const DEFAULT_ROOM_GLOW = false;
const DEFAULT_KIOSK = false;
const DEFAULT_NIGHT = "auto";
const DEFAULT_SUN = "sun.sun";

const NIGHT_CHOICES = ["auto", "on", "off"] as const;

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

  setConfig(config: FloorplanStudioCardConfig): void {
    // CLAUDE.md finding 1: config comes from a saved dashboard, which a person (or an LLM helping them) can hand-edit —
    // never trust its shape further than reading the handful of keys this form understands.
    this._config = { ...((config ?? {}) as EditorConfig) };
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

  private _onRoomGlow(e: Event): void {
    this._set("room_glow", (e.target as HTMLInputElement).checked, DEFAULT_ROOM_GLOW);
  }

  private _onZoom(e: Event): void {
    const choice = (e.target as HTMLSelectElement).value as ZoomChoice;
    const value: EditorConfig["zoom"] = choice === "off" ? false : choice === "wheel" ? "wheel" : true;
    this._set("zoom", value, true);
  }

  private _onKiosk(e: Event): void {
    this._set("kiosk", (e.target as HTMLInputElement).checked, DEFAULT_KIOSK);
  }

  private _onNight(e: Event): void {
    this._set("night", (e.target as HTMLSelectElement).value as EditorConfig["night"], DEFAULT_NIGHT);
  }

  private _onSun(e: Event): void {
    const v = (e.target as HTMLInputElement).value.trim() || DEFAULT_SUN;
    this._set("sun", v, DEFAULT_SUN);
  }

  protected render() {
    const floors = this._floorEntries();
    const checked = new Set(this._config.floors ?? []);
    return html`
      <div class="row">
        <label class="main" for="theme">Theme</label>
        <select id="theme" @change=${this._onTheme}>
          ${THEMES.map((t) => html`<option value=${t} ?selected=${t === this._theme()}>${t}</option>`)}
        </select>
      </div>

      <div class="row">
        <label class="main">Floors</label>
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

      <div class="row">
        <label class="main" for="fade">Fade (s)</label>
        <input id="fade" type="number" min="0" step="1" .value=${String(this._config.fade ?? DEFAULT_FADE)} @change=${this._onFade} />
      </div>

      <div class="row">
        <label class="main" for="room_glow">Room glow</label>
        <input id="room_glow" type="checkbox" .checked=${this._config.room_glow ?? DEFAULT_ROOM_GLOW} @change=${this._onRoomGlow} />
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
        <label class="main" for="kiosk">Kiosk</label>
        <input id="kiosk" type="checkbox" .checked=${this._config.kiosk ?? DEFAULT_KIOSK} @change=${this._onKiosk} />
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
      <p class="hint">Night darkens rooms after sunset; Kiosk shows only the plan, for a wall tablet.</p>
    `;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("floorplan-studio-card-editor"))
  customElements.define("floorplan-studio-card-editor", FloorplanStudioCardEditor);
