import { type Device, type Door, floorOffRows } from "../core";
import { t } from "../core/i18n";
import { fireEvent } from "./actions";
import { html, nothing } from "lit";
import { floorTitle, pickRoom } from "./card-overview";
import { openHistory } from "./card-extras";
import { callService, closePopup, openPopup } from "./card-popup";
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
  return !!(c._coverDialog || c._vacuumDialog || c._chooserDialog || c._offDialog || c._ctxMenu);
}

export const openCtxMenu = (c: FloorplanStudioCard, e: MouseEvent): void => {
  e.preventDefault();
  closePopup(c);
  const { clientX: x, clientY: y } = e, el = e.target as Element | null;
  const apply = (lib: DialogsLib) => { c._ctxMenu = lib.resolveCtxMenu(c, x, y, el); c.requestUpdate(); };
  const lib = dialogsMod.get();
  if (lib) apply(lib);
  else void dialogsMod.load().then((m) => { if (c.isConnected) apply(m); }, () => {});
};
export const closeCtxMenu = (c: FloorplanStudioCard): void => { c._ctxMenu = null; c.requestUpdate(); };

function openDlg(c: FloorplanStudioCard, set: () => void): void {
  if (dialogOpen(c)) return;
  set();
  ensureDialogs(c);
  c.requestUpdate();
}

export const openCoverDialog = (c: FloorplanStudioCard, door: Door): void => openDlg(c, () => { c._coverDialog = door; });
export const closeCoverDialog = (c: FloorplanStudioCard): void => { c._coverDialog = null; c.requestUpdate(); };
export const openVacuumDialog = (c: FloorplanStudioCard, d: Device): void => openDlg(c, () => { c._vacuumDialog = d; });
export const closeVacuumDialog = (c: FloorplanStudioCard): void => { c._vacuumDialog = null; c.requestUpdate(); };
export const openChooserDialog = (c: FloorplanStudioCard, title: string, entities: string[], line?: () => string): void =>
  openDlg(c, () => { c._chooserDialog = { title, entities, ...(line ? { line } : {}) }; });
export const closeChooserDialog = (c: FloorplanStudioCard): void => { c._chooserDialog = null; c.requestUpdate(); };

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
  html, nothing, t, fireEvent, callService, coverService,
  closeCover: closeCoverDialog, closeOff: closeOffDialog, closeVacuum: closeVacuumDialog, closeChooser: closeChooserDialog,
  closeCtx: closeCtxMenu,
  openPopup: (c, sub, at) => openPopup(c, sub, at, null),
  openHistory: (c, entity, name) => openHistory(c, name, [entity]),
  pickRoom,
  resetView: (c) => { c._view3d?.reset(); c._view = null; c.requestUpdate(); },
  toggleView: (c) => { c._pickedView = c._shows3d() ? "2d" : "3d"; c._fallback3d = null; c.requestUpdate(); },
  toggleLabels: (c) => { c._pickedLabels = !c._labels(); c.requestUpdate(); },
};

export const dialogsTemplate = (c: FloorplanStudioCard) => (dialogOpen(c) ? dialogsMod.get()?.renderDialogs(deps, c) ?? null : null);
export const onDialogKeydown = (c: FloorplanStudioCard, e: KeyboardEvent) => { dialogsMod.get()?.handleDialogKeydown(deps, c, e); };
