// S65: Wall-tablet & mobile kiosk polish (`idle_return`, `idle_dim` screensaver, and `header_clock` + weather chip).
import { css, html, nothing } from "lit";
import { closeExtras } from "./card-extras";
import { pickRoom } from "./card-overview";
import { closePopup } from "./card-popup";
import { closeReplay, replayAlways } from "./card-replay";
import { resetView } from "./card-zoom";
import type { FloorplanStudioCard } from "./floorplan-studio-card";

/** Parses `idle_return` / `idle_dim` seconds from untrusted config (`5..86400`, else `0` = off). */
export const parseIdleSec = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 5 ? Math.min(86400, Math.round(v)) : 0;

/** 24-hour `HH:MM` clock string from epoch ms. */
export const formatClock = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Compact weather readout (`"21 °C · Sunny"`) from a HA `weather.*` state object, or `""` if missing/unavailable. */
export function formatWeatherChip(st: { state?: unknown; attributes?: Record<string, unknown> } | null | undefined): string {
  const raw = typeof st?.state === "string" ? st.state.trim() : "";
  if (!raw || raw === "unknown" || raw === "unavailable") return "";
  const a = st!.attributes ?? {};
  const t = typeof a.temperature === "number" && Number.isFinite(a.temperature) ? Math.round(a.temperature * 10) / 10 : null;
  const u = typeof a.temperature_unit === "string" && a.temperature_unit.trim() ? a.temperature_unit.trim() : "°C";
  const c = raw.replace(/[-_]+/g, " ");
  return [t !== null ? `${t} ${u}` : "", c[0]!.toUpperCase() + c.slice(1)].filter(Boolean).join(" · ");
}

export const KIOSK_CSS = css`
  .fp-head-clock,.fp-kiosk-clock{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;font:600 12px/1.2 var(--fp-font,system-ui,sans-serif);font-variant-numeric:tabular-nums;color:var(--fp-ink);background:var(--fp-room);border:1px solid var(--fp-idle);white-space:nowrap}
  .fp-kiosk-clock{position:absolute;top:8px;left:8px;z-index:4;pointer-events:none}
  .fp-screensaver{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:rgba(8,12,20,.82);color:#f3f6fb;cursor:pointer;font-family:var(--fp-font,system-ui,sans-serif);user-select:none}
  .fp-ss-time{font-size:clamp(36px,9vw,64px);font-weight:600;font-variant-numeric:tabular-nums}
  .fp-ss-weather{font-size:15px;opacity:.85}
`;

function defaultFloorKey(c: FloorplanStudioCard): string | null {
  const f = c._config.floor, fl = c._layout?.floors;
  if (!fl) return null;
  if (typeof f === "string" && f && f !== "all" && fl[f]) return f;
  if (Array.isArray(c._config.floors)) {
    const first = c._config.floors.find((k): k is string => typeof k === "string" && !!fl[k]);
    if (first) return first;
  }
  return Object.keys(fl)[0] ?? null;
}

export function applyIdleReturn(c: FloorplanStudioCard): void {
  closePopup(c);
  c._coverDialog = c._vacuumDialog = c._chooserDialog = c._offDialog = null;
  closeExtras(c);
  pickRoom(c, null);
  if (c._replay && !replayAlways(c)) closeReplay(c);
  resetView(c);
  const def = defaultFloorKey(c);
  if (def && def !== c._floorKey()) c._shownFloor = def;
  c.requestUpdate();
}

export function stopKioskTimers(c: FloorplanStudioCard): void {
  if (c._idleRetTimer !== null) { globalThis.clearTimeout(c._idleRetTimer); c._idleRetTimer = null; }
  if (c._idleDimTimer !== null) { globalThis.clearTimeout(c._idleDimTimer); c._idleDimTimer = null; }
  if (c._clockTimer !== null) { globalThis.clearInterval(c._clockTimer); c._clockTimer = null; }
}

export function syncKioskTimers(c: FloorplanStudioCard): void {
  stopKioskTimers(c);
  if (!c.isConnected) return;
  const r = parseIdleSec(c._config.idle_return), d = parseIdleSec(c._config.idle_dim);
  if (r) c._idleRetTimer = globalThis.setTimeout(() => { c._idleRetTimer = null; applyIdleReturn(c); }, r * 1000) as unknown as number;
  if (d && !c._dimmed) c._idleDimTimer = globalThis.setTimeout(() => { c._idleDimTimer = null; c._dimmed = true; syncKioskTimers(c); c.requestUpdate(); }, d * 1000) as unknown as number;
  if (c._config.header_clock === true || c._dimmed) c._clockTimer = globalThis.setInterval(() => { if (c.isConnected) c.requestUpdate(); }, 30_000) as unknown as number;
}

export function touchKioskIdle(c: FloorplanStudioCard): void {
  if (!c._dimmed && (parseIdleSec(c._config.idle_return) || parseIdleSec(c._config.idle_dim))) syncKioskTimers(c);
}

const clockPair = (c: FloorplanStudioCard) => [formatClock(Date.now()), formatWeatherChip(c._hass?.states?.[c._weatherId()])] as const;

export function clockChipTemplate(c: FloorplanStudioCard, kioskPill = false) {
  if (c._config.header_clock !== true) return nothing;
  const [tm, w] = clockPair(c);
  return html`<span class=${kioskPill ? "fp-kiosk-clock" : "fp-head-clock"} data-clock>${w ? `${tm} · ${w}` : tm}</span>`;
}

export function screensaverTemplate(c: FloorplanStudioCard) {
  if (!c._dimmed) return nothing;
  const [tm, w] = clockPair(c);
  const wake = (e: Event) => { e.preventDefault(); e.stopPropagation(); c._dimmed = false; syncKioskTimers(c); c.requestUpdate(); };
  return html`<div class="fp-screensaver" role="button" tabindex="0" aria-label="Wake" @pointerdown=${wake} @click=${wake} @keydown=${wake}><div class="fp-ss-time">${tm}</div>${w ? html`<div class="fp-ss-weather">${w}</div>` : nothing}</div>`;
}
