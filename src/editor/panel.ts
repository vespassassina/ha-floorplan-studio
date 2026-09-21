import { LitElement, css, html, nothing } from "lit";
import { guard } from "lit/directives/guard.js";
import type { Layout } from "../core";
import demo from "../../demo/layout.json";
import "./editor-app";
import type { FloorplanStudioEditor } from "./editor-app";

/** The part of Home Assistant's `hass` object the panel uses. */
interface PanelHass {
  callWS<T>(msg: { type: string; [k: string]: unknown }): Promise<T>;
  themes?: { darkMode?: boolean };
  states?: Record<string, { state: string; attributes: Record<string, unknown> }>;
  callService?(domain: string, service: string, data: Record<string, unknown>): Promise<unknown>;
}

const REPO = "vespassassina/ha-floorplan-studio";

/** The update HACS offers for this integration, if any. Matched by its release URL, so a renamed entity is still found. */
function findUpdate(hass: PanelHass | undefined) {
  for (const [id, s] of Object.entries(hass?.states ?? {})) {
    if (!id.startsWith("update.") || s.state !== "on") continue;
    const url = String(s.attributes.release_url ?? "");
    if (!url.includes(REPO)) continue;
    return { id, installed: String(s.attributes.installed_version ?? "?"), latest: String(s.attributes.latest_version ?? "?"), url, busy: s.attributes.in_progress === true };
  }
  return null;
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
    install: { state: true },
  };
  declare hass: PanelHass | undefined;
  declare narrow: boolean;
  declare panel: unknown;
  /** The stored plan, or null when nothing is stored yet (the editor then starts blank). */
  declare layout: Layout | null;
  declare ready: boolean;
  declare error: string;
  /** The install click: empty when idle, busy, done, or an error text. */
  declare install: string;
  private started = false;

  constructor() {
    super();
    this.layout = null;
    this.ready = false;
    this.error = "";
    this.install = "";
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

  private async runInstall(id: string) {
    this.install = "busy";
    try {
      await this.hass!.callService!("update", "install", { entity_id: id });
      this.install = "done";
    } catch (e) {
      this.install = `Update failed: ${errText(e)}`;
    }
  }

  private banner() {
    if (this.install === "done") return html`<div class="update">Update installed. Restart Home Assistant to finish (Settings, System, Restart).</div>`;
    const u = findUpdate(this.hass);
    if (!u) return nothing;
    const failed = this.install && this.install !== "busy" ? html` <span class="bad">${this.install}</span>` : nothing;
    const busy = u.busy || this.install === "busy";
    return html`<div class="update">Floorplan Studio ${u.latest} is available (you have ${u.installed}).
      <button ?disabled=${busy} @click=${() => this.runInstall(u.id)}>${busy ? "Installing…" : "Update"}</button>
      <a href=${u.url} target="_blank" rel="noreferrer">Release notes</a>${failed}</div>`;
  }

  render() {
    if (this.error) {
      return html`<div class="msg"><p>${this.error}</p><button @click=${() => this.load()}>Retry</button></div>`;
    }
    if (!this.ready) return html`<div class="msg">Loading…</div>`;
    const demoLayout = demo as unknown as Layout;
    const dark = this.hass?.themes?.darkMode;
    // The editor is drawn again only when the stored layout or the dark mode changes. `hass` changes on every state update in the
    // house, and Lit re-sets an object property on every render: without this guard each update handed the editor the stored layout
    // again, which it takes for a fresh load (zoom reset, selection gone, unsaved edits reverted, undo history wiped).
    // No stored plan: leave `layout` unset. A blank plan is not a valid layout (an outline needs 3 points), so the editor's own blank start is used.
    const editor = guard([this.layout, dark], () => this.layout
      ? html`<floorplan-studio-editor .layout=${this.layout} .demo=${demoLayout} .haDark=${dark} @save-request=${this.onSave}></floorplan-studio-editor>`
      : html`<floorplan-studio-editor .demo=${demoLayout} .haDark=${dark} @save-request=${this.onSave}></floorplan-studio-editor>`);
    return html`${this.banner()}${editor}`;
  }

  static styles = css`
    :host { display: block; font: 14px/1.4 system-ui, sans-serif; box-sizing: border-box; min-height: 100%; padding: 8px 12px; background: var(--primary-background-color, #0d1522); color: var(--primary-text-color, #e6e6e6); }
    .msg { padding: 24px; }
    .update { margin: 0 0 8px; padding: 8px 12px; border-radius: 6px; background: var(--primary-color, #1f6699); color: var(--text-primary-color, #fff); }
    .update a { color: inherit; margin-left: 8px; }
    .update .bad { margin-left: 8px; font-weight: 600; }
    button { font: inherit; padding: 4px 12px; cursor: pointer; }
  `;
}
if (!customElements.get("floorplan-studio-panel")) customElements.define("floorplan-studio-panel", FloorplanStudioPanel);
