import { LitElement, css, html, unsafeCSS, type PropertyValues } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { FLOORPLAN_CSS, THEMES, migrate, planPivot, renderFloor, validate, viewBoxFor } from "../core";
import type { Theme } from "../core";
import type { Door, Floor, Layout } from "../core";
import { bindDeviceActions } from "./actions";

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
  /** S7.6: `auto` (default) darkens the plan while the sun entity is `below_horizon` (or `on`); `on` always, `off` never. */
  night?: "auto" | "on" | "off";
  /** S7.6: the entity `night: auto` reads; default `sun.sun`. */
  sun?: string;
}

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string }[];
  }
}

/** `custom:floorplan-studio-card`: renders one floor of the layout, live from `hass`. */
export class FloorplanStudioCard extends LitElement {
  static styles = [unsafeCSS(FLOORPLAN_CSS), css`
    :host { display: block; position: relative; }
    svg { width: 100%; height: auto; display: block; }
    p.msg { padding: 16px; margin: 0; font: 14px sans-serif; color: var(--fp-text); }
    /* S2.6: the floor switcher is card chrome (like p.msg above), not plan content, so it sits outside the <svg>
       renderFloor draws and is positioned over it instead. */
    .fp-floors { position: absolute; top: 8px; left: 8px; z-index: 1; display: flex; gap: 6px; }
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
    .fp-dialog-actions button.confirm { color: var(--fp-on-dark, #fff); background: var(--fp-primary); border-color: var(--fp-primary); }
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

  static getStubConfig(): FloorplanStudioCardConfig {
    return { type: "custom:floorplan-studio-card" };
  }

  connectedCallback(): void {
    super.connectedCallback();
    // S2.7: programmatically focusable (not in the tab order) so the card itself can take focus back after the
    // cover dialog closes, without adding a stop no keyboard user would otherwise want. Set here, not in the
    // constructor: the custom element spec forbids gaining attributes during construction (jsdom enforces this
    // and throws NotSupportedError; a real browser is more forgiving, but this is the correct place regardless).
    if (!this.hasAttribute("tabindex")) this.tabIndex = -1;
  }

  setConfig(config: FloorplanStudioCardConfig): void {
    this._config = config ?? {};
    this._layout = null;
    this._error = null;
    this._urlRequested = false;
    this._wsRequested = false;
    this._shownFloor = null;
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
        // S2.4 review: every floor, not only the one on show, so a sensor keeps fading across a floor switch (S2.6).
        this._motionEntities = new Set(Object.values(v.layout.floors).flatMap((f) => f.devices.filter((d) => d.type === "motion").map((d) => d.entity)));
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

  /** The configured theme, blueprint when there is none or it is not one of the three. The OS and Home Assistant's dark mode no longer pick it: only `theme: ha` follows Home Assistant. */
  private _theme(): Theme {
    const t = this._config.theme;
    return t && (THEMES as readonly string[]).includes(t) ? t : "blueprint";
  }

  /** Home Assistant's dark mode, used only by `theme: ha` to choose the dark set for what its CSS variables do not cover. */
  private _haDark(): boolean {
    return this._hass?.themes?.darkMode === true;
  }

  /** S6.5: the switchable floors and their order — `config.floors`, filtered to the ones the layout actually has,
   * when it names at least one real floor; every floor, in layout order, for `config.floor === "all"`; `null` for
   * a single explicit floor or nothing configured. `floors` wins over `floor` when both are set. Untrusted config
   * (CLAUDE.md finding 1): an unknown id is dropped rather than thrown on, and an empty or all-unknown list is
   * the same as `floors` not being set. */
  private _floorList(): [string, Floor][] | null {
    if (!this._layout) return null;
    if (this._config.floors?.length) {
      const entries = this._config.floors.filter((k) => this._layout!.floors[k]).map((k) => [k, this._layout!.floors[k]!] as [string, Floor]);
      if (entries.length) return entries;
    }
    if (this._config.floor === "all") return Object.entries(this._layout.floors);
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
  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    const t = this._theme();
    this.setAttribute("data-theme", t);
    if (t === "ha" && this._haDark()) this.setAttribute("data-mode", "dark");
    else this.removeAttribute("data-mode");

    const svg = this.shadowRoot?.querySelector("svg") ?? null;
    if (svg !== this._actionsSvg) {
      // Lit keeps the <svg> element itself across renders (only unsafeSVG's content is replaced), so binding
      // once per element, not once per render, avoids piling up duplicate listeners (S2.2 "Break it": no
      // debounce, but also no double-firing from a stale second listener).
      this._unbindActions?.();
      this._unbindActions = svg
        ? bindDeviceActions(svg, this, (i) => this._floor()?.devices[i], (i) => this._floor()?.doors[i], (door) => this._openCoverDialog(door))
        : null;
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
  }

  /**
   * S2.7: opens the cover confirm dialog for `door`, unless one is already open — a second tap while the dialog
   * is shown (a door re-tapped, or another cover door tapped through the dialog's own backdrop) does not open a
   * second one or swap which door it acts on ("Break it" in the PLAN block).
   */
  private _openCoverDialog(door: Door): void {
    if (this._coverDialog) return;
    this._coverDialog = door;
    this.requestUpdate();
  }

  private _closeCoverDialog(): void {
    this._coverDialog = null;
    this.requestUpdate();
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

  /** Escape cancels; Tab/Shift+Tab cycle only between the dialog's own two buttons, so focus never escapes it into
   * the rest of the card while it is open. */
  private _onDialogKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      this._closeCoverDialog();
      return;
    }
    if (e.key !== "Tab") return;
    const root = this.shadowRoot;
    const buttons = root ? [...root.querySelectorAll<HTMLButtonElement>(".fp-dialog-actions button")] : [];
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
    const list = this._floorList();
    if (!list) return null;
    const current = this._floorKey();
    return html`<div class="fp-floors">
      ${list.map(
        ([key, fl]) => html`<button type="button" aria-pressed=${key === current ? "true" : "false"} @click=${() => this._selectFloor(key)}>${fl.title || key}</button>`,
      )}
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
    const box = viewBoxFor(f, 60, rotate);
    const body = renderFloor(f, {
      scale: 1,
      state: this._stateForRender(),
      now: Date.now(),
      fade: this._config.fade,
      roomGlow: this._config.room_glow,
      theme: this._theme(),
      dark: this._haDark(),
      rotate,
      night: this._night(),
    });
    return html`${this._floorChips()}<svg viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${unsafeSVG(body)}</svg>${this._coverDialogTemplate()}`;
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
