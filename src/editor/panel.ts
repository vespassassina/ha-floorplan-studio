import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { guard } from "lit/directives/guard.js";
import type { Layout } from "../core";
import demo from "../../demo/home.json";
import "./editor-app";
import { haData } from "./hass-pickers";
import { tempUnitOf } from "./temp-range-ops";
import { makeWriter } from "./hass-write";
import { panelVar } from "./theme";
import type { HaData } from "../core";
import type { FloorplanStudioEditor } from "./editor-app";
import { CARD_VERSION } from "../card/version";
import { clearDraft, loadLayout, readDraft } from "./state";

/** "2026-10-21 14:03" in the browser's time zone, 24 h; "an earlier session" when the draft carries no usable time. */
function draftTime(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "an earlier session";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The part of Home Assistant's `hass` object the panel uses. */
interface PanelHass {
  callWS<T>(msg: { type: string; [k: string]: unknown }): Promise<T>;
  themes?: { darkMode?: boolean };
  config?: { unit_system?: { temperature?: string } };
  states?: Record<string, { state: string; attributes: Record<string, unknown>; last_changed: string }>;
  callService?(domain: string, service: string, data: Record<string, unknown>): Promise<unknown>;
}

const REPO_URL = "https://github.com/vespassassina/ha-floorplan-studio/";

/** The update HACS offers for this integration, if any. Matched by its release URL, so a renamed entity is still found. The prefix is checked, not a substring: the URL ends up in a link href. */
function findUpdate(hass: PanelHass | undefined) {
  for (const [id, s] of Object.entries(hass?.states ?? {})) {
    if (!id.startsWith("update.") || s.state !== "on") continue;
    const url = String(s.attributes.release_url ?? "");
    if (!url.startsWith(REPO_URL)) continue;
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
    stale: { state: true },
    draftAt: { state: true },
    conflict: { state: true },
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
  /** The installed version when it differs from the one this page was built from (an update landed while the page stayed open); empty otherwise. */
  declare stale: string;
  /** This page's own build version. A dev build has none to compare, so it is never stale. */
  private built: string = CARD_VERSION;
  /** Empty when no draft is on offer; otherwise the time text the banner shows. */
  declare draftAt: string;
  /** The autosave found at load, unvalidated; Restore sends it through `validate` again. */
  private draft: unknown = null;
  private saving = false;
  private saveQueued = false;
  /** Empty, or what to tell the person after the server refused a save because the plan changed elsewhere. */
  declare conflict: string;
  /** The stored revision this page last saw; null when the integration does not report one (then a save carries no `expected_rev`). */
  private rev: number | null = null;
  /** Counts loads. The editor is drawn again only when it changes, never when `layout` is updated after a save. */
  private loadId = 0;
  private started = false;
  /** What HA has, fetched once after the load. Handed to the editor directly, never through a template binding: the editor is drawn once (see `render`). */
  private ha: HaData | undefined;

  constructor() {
    super();
    this.layout = null;
    this.ready = false;
    this.error = "";
    this.install = "";
    this.stale = "";
    this.draftAt = "";
    this.conflict = "";
  }

  private onVisible = () => { if (document.visibilityState !== "hidden") void this.checkVersion(); };
  /** Closing the tab with unsaved edits asks first. (Sidebar navigation inside HA does not unload the page; the draft banner covers that.) */
  private onUnload = (e: BeforeUnloadEvent) => { if (this.editor()?.dirty) { e.preventDefault(); e.returnValue = ""; } };
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("beforeunload", this.onUnload);
  }
  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("beforeunload", this.onUnload);
    super.disconnectedCallback();
  }
  private editor() { return this.renderRoot?.querySelector("floorplan-studio-editor") as FloorplanStudioEditor | null; }
  /** Asks the integration which version is installed. Any failure or odd reply says nothing: a guard must never be the thing that breaks the panel. */
  private async checkVersion() {
    if (!this.hass || this.built === "dev") return;
    try {
      const r = await this.hass.callWS<{ version?: unknown }>({ type: "floorplan_studio/version" });
      this.stale = typeof r?.version === "string" && r.version !== "" && r.version !== this.built ? r.version : "";
    } catch { /* an older integration has no such command */ }
  }
  private reload() { location.reload(); }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("hass") && this.hass && !this.started) {
      this.started = true;
      void this.load();
      void this.checkVersion();
    }
  }

  private async load() {
    this.error = "";
    try {
      const r = await this.hass!.callWS<{ layout: Layout | null; rev?: number }>({ type: "floorplan_studio/load", with_trace: true });
      this.rev = typeof r.rev === "number" ? r.rev : null;
      this.offerDraft(r.layout); // before the editor exists: its first autosave would overwrite the draft
      this.layout = r.layout;
      this.loadId++;
      this.conflict = "";
      this.ready = true;
      void this.loadHa();
    } catch (e) {
      // No editor on a failed load: saving from it would overwrite the stored plan with an empty one.
      this.layout = null;
      this.ready = false;
      this.error = `Could not load the floor plan: ${errText(e)}`;
    }
  }

  /** Offers this browser's autosave when it is a usable plan that differs from the stored one. A junk draft is ignored, never thrown on. */
  private offerDraft(stored: Layout | null) {
    this.draft = null;
    this.draftAt = "";
    const d = readDraft();
    if (!d) return;
    const draft = loadLayout(d.raw);
    if (!draft.ok) return;
    const same = stored ? loadLayout(stored) : null;
    let offer: unknown = d.raw;
    if (same?.ok) {
      // The autosave drops trace images when the browser's storage is full (persist), so a draft without a trace on a floor
      // that has one stored is a draft that lost it, not one that removed it. Put the stored trace back before comparing:
      // otherwise the banner shows on every visit and Restore leads to a Save that erases the image.
      const merged = structuredClone(draft.layout);
      for (const [k, f] of Object.entries(merged.floors)) {
        const had = Object.prototype.hasOwnProperty.call(same.layout.floors, k) ? same.layout.floors[k].trace : undefined;
        if (had && !f.trace) f.trace = structuredClone(had);
      }
      if (JSON.stringify(same.layout) === JSON.stringify(merged)) return;
      offer = merged;
    }
    this.draft = offer;
    this.draftAt = draftTime(d.at);
  }
  private restoreDraft() {
    const ed = this.editor();
    if (ed) ed.adoptLayout(this.draft, "Draft restored. Undo brings back the plan as it was saved.");
    this.draft = null;
    this.draftAt = "";
  }
  private discardDraft() {
    clearDraft();
    this.draft = null;
    this.draftAt = "";
  }

  private async loadHa() {
    try { this.ha = await haData(this.hass as never); } catch { this.ha = undefined; } // no data: the editor keeps its text fields
    this.pushHa();
  }
  private pushHa() {
    const ed = this.editor();
    // The theme is pushed here, not through the guarded template: a flip must not render the editor again (that is a fresh load).
    if (ed && ed.haDark !== this.hass?.themes?.darkMode) ed.haDark = this.hass?.themes?.darkMode;
    const unit = tempUnitOf(this.hass?.config?.unit_system?.temperature);
    if (ed && ed.tempUnit !== unit) ed.tempUnit = unit; // a primitive, so setting it never re-runs the layout setter
    if (ed && this.ha && ed.ha !== this.ha) ed.ha = this.ha;
    if (ed && this.hass && !ed.writer) ed.writer = makeWriter({ callWS: (m) => this.hass!.callWS(m as never), callApi: (m, p, d) => (this.hass as never as { callApi: (...a: unknown[]) => Promise<never> }).callApi(m, p, d) }); // late-bound: hass is replaced on every state change
    // Live device state, imperative like `ha`/`writer` above, not a template binding: the render `guard` below
    // deliberately excludes `hass` (it changes on every state update in the house), so a templated binding here
    // would never reach the editor. `hass.states` is a fresh object on every push, so this always reassigns.
    if (ed && this.hass?.states) ed.hassState = this.hass.states;
  }
  protected updated() { this.pushHa(); }

  private async onSave(e: Event) {
    const ed = e.currentTarget as FloorplanStudioEditor;
    const layout = (e as CustomEvent<Layout>).detail;
    if (this.stale) { ed.saveDone(false, `Not saved: this page is out of date (${this.built}, installed ${this.stale}). Reload, then save again.`); return; }
    // A second request before the first reply would carry the same expected_rev and be refused as a conflict with the user's own save.
    // Hold it: when the first lands, the editor is asked to save its newest state against the new revision.
    if (this.saving) { this.saveQueued = true; return; }
    this.saving = true;
    // `layout` is the editor's live object; copy it now, before the await, so an edit made while saving is not mistaken for saved.
    const sent = structuredClone(layout);
    try {
      const r = await this.hass!.callWS<{ rev?: number } | undefined>({ type: "floorplan_studio/save", layout, ...(this.rev === null ? {} : { expected_rev: this.rev }) });
      this.rev = typeof r?.rev === "number" ? r.rev : null;
      this.layout = sent; // what is stored now; the editor is not drawn again for it (see `render`)
      this.conflict = "";
      this.saving = false;
      if (this.saveQueued) { this.saveQueued = false; ed.save(); return; } // the status stays "Saving…" until the newest state is written
      ed.saveDone(true, "Saved to Home Assistant");
      // The stored plan is now this one: an old draft would only offer it back, and Restore then Save would undo what another device saved since.
      if (!ed.dirty) clearDraft();
    } catch (err) {
      this.saveQueued = false;
      if ((err as { code?: unknown } | null)?.code === "conflict") {
        this.conflict = errText(err);
        ed.saveDone(false, "Not saved: the plan was changed elsewhere. Reload it or overwrite it, above the plan.");
      } else ed.saveDone(false, `Save failed: ${errText(err)}`);
    } finally {
      this.saving = false;
    }
  }

  /** Conflict, Reload: take the stored plan in as one undo step. Your edits stay one Undo away. */
  private async reloadStored() {
    const ed = this.editor();
    if (!ed) return;
    try {
      // with_trace: the server strips every trace image without it, and this plan is loaded as saved: the next Save would erase them.
      const r = await this.hass!.callWS<{ layout: Layout | null; rev?: number }>({ type: "floorplan_studio/load", with_trace: true });
      if (!ed.adoptLayout(r.layout, "Reloaded the plan saved elsewhere. Undo brings your version back.")) return; // the editor lists why; the conflict stays
      ed.markSaved();
      this.rev = typeof r.rev === "number" ? r.rev : null;
      this.layout = structuredClone(ed.layout);
      this.conflict = "";
    } catch (e) {
      this.conflict = `Could not reload the plan: ${errText(e)}`;
    }
  }
  /** Conflict, Overwrite: learn the latest revision, then save the editor's plan against it. */
  private async overwriteStored() {
    const ed = this.editor();
    if (!ed) return;
    try {
      const r = await this.hass!.callWS<{ rev?: number }>({ type: "floorplan_studio/load", with_trace: true }); // only the revision is used; asked the same as every Studio load
      this.rev = typeof r.rev === "number" ? r.rev : null;
      this.conflict = "";
      ed.save();
    } catch (e) {
      this.conflict = `Could not read the stored revision: ${errText(e)}`;
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
    if (this.stale) return html`<div class="update stale">Floorplan Studio was updated to ${this.stale}; this page still runs ${this.built}. <button @click=${() => this.reload()}>Reload</button> Saving is off until you do.</div>`;
    if (this.install === "done") return html`<div class="update">Update installed. Restart Home Assistant to finish (Settings, System, Restart).</div>`;
    const u = findUpdate(this.hass);
    if (!u) return nothing;
    const failed = this.install && this.install !== "busy" ? html` <span class="bad">${this.install}</span>` : nothing;
    const busy = u.busy || this.install === "busy";
    return html`<div class="update">Floorplan Studio ${u.latest} is available (you have ${u.installed}).
      <button ?disabled=${busy} @click=${() => this.runInstall(u.id)}>${busy ? "Installing…" : "Update"}</button>
      <a href=${u.url} target="_blank" rel="noreferrer">Release notes</a>${failed}</div>`;
  }

  private draftBanner() {
    if (!this.draftAt) return nothing;
    return html`<div class="update draft">Restore unsaved draft from ${this.draftAt}?
      <button class="restore" @click=${() => this.restoreDraft()}>Restore</button>
      <button class="discard" @click=${() => this.discardDraft()}>Discard</button></div>`;
  }
  private conflictBanner() {
    if (!this.conflict) return nothing;
    return html`<div class="update conflict">Changed elsewhere: ${this.conflict}
      <button class="reload" @click=${() => this.reloadStored()}>Reload</button>
      <button class="overwrite" @click=${() => this.overwriteStored()}>Overwrite</button></div>`;
  }
  /** On a narrow screen HA hides its sidebar; every core panel puts the menu button in its own top bar, so this one does too. */
  private bar() {
    if (!this.narrow) return nothing;
    const menu = customElements.get("ha-menu-button")
      ? html`<ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>`
      : html`<button class="menu" aria-label="Menu" @click=${() => this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }))}>☰</button>`;
    return html`<div class="bar">${menu}<span>Floorplan Studio</span></div>`;
  }

  render() {
    if (this.error) {
      return html`<div class="msg"><p>${this.error}</p><button @click=${() => this.load()}>Retry</button></div>`;
    }
    if (!this.ready) return html`<div class="msg">Loading…</div>`;
    const demoLayout = demo as unknown as Layout;
    const dark = this.hass?.themes?.darkMode;
    // The editor is drawn again only on a load (`loadId`). Not on the dark mode (pushed in `pushHa`) and not on a save, which updates
    // `this.layout` to what was stored but is no reason to hand the editor a plan. `hass` changes on every state update in the
    // house, and Lit re-sets an object property on every render: without this guard each update handed the editor the stored layout
    // again, which it takes for a fresh load (zoom reset, selection gone, unsaved edits reverted, undo history wiped).
    // No stored plan: leave `layout` unset. A blank plan is not a valid layout (an outline needs 3 points), so the editor's own blank start is used.
    const editor = guard([this.loadId], () => this.layout
      ? html`<floorplan-studio-editor dashboard-href="/" .layout=${this.layout} .demo=${demoLayout} .haDark=${dark} @save-request=${this.onSave}></floorplan-studio-editor>`
      : html`<floorplan-studio-editor dashboard-href="/" .demo=${demoLayout} .firstRun=${true} .haDark=${dark} @save-request=${this.onSave}></floorplan-studio-editor>`); // S37.1: nothing stored, so the editor offers its three first choices
    return html`${this.bar()}${this.banner()}${this.draftBanner()}${this.conflictBanner()}${editor}`;
  }

  static styles = css`
    :host { display: block; font: 14px/1.4 system-ui, sans-serif; box-sizing: border-box; min-height: 100%; padding: 8px 12px; background: ${unsafeCSS(panelVar("background"))}; color: ${unsafeCSS(panelVar("text"))}; }
    .msg { padding: 24px; }
    .update { margin: 0 0 8px; padding: 8px 12px; border-radius: 6px; background: ${unsafeCSS(panelVar("accent"))}; color: ${unsafeCSS(panelVar("accentText"))}; }
    .bar { display: flex; align-items: center; gap: 8px; margin: -8px -12px 8px; padding: 4px 8px; font-weight: 600; }
    .bar .menu { background: none; border: 0; font-size: 20px; color: inherit; }
    .update a { color: inherit; margin-left: 8px; }
    .update .bad { margin-left: 8px; font-weight: 600; }
    button { font: inherit; padding: 4px 12px; cursor: pointer; }
  `;
}
if (!customElements.get("floorplan-studio-panel")) customElements.define("floorplan-studio-panel", FloorplanStudioPanel);
