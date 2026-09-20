import { LitElement, css, html, unsafeCSS, type PropertyValues } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { FLOORPLAN_CSS, migrate, planPivot, renderFloor, validate, viewBoxFor } from "../core";
import type { Floor, Layout } from "../core";
import { bindDeviceActions, lightFill, lightOpacity } from "./actions";

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
  floor?: string | "all";
  fade?: number;
  room_glow?: boolean;
  layout?: Layout;
  layout_url?: string;
}

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string }[];
  }
}

/** `custom:floorplan-studio-card`: renders one floor of the layout, live from `hass`. */
export class FloorplanStudioCard extends LitElement {
  static styles = [unsafeCSS(FLOORPLAN_CSS), css`
    :host { display: block; }
    svg { width: 100%; height: auto; display: block; }
    p.msg { padding: 16px; margin: 0; font: 14px sans-serif; color: var(--fp-text); }
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

  static getStubConfig(): FloorplanStudioCardConfig {
    return { type: "custom:floorplan-studio-card" };
  }

  setConfig(config: FloorplanStudioCardConfig): void {
    this._config = config ?? {};
    this._layout = null;
    this._error = null;
    this._urlRequested = false;
    this._wsRequested = false;
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

  getCardSize(): number {
    const f = this._floor();
    if (!f || !f.outline.length) return 6;
    const box = viewBoxFor(f, 60, this._rotate());
    return Math.max(3, Math.round((box.h / box.w) * 8));
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopTimer();
    this._unbindActions?.();
    this._unbindActions = null;
    this._actionsSvg = null;
  }

  /** Takes any accepted layout (from config or a fetch), migrates and validates it. Never throws: an unusable one just leaves the message up. */
  private _applyLayout(raw: unknown): void {
    try {
      const v = validate(migrate(raw));
      if (v.ok && Object.keys(v.layout.floors).length) {
        this._layout = v.layout;
        this._error = null;
      } else {
        this._error = NO_LAYOUT;
      }
    } catch {
      this._error = NO_LAYOUT;
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
      this._hass.connection
        .sendMessagePromise({ type: "floorplan_studio/load" })
        .then((layout) => this._applyLayout(layout))
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

  /** Dark when the Home Assistant dashboard is dark, light when it is explicitly not; undefined (never hard-coded) with no `hass.themes` at all. */
  private _theme(): "light" | "dark" | undefined {
    if (!this._hass?.themes) return undefined;
    return this._hass.themes.darkMode ? "dark" : "light";
  }

  private _floor(): Floor | null {
    if (!this._layout) return null;
    const keys = Object.keys(this._layout.floors);
    if (!keys.length) return null;
    const want = this._config.floor;
    const key = want && want !== "all" && this._layout.floors[want] ? want : keys[0];
    return this._layout.floors[key];
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
      const t = Date.parse(s.last_changed);
      return !Number.isNaN(t) && now - t < fadeMs;
    });
  }

  private _stopTimer(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /** Starts a 1 s re-render timer while a motion device is fading, stops it the moment none is. Never runs for nothing else. */
  private _syncTimer(): void {
    const active = this._motionFading();
    if (active && this._timer === null) {
      // Each tick checks for itself, so the timer stops the moment the fade window closes rather than running forever once started.
      this._timer = setInterval(() => {
        if (this._motionFading()) this.requestUpdate();
        else this._stopTimer();
      }, 1000);
    } else if (!active) {
      this._stopTimer();
    }
  }

  /**
   * The light's own colour (S2.2): `renderFloor` draws every icon in its type's flat `--fp-on`, since it never
   * looks past `state` for a per-entity attribute. Here, on top of that markup, a lit light's `<path>` gets an
   * inline `fill`/`opacity` from its own `rgb_color`/`brightness` — inline always outranks the CSS class rule.
   * Runs after every render because `unsafeSVG` replaces the `<svg>`'s content wholesale, taking any inline
   * style set on a previous render's nodes with it.
   */
  private _paintLights(svg: SVGSVGElement): void {
    const f = this._floor();
    if (!f) return;
    f.devices.forEach((d, i) => {
      if (d.type !== "light") return;
      const g = svg.querySelector(`[data-x="${i}"]`);
      const path = g?.querySelector("path");
      if (!g || !path) return;
      if (!g.classList.contains("on")) { path.removeAttribute("style"); return; }
      const state = this._hass?.states[d.entity];
      path.setAttribute("style", `fill:${lightFill(state)};opacity:${lightOpacity(state)}`);
    });
  }

  /**
   * The host's own chrome (this `p.msg`, anything outside the `<svg>`) is styled by `FLOORPLAN_CSS`'s `:host` rules,
   * which read `data-theme` off the host element itself, not off `renderFloor`'s output. Without this the chrome
   * would follow the OS's `prefers-color-scheme` instead of Home Assistant's own theme (Opus review). Kept in sync
   * with the same value passed into `renderFloor`, and cleared, never hard-coded, when there is no `hass.themes`.
   */
  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    const t = this._theme();
    if (t) this.setAttribute("data-theme", t);
    else this.removeAttribute("data-theme");

    const svg = this.shadowRoot?.querySelector("svg") ?? null;
    if (svg !== this._actionsSvg) {
      // Lit keeps the <svg> element itself across renders (only unsafeSVG's content is replaced), so binding
      // once per element, not once per render, avoids piling up duplicate listeners (S2.2 "Break it": no
      // debounce, but also no double-firing from a stale second listener).
      this._unbindActions?.();
      this._unbindActions = svg ? bindDeviceActions(svg, this, (i) => this._floor()?.devices[i]) : null;
      this._actionsSvg = svg;
    }
    if (svg) this._paintLights(svg);
  }

  protected render() {
    const f = this._floor();
    if (!f) return html`<p class="msg">${this._error ?? NO_LAYOUT}</p>`;
    const rotate = this._rotate();
    const box = viewBoxFor(f, 60, rotate);
    const body = renderFloor(f, {
      scale: 1,
      state: this._hass?.states,
      now: Date.now(),
      fade: this._config.fade,
      roomGlow: this._config.room_glow,
      theme: this._theme(),
      rotate,
    });
    return html`<svg viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${unsafeSVG(body)}</svg>`;
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
if (typeof customElements !== "undefined" && !customElements.get("floorplan-studio-card"))
  customElements.define("floorplan-studio-card", FloorplanStudioCard);
