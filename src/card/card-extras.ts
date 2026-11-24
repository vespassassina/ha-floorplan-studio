// S48 / S50: Minimal lazy loaders for history chart, Plan legend, and WYSIWYG scene editor overlays.
import { html, nothing } from "lit";
import { UI_ICONS } from "../core/icons";
import { t } from "../core/i18n";
import { customCalls, renderFloor } from "../core";
import { lazy } from "./lazy";
import { planPatch } from "./plan-patch";
import { closePopup } from "./card-popup";
import { fetchHistoryFor } from "./card-replay";
import type { FloorplanStudioCard } from "./floorplan-studio-card";
import type { HistoryHost, HistorySeriesSpec } from "./history";
import type { SceneEditorDraft } from "./scene";

type HistoryLib = typeof import("./history");
type LegendLib = typeof import("./legend");
type SceneLib = typeof import("./scene");

const historyMod = lazy<HistoryLib>(() => import("./history"), "__FPHISTORY_CHUNK__", "history");
const legendMod = lazy<LegendLib>(() => import("./legend"), "__FPLEGEND_CHUNK__", "legend");
const sceneMod = lazy<SceneLib>(() => import("./scene"), "__FPSCENE_CHUNK__", "scene");

export type HistoryState = NonNullable<HistoryHost["_history"]>;
export type { SceneEditorDraft };

function reset(c: FloorplanStudioCard) { c._history = null; c._legendOpen = false; c._sceneEd = null; }

export function closeExtras(c: FloorplanStudioCard): boolean {
  if (!c._history && !c._legendOpen && !c._sceneEd) return false;
  reset(c); c.requestUpdate(); return true;
}

function withMod<T>(c: FloorplanStudioCard, mod: { get(): T | null; load(): Promise<T> }, fn: (lib: T) => void) {
  closePopup(c); reset(c);
  const lib = mod.get();
  if (lib) fn(lib); else void mod.load().then(fn, () => {});
}

export const openHistory = (c: FloorplanStudioCard, title: string, specs: readonly (string | HistorySeriesSpec)[], hours = 24) =>
  withMod(c, historyMod, (lib) => lib.runCardHistory(c, title, specs, hours, (ids, a, b) => fetchHistoryFor(c, ids, a, b)));

export const openLegend = (c: FloorplanStudioCard) =>
  withMod(c, legendMod, () => { c._legendOpen = true; c.requestUpdate(); });

export const openSceneEditor = (c: FloorplanStudioCard, i: number) => withMod(c, sceneMod, (lib) => lib.openCardScene(c, i));

export function extrasOverlay(c: FloorplanStudioCard) {
  return c._sceneEd ? sceneMod.get()?.renderCardScene({ html, nothing, svgAttr: planPatch, renderFloor, customCalls }, c) ?? nothing
    : c._history ? historyMod.get()?.renderCardHistory({ html, nothing, t }, c, UI_ICONS.close, (ti, sp, hr) => openHistory(c, ti, sp, hr)) ?? nothing
    : c._legendOpen ? legendMod.get()?.legendOverlayView({ html, t }, UI_ICONS.close, () => closeExtras(c)) ?? nothing
    : nothing;
}
