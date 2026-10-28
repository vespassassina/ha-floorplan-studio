import { type Device, type Door, floorOffCalls, floorOffRows, OFF_GROUP_LABEL, OFF_GROUPS } from "../core";
import { t } from "../core/i18n";
import { fireEvent } from "./actions";
import { html, nothing } from "lit";
import { floorTitle } from "./card-overview";
import type { FloorplanStudioCard } from "./floorplan-studio-card";

/**
 * S2.7: opens the cover confirm dialog for `door`, unless one is already open — a second tap while the dialog
 * is shown (a door re-tapped, or another cover door tapped through the dialog's own backdrop) does not open a
 * second one or swap which door it acts on ("Break it" in the PLAN block).
 */
/** Whether any of the card's dialogs is open. Only one is ever open; each `_open…Dialog` checks this first. */
export function dialogOpen(c: FloorplanStudioCard): boolean {
  return !!(c._coverDialog || c._vacuumDialog || c._chooserDialog || c._offDialog);
}

export function openCoverDialog(c: FloorplanStudioCard, door: Door): void {
  if (dialogOpen(c)) return;
  c._coverDialog = door;
  c.requestUpdate();
}

export function closeCoverDialog(c: FloorplanStudioCard): void {
  c._coverDialog = null;
  c.requestUpdate();
}

/**
 * S7.10: opens the vacuum dialog for `d`, unless a dialog (this one or the cover one) is already open — the
 * same "ignore a second tap while open" rule as `_openCoverDialog`.
 */
export function openVacuumDialog(c: FloorplanStudioCard, d: Device): void {
  if (dialogOpen(c)) return;
  c._vacuumDialog = d;
  c.requestUpdate();
}

export function closeVacuumDialog(c: FloorplanStudioCard): void {
  c._vacuumDialog = null;
  c.requestUpdate();
}

/**
 * S10.4: opens the chooser dialog listing `entities` under `title`, unless a dialog (any of the three) is
 * already open — the same "ignore a second tap while open" rule as `_openCoverDialog`/`_openVacuumDialog`.
 * `bindDeviceActions` only ever calls this with two or more entities (one opens more-info directly instead), but
 * this checks anyway rather than trusting that, so a future caller mistake shows an empty, if odd, dialog rather
 * than a crash.
 */
export function openChooserDialog(c: FloorplanStudioCard, title: string, entities: string[], line?: () => string): void {
  if (dialogOpen(c)) return;
  c._chooserDialog = { title, entities, ...(line ? { line } : {}) };
  c.requestUpdate();
}

export function closeChooserDialog(c: FloorplanStudioCard): void {
  c._chooserDialog = null;
  c.requestUpdate();
}

/** The chooser's own row label: HA's `friendly_name` when the entity has state, else the plan id itself — same
 *  fallback order `active.ts`'s `nameFor` already uses for a device row, so the two never disagree about what an
 *  entity is called. Untrusted state (finding 1): anything that is not text is skipped. */
export function chooserEntityName(card: FloorplanStudioCard, entityId: string): string {
  const friendly = card._hass?.states[entityId]?.attributes?.friendly_name;
  if (typeof friendly === "string" && friendly) return friendly;
  // Review fix: the plan's own catalog name before the bare id, the order the S10.4 brief asked for.
  const cat = Array.isArray(card._layout?.catalog) ? card._layout!.catalog.find((c) => c?.entity === entityId)?.name : undefined;
  return typeof cat === "string" && cat ? cat : entityId;
}

/** The row's live state, with its unit when HA gives one; empty when HA has no state for it. Untrusted: only text. */
export function chooserEntityState(c: FloorplanStudioCard, entityId: string): string {
  const st = c._hass?.states[entityId];
  if (!st || typeof st.state !== "string") return "";
  const unit = st.attributes?.unit_of_measurement;
  return typeof unit === "string" && unit ? `${st.state} ${unit}` : st.state;
}

export function pickChooserEntity(c: FloorplanStudioCard, entityId: string): void {
  closeChooserDialog(c);
  fireEvent(c, "hass-more-info", { entityId });
}

/** S7.10: Break it — `unavailable`/`unknown` (or no state at all) disables the three action buttons; Cancel
 *  always stays enabled, so the dialog can still be dismissed. */
export function vacuumDisabled(c: FloorplanStudioCard): boolean {
  const d = c._vacuumDialog;
  if (!d) return true;
  const s = c._hass?.states[d.entity]?.state;
  return !s || s === "unavailable" || s === "unknown";
}

export function vacuumAction(c: FloorplanStudioCard, service: "start" | "pause" | "return_to_base"): void {
  const d = c._vacuumDialog;
  if (d) c._call("vacuum", service, { entity_id: d.entity });
  closeVacuumDialog(c);
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
export function coverService(c: FloorplanStudioCard, door: Door): "open_cover" | "close_cover" {
  return c._hass?.states[door.cover ?? ""]?.state === "open" ? "close_cover" : "open_cover";
}

export function confirmCoverDialog(c: FloorplanStudioCard): void {
  const door = c._coverDialog;
  if (door?.cover) c._call("cover", coverService(c, door), { entity_id: door.cover });
  closeCoverDialog(c);
}

/** The entry: for the floor on show, disabled with its reason when nothing on it is on. */
export function floorOffButton(c: FloorplanStudioCard) {
  const f = c._floor(), key = c._floorKey();
  if (!f || !key) return nothing;
  const none = floorOffRows(f, c._stateForRender()).length === 0;
  return html`<button type="button" class="fp-floor-off" ?disabled=${none} title=${none ? t("Nothing is on on this floor") : t("Choose what to turn off on this floor")} @click=${() => openOffDialog(c)}>${t("Turn off on this floor…")}</button>`;
}

export function openOffDialog(c: FloorplanStudioCard): void {
  const f = c._floor(), key = c._floorKey();
  if (!f || !key || dialogOpen(c)) return;
  const rows = floorOffRows(f, c._stateForRender());
  if (!rows.length) return;
  c._closePopup();
  c._offDialog = { floor: key, title: floorTitle(c, key), rows, ticked: rows.map(() => true) };
  c.requestUpdate();
}

export function closeOffDialog(c: FloorplanStudioCard): void {
  c._offDialog = null;
  c.requestUpdate();
}

export function tickOff(c: FloorplanStudioCard, i: number, on: boolean): void {
  const d = c._offDialog;
  if (!d || i < 0 || i >= d.ticked.length) return;
  d.ticked = d.ticked.map((t, j) => (j === i ? on : t));
  c.requestUpdate();
}

/** One `turn_off` per domain over the ticked rows (`floorOffCalls`), then the dialog closes. */
export function confirmOffDialog(card: FloorplanStudioCard): void {
  const d = card._offDialog;
  if (!d) return;
  for (const c of floorOffCalls(d.rows.filter((_, i) => d.ticked[i]))) card._call(c.domain, c.service, c.data);
  closeOffDialog(card);
}

/** S2.7: the cover confirm dialog, or `null` when none is open. Card chrome (like `_floorChips` above): outside
 * the `<svg>` renderFloor draws, never inside it (CLAUDE.md finding 8). `lit-html`'s own text-node escaping
 * handles the door's `name` safely, the same guarantee `esc()` gives core's hand-built SVG strings (finding 2).
 * The verb (both the question and the button's own label) comes from `_coverService`, the same call
 * `_confirmCoverDialog` makes, so the text can never promise one thing and do another (Opus review). `role`,
 * `aria-modal` and `aria-labelledby` name this to assistive tech as the modal it is, pointed at the question
 * itself so its name changes along with the verb. */
export function coverDialogTemplate(c: FloorplanStudioCard) {
  const door = c._coverDialog;
  if (!door?.cover) return null;
  const closing = coverService(c, door) === "close_cover";
  return html`
      <div class="fp-dialog-backdrop" @keydown=${c._onDialogKeydown}>
        <div class="fp-dialog" role="dialog" aria-modal="true" aria-labelledby="fp-dialog-title">
          <p id="fp-dialog-title">${closing ? t("Close {name}?", { name: door.name }) : t("Open {name}?", { name: door.name })}</p>
          <div class="fp-dialog-actions">
            <button type="button" class="cancel" @click=${() => closeCoverDialog(c)}>${t("Cancel")}</button>
            <button type="button" class="confirm" @click=${() => confirmCoverDialog(c)}>${closing ? t("Close") : t("Open")}</button>
          </div>
        </div>
      </div>
    `;
}

/** S24.8: the floor-off checklist. Groups in `OFF_GROUPS` order with their counts, a tick per row (all ticked), and one
 *  confirm that names how many will go. Names go through lit, escaped (finding 2). */
export function offDialogTemplate(c: FloorplanStudioCard) {
  const d = c._offDialog;
  if (!d) return null;
  const n = d.ticked.filter(Boolean).length;
  return html`
      <div class="fp-dialog-backdrop" @keydown=${c._onDialogKeydown}>
        <div class="fp-dialog fp-off-dialog" role="dialog" aria-modal="true" aria-labelledby="fp-off-title">
          <p id="fp-off-title">${t("Turn off on {name}", { name: d.title })}</p>
          <div class="fp-off-list">
            ${OFF_GROUPS.map((g) => {
            const idx = d.rows.flatMap((r, i) => (r.group === g ? [i] : []));
            return idx.length ? html`<fieldset class="fp-off-group"><legend>${t("{group} · {n}", { group: t(OFF_GROUP_LABEL[g]), n: idx.length })}</legend>
                ${idx.map((i) => { const r = d.rows[i]!; return html`<label class="fp-off-row" data-entity=${r.entity}><input type="checkbox" .checked=${d.ticked[i] ?? false} @change=${(e: Event) => tickOff(c, i, (e.target as HTMLInputElement).checked)} /><span>${r.name}${r.via ? html` <span class="fp-off-via">${t("with {name}", { name: r.via })}</span>` : nothing}</span></label>`; })}
              </fieldset>` : nothing;
          })}
          </div>
          <div class="fp-dialog-actions">
            <button type="button" class="cancel" @click=${() => closeOffDialog(c)}>${t("Cancel")}</button>
            <button type="button" class="confirm" ?disabled=${n === 0} @click=${() => confirmOffDialog(c)}>${t("Turn off {n}", { n })}</button>
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
export function vacuumDialogTemplate(c: FloorplanStudioCard) {
  const d = c._vacuumDialog;
  if (!d) return null;
  const disabled = vacuumDisabled(c);
  return html`
      <div class="fp-dialog-backdrop" @keydown=${c._onDialogKeydown}>
        <div class="fp-dialog fp-vacuum-dialog" role="dialog" aria-modal="true" aria-labelledby="fp-vacuum-dialog-title">
          <p id="fp-vacuum-dialog-title">${d.name ?? d.id}</p>
          <div class="fp-dialog-actions">
            <button type="button" class="cancel" @click=${() => closeVacuumDialog(c)}>${t("Cancel")}</button>
            <button type="button" ?disabled=${disabled} @click=${() => vacuumAction(c, "start")}>${t("Start")}</button>
            <button type="button" ?disabled=${disabled} @click=${() => vacuumAction(c, "pause")}>${t("Pause")}</button>
            <button type="button" class="confirm" ?disabled=${disabled} @click=${() => vacuumAction(c, "return_to_base")}>${t("Return to dock")}</button>
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
export function chooserDialogTemplate(card: FloorplanStudioCard) {
  const c = card._chooserDialog;
  if (!c) return null;
  return html`
      <div class="fp-dialog-backdrop" @keydown=${card._onDialogKeydown} @click=${(e: Event) => { if (e.target === e.currentTarget) closeChooserDialog(card); }}>
        <div class="fp-dialog fp-chooser-dialog" role="dialog" aria-modal="true" aria-labelledby="fp-chooser-dialog-title">
          <p id="fp-chooser-dialog-title">${[c.title, c.line?.()].filter(Boolean).join(" · ")}</p>
          <div class="fp-chooser-list">
            ${c.entities.map((id) => html`<button type="button" @click=${() => pickChooserEntity(card, id)}><span class="name">${chooserEntityName(card, id)}</span><span class="state">${chooserEntityState(card, id)}</span></button>`)}
          </div>
          <div class="fp-dialog-actions">
            <button type="button" class="cancel" @click=${() => closeChooserDialog(card)}>${t("Cancel")}</button>
          </div>
        </div>
      </div>
    `;
}

/** Escape cancels; Tab/Shift+Tab cycle only between the open dialog's own buttons, so focus never escapes it into
 * the rest of the card while it is open. Shared by the cover dialog (two buttons), the vacuum dialog (four) and
 * the S10.4 chooser (its entity rows plus Cancel) — `_openCoverDialog`/`_openVacuumDialog`/`_openChooserDialog`
 * never let more than one be open at once, so exactly one dialog's buttons are ever on the page and this reads
 * them generically rather than picking a dialog by name. */
export function onDialogKeydown(c: FloorplanStudioCard, e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    if (c._vacuumDialog) closeVacuumDialog(c);
    else if (c._chooserDialog) closeChooserDialog(c);
    else if (c._offDialog) closeOffDialog(c);
    else closeCoverDialog(c);
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
