// S48: Lazy coordinators for the per-entity/room history chart and the Plan legend overlay.
import { html, nothing } from "lit";
import { UI_ICONS } from "../core/icons";
import { t } from "../core/i18n";
import { lazy } from "./lazy";
import { closePopup } from "./card-popup";
import { fetchHistoryFor } from "./card-replay";
import type { FloorplanStudioCard } from "./floorplan-studio-card";
import type { HistorySeriesSpec } from "./history";
import type { HistoryIndex } from "./replay/history";

type HistoryLib = typeof import("./history");
type LegendLib = typeof import("./legend");

const historyMod = lazy<HistoryLib>(() => import("./history"), "__FPHISTORY_CHUNK__", "history");
const legendMod = lazy<LegendLib>(() => import("./legend"), "__FPLEGEND_CHUNK__", "legend");

export interface HistoryState {
  title: string;
  specs: HistorySeriesSpec[];
  hours: number;
  status: "loading" | "ready" | "error";
  index?: HistoryIndex;
  startMs: number;
  endMs: number;
  error?: string;
}

/** Opens the lazy sensor history chart overlay for `specs` (capped at 6 unique entities). */
export function openHistory(
  c: FloorplanStudioCard,
  title: string,
  specs: readonly HistorySeriesSpec[],
  hours = 24,
): void {
  const seen = new Set<string>(), uniq = specs.filter((s) => s?.id && !seen.has(s.id) && seen.add(s.id)).slice(0, 6).map((s) => ({ id: s.id, label: s.label || s.id }));
  if (!uniq.length) return;
  closePopup(c);
  c._legendOpen = false;
  const endMs = Date.now(), startMs = endMs - hours * 3600_000;
  const st: HistoryState = { title, specs: uniq, hours, status: "loading", startMs, endMs };
  c._history = st;
  c.requestUpdate();
  const pChunk = historyMod.load();
  if (!historyMod.get()) pChunk.then(() => { if (c._history === st) c.requestUpdate(); }, () => {});
  void Promise.all([pChunk, fetchHistoryFor(c, uniq.map((s) => s.id), startMs, endMs)]).then(
    ([, index]) => {
      if (c._history !== st) return;
      c._history = { ...st, status: "ready", index };
      c.requestUpdate();
    },
    (err) => {
      if (c._history !== st) return;
      c._history = { ...st, status: "error", error: String((err as { message?: unknown })?.message ?? err) };
      c.requestUpdate();
    },
  );
}

export function closeHistory(c: FloorplanStudioCard): void {
  if (!c._history) return;
  c._history = null;
  c.requestUpdate();
}

export function historyOverlay(c: FloorplanStudioCard) {
  const h = c._history, lib = h ? historyMod.get() : null;
  if (!h || !lib) return nothing;
  return lib.historyOverlayView({ html, nothing, t }, {
    ...h,
    series: h.status === "ready" ? lib.extractSeries(h.index, h.specs, h.startMs, h.endMs) : [],
    closeIcon: UI_ICONS.close,
    onWindow: (hrs) => openHistory(c, h.title, h.specs, hrs),
    onClose: () => closeHistory(c),
  });
}

export function openLegend(c: FloorplanStudioCard): void {
  closePopup(c);
  c._history = null;
  c._legendOpen = true;
  c.requestUpdate();
  if (!legendMod.get()) void legendMod.load().then(() => c.requestUpdate(), () => { c._legendOpen = false; c.requestUpdate(); });
}

export function closeLegend(c: FloorplanStudioCard): void {
  if (!c._legendOpen) return;
  c._legendOpen = false;
  c.requestUpdate();
}

export function legendOverlay(c: FloorplanStudioCard) {
  const lib = c._legendOpen ? legendMod.get() : null;
  return lib ? lib.legendOverlayView({ html, t }, UI_ICONS.close, () => closeLegend(c)) : nothing;
}
