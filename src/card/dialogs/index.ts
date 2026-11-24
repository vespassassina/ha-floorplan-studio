// S64.1: Lazy zero-import modal dialogs chunk (`floorplan-studio-dialogs-<hash>.js`).
// Holds cover, floor-off, vacuum, and chooser dialog templates + handlers so the main card pays only the opener state.
import type { html as Html } from "lit";
import type { Device, Door } from "../../core";
import type { FloorplanStudioCard } from "../floorplan-studio-card";

export const DIALOGS_CHUNK = "fp-dialogs-v1";

const OFF_GROUPS = ["lights", "switches", "plugs", "fans", "media"] as const;
const OFF_GROUP_LABEL: Record<(typeof OFF_GROUPS)[number], string> = { lights: "Lights", switches: "Switches", plugs: "Plugs", fans: "Fans", media: "Media" };
const OFF_DOMAINS = ["light", "switch", "media_player"];
function floorOffCalls(rows: readonly { entities: readonly string[] }[]) {
  const by = new Map<string, string[]>([...OFF_DOMAINS, "homeassistant"].map((d) => [d, []]));
  const seen = new Set<string>();
  for (const r of rows) for (const e of r.entities) {
    if (seen.has(e)) continue;
    seen.add(e);
    const d = e.split(".")[0] ?? "";
    by.get(OFF_DOMAINS.includes(d) ? d : "homeassistant")!.push(e);
  }
  return [...by].filter(([, ids]) => ids.length).map(([domain, ids]) => ({ domain, service: "turn_off", data: { entity_id: ids } }));
}

const DIALOGS_CSS = `
.fp-dialog-backdrop{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)}
.fp-dialog{background:var(--fp-room);color:var(--fp-ink);border-radius:8px;padding:16px 20px;min-width:200px;box-shadow:0 4px 16px rgba(0,0,0,.3)}
.fp-dialog p{margin:0 0 14px;font:14px/1.3 var(--fp-font,system-ui,sans-serif)}
.fp-dialog-actions{display:flex;justify-content:flex-end;gap:8px}
.fp-dialog-actions button{font:13px/1.2 var(--fp-font,system-ui,sans-serif);color:var(--fp-ink);background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:6px;padding:6px 14px;cursor:pointer}
.fp-dialog-actions button.confirm{color:var(--fp-on-dark,#fff);background:var(--fp-primary);border-color:var(--fp-primary)}
.fp-vacuum-dialog .fp-dialog-actions{flex-wrap:wrap}
.fp-dialog-actions button:disabled{opacity:.45;cursor:default}
.fp-chooser-list{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.fp-chooser-list button{display:flex;justify-content:space-between;gap:12px;text-align:left;font:13px/1.2 var(--fp-font,system-ui,sans-serif);color:var(--fp-ink);background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:6px;padding:8px 12px;cursor:pointer}
.fp-chooser-list button .state{opacity:.7;white-space:nowrap}
.fp-chooser-dialog .fp-dialog-actions{justify-content:flex-end}
.fp-off-dialog{display:flex;flex-direction:column;max-width:min(360px,calc(100% - 32px));max-height:calc(100% - 32px);box-sizing:border-box}
.fp-off-list{overflow-y:auto;margin:0 0 14px;min-height:0}
.fp-off-group{border:none;margin:0 0 8px;padding:0}
.fp-off-group legend{padding:0;font:600 12px/1.6 var(--fp-font,system-ui,sans-serif)}
.fp-off-row{display:flex;align-items:center;gap:8px;min-height:32px;font:13px/1.3 var(--fp-font,system-ui,sans-serif);cursor:pointer}
.fp-off-row input{width:18px;height:18px;margin:0;flex:0 0 auto;accent-color:var(--fp-primary)}
.fp-off-via{font-size:11px;color:var(--fp-text)}
@media (pointer:coarse){.fp-dialog-actions button{min-height:44px;min-width:44px}.fp-chooser-list button,.fp-off-row{min-height:44px}}
`;

export interface DialogDeps {
  html: typeof Html;
  nothing: unknown;
  t: (key: string, vars?: Record<string, string | number>) => string;
  fireEvent: (el: HTMLElement, type: string, detail?: unknown) => void;
  callService: (c: FloorplanStudioCard, domain: string, service: string, data?: Record<string, unknown>) => void;
  coverService: (c: FloorplanStudioCard, door: Door) => "open_cover" | "close_cover";
  closeCover: (c: FloorplanStudioCard) => void;
  closeOff: (c: FloorplanStudioCard) => void;
  closeVacuum: (c: FloorplanStudioCard) => void;
  closeChooser: (c: FloorplanStudioCard) => void;
}

function chooserEntityName(card: FloorplanStudioCard, entityId: string): string {
  const friendly = card._hass?.states[entityId]?.attributes?.friendly_name;
  if (typeof friendly === "string" && friendly) return friendly;
  const cat = Array.isArray(card._layout?.catalog) ? card._layout!.catalog.find((c) => c?.entity === entityId)?.name : undefined;
  return typeof cat === "string" && cat ? cat : entityId;
}

function chooserEntityState(c: FloorplanStudioCard, entityId: string): string {
  const st = c._hass?.states[entityId];
  if (!st || typeof st.state !== "string") return "";
  const unit = st.attributes?.unit_of_measurement;
  return typeof unit === "string" && unit ? `${st.state} ${unit}` : st.state;
}

function vacuumDisabled(c: FloorplanStudioCard): boolean {
  const d = c._vacuumDialog;
  if (!d) return true;
  const s = c._hass?.states[d.entity]?.state;
  return !s || s === "unavailable" || s === "unknown";
}

export function renderCoverDialog(d: DialogDeps, c: FloorplanStudioCard): unknown {
  const door = c._coverDialog;
  if (!door?.cover) return null;
  const { html, t } = d;
  const closing = d.coverService(c, door) === "close_cover";
  return html`<style>${DIALOGS_CSS}</style>
    <div class="fp-dialog-backdrop" @keydown=${c._onDialogKeydown}>
      <div class="fp-dialog" role="dialog" aria-modal="true" aria-labelledby="fp-dialog-title">
        <p id="fp-dialog-title">${closing ? t("Close {name}?", { name: door.name }) : t("Open {name}?", { name: door.name })}</p>
        <div class="fp-dialog-actions">
          <button type="button" class="cancel" @click=${() => d.closeCover(c)}>${t("Cancel")}</button>
          <button type="button" class="confirm" @click=${() => {
            if (door.cover) d.callService(c, "cover", d.coverService(c, door), { entity_id: door.cover });
            d.closeCover(c);
          }}>${closing ? t("Close") : t("Open")}</button>
        </div>
      </div>
    </div>
  `;
}

export function renderOffDialog(d: DialogDeps, c: FloorplanStudioCard): unknown {
  const dlg = c._offDialog;
  if (!dlg) return null;
  const { html, nothing, t } = d;
  const n = dlg.ticked.filter(Boolean).length;
  const tick = (i: number, on: boolean) => {
    if (i < 0 || i >= dlg.ticked.length) return;
    dlg.ticked = dlg.ticked.map((v, j) => (j === i ? on : v));
    c.requestUpdate();
  };
  return html`<style>${DIALOGS_CSS}</style>
    <div class="fp-dialog-backdrop" @keydown=${c._onDialogKeydown}>
      <div class="fp-dialog fp-off-dialog" role="dialog" aria-modal="true" aria-labelledby="fp-off-title">
        <p id="fp-off-title">${t("Turn off on {name}", { name: dlg.title })}</p>
        <div class="fp-off-list">
          ${OFF_GROUPS.map((g) => {
            const idx = dlg.rows.flatMap((r, i) => (r.group === g ? [i] : []));
            return idx.length ? html`<fieldset class="fp-off-group"><legend>${t("{group} · {n}", { group: t(OFF_GROUP_LABEL[g]), n: idx.length })}</legend>
              ${idx.map((i) => { const r = dlg.rows[i]!; return html`<label class="fp-off-row" data-entity=${r.entity}><input type="checkbox" .checked=${dlg.ticked[i] ?? false} @change=${(e: Event) => tick(i, (e.target as HTMLInputElement).checked)} /><span>${r.name}${r.via ? html` <span class="fp-off-via">${t("with {name}", { name: r.via })}</span>` : nothing}</span></label>`; })}
            </fieldset>` : nothing;
          })}
        </div>
        <div class="fp-dialog-actions">
          <button type="button" class="cancel" @click=${() => d.closeOff(c)}>${t("Cancel")}</button>
          <button type="button" class="confirm" ?disabled=${n === 0} @click=${() => {
            for (const call of floorOffCalls(dlg.rows.filter((_, i) => dlg.ticked[i]))) d.callService(c, call.domain, call.service, call.data);
            d.closeOff(c);
          }}>${t("Turn off {n}", { n })}</button>
        </div>
      </div>
    </div>
  `;
}

export function renderVacuumDialog(d: DialogDeps, c: FloorplanStudioCard): unknown {
  const dev: Device | null = c._vacuumDialog;
  if (!dev) return null;
  const { html, t } = d;
  const disabled = vacuumDisabled(c);
  const act = (service: "start" | "pause" | "return_to_base") => {
    d.callService(c, "vacuum", service, { entity_id: dev.entity });
    d.closeVacuum(c);
  };
  return html`<style>${DIALOGS_CSS}</style>
    <div class="fp-dialog-backdrop" @keydown=${c._onDialogKeydown}>
      <div class="fp-dialog fp-vacuum-dialog" role="dialog" aria-modal="true" aria-labelledby="fp-vacuum-dialog-title">
        <p id="fp-vacuum-dialog-title">${dev.name ?? dev.id}</p>
        <div class="fp-dialog-actions">
          <button type="button" class="cancel" @click=${() => d.closeVacuum(c)}>${t("Cancel")}</button>
          <button type="button" ?disabled=${disabled} @click=${() => act("start")}>${t("Start")}</button>
          <button type="button" ?disabled=${disabled} @click=${() => act("pause")}>${t("Pause")}</button>
          <button type="button" class="confirm" ?disabled=${disabled} @click=${() => act("return_to_base")}>${t("Return to dock")}</button>
        </div>
      </div>
    </div>
  `;
}

export function renderChooserDialog(d: DialogDeps, card: FloorplanStudioCard): unknown {
  const dlg = card._chooserDialog;
  if (!dlg) return null;
  const { html, t } = d;
  return html`<style>${DIALOGS_CSS}</style>
    <div class="fp-dialog-backdrop" @keydown=${card._onDialogKeydown} @click=${(e: Event) => { if (e.target === e.currentTarget) d.closeChooser(card); }}>
      <div class="fp-dialog fp-chooser-dialog" role="dialog" aria-modal="true" aria-labelledby="fp-chooser-dialog-title">
        <p id="fp-chooser-dialog-title">${[dlg.title, dlg.line?.()].filter(Boolean).join(" · ")}</p>
        <div class="fp-chooser-list">
          ${dlg.entities.map((id) => html`<button type="button" @click=${() => { d.closeChooser(card); d.fireEvent(card, "hass-more-info", { entityId: id }); }}><span class="name">${chooserEntityName(card, id)}</span><span class="state">${chooserEntityState(card, id)}</span></button>`)}
        </div>
        <div class="fp-dialog-actions">
          <button type="button" class="cancel" @click=${() => d.closeChooser(card)}>${t("Cancel")}</button>
        </div>
      </div>
    </div>
  `;
}

export function renderDialogs(d: DialogDeps, c: FloorplanStudioCard): unknown {
  return c._coverDialog ? renderCoverDialog(d, c)
    : c._vacuumDialog ? renderVacuumDialog(d, c)
    : c._chooserDialog ? renderChooserDialog(d, c)
    : c._offDialog ? renderOffDialog(d, c)
    : null;
}

export function handleDialogKeydown(d: DialogDeps, c: FloorplanStudioCard, e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    if (c._vacuumDialog) d.closeVacuum(c);
    else if (c._chooserDialog) d.closeChooser(c);
    else if (c._offDialog) d.closeOff(c);
    else d.closeCover(c);
    return;
  }
  if (e.key !== "Tab") return;
  const root = c.shadowRoot;
  const buttons = root ? [...root.querySelectorAll<HTMLElement>(".fp-dialog-actions button:not(:disabled), .fp-chooser-list button, .fp-off-list input")] : [];
  if (buttons.length < 2) return;
  const first = buttons[0]!, last = buttons[buttons.length - 1]!;
  const active = root?.activeElement;
  if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}
