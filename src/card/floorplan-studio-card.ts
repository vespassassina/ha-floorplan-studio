import { LitElement, css, html, unsafeCSS } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { FLOORPLAN_CSS, migrate, planPivot, renderFloor, validate, viewBoxFor } from "../core";
import type { Floor, Layout } from "../core";

const NO_LAYOUT = "No layout: install the Floorplan Studio integration or set layout_url";

/** What the card needs of `hass`. Home Assistant's real object has far more; this is only what the card reads. */
export interface HassEntity { state: string; attributes: Record<string, unknown>; last_changed: string }
export interface Hass {
  states: Record<string, HassEntity>;
  themes?: { darkMode?: boolean };
  connection?: { sendMessagePromise<T>(msg: Record<string, unknown>): Promise<T> };
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
    p.msg { padding: 16px; margin: 0; font: 14px sans-serif; color: var(--fp-text, #3a3a3a); }
  `];

  private _config: FloorplanStudioCardConfig = {};
  private _hass?: Hass;
  private _layout: Layout | null = null;
  private _error: string | null = null;
  private _urlRequested = false;
  private _wsRequested = false;
  private _timer: ReturnType<typeof setInterval> | null = null;

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
    const box = viewBoxFor(f);
    return Math.max(3, Math.round((box.h / box.w) * 8));
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopTimer();
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

  protected render() {
    const f = this._floor();
    if (!f) return html`<p class="msg">${this._error ?? NO_LAYOUT}</p>`;
    const layout = this._layout as Layout;
    const rotate = layout.rotate ? { deg: layout.rotate, pivot: planPivot(layout) } : undefined;
    const box = viewBoxFor(f, 60, rotate);
    const body = renderFloor(f, {
      scale: 1,
      state: this._hass?.states,
      now: Date.now(),
      fade: this._config.fade,
      roomGlow: this._config.room_glow,
      theme: this._hass?.themes ? (this._hass.themes.darkMode ? "dark" : "light") : undefined,
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
