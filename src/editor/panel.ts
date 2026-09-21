import { LitElement, css, html } from "lit";
import type { Layout } from "../core";
import demo from "../../demo/layout.json";
import "./editor-app";
import type { FloorplanStudioEditor } from "./editor-app";

/** The part of Home Assistant's `hass` object the panel uses. */
interface PanelHass {
  callWS<T>(msg: { type: string; [k: string]: unknown }): Promise<T>;
  themes?: { darkMode?: boolean };
}

const errText = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

/**
 * <floorplan-studio-panel>: the editor inside Home Assistant.
 *   property `hass`  set by HA on every state change; the first one starts the load
 * Load and save go through the `floorplan_studio/load` and `floorplan_studio/save` websocket commands.
 */
export class FloorplanStudioPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    narrow: { attribute: false },
    panel: { attribute: false },
    layout: { state: true },
    ready: { state: true },
    error: { state: true },
  };
  declare hass: PanelHass | undefined;
  declare narrow: boolean;
  declare panel: unknown;
  /** The stored plan, or null when nothing is stored yet (the editor then starts blank). */
  declare layout: Layout | null;
  declare ready: boolean;
  declare error: string;
  private started = false;

  constructor() {
    super();
    this.layout = null;
    this.ready = false;
    this.error = "";
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("hass") && this.hass && !this.started) {
      this.started = true;
      void this.load();
    }
  }

  private async load() {
    this.error = "";
    try {
      const r = await this.hass!.callWS<{ layout: Layout | null }>({ type: "floorplan_studio/load" });
      this.layout = r.layout;
      this.ready = true;
    } catch (e) {
      // No editor on a failed load: saving from it would overwrite the stored plan with an empty one.
      this.layout = null;
      this.ready = false;
      this.error = `Could not load the floor plan: ${errText(e)}`;
    }
  }

  private async onSave(e: Event) {
    const ed = e.currentTarget as FloorplanStudioEditor;
    const layout = (e as CustomEvent<Layout>).detail;
    try {
      await this.hass!.callWS({ type: "floorplan_studio/save", layout });
      ed.saveDone(true, "Saved to Home Assistant");
    } catch (err) {
      ed.saveDone(false, `Save failed: ${errText(err)}`);
    }
  }

  render() {
    if (this.error) {
      return html`<div class="msg"><p>${this.error}</p><button @click=${() => this.load()}>Retry</button></div>`;
    }
    if (!this.ready) return html`<div class="msg">Loading…</div>`;
    const demoLayout = demo as unknown as Layout;
    // No stored plan: leave `layout` unset. A blank plan is not a valid layout (an outline needs 3 points), so the editor's own blank start is used.
    return this.layout
      ? html`<floorplan-studio-editor .layout=${this.layout} .demo=${demoLayout} .haDark=${this.hass?.themes?.darkMode} @save-request=${this.onSave}></floorplan-studio-editor>`
      : html`<floorplan-studio-editor .demo=${demoLayout} .haDark=${this.hass?.themes?.darkMode} @save-request=${this.onSave}></floorplan-studio-editor>`;
  }

  static styles = css`
    :host { display: block; box-sizing: border-box; min-height: 100%; padding: 8px 12px; background: var(--primary-background-color, #0d1522); color: var(--primary-text-color, #e6e6e6); }
    .msg { padding: 24px; }
    button { font: inherit; padding: 6px 14px; cursor: pointer; }
  `;
}
if (!customElements.get("floorplan-studio-panel")) customElements.define("floorplan-studio-panel", FloorplanStudioPanel);
