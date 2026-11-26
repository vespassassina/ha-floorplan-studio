// S48: Popup history chart for a room's or device's sensors. Zero runtime imports so Rollup keeps this chunk isolated.
import type { html as Html, nothing as Nothing } from "lit";
import type { HistoryIndex } from "../replay/history";

export const HISTORY_CHUNK = "fp-history-v1";

export interface HistoryTools {
  html: typeof Html;
  nothing: typeof Nothing;
  t(key: string, vars?: Record<string, string | number>): string;
}

export interface HistorySeriesSpec { id: string; label: string }
export interface NumericPoint { t: number; v: number }
export interface NumericSeries { kind: "numeric"; id: string; label: string; unit: string; points: NumericPoint[]; min: number; max: number; latest: number }
export interface DiscreteSegment { start: number; end: number; state: string; active: boolean }
export interface DiscreteSeries { kind: "discrete"; id: string; label: string; segments: DiscreteSegment[]; latest: string }
export type ChartSeries = NumericSeries | DiscreteSeries;

export interface HistoryOverlayModel {
  title: string;
  hours: number;
  status: "loading" | "ready" | "error";
  error?: string;
  series: ChartSeries[];
  startMs: number;
  endMs: number;
  closeIcon: string;
  onWindow(hours: number): void;
  onClose(): void;
}

const MAX_SERIES = 6;
const MAX_POINTS = 120;
const WINDOWS = [6, 24, 168] as const;
const NUM_RE = /^-?\d+(\.\d+)?$/;
const INACTIVE = new Set(["off", "closed", "locked", "idle", "standby", "unavailable", "unknown", "clear", "not_home", "disarmed"]);
const SERIES_COLORS = ["--fp-primary", "--fp-dev-heater", "--fp-dev-person", "--fp-dev-light", "--fp-warn", "--fp-dev-motion"];

function downsample(pts: NumericPoint[]): NumericPoint[] {
  if (pts.length <= MAX_POINTS) return pts;
  const out: NumericPoint[] = [pts[0]!];
  const step = (pts.length - 1) / (MAX_POINTS - 1);
  for (let i = 1; i < MAX_POINTS - 1; i++) out.push(pts[Math.round(i * step)]!);
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Extracts numeric polylines and discrete state timelines from a Replay `HistoryIndex`. */
export function extractSeries(
  index: HistoryIndex | undefined,
  specs: readonly HistorySeriesSpec[],
  startMs: number,
  endMs: number,
): ChartSeries[] {
  if (!index || !(endMs > startMs)) return [];
  const out: ChartSeries[] = [];
  for (const sp of specs.slice(0, MAX_SERIES)) {
    const rows = index.get(sp.id);
    if (!Array.isArray(rows) || !rows.length) continue;
    const nums: NumericPoint[] = [];
    let unit = "";
    for (const r of rows) {
      if (!r || typeof r.state !== "string" || typeof r.lu !== "number" || !Number.isFinite(r.lu)) continue;
      if (!unit && typeof r.attributes?.unit_of_measurement === "string") unit = r.attributes.unit_of_measurement;
      const s = r.state.trim();
      if (!NUM_RE.test(s)) continue;
      const v = Number(s);
      if (!Number.isFinite(v)) continue;
      nums.push({ t: Math.max(startMs, Math.min(endMs, r.lu * 1000)), v });
    }
    if (nums.length) {
      let min = Infinity, max = -Infinity;
      for (const p of nums) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; }
      const latest = nums[nums.length - 1]!.v;
      out.push({ kind: "numeric", id: sp.id, label: sp.label || sp.id, unit, points: downsample(nums), min, max, latest });
      continue;
    }
    const segs: DiscreteSegment[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r || typeof r.state !== "string" || typeof r.lu !== "number" || !Number.isFinite(r.lu)) continue;
      const s0 = Math.max(startMs, Math.min(endMs, r.lu * 1000));
      const next = rows[i + 1];
      const e0 = next && typeof next.lu === "number" && Number.isFinite(next.lu) ? Math.max(startMs, Math.min(endMs, next.lu * 1000)) : endMs;
      if (e0 <= s0) continue;
      segs.push({ start: s0, end: e0, state: r.state, active: !INACTIVE.has(r.state.toLowerCase()) });
    }
    if (segs.length) out.push({ kind: "discrete", id: sp.id, label: sp.label || sp.id, segments: segs, latest: segs[segs.length - 1]!.state });
  }
  return out;
}

const fmtVal = (v: number, unit: string) => {
  const n = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return unit ? `${n} ${unit}` : String(n);
};
const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export const HISTORY_CSS = `
.fp-hist-ov{position:absolute;inset:12px;margin:auto;width:min(390px,calc(100% - 24px));max-height:calc(100% - 24px);height:fit-content;z-index:5;display:flex;flex-direction:column;background:color-mix(in srgb,var(--fp-room) 94%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid var(--fp-idle);border-radius:12px;color:var(--fp-ink);font:12px/1.35 var(--fp-font,system-ui,sans-serif);box-shadow:0 8px 24px rgba(0,0,0,.35);overflow:hidden}
.fp-hist-hd{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--fp-idle)}
.fp-hist-title{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fp-hist-win{display:inline-flex;gap:4px}
.fp-hist-win button{appearance:none;border:1px solid var(--fp-idle);background:transparent;color:var(--fp-ink);border-radius:999px;padding:2px 8px;font:11px/1.4 var(--fp-font,system-ui,sans-serif);cursor:pointer}
.fp-hist-win button[aria-pressed=true]{background:var(--fp-ink);color:var(--fp-room);border-color:var(--fp-ink)}
.fp-hist-x{appearance:none;background:none;border:0;color:var(--fp-ink);cursor:pointer;padding:2px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center}
.fp-hist-x svg{width:16px;height:16px}
.fp-hist-bd{padding:10px 12px;overflow:auto;display:flex;flex-direction:column;gap:8px}
.fp-hist-svg{width:100%;height:132px;display:block;overflow:visible}
.fp-hist-grid{stroke:var(--fp-idle);stroke-opacity:.5;stroke-width:1;stroke-dasharray:2 2}
.fp-hist-tick{fill:var(--fp-text);font-size:9px;font-variant-numeric:tabular-nums}
.fp-hist-axes{display:flex;justify-content:space-between;color:var(--fp-text);font-size:10px;font-variant-numeric:tabular-nums}
.fp-hist-leg{display:flex;flex-wrap:wrap;gap:6px 10px}
.fp-hist-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-variant-numeric:tabular-nums}
.fp-hist-dot{width:8px;height:8px;border-radius:50%;flex:none}
.fp-hist-disc{display:flex;flex-direction:column;gap:4px}
.fp-hist-drow{display:flex;flex-direction:column;gap:2px}
.fp-hist-dhd{display:flex;justify-content:space-between;font-size:11px;color:var(--fp-text)}
.fp-hist-bar{width:100%;height:12px;display:block;border-radius:4px;overflow:hidden}
.fp-hist-msg{margin:8px 0;text-align:center;color:var(--fp-text)}
`;

export function historyOverlayView({ html, nothing, t }: HistoryTools, m: HistoryOverlayModel): unknown {
  const numSeries = m.series.filter((s): s is NumericSeries => s.kind === "numeric");
  const discSeries = m.series.filter((s): s is DiscreteSeries => s.kind === "discrete");
  const span = Math.max(1, m.endMs - m.startMs);
  const W = 340, H = 120, PAD_T = 6, PAD_B = 6, UH = H - PAD_T - PAD_B;
  const units = new Set(numSeries.map((s) => s.unit));
  const shared = units.size === 1;
  const gMin = shared ? Math.min(...numSeries.map((s) => s.min)) : 0;
  const gMax = shared ? Math.max(...numSeries.map((s) => s.max)) : 1;

  return html`<style>${HISTORY_CSS}</style><div class="fp-hist-ov" role="dialog" aria-label=${m.title} data-pop>
    <div class="fp-hist-hd">
      <span class="fp-hist-title">${m.title}</span>
      <div class="fp-hist-win" role="group" aria-label=${t("Window")}>
        ${WINDOWS.map((h) => html`<button type="button" aria-pressed=${h === m.hours ? "true" : "false"} @click=${() => m.onWindow(h)}>${h > 48 ? t("{n} d", { n: h / 24 }) : t("{n} h", { n: h })}</button>`)}
      </div>
      <button type="button" class="fp-hist-x" aria-label=${t("Close chart")} title=${t("Close chart")} @click=${m.onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d=${m.closeIcon} fill="currentColor"/></svg></button>
    </div>
    <div class="fp-hist-bd">
      ${m.status === "loading" ? html`<p class="fp-hist-msg">${t("Loading…")}</p>`
        : m.status === "error" ? html`<p class="fp-hist-msg">${m.error ?? t("no data")}</p>`
        : !m.series.length ? html`<p class="fp-hist-msg">${t("no data")}</p>`
        : html`${numSeries.length ? html`<svg class="fp-hist-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label=${m.title}>
            <line class="fp-hist-grid" x1="0" y1=${PAD_T} x2=${W} y2=${PAD_T}/>
            <line class="fp-hist-grid" x1="0" y1=${PAD_T + UH / 2} x2=${W} y2=${PAD_T + UH / 2}/>
            <line class="fp-hist-grid" x1="0" y1=${H - PAD_B} x2=${W} y2=${H - PAD_B}/>
            ${shared ? html`<text class="fp-hist-tick" x="2" y=${PAD_T + 8}>${fmtVal(gMax, numSeries[0]!.unit)}</text><text class="fp-hist-tick" x="2" y=${H - PAD_B - 2}>${fmtVal(gMin, numSeries[0]!.unit)}</text>` : nothing}
            ${numSeries.map((s, si) => {
              const lo = shared ? gMin : s.min, hi = shared ? gMax : s.max, rng = Math.max(1e-6, hi - lo);
              const pts = s.points.map((p) => `${(((p.t - m.startMs) / span) * W).toFixed(1)},${(PAD_T + UH - ((p.v - lo) / rng) * UH).toFixed(1)}`).join(" ");
              const col = `var(${SERIES_COLORS[si % SERIES_COLORS.length]})`;
              return html`<polyline fill="none" stroke=${col} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points=${pts}/>`;
            })}
          </svg>
          <div class="fp-hist-axes"><span>${fmtClock(m.startMs)}</span><span>${fmtClock((m.startMs + m.endMs) / 2)}</span><span>${fmtClock(m.endMs)}</span></div>
          <div class="fp-hist-leg">${numSeries.map((s, si) => html`<span class="fp-hist-chip"><span class="fp-hist-dot" style="background:var(${SERIES_COLORS[si % SERIES_COLORS.length]})"></span><span>${s.label}</span><strong>${fmtVal(s.latest, s.unit)}</strong><span>(${fmtVal(s.min, "")}–${fmtVal(s.max, s.unit)})</span></span>`)}</div>` : nothing}
          ${discSeries.length ? html`<div class="fp-hist-disc">${discSeries.map((s) => html`<div class="fp-hist-drow">
            <div class="fp-hist-dhd"><span>${s.label}</span><strong>${s.latest}</strong></div>
            <svg class="fp-hist-bar" viewBox="0 0 ${W} 12" preserveAspectRatio="none" role="img" aria-label=${s.label}>
              <rect x="0" y="0" width=${W} height="12" fill="var(--fp-idle)" fill-opacity="0.35"/>
              ${s.segments.filter((g) => g.active).map((g) => {
                const x = ((g.start - m.startMs) / span) * W, w = Math.max(1.5, ((g.end - g.start) / span) * W);
                return html`<rect x=${x.toFixed(1)} y="0" width=${w.toFixed(1)} height="12" fill="var(--fp-primary)"/>`;
              })}
            </svg>
          </div>`)}</div>` : nothing}`}
    </div>
  </div>`;
}

export interface HistoryHost {
  _history: { title: string; specs: HistorySeriesSpec[]; hours: number; status: "loading" | "ready" | "error"; index?: HistoryIndex; startMs: number; endMs: number; error?: string } | null;
  _hass?: { states?: Record<string, { attributes?: Record<string, unknown> } | undefined> };
  requestUpdate(): void;
}

/** Runs the fetch + state transition inside the lazy history chunk to keep main card bundle tiny. */
export function runCardHistory(
  c: HistoryHost,
  title: string,
  specs: readonly (string | HistorySeriesSpec)[],
  hours: number,
  fetchFn: (ids: string[], startMs: number, endMs: number) => Promise<HistoryIndex>,
): void {
  const seen = new Set<string>();
  const uniq = specs.map((s) => (typeof s === "string" ? { id: s, label: (c._hass?.states?.[s]?.attributes?.friendly_name as string) || title || s } : { id: s.id, label: s.label || s.id }))
    .filter((s) => s.id && !seen.has(s.id) && seen.add(s.id))
    .slice(0, MAX_SERIES);
  if (!uniq.length) return;
  const endMs = Date.now(), startMs = endMs - hours * 3600_000;
  const st = { title, specs: uniq, hours, status: "loading" as const, startMs, endMs };
  c._history = st;
  c.requestUpdate();
  void fetchFn(uniq.map((s) => s.id), startMs, endMs).then(
    (index) => { if (c._history === st) { c._history = { ...st, status: "ready", index }; c.requestUpdate(); } },
    (err) => { if (c._history === st) { c._history = { ...st, status: "error", error: String((err as { message?: unknown })?.message ?? err) }; c.requestUpdate(); } },
  );
}

export function renderCardHistory(
  tools: HistoryTools,
  c: HistoryHost,
  closeIcon: string,
  onWindow: (title: string, specs: readonly HistorySeriesSpec[], hours: number) => void,
): unknown {
  const h = c._history;
  if (!h) return tools.nothing;
  return historyOverlayView(tools, {
    ...h,
    series: h.status === "ready" ? extractSeries(h.index, h.specs, h.startMs, h.endMs) : [],
    closeIcon,
    onWindow: (hrs) => onWindow(h.title, h.specs, hrs),
    onClose: () => { c._history = null; c.requestUpdate(); },
  });
}

// ---- S77: per-room presence heat map over a day (zero-import, lives in the lazy history chunk) ----

const PRESENCE_ON = new Set(["on", "detected", "occupied", "home"]);
const PRESENCE_CAP_MS = 8 * 3600_000;

export type PresenceValues = Record<number, { text: string; t: number }>;
export interface PresenceState { key: string; status: "loading" | "ready" | "error"; values?: PresenceValues }
export interface PresenceHost { _presence: PresenceState | null; requestUpdate(): void }

function fmtDuration(ms: number): string {
  if (!(ms > 0)) return "0m";
  if (ms < 60_000) return "<1m";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Collects per-room motion/radar/attached-motion entity ids for a floor. */
export function presenceSensorsForFloor(
  f: { rooms?: readonly { kind?: unknown; motion?: unknown }[]; devices?: readonly { type?: unknown; entity?: unknown; motion?: unknown; x?: unknown; y?: unknown }[] } | null | undefined,
  roomAtFn: (f: never, pt: [number, number]) => number,
  roomOwns: Record<string, boolean>,
): Map<number, string[]> {
  const out = new Map<number, Set<string>>();
  const rooms = Array.isArray(f?.rooms) ? f.rooms : [];
  const add = (i: number, id: unknown) => {
    if (typeof id !== "string" || !id || !rooms[i] || !roomOwns[String(rooms[i]!.kind)]) return;
    let s = out.get(i);
    if (!s) { s = new Set(); out.set(i, s); }
    s.add(id);
  };
  rooms.forEach((r, i) => {
    if (Array.isArray(r?.motion)) (r.motion as unknown[]).forEach((id) => add(i, id));
  });
  for (const d of Array.isArray(f?.devices) ? f.devices : []) {
    if (!d || typeof d !== "object") continue;
    const x = d.x, y = d.y;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const i = roomAtFn(f as never, [x, y]);
    if (i < 0) continue;
    if (d.type === "motion" || d.type === "radar") add(i, d.entity);
    if (d.motion) add(i, d.motion);
  }
  return new Map([...out].map(([i, s]) => [i, [...s]]));
}

/** Pure per-room occupied duration & heat value (0..1 capped at 8 h) using merged ON intervals across sensors. */
export function presenceHeat(
  roomSensors: Map<number, readonly string[]>,
  index: HistoryIndex | undefined,
  startMs: number,
  endMs: number,
): PresenceValues {
  const out: PresenceValues = Object.create(null);
  if (!index || !(endMs > startMs)) return out;
  for (const [roomIdx, ids] of roomSensors) {
    const intervals: [number, number][] = [];
    let hasData = false;
    for (const id of ids) {
      const rows = index.get(id);
      if (!Array.isArray(rows) || !rows.length) continue;
      hasData = true;
      for (let j = 0; j < rows.length; j++) {
        const r = rows[j];
        if (!r || typeof r.state !== "string" || typeof r.lu !== "number" || !Number.isFinite(r.lu)) continue;
        if (!PRESENCE_ON.has(r.state.trim().toLowerCase())) continue;
        const s0 = Math.max(startMs, Math.min(endMs, r.lu * 1000));
        const next = rows[j + 1];
        const e0 = next && typeof next.lu === "number" && Number.isFinite(next.lu) ? Math.max(startMs, Math.min(endMs, next.lu * 1000)) : endMs;
        if (e0 > s0) intervals.push([s0, e0]);
      }
    }
    if (!hasData) continue;
    intervals.sort((a, b) => a[0] - b[0]);
    let totalMs = 0;
    let curS = -1, curE = -1;
    for (const [s, e] of intervals) {
      if (curS < 0) { curS = s; curE = e; }
      else if (s <= curE) curE = Math.max(curE, e);
      else { totalMs += curE - curS; curS = s; curE = e; }
    }
    if (curS >= 0) totalMs += curE - curS;
    const t = Math.min(1, Math.round((totalMs / PRESENCE_CAP_MS) * 1000) / 1000);
    out[roomIdx] = { text: fmtDuration(totalMs), t };
  }
  return out;
}

/** Fetches 24 h (or active replay window) history for presence sensors and stores per-room heat values on the host. */
export function runCardPresence(
  c: PresenceHost,
  f: Parameters<typeof presenceSensorsForFloor>[0],
  key: string,
  roomAtFn: (f: never, pt: [number, number]) => number,
  roomOwns: Record<string, boolean>,
  startMs: number,
  endMs: number,
  fetchFn: (ids: string[], startMs: number, endMs: number) => Promise<HistoryIndex>,
): void {
  const sensors = presenceSensorsForFloor(f, roomAtFn, roomOwns);
  const allIds = [...new Set([...sensors.values()].flat())];
  if (!allIds.length) {
    c._presence = { key, status: "ready", values: Object.create(null) };
    c.requestUpdate();
    return;
  }
  const st: PresenceState = { key, status: "loading" };
  c._presence = st;
  void fetchFn(allIds, startMs, endMs).then(
    (index) => { if (c._presence === st) { c._presence = { key, status: "ready", values: presenceHeat(sensors, index, startMs, endMs) }; c.requestUpdate(); } },
    () => { if (c._presence === st) { c._presence = { key, status: "error", values: Object.create(null) }; c.requestUpdate(); } },
  );
}
