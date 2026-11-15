import type { html as Html, nothing as Nothing } from "lit";

// B56.2/B56.3/B56.4: lazy energy counters chunk. Zero runtime imports from card/core: the card hands over lit and t().
export const ENERGY_CHUNK = "fp-energy-v1";

const STEP_MS = 300_000;
const SPARK_BINS = 24;
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

export type EnergySourceKind = "electricity" | "solar" | "gas" | "water";
export interface EnergySettings { hide?: readonly EnergySourceKind[]; show?: "use" | "cost" | "both"; spark?: boolean }
export type EnergyAsk = <T = unknown>(msg: Record<string, unknown>) => Promise<T>;
export interface CostRule { statCost?: string; fixedPrice?: number; priceEntity?: string }
export interface EnergyFlow { stat: string; cost: CostRule }
export interface EnergyPrefs {
  gridFrom: EnergyFlow[];
  gridTo: EnergyFlow[];
  solar: EnergyFlow[];
  gas: EnergyFlow[];
  water: EnergyFlow[];
}
export interface StatRow { start: number; end: number; change: number | null; mean: number | null }
export type StatsIndex = Map<string, StatRow[]>;

export type CounterResult =
  | { status: "ok"; use: number; cost: number | null | "nodata"; points: number[] }
  | { status: "nodata" };

export interface EnergyModel {
  prefs: EnergyPrefs;
  stats: StatsIndex;
  startMs: number;
  tMs: number;
  endMs: number;
  currency?: string;
  settings?: EnergySettings;
  hass?: { language?: string; locale?: { language?: string }; states?: Record<string, { attributes?: Record<string, unknown> } | undefined> };
}
export interface EnergyTools { html: typeof Html; nothing: typeof Nothing; t(key: string, vars?: Record<string, string | number>): string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const statStr = (v: unknown): string | undefined => (typeof v === "string" && v && !RESERVED.has(v) ? v : undefined);
const fin = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const toMs = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN);

function readCost(s: Record<string, unknown>, exp = false): CostRule {
  const rule: CostRule = {};
  const sc = statStr(exp ? s.stat_compensation : s.stat_cost);
  if (sc) rule.statCost = sc;
  const fp = fin(exp ? (s.number_energy_price_export ?? s.number_energy_price) : s.number_energy_price);
  if (fp !== undefined) rule.fixedPrice = fp;
  const pe = statStr(exp ? (s.entity_energy_price_export ?? s.entity_energy_price) : s.entity_energy_price);
  if (pe) rule.priceEntity = pe;
  return rule;
}

/** Parse HA's `energy/get_prefs` reply (supports both unified grid fields and legacy flow_from/flow_to arrays). */
export function parseEnergyPrefs(raw: unknown): EnergyPrefs | null {
  if (!isObj(raw) || !Array.isArray(raw.energy_sources)) return null;
  const prefs: EnergyPrefs = { gridFrom: [], gridTo: [], solar: [], gas: [], water: [] };
  for (const s of raw.energy_sources) {
    if (!isObj(s) || typeof s.type !== "string") continue;
    if (s.type === "grid") {
      if (Array.isArray(s.flow_from)) {
        for (const f of s.flow_from) {
          const st = isObj(f) && statStr(f.stat_energy_from);
          if (st) prefs.gridFrom.push({ stat: st, cost: readCost(f) });
        }
      } else {
        const st = statStr(s.stat_energy_from);
        if (st) prefs.gridFrom.push({ stat: st, cost: readCost(s) });
      }
      if (Array.isArray(s.flow_to)) {
        for (const f of s.flow_to) {
          const st = isObj(f) && statStr(f.stat_energy_to);
          if (st) prefs.gridTo.push({ stat: st, cost: readCost(f, true) });
        }
      } else {
        const st = statStr(s.stat_energy_to);
        if (st) prefs.gridTo.push({ stat: st, cost: readCost(s, true) });
      }
    } else if (s.type === "solar" || s.type === "gas" || s.type === "water") {
      const st = statStr(s.stat_energy_from);
      if (st) prefs[s.type].push({ stat: st, cost: readCost(s) });
    }
  }
  return prefs.gridFrom.length || prefs.gridTo.length || prefs.solar.length || prefs.gas.length || prefs.water.length ? prefs : null;
}

/** Deduplicated statistic IDs to request and whether `mean` is needed for any entity-price rule. */
export function statIdsFor(prefs: EnergyPrefs): { ids: string[]; needMean: boolean } {
  const ids = new Set<string>();
  let needMean = false;
  for (const flow of [...prefs.gridFrom, ...prefs.gridTo, ...prefs.solar, ...prefs.gas, ...prefs.water]) {
    ids.add(flow.stat);
    if (flow.cost.statCost) ids.add(flow.cost.statCost);
    else if (flow.cost.fixedPrice === undefined && flow.cost.priceEntity) {
      ids.add(flow.cost.priceEntity);
      needMean = true;
    }
  }
  return { ids: [...ids].sort(), needMean };
}

/** Parse HA's `recorder/statistics_during_period` reply into sorted bucket arrays per stat ID. */
export function parseStats(raw: unknown, asked: readonly string[]): StatsIndex {
  const index: StatsIndex = new Map();
  if (!isObj(raw)) return index;
  for (const id of new Set(asked)) {
    if (RESERVED.has(id) || !Object.prototype.hasOwnProperty.call(raw, id)) continue;
    const list = raw[id];
    if (!Array.isArray(list)) continue;
    const rows: StatRow[] = [];
    for (const r of list) {
      if (!isObj(r)) continue;
      const start = toMs(r.start), end = toMs(r.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const change = fin(r.change) ?? null;
      const mean = fin(r.mean) ?? null;
      rows.push({ start, end, change, mean });
    }
    rows.sort((a, b) => a.start - b.start);
    if (rows.length) index.set(id, rows);
  }
  return index;
}

interface Slice { start: number; end: number; change: number; frac: number }
interface Integrated { total: number; slices: Slice[] }

function integrateChange(series: StatRow[] | undefined, startMs: number, tMs: number): Integrated | null {
  if (!series || !series.length) return null;
  if (series[0].start - startMs >= STEP_MS) return null;
  if (tMs <= startMs) {
    const first = series[0];
    return first.change === null ? null : { total: 0, slices: [] };
  }
  let total = 0;
  let covered = series[0].start;
  const slices: Slice[] = [];
  for (const b of series) {
    if (b.end <= startMs) { covered = Math.max(covered, b.end); continue; }
    if (b.start >= tMs) break;
    if (b.start > startMs && b.start - covered > 1000) return null;
    if (b.change === null) return null;
    const a = Math.max(startMs, b.start), z = Math.min(tMs, b.end);
    const frac = (z - a) / (b.end - b.start);
    total += b.change * frac;
    slices.push({ start: b.start, end: b.end, change: b.change, frac });
    covered = b.end;
  }
  if (tMs - covered >= STEP_MS) return null;
  return { total, slices };
}

function priceMeanAt(series: StatRow[] | undefined, start: number, end: number): number | null {
  if (!series || !series.length) return null;
  let lo = 0, hi = series.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, b = series[mid];
    if (b.end <= start) lo = mid + 1;
    else if (b.start >= end) hi = mid - 1;
    else return b.mean;
  }
  return null;
}

function flowCost(flow: EnergyFlow, used: Integrated, stats: StatsIndex, startMs: number, tMs: number): number | null | "nodata" {
  const { statCost, fixedPrice, priceEntity } = flow.cost;
  if (statCost) {
    const c = integrateChange(stats.get(statCost), startMs, tMs);
    return c ? c.total : "nodata";
  }
  if (fixedPrice !== undefined) return used.total * fixedPrice;
  if (priceEntity) {
    const pSeries = stats.get(priceEntity);
    if (!pSeries) return "nodata";
    let sum = 0;
    for (const s of used.slices) {
      const m = priceMeanAt(pSeries, s.start, s.end);
      if (m === null) return "nodata";
      sum += s.change * s.frac * m;
    }
    return sum;
  }
  return null;
}

function sumFlows(
  flows: readonly EnergyFlow[],
  stats: StatsIndex,
  startMs: number,
  tMs: number,
): { use: number; cost: number | null | "nodata"; slices: { start: number; val: number }[] } | null {
  let use = 0;
  let hasCostRule = false;
  let costGap = false;
  let costSum = 0;
  const byBucket = new Map<number, number>();
  for (const flow of flows) {
    const intg = integrateChange(stats.get(flow.stat), startMs, tMs);
    if (!intg) return null;
    use += intg.total;
    for (const s of intg.slices) byBucket.set(s.start, (byBucket.get(s.start) ?? 0) + s.change);
    const fc = flowCost(flow, intg, stats, startMs, tMs);
    if (fc === "nodata") { hasCostRule = true; costGap = true; }
    else if (fc !== null) { hasCostRule = true; costSum += fc; }
  }
  const slices = [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([start, val]) => ({ start, val }));
  return { use, cost: !hasCostRule ? null : costGap ? "nodata" : costSum, slices };
}

function buildSpark(seriesList: { sign: 1 | -1; slices: { start: number; val: number }[] }[], startMs: number, endMs: number): number[] {
  const span = endMs - startMs;
  if (!(span > 0)) return [];
  const bins = new Array<number>(SPARK_BINS).fill(0);
  let maxBin = -1;
  for (const { sign, slices } of seriesList) {
    for (const s of slices) {
      const idx = Math.min(SPARK_BINS - 1, Math.max(0, Math.floor(((s.start - startMs) / span) * SPARK_BINS)));
      bins[idx] += sign * s.val;
      if (idx > maxBin) maxBin = idx;
    }
  }
  return maxBin < 0 ? [] : bins.slice(0, maxBin + 1);
}

/** Integrate 5-minute energy and cost counters at moment `tMs` over `[startMs, endMs]`. */
export function counterAt(
  prefs: EnergyPrefs,
  stats: StatsIndex,
  kind: EnergySourceKind,
  startMs: number,
  tMs: number,
  endMs: number,
): CounterResult {
  if (kind === "electricity") {
    const imp = sumFlows(prefs.gridFrom, stats, startMs, tMs);
    if (!imp) return { status: "nodata" };
    const sol = prefs.solar.length ? sumFlows(prefs.solar, stats, startMs, tMs) : { use: 0, cost: null, slices: [] };
    if (!sol) return { status: "nodata" };
    const exp = prefs.gridTo.length ? sumFlows(prefs.gridTo, stats, startMs, tMs) : { use: 0, cost: null, slices: [] };
    if (!exp) return { status: "nodata" };
    const points = buildSpark(
      [{ sign: 1, slices: imp.slices }, { sign: 1, slices: sol.slices }, { sign: -1, slices: exp.slices }],
      startMs,
      endMs,
    );
    return { status: "ok", use: imp.use + sol.use - exp.use, cost: imp.cost, points };
  }
  if (kind === "solar") {
    const sol = sumFlows(prefs.solar, stats, startMs, tMs);
    if (!sol) return { status: "nodata" };
    // Solar cost line is grid export compensation when export is present, otherwise solar's own cost if set.
    let cost: number | null | "nodata" = sol.cost;
    if (prefs.gridTo.length) {
      const exp = sumFlows(prefs.gridTo, stats, startMs, tMs);
      if (!exp) return { status: "nodata" };
      if (exp.cost !== null) cost = exp.cost;
    }
    return { status: "ok", use: sol.use, cost, points: buildSpark([{ sign: 1, slices: sol.slices }], startMs, endMs) };
  }
  const flows = kind === "gas" ? prefs.gas : prefs.water;
  const res = sumFlows(flows, stats, startMs, tMs);
  if (!res) return { status: "nodata" };
  return { status: "ok", use: res.use, cost: res.cost, points: buildSpark([{ sign: 1, slices: res.slices }], startMs, endMs) };
}

const ICONS: Record<EnergySourceKind, string> = {
  electricity: "M11,21H10L11,14H7.5C6.8,14 6.5,13.4 6.8,12.8L13,3H14L13,10H16.5C17.2,10 17.5,10.6 17.1,11.2L11,21Z",
  solar: "M12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7M12,2L14,5H10L12,2M12,22L10,19H14L12,22M2,12L5,10V14L2,12M22,12L19,14V10L22,12Z",
  gas: "M12,2C12,2 7,8.5 7,13.5A5,5 0 0,0 12,18.5A5,5 0 0,0 17,13.5C17,8.5 12,2 12,2M12,16.5A3,3 0 0,1 9,13.5C9,11.5 10.7,8.7 12,6.7C13.3,8.7 15,11.5 15,13.5A3,3 0 0,1 12,16.5Z",
  water: "M12,20A6,6 0 0,1 6,14C6,10 12,3.25 12,3.25C12,3.25 18,10 18,14A6,6 0 0,1 12,20Z",
};

const ALL_KINDS: EnergySourceKind[] = ["electricity", "solar", "gas", "water"];

function presentKinds(prefs: EnergyPrefs, hide?: readonly EnergySourceKind[]): EnergySourceKind[] {
  const hidden = new Set(hide ?? []);
  return ALL_KINDS.filter((k) => {
    if (hidden.has(k)) return false;
    if (k === "electricity") return prefs.gridFrom.length > 0 || prefs.gridTo.length > 0;
    return prefs[k].length > 0;
  });
}

function fmtNum(v: number, lang: string | undefined): string {
  const rounded = Math.abs(v) < 1e-9 ? 0 : v;
  try { return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(rounded); }
  catch { return String(Number(rounded.toFixed(2))); }
}

function fmtMoney(v: number, currency: string | undefined, lang: string | undefined): string {
  const rounded = Math.abs(v) < 1e-9 ? 0 : v;
  if (currency) {
    try { return new Intl.NumberFormat(lang, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rounded); }
    catch { /* invalid currency code in config */ }
  }
  return currency ? `${rounded.toFixed(2)} ${currency}` : rounded.toFixed(2);
}

function unitFor(kind: EnergySourceKind, prefs: EnergyPrefs, m: EnergyModel): string {
  if (kind === "electricity" || kind === "solar") return "kWh";
  const stat = prefs[kind][0]?.stat;
  const u = stat ? m.hass?.states?.[stat]?.attributes?.unit_of_measurement : undefined;
  return typeof u === "string" && u ? u : kind === "gas" ? "m³" : "L";
}

function sparkSvg(html: typeof Html, points: number[]): unknown {
  const lo = Math.min(0, ...points), hi = Math.max(lo + 1e-9, ...points), span = hi - lo;
  const stepX = 34 / Math.max(1, SPARK_BINS - 1);
  const pts = points.map((v, i) => `${(1 + i * stepX).toFixed(1)},${(13 - ((v - lo) / span) * 11).toFixed(1)}`).join(" ");
  return html`<svg class="fp-en-spark" viewBox="0 0 36 14" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points=${pts}/></svg>`;
}

/** Colours only through `--fp-*`. One row wrapping to two lines on narrow cards. */
export const ENERGY_CSS = `
.fp-en-chips{grid-area:en;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding-bottom:4px;min-width:0}
.fp-en-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid var(--fp-idle);border-radius:999px;font-size:12px;line-height:1.25;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--fp-ink);background:var(--fp-room)}
.fp-en-chip svg{width:14px;height:14px;flex:none;display:block}
.fp-en-chip .fp-en-spark{width:32px;height:12px;color:var(--fp-text)}
.fp-en-cost{color:var(--fp-text)}
`;

/** Draw the compact counter chips for the replay bar's head row. */
export function energyChipsView({ html, nothing, t }: EnergyTools, m: EnergyModel): unknown {
  const kinds = presentKinds(m.prefs, m.settings?.hide);
  if (!kinds.length) return nothing;
  const show = m.settings?.show ?? "both";
  const spark = m.settings?.spark !== false;
  const lang = m.hass?.language ?? m.hass?.locale?.language;
  return html`<style>${ENERGY_CSS}</style><div class="fp-en-chips">${kinds.map((k) => {
    const label = k === "electricity" ? t("Electricity (battery ignored)") : k === "solar" ? t("Solar") : k === "gas" ? t("Gas") : t("Water");
    const c = counterAt(m.prefs, m.stats, k, m.startMs, m.tMs, m.endMs);
    if (c.status === "nodata") {
      return html`<span class="fp-en-chip" data-k=${k} title=${label}><svg viewBox="0 0 24 24" aria-hidden="true"><path d=${ICONS[k]} fill="currentColor"/></svg><span>${t("no data")}</span></span>`;
    }
    const unit = unitFor(k, m.prefs, m);
    const num = fmtNum(c.use, lang);
    const useText = unit === "kWh" ? t("{n} kWh", { n: num }) : `${num} ${unit}`;
    const hasCost = c.cost !== null;
    const costText = c.cost === "nodata" ? t("no data") : typeof c.cost === "number" ? fmtMoney(c.cost, m.currency, lang) : "";
    const showUse = show === "use" || show === "both" || (show === "cost" && !hasCost);
    const showCost = hasCost && (show === "cost" || show === "both");
    return html`<span class="fp-en-chip" data-k=${k} title=${label}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${ICONS[k]} fill="currentColor"/></svg>
      ${showUse ? html`<span>${useText}</span>` : nothing}
      ${showCost ? html`<span class="fp-en-cost">${costText}</span>` : nothing}
      ${spark && c.points.length ? sparkSvg(html, c.points) : nothing}
    </span>`;
  })}</div>`;
}

/** Fetch HA Energy preferences (`energy/get_prefs`). */
export async function fetchEnergyPrefs(ask: EnergyAsk): Promise<EnergyPrefs | null> {
  return parseEnergyPrefs(await ask({ type: "energy/get_prefs" }));
}

/** Fetch 5-minute recorder statistics covering `[startMs, endMs]` for all active energy sources and price entities. */
export async function fetchEnergyStats(ask: EnergyAsk, prefs: EnergyPrefs, startMs: number, endMs: number): Promise<StatsIndex> {
  const { ids, needMean } = statIdsFor(prefs);
  if (!ids.length) return new Map();
  const raw = await ask({
    type: "recorder/statistics_during_period",
    start_time: new Date(startMs).toISOString(),
    end_time: new Date(endMs).toISOString(),
    statistic_ids: ids,
    period: "5minute",
    types: needMean ? ["change", "mean"] : ["change"],
    units: { energy: "kWh" },
  });
  return parseStats(raw, ids);
}
