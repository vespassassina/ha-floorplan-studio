import { type Device, type Door, floorOffCalls, floorOffRows, OFF_GROUP_LABEL, OFF_GROUPS } from "../core";
import { t } from "../core/i18n";
import { fireEvent } from "./actions";
import { html, nothing } from "lit";
import { floorTitle } from "./card-overview";
import { callService, closePopup } from "./card-popup";
import { lazy } from "./lazy";
import type { FloorplanStudioCard } from "./floorplan-studio-card";
import type { DialogDeps } from "./dialogs";

type DialogsLib = typeof import("./dialogs");
const dialogsMod = lazy<DialogsLib>(() => import("./dialogs"), "__FPDIALOGS_CHUNK__", "dialogs");

function ensureDialogs(c: FloorplanStudioCard): void {
  if (!dialogsMod.get()) void dialogsMod.load().then(() => { if (c.isConnected) c.requestUpdate(); }, () => {});
}

/** Whether any of the card's dialogs is open. Only one is ever open; each `open…Dialog` checks this first. */
export function dialogOpen(c: FloorplanStudioCard): boolean {
  return !!(c._coverDialog || c._vacuumDialog || c._chooserDialog || c._offDialog);
}

export function openCoverDialog(c: FloorplanStudioCard, door: Door): void {
  if (dialogOpen(c)) return;
  c._coverDialog = door;
  ensureDialogs(c);
  c.requestUpdate();
}
export function closeCoverDialog(c: FloorplanStudioCard): void { c._coverDialog = null; c.requestUpdate(); }

export function openVacuumDialog(c: FloorplanStudioCard, d: Device): void {
  if (dialogOpen(c)) return;
  c._vacuumDialog = d;
  ensureDialogs(c);
  c.requestUpdate();
}
export function closeVacuumDialog(c: FloorplanStudioCard): void { c._vacuumDialog = null; c.requestUpdate(); }

export function openChooserDialog(c: FloorplanStudioCard, title: string, entities: string[], line?: () => string): void {
  if (dialogOpen(c)) return;
  c._chooserDialog = { title, entities, ...(line ? { line } : {}) };
  ensureDialogs(c);
  c.requestUpdate();
}
export function closeChooserDialog(c: FloorplanStudioCard): void { c._chooserDialog = null; c.requestUpdate(); }

export function coverService(c: FloorplanStudioCard, door: Door): "open_cover" | "close_cover" {
  return c._hass?.states[door.cover ?? ""]?.state === "open" ? "close_cover" : "open_cover";
}

/** The entry: for the floor on show, disabled with its reason when nothing on it is on. */
export function floorOffButton(c: FloorplanStudioCard) {
  const f = c._floor(), key = c._floorKey();
  if (!f || !key) return nothing;
  const none = c._replayGuard().replaying() || floorOffRows(f, c._stateForRender()).length === 0;
  return html`<button type="button" class="fp-floor-off" ?disabled=${none} title=${none ? t("Nothing is on on this floor") : t("Choose what to turn off on this floor")} @click=${() => openOffDialog(c)}>${t("Turn off on this floor…")}</button>`;
}

export function openOffDialog(c: FloorplanStudioCard): void {
  const f = c._floor(), key = c._floorKey();
  if (!f || !key || dialogOpen(c) || c._replayGuard().replaying()) return;
  const rows = floorOffRows(f, c._stateForRender());
  if (!rows.length) return;
  closePopup(c);
  c._offDialog = { floor: key, title: floorTitle(c, key), rows, ticked: rows.map(() => true) };
  ensureDialogs(c);
  c.requestUpdate();
}
export function closeOffDialog(c: FloorplanStudioCard): void { c._offDialog = null; c.requestUpdate(); }

const deps: DialogDeps = {
  html, nothing, t, OFF_GROUPS, OFF_GROUP_LABEL, floorOffCalls, fireEvent, callService, coverService,
  closeCover: closeCoverDialog, closeOff: closeOffDialog, closeVacuum: closeVacuumDialog, closeChooser: closeChooserDialog,
};

export const coverDialogTemplate = (c: FloorplanStudioCard) => (c._coverDialog ? dialogsMod.get()?.renderCoverDialog(deps, c) ?? null : null);
export const offDialogTemplate = (c: FloorplanStudioCard) => (c._offDialog ? dialogsMod.get()?.renderOffDialog(deps, c) ?? null : null);
export const vacuumDialogTemplate = (c: FloorplanStudioCard) => (c._vacuumDialog ? dialogsMod.get()?.renderVacuumDialog(deps, c) ?? null : null);
export const chooserDialogTemplate = (c: FloorplanStudioCard) => (c._chooserDialog ? dialogsMod.get()?.renderChooserDialog(deps, c) ?? null : null);
export const onDialogKeydown = (c: FloorplanStudioCard, e: KeyboardEvent) => { dialogsMod.get()?.handleDialogKeydown(deps, c, e); };
