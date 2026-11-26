// S48 / S50: Minimal lazy loaders for history chart, Plan legend, and WYSIWYG scene editor overlays.
import { html, nothing } from "lit";
import { UI_ICONS } from "../core/icons";
import { t } from "../core/i18n";
import { customCalls, renderFloor, roomAt, ROOM_OWNS } from "../core";
import type { Floor } from "../core";
import { lazy } from "./lazy";
import { planPatch } from "./plan-patch";
import { callService, closePopup } from "./card-popup";
import { fetchHistoryFor } from "./card-replay";
import type { FloorplanStudioCard } from "./floorplan-studio-card";
import type { HistoryHost, HistorySeriesSpec, PresenceState } from "./history";
import type { SceneEditorDraft } from "./scene";

type HistoryLib = typeof import("./history");
type LegendLib = typeof import("./legend");
type SceneLib = typeof import("./scene");
type CarLib = typeof import("./car");

const historyMod = lazy<HistoryLib>(() => import("./history"), "__FPHISTORY_CHUNK__", "history");
const legendMod = lazy<LegendLib>(() => import("./legend"), "__FPLEGEND_CHUNK__", "legend");
const sceneMod = lazy<SceneLib>(() => import("./scene"), "__FPSCENE_CHUNK__", "scene");
const carMod = lazy<CarLib>(() => import("./car"), "__FPCAR_CHUNK__", "car");

export type HistoryState = NonNullable<HistoryHost["_history"]>;
export type { PresenceState, SceneEditorDraft };

/** S77: returns cached per-room presence heat values (or kicks off a lazy 24 h history fetch). */
export function presenceValues(c: FloorplanStudioCard, f: Floor, floorKey: string): PresenceState | null {
  const rp = c._replay;
  const endMs = rp && !rp.idle ? rp.end : Date.now();
  const hours = rp && !rp.idle ? rp.hours : 24;
  const startMs = endMs - hours * 3600_000;
  const key = `${floorKey}:${Math.floor(endMs / 300_000)}:${hours}`;
  if (c._presence?.key === key) return c._presence;
  const st: PresenceState = { key, status: "loading" };
  c._presence = st;
  const run = (lib: HistoryLib) => {
    if (c._presence === st) lib.runCardPresence(c, f, key, roomAt as never, ROOM_OWNS, startMs, endMs, (ids, a, b) => fetchHistoryFor(c, ids, a, b));
  };
  const lib = historyMod.get();
  if (lib) run(lib); else void historyMod.load().then(run, () => { if (c._presence === st) { c._presence = { key, status: "error" }; c.requestUpdate(); } });
  return c._presence;
}

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

/** S64.2: renders the rich car popover section inside `.fp-pop` once the lazy car chunk is loaded. */
export function carExtra(c: FloorplanStudioCard, entities: readonly string[]): unknown {
  const lib = carMod.get();
  if (!lib) {
    void carMod.load().then(() => { if (c.isConnected && c._popup?.s.type === "car") c.requestUpdate(); }, () => {});
    return nothing;
  }
  return lib.renderCarPopover(
    {
      html, nothing, kiosk: c._kiosk(),
      confirmEntity: c._carConfirm,
      setConfirm: (entity) => { c._carConfirm = entity; c.requestUpdate(); },
      callService: (d, s, data) => callService(c, d, s, data),
    },
    entities,
    c._stateForRender(),
  );
}

export function extrasOverlay(c: FloorplanStudioCard) {
  return c._sceneEd ? sceneMod.get()?.renderCardScene({ html, nothing, svgAttr: planPatch, renderFloor, customCalls }, c) ?? nothing
    : c._history ? historyMod.get()?.renderCardHistory({ html, nothing, t }, c, UI_ICONS.close, (ti, sp, hr) => openHistory(c, ti, sp, hr)) ?? nothing
    : c._legendOpen ? legendMod.get()?.legendOverlayView({ html, t }, UI_ICONS.close, () => closeExtras(c)) ?? nothing
    : nothing;
}
